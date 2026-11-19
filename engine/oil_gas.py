"""LTEC deal engine — oil & gas module (#46): non-operated working interests bought through a sponsor's joint venture.

A deal file names its wells, the venture's working and net revenue interests, the sponsor's turnkey price and the
investor's check. Each case sets production (a per-well decline curve calibrated to a stated current rate), prices,
costs and tax treatment. The engine runs month by month:

    per-well volume (8/8ths) -> investor revenue at its NRI -> production taxes, gathering, LOE at its WI, fees
    -> net cash by production month -> paid on the pay day after a lag (back production on the first pay date)
    -> pre-tax investor flows, then a tax layer (year-1 deduction, the rest by depletion or the next year)

engine/oil_gas.js is a line-for-line port (tests/test_oil_gas.py checks parity). Nothing deal-specific lives here.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from engine.core import add_months, load_deal, merge_deep  # noqa: E402

IRR_GRID = [-0.9, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 10.0]


def xirr(flows: list[float], dates: list[date]) -> float | None:
    """XIRR (actual/365). Long well lives can end in small negative months, which gives a second sign change far
    near -100%; and after-tax flows can turn negative late (tax on income). Bracket the highest root on a fixed grid
    (the usual investment answer), then bisect. None when no bracket."""
    if not any(cf < -1e-9 for cf in flows) or not any(cf > 1e-9 for cf in flows):
        return None
    d0 = dates[0]
    yrs = [(d - d0).days / 365.0 for d in dates]

    def f(r):
        return sum(cf / (1 + r) ** y for cf, y in zip(flows, yrs))

    vals = [f(r) for r in IRR_GRID]
    best = -1
    for i in range(len(IRR_GRID) - 1):
        if vals[i] * vals[i + 1] < 0 or vals[i + 1] == 0:
            best = i
    if best < 0:
        return IRR_GRID[0] if vals[0] == 0 else None
    if vals[best + 1] == 0:
        return IRR_GRID[best + 1]
    lo, hi = IRR_GRID[best], IRR_GRID[best + 1]
    f_lo = vals[best]
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = f(mid)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi = mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2

CASE_META = ("label", "note", "from")


# ---------------------------------------------------------------- months and dates

def month_index(iso: str) -> int:
    """'YYYY-MM' or 'YYYY-MM-DD' -> months since year 0."""
    y, m = int(iso[0:4]), int(iso[5:7])
    return y * 12 + m - 1


def month_key(mi: int) -> str:
    return f"{mi // 12:04d}-{mi % 12 + 1:02d}"


def days_in_month(mi: int) -> int:
    y, m = mi // 12, mi % 12 + 1
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - date(y, m, 1)).days


def pay_date(mi: int, day: int) -> str:
    return date(mi // 12, mi % 12 + 1, min(day, days_in_month(mi))).isoformat()


# ---------------------------------------------------------------- cases

def case_params(inp: dict, key: str) -> dict:
    """A case's full parameters: its `from` case's (recursively), with its own on top (deep merge)."""
    c = inp["cases"][key]
    own = {k: v for k, v in c.items() if k not in CASE_META}
    if c.get("from"):
        return merge_deep(case_params(inp, c["from"]), own)
    return json.loads(json.dumps(own))


def well_shape(t: float, b: float, di: float, dmin: float) -> float:
    """Rate at t years as a share of the initial rate: Arps hyperbolic (b > 0) or exponential (b = 0) at nominal
    initial decline di, switching to exponential at dmin once the hyperbolic decline falls to it."""
    if di <= 0:
        return 1.0
    if b <= 0:
        return math.exp(-di * t)
    ts = (di / dmin - 1) / (b * di) if dmin > 0 and di > dmin else math.inf
    if t <= ts:
        return (1 + b * di * t) ** (-1 / b)
    return (1 + b * di * ts) ** (-1 / b) * math.exp(-dmin * (t - ts))


def wti_at(p: dict, mi: int) -> float:
    w = p["wti"]
    k = month_key(mi)
    if k in (w.get("history") or {}):
        return w["history"][k]
    ys = w.get("years") or {}
    return ys[str(mi // 12)] if str(mi // 12) in ys else w["long_term"]


def realized_price(p: dict, wti: float) -> float:
    """$ per BOE: the oil share at WTI less the differential; gas and NGLs at gas_ngl_price (None = priced as oil)."""
    oil = wti - p["differential"]
    other = oil if p.get("gas_ngl_price") is None else p["gas_ngl_price"]
    return p["oil_share"] * oil + (1 - p["oil_share"]) * other


def shares(inp: dict) -> dict:
    """The investor's share of the venture and its look-through WI / NRI in each well."""
    d, chk = inp["deal"], inp["investor"]["check"]
    raise_total = d["units_offered"] * d["unit_price"]
    s = chk / raise_total
    return {"of_raise": s, "units": chk / d["unit_price"],
            "wi": d["venture_wi"] * (1 - d["manager_share"]) * s,
            "nri": d["venture_nri"] * (1 - d["manager_share"]) * s}


# ---------------------------------------------------------------- one case

def run_case(key: str, inp: dict) -> dict:
    d, inv = inp["deal"], inp["investor"]
    p = case_params(inp, key)
    pr = p["production"]
    sh = shares(inp)
    wells = d["wells"]
    on = [month_index(w["online"]) for w in wells]
    on_day = [int(w["online"][8:10]) for w in wells]
    m0, n = min(on), d["horizon_months"]
    b, di, dmin = pr["b"], pr["di"], pr["dmin"]

    def t_of(k: int, mi: int) -> float:
        return (mi - on[k] + 0.5) / 12

    # calibrate: the average rate of the wells online in rate_month equals the stated rate (if none are online
    # by then, the stated rate is each well's first month)
    rm = month_index(pr["rate_month"])
    live = [k for k in range(len(wells)) if on[k] <= rm]
    if live:
        avg = sum(well_shape(t_of(k, rm), b, di, dmin) for k in live) / len(live)
    else:
        avg = well_shape(0.5 / 12, b, di, dmin)
    qi = pr["rate"] / avg

    months, boe, wells_on = [], [], []
    for j in range(n):
        mi = m0 + j
        dim = days_in_month(mi)
        v, cnt = 0.0, 0
        for k in range(len(wells)):
            if mi < on[k]:
                continue
            days = dim - on_day[k] + 1 if mi == on[k] else dim
            v += qi * well_shape(t_of(k, mi), b, di, dmin) * days
            cnt += 1
        months.append(mi)
        boe.append(v)
        wells_on.append(cnt)

    wti, price, rev, ptax, gath, loe, fees, net = [], [], [], [], [], [], [], []
    fee_m = d["monthly_management_fee"] * sh["of_raise"] + p.get("fixed_per_unit_month", 0.0) * sh["units"]
    for j in range(n):
        w = wti_at(p, months[j])
        r = realized_price(p, w)
        rv = boe[j] * sh["nri"] * r
        tx = rv * p["production_tax"]
        g = boe[j] * sh["nri"] * p["gathering"]
        lo = (boe[j] * p["loe_per_boe"] + wells_on[j] * p["loe_per_well_month"]) * sh["wi"]
        wti.append(w)
        price.append(r)
        rev.append(rv)
        ptax.append(tx)
        gath.append(g)
        loe.append(lo)
        fees.append(fee_m)
        net.append(rv - tx - g - lo - fee_m)
    # economic limit: production stops after the last month that nets cash
    last = max([j for j in range(n) if net[j] > 0], default=-1)
    for j in range(last + 1, n):
        boe[j] = rev[j] = ptax[j] = gath[j] = loe[j] = fees[j] = net[j] = 0.0
        wells_on[j] = 0

    # investor cash: each production month is paid on the pay day after the lag; back production on back_pay_date
    fund = d["fund_date"]
    flows: dict[str, float] = {fund: -inv["check"]}
    for j in range(last + 1):
        dt = max(pay_date(months[j] + d["pay_lag_months"], d["pay_day"]), d["back_pay_date"])
        flows[dt] = flows.get(dt, 0.0) + net[j]
    assess_total = 0.0
    for a in p.get("assessments") or []:
        amt = a["per_unit"] * sh["units"]
        flows[a["date"]] = flows.get(a["date"], 0.0) - amt
        assess_total += amt
    pre_dates = sorted(flows)
    pre = [flows[x] for x in pre_dates]

    # tax by calendar year of production; cash on Apr 15 of the next year (positive = a saving)
    tx_p = p["tax"]
    y0 = int(fund[0:4])
    years = list(range(min(y0, months[0] // 12), months[max(last, 0)] // 12 + 1))
    by_y = {y: {"boe": 0.0, "rev": 0.0, "net": 0.0} for y in years}
    for j in range(last + 1):
        y = months[j] // 12
        by_y[y]["boe"] += boe[j]
        by_y[y]["rev"] += rev[j]
        by_y[y]["net"] += net[j]
    basis = inv["check"] * (1 - tx_p["year1_deductible"])
    pct = tx_p.get("percentage_depletion", 0.0)
    tax_rows, tax_flows = [], {}
    for y in years:
        if y < y0:
            continue
        ded = inv["check"] * tx_p["year1_deductible"] if y == y0 else 0.0
        ded += sum(a["per_unit"] * sh["units"] for a in p.get("assessments") or [] if int(a["date"][0:4]) == y)
        if tx_p["rest"] == "next_year":
            cost = basis if y == y0 + 1 else 0.0
        else:
            remaining = sum(by_y[z]["boe"] for z in years if z >= y)
            cost = basis * by_y[y]["boe"] / remaining if remaining > 0 else 0.0
        pctd = min(pct * by_y[y]["rev"], max(by_y[y]["net"], 0.0))
        dep = max(cost, pctd) if tx_p["rest"] != "next_year" else cost + pctd
        if tx_p["rest"] != "next_year":
            basis = max(basis - dep, 0.0)
        taxable = by_y[y]["net"] - ded - dep
        cash = -taxable * inv["tax_rate"]
        dt = f"{y + 1}-04-15"
        tax_flows[dt] = tax_flows.get(dt, 0.0) + cash
        tax_rows.append({"year": y, "net_income": by_y[y]["net"], "deduction": ded, "depletion": dep,
                         "taxable": taxable, "tax_cash": cash, "paid_on": dt})
    post = dict(flows)
    for k2, v2 in tax_flows.items():
        post[k2] = post.get(k2, 0.0) + v2
    post_dates = sorted(post)
    post_cf = [post[x] for x in post_dates]

    def metrics(dates: list[str], cf: list[float]) -> dict:
        ds = [date.fromisoformat(x) for x in dates]
        cum, payback = 0.0, None
        for x, c in zip(dates, cf):
            cum += c
            if payback is None and x > fund and cum >= -0.005:
                payback = x
        return {"irr": xirr(cf, ds), "profit": sum(cf), "payback": payback}

    m_pre, m_post = metrics(pre_dates, pre), metrics(post_dates, post_cf)
    paid_in = inv["check"] + assess_total
    got = sum(c for c in pre if c > 0)
    yr12 = add_months(date.fromisoformat(fund), 12).isoformat()
    first12 = sum(c for x, c in zip(pre_dates, pre) if fund < x <= yr12 and c > 0)
    back = flows.get(d["back_pay_date"], 0.0) if d["back_pay_date"] > fund else 0.0
    d0 = date.fromisoformat(fund)
    pv10 = sum(c / 1.1 ** ((date.fromisoformat(x) - d0).days / 365) for x, c in zip(pre_dates, pre) if x > fund)
    eur = qi * sum(well_shape((a + 0.5) / 12, b, di, dmin) * 365 / 12 for a in range(last + 1))
    cost_share = d["afe_gross_total"] * d["venture_wi"] * (1 - d["manager_share"]) * sh["of_raise"]
    return {
        "key": key, "label": inp["cases"][key]["label"], "note": inp["cases"][key].get("note", ""),
        "params": p,
        "wells": {"ip": qi, "eur": eur, "last_month": month_key(months[last]) if last >= 0 else None,
                  "life_years": (last + 1) / 12},
        "production": {"months": [month_key(x) for x in months], "boe": boe, "wells_on": wells_on, "wti": wti,
                       "price": price, "revenue": rev, "production_tax": ptax, "gathering": gath, "loe": loe,
                       "fees": fees, "net": net},
        "annual": [{"year": y, **by_y[y]} for y in years],
        "investor": {"check": inv["check"], "assessments": assess_total, "paid_in": paid_in,
                     "payment_dates": pre_dates, "payments": pre, "total": got, "multiple": got / paid_in,
                     "profit": m_pre["profit"], "irr": m_pre["irr"], "payback": m_pre["payback"],
                     "first_12_months": first12, "back_production": back, "pv10": pv10, "pv10_per_dollar": pv10 / paid_in,
                     "wi": sh["wi"], "nri": sh["nri"]},
        "after_tax": {"payment_dates": post_dates, "payments": post_cf, "irr": m_post["irr"],
                      "profit": m_post["profit"], "payback": m_post["payback"], "years": tax_rows},
        "cost": {"at_afe": cost_share, "load": inv["check"] / cost_share - 1 if cost_share > 0 else None},
    }


# ---------------------------------------------------------------- the sponsor's conversion table

def sponsor_table(inp: dict) -> dict:
    """The sponsor's 'Monthly Income Conversion Table', rebuilt from the formula it implies: BOE/day per well x
    wells x 365/12 days x price x a unit's NRI (venture NRI / units, ignoring the managing venturer's 1%) less a fixed
    monthly amount per unit; totals are BOE per well x wells x price x that NRI."""
    t, d = inp["sponsor_table"], inp["deal"]
    nri_u = d["venture_nri"] / d["units_offered"]
    unit = d["unit_price"]
    risk = unit * (1 - t["deductible"] * t["tax_rate"])
    monthly = []
    for r in t["rates"]:
        one = max(r * t["wells"] * 365 / 12 * t["price"] * nri_u - t["fixed_per_unit_month"], 0.0)
        monthly.append({"rate": r, "by_ticket": [one * u for u in t["tickets"]],
                        "cash_on_cash": one * 12 / unit, "with_tax": one * 12 / risk})
    totals = []
    for v in t["totals"]:
        one = v * t["wells"] * t["price"] * nri_u
        totals.append({"boe": v, "by_ticket": [one * u for u in t["tickets"]], "roi": one / unit, "with_tax": one / risk})
    return {"unit_nri": nri_u, "risk_capital": risk, "tax_saving": unit - risk, "monthly": monthly, "totals": totals}


def run_all(inp: dict) -> dict:
    return {"inputs_version": inp.get("version"), "asset_class": "oil_gas",
            "cases": {k: run_case(k, inp) for k in inp["cases"]},
            "sponsor_table": sponsor_table(inp) if inp.get("sponsor_table") else None}


# ---------------------------------------------------------------- CLI

def _pct(x):
    return "   n/a" if x is None else f"{x * 100:6.1f}%"


def main(argv: list[str]) -> None:
    slug = next((a for a in argv if not a.startswith("--")), "lapetco-oxy-2")
    inp = load_deal(slug)
    res = run_all(inp)
    if "--json" in argv:
        print(json.dumps(res, default=str))
        return
    print(f"{inp['meta']['name']}  (check ${inp['investor']['check']:,.0f}, tax rate {inp['investor']['tax_rate']:.0%})")
    print(f"{'case':<36}{'EUR/well':>10}{'multiple':>10}{'IRR':>9}{'after-tax':>11}{'PV10/$':>8}{'first 12m':>11}  payback")
    for c in res["cases"].values():
        i, a = c["investor"], c["after_tax"]
        print(f"{c['label']:<36}{c['wells']['eur'] / 1000:>9.0f}k{i['multiple']:>9.2f}x{_pct(i['irr']):>9}{_pct(a['irr']):>11}"
              f"{i['pv10_per_dollar']:>8.2f}{i['first_12_months']:>11,.0f}  {i['payback'] or 'never'}")


if __name__ == "__main__":
    main(sys.argv[1:])
