"""LTEC deal engine — Python reference engine.

Runs one deal file (deals/<slug>/deal.json) through property operations, debt, the sponsor waterfall and our
vehicle. engine/core.js is a line-for-line port; tests/test_parity.py keeps the two in agreement. The engines
never hold deal numbers: everything comes from the deal file.

Deal #1, Siena Villas, reproduces its v10 workbook and SV26 warehouse workbook to the cent
(deals/siena-villas/tests/test_tieout.py).

Usage:
    python -m engine.core siena-villas                 # print summary for that deal
    python -m engine.core siena-villas --json out.json # write full results
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

DEALS_DIR = Path(__file__).resolve().parents[1] / "deals"


def deal_path(slug_or_path: str | Path) -> Path:
    """A deal slug (deals/<slug>/deal.json) or a path to a deal file."""
    p = Path(slug_or_path)
    return p if p.suffix == ".json" else DEALS_DIR / str(slug_or_path) / "deal.json"


def load_deal(slug_or_path: str | Path) -> dict:
    return json.loads(deal_path(slug_or_path).read_text())


def list_deals() -> list[str]:
    return sorted(p.parent.name for p in DEALS_DIR.glob("*/deal.json"))


def uw_years(deal: dict) -> int:
    """The hold the sponsor underwrote (the year its sale and explicit rows end on)."""
    return int(deal["underwritten_hold_years"])


# ---------------------------------------------------------------- math helpers

def npv(rate: float, flows: list[float]) -> float:
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(flows))


def irr(flows: list[float]) -> float | None:
    """Annual-period IRR (Excel IRR). Bisection on [-0.99, 10]."""
    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo, flows), npv(hi, flows)
    if f_lo * f_hi > 0:
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        f_mid = npv(mid, flows)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def xirr(flows: list[float], dates: list[date]) -> float | None:
    """Excel XIRR (actual/365). None when there is nothing to measure (no money in or no money out)."""
    if not any(cf < -1e-9 for cf in flows) or not any(cf > 1e-9 for cf in flows):
        return None
    d0 = dates[0]
    yrs = [(d - d0).days / 365.0 for d in dates]

    def f(r):
        return sum(cf / (1 + r) ** y for cf, y in zip(flows, yrs))

    lo, hi = -0.9999, 10.0
    f_lo, f_hi = f(lo), f(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        f_mid = f(mid)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    # clamp day (EDATE behaviour)
    import calendar
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


# ---------------------------------------------------------------- operations

def hold_years(deal: dict) -> int:
    """Years from close to sale (default 5, the v10 / deck hold)."""
    return int(deal["hold_years"])


def _grow(series: list[float], n: int, rate) -> list[float]:
    """Extend a series to n entries, each new year growing at rate (a number, or a function of the index)."""
    out = list(series)
    while len(out) < n:
        g = rate(len(out)) if callable(rate) else rate
        out.append(out[-1] * (1 + g))
    return out


def case_cap_basis(case: dict, deal: dict, nxt5: float) -> float:
    """The cap rate a case implies for valuing the property (refinance appraisals, and the Sponsor case when the
    hold isn't five years): its exit cap, or for the deck case the cap implied by the deck's Year-5 sale."""
    if case["kind"] == "explicit":
        gross = (case["net_sale_proceeds"] + deal["loan_amount"]) / (1 - deal["selling_cost_pct"])
        return nxt5 / gross
    return case["exit_cap"]


def _merge(base: dict, ov: dict) -> dict:
    out = dict(base)
    for k, v in ov.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def case_deal(inp: dict, key: str) -> dict:
    """The deal as one case sees it: the deal inputs with that case's deal_overrides merged in (e.g. a downside
    case where a buyer pays nothing for the tax rebates left at the sale)."""
    ov = inp["cases"][key].get("deal_overrides")
    return _merge(inp["deal"], ov) if ov else inp["deal"]


def case_lines(case: dict, deal: dict, n: int, cases: dict | None = None):
    """Rents, other income, operating expenses and CapEx for years 1..n.

    kind 'derived' (our cases on any deal) starts from another case's lines (`from`, usually the sponsor's) and
    adjusts them: each of rents / other income / opex either follows the source year by year ('source', rents and
    each times a factor) or grows from the source's Year 1 at a set rate ('growth'); `rent_adjust` adds $
    by year (e.g. concessions above the sponsor's); `opex_add` adds $ from `opex_add_start_year`, growing at
    `opex_add_growth` (e.g. a tax reassessment). CapEx follows the source."""
    if case["kind"] == "derived":
        r, o, x, cx = case_lines(cases[case["from"]], deal, n, cases)

        def path(base, mode, g, factor):
            out = [base[0] * factor]
            for i in range(1, n):
                out.append(out[-1] * (1 + g) if mode == "growth" else base[i] * factor)
            return out

        adj = case["rent_adjust"]
        r2 = [v + (adj[i] if i < len(adj) else 0.0)
              for i, v in enumerate(path(r, case["rent_path"], case["rent_growth"], case["rent_factor"]))]
        o2 = path(o, case["other_income_path"], case["other_income_growth"], case["other_income_factor"])
        st = int(case["opex_add_start_year"])
        x2 = [v + (case["opex_add"] * (1 + case["opex_add_growth"]) ** (i + 1 - st) if i + 1 >= st else 0.0)
              for i, v in enumerate(path(x, case["opex_path"], case["opex_growth"], case["opex_factor"]))]
        return r2, o2, x2, cx
    if case["kind"] in ("explicit", "custom"):
        if case["kind"] == "explicit":
            gr = go = gx = case["y6_noi_growth"]
        else:
            gr, go, gx = case["rent_growth_y6"], case["other_income_growth_y6"], case["opex_growth_y6"]
        r_all = _grow(case["rents"], n, gr)
        o_all = _grow(case["other_income"], n, go)
        x_all = _grow(case["opex"], n, gx)
    else:
        g3 = case["rent_growth_y3_plus"]
        r_all = _grow([case["rent_y1"]], n, lambda i: case["rent_growth_y2"] if i == 1 else g3)
        if "other_income_explicit" in case:
            # Adjusted Base grows other income at the rent growth rate after its explicit years (v10 B51)
            o_all = _grow(case["other_income_explicit"], n, g3)
        else:
            o_all = _grow([case["other_income_y1"]], n, case["other_income_growth"])
        x_all = _grow([case["opex_y1"]], n, case["opex_growth"])
    capex_in = list(case["capex"]) if "capex" in case else [deal["annual_capex_reserves"]]
    return r_all, o_all, x_all, (capex_in + [capex_in[-1]] * n)[:n]


def case_operations(case: dict, deal: dict, cases: dict | None = None) -> dict:
    """Annual P&L for Years 1..H plus the NOI a buyer prices, with the debt schedule - the loan, or a refinance at
    the end of year R. Past the underwritten years every line grows at the case's long-run rate."""
    H = hold_years(deal)
    Y = uw_years(deal)
    n = max(H + 1, Y + 1)
    r_all, o_all, x_all, cx_all = case_lines(case, deal, n, cases)
    noi_all = [r + o - x for r, o, x in zip(r_all, o_all, x_all)]
    # the NOI a buyer prices at the end of year H: next year's (forward) or the final hold year's (trailing)
    exit_noi = noi_all[H] if deal["exit_noi_basis"] == "forward" else noi_all[H - 1]

    rents, oi, opex = r_all[:H], o_all[:H], x_all[:H]
    income = [r + o for r, o in zip(rents, oi)]
    noi = [i - e for i, e in zip(income, opex)]
    capex = cx_all[:H]
    am_fee = [i * deal["asset_mgmt_fee_pct_of_income"] for i in income]
    assume = [deal.get("assumption_fee_pct", 0.0) * deal["loan_amount"]] + [0.0] * (H - 1)

    # ---- debt: the assumed interest-only loan, optionally refinanced at the end of year R
    loan0 = deal["loan_amount"]
    ds0 = loan0 * deal["loan_rate"] if deal.get("debt_service_method") == "interest_only" else deal["annual_debt_service"]
    ds, bal_end, refi_net = [], [], [0.0] * H
    rf = deal.get("refi") or {}
    R = int(rf.get("year", 0)) if rf.get("enabled") else 0
    refi = None
    if 1 <= R < H:
        cap = rf["appraisal_cap"] or case_cap_basis(case, deal, noi_all[Y])
        value = noi_all[R] / cap
        rate, io, amort = rf["rate"], int(rf["io_years"]), int(rf["amort_years"])
        factor = rate / (1 - (1 + rate) ** -amort) if rate > 0 else 1 / amort
        loan = rf["ltv"] * value if rf["sizing"] == "ltv" else rf["amount"]
        loan_dscr = None
        pay_rate = rate if io > 0 else factor
        if rf.get("dscr_min", 0) > 0 and pay_rate > 0:
            loan_dscr = noi_all[R] / rf["dscr_min"] / pay_rate
            loan = min(loan, loan_dscr)
        costs = loan * rf["cost_pct"]
        refi_net[R - 1] = loan - loan0 - costs
        refi = {"year": R, "appraisal_cap": cap, "appraised_value": value, "noi_basis": noi_all[R],
                "loan": loan, "loan_dscr_limit": loan_dscr, "ltv": loan / value, "costs": costs,
                "payoff_old": loan0, "net_proceeds": refi_net[R - 1], "rate": rate}
    bal = loan0
    amort_pay = refi["loan"] * factor if refi else 0.0  # level payment once amortization starts
    for y in range(1, H + 1):
        if refi and y > R:
            if y - R <= io:
                pay = bal * rate
            else:
                pay = amort_pay
                bal -= pay - bal * rate
        else:
            pay = ds0
        if refi and y == R:
            bal = refi["loan"]
        ds.append(pay)
        bal_end.append(bal)
    if refi:
        refi["first_year_debt_service"] = ds[R] if R < H else None
        refi["dscr"] = noi_all[R] / ds[R] if R < H and ds[R] else None
    # cash received below NOI (e.g. a tax-increment rebate): amounts by hold year; at a sale, optionally the NPV of
    # the amounts still to come (Excel NPV: first one discounted a full year)
    bni = deal["below_noi_income"]
    # factor scales every payment (0.5 = half paid, 0 = none); delay_years pushes the whole schedule back
    amts = [0.0] * int(bni["delay_years"]) + [a * bni["factor"] for a in bni["amounts"]]
    below = [amts[y] if y < len(amts) else 0.0 for y in range(H)]
    rest = amts[H:]
    bni_sale = (sum(a / (1 + bni["npv_rate"]) ** (k + 1) for k, a in enumerate(rest))
                if bni["sale_value"] == "npv" else 0.0)
    ocf = [nn - c - d - a - f + b for nn, c, d, a, f, b in zip(noi, capex, ds, am_fee, assume, below)]

    return {
        "rents": rents, "other_income": oi, "total_income": income, "opex": opex,
        "noi": noi, "capex": capex, "debt_service": ds, "asset_mgmt_fee": am_fee, "assumption_fee": assume,
        "below_noi_income": below, "below_noi_sale_value": bni_sale,
        "operating_cash_flow": ocf, "y6_noi": exit_noi, "next_year_noi": exit_noi, "hold_years": H,
        "refi_proceeds": refi_net, "loan_balance_end": bal_end, "refi": refi,
        "_noi_year6": noi_all[Y],
    }


def case_exit(case: dict, ops: dict, deal: dict) -> dict:
    H = ops["hold_years"]
    debt, sell, dispo = ops["loan_balance_end"][-1], deal["selling_cost_pct"], deal["disposition_fee_pct"]
    nxt = ops["next_year_noi"]
    # besides the property: reserves funded at close and returned, and the value of below-NOI income still to come.
    # A deck's given net sale proceeds (explicit case at its own hold) are taken as all-in.
    extra = sale_extras(ops, deal)
    if case["kind"] == "explicit":
        if H == uw_years(deal) and not ops["refi"]:
            nsp = case["net_sale_proceeds"]
            gross = (nsp + debt) / (1 - sell)
        else:  # the deck's implied cap, applied to the NOI after this hold
            gross = nxt / case_cap_basis(case, deal, ops["_noi_year6"])
            nsp = gross - gross * sell - debt + extra
        cap = nxt / gross
    elif case["kind"] == "custom" and case["exit_method"] == "sale_price":
        gross = case["sale_price"]
        cap = nxt / gross
        nsp = gross - gross * sell - debt - gross * dispo + extra
    else:
        cap = case["exit_cap"]
        gross = nxt / cap
        nsp = gross - gross * sell - debt - gross * dispo + extra
    return {"y6_noi": nxt, "exit_cap": cap, "gross_value": gross,
            "selling_costs": gross * sell, "disposition_fee": 0 if case["kind"] == "explicit" else gross * dispo,
            "debt_payoff": debt, "reserves_returned": deal["reserves_returned_at_sale"],
            "below_noi_sale_value": ops["below_noi_sale_value"],
            "net_sale_proceeds": nsp, "price_per_unit": gross / deal["units"]}


def sale_extras(ops: dict, deal: dict) -> float:
    return deal["reserves_returned_at_sale"] + ops["below_noi_sale_value"]


# ---------------------------------------------------------------- waterfall

def run_waterfall(cash: list[float], equity: float, wf: dict, events: list[float] | None = None) -> dict:
    """OA §8.1 waterfall on annual partnership cash. Mirrors v10 'LP Waterfall' rows.

    A shortfall in any year (e.g. a refinance that doesn't cover the old loan) is carried forward and covered
    from later cash; a shortfall left at the end (an underwater sale on the non-recourse loan) isn't called from
    members. v10 does neither; no default case is affected.

    wf["return_of_capital"]: "all_cash" (OA 8.1 style: after pref, any cash returns capital) or "capital_events"
    (operating cash above the pref goes straight to the splits; capital comes back only from events - a sale or
    refinance - whose amounts per year are `events`; pref is paid from operating cash first)."""
    roc_events = wf["return_of_capital"] == "capital_events"
    pref = wf["pref_rate"]
    tiers = wf["tiers"]
    unreturned, unpaid = equity, 0.0
    rows = {k: [] for k in ("cash", "pref_due", "to_pref", "return_of_capital", "unreturned_end",
                            "unpaid_pref_end", "tier_splits", "lp", "gp", "deficit_end")}
    lp_hist: list[float] = []
    deficit = 0.0
    for t in range(1, len(cash) + 1):
        c = cash[t - 1] + deficit
        deficit = min(0.0, c)
        c = max(0.0, c)
        carried = unpaid * (1 + pref) if wf.get("pref_compounds") else unpaid
        due = unreturned * pref + carried
        to_pref = min(c, due)
        if roc_events:
            ev = min(max(0.0, events[t - 1] if events else 0.0), c)
            roc = min(max(0.0, ev - max(0.0, to_pref - (c - ev))), unreturned)
        else:
            roc = min(max(0.0, c - to_pref), unreturned)
        remaining = c - to_pref - roc
        lp = to_pref + roc
        gp = 0.0
        splits = []
        for tier in tiers:
            h, s = tier["lp_irr_hurdle"], tier["lp_share"]
            fv_prior = sum(d * (1 + h) ** (t - 1 - i) for i, d in enumerate(lp_hist))
            lp_needed = max(0.0, equity * (1 + h) ** t - fv_prior - lp)
            amt = min(remaining, lp_needed / s)
            lp += amt * s
            gp += amt * (1 - s)
            remaining -= amt
            splits.append(amt)
        lp += remaining * wf["residual_lp_share"]
        gp += remaining * (1 - wf["residual_lp_share"])
        splits.append(remaining)

        unreturned -= roc
        unpaid = due - to_pref
        lp_hist.append(lp)
        for k, v in (("cash", c), ("pref_due", due), ("to_pref", to_pref), ("return_of_capital", roc),
                     ("unreturned_end", unreturned), ("unpaid_pref_end", unpaid),
                     ("tier_splits", splits), ("lp", lp), ("gp", gp), ("deficit_end", deficit)):
            rows[k].append(v)
    return rows


def lp_metrics(lp: list[float], equity: float, pay: tuple | None = None, close: date | None = None) -> dict:
    """irr is the annual-period IRR, or XIRR on actual payment dates when a dated schedule is given."""
    annual = irr([-equity] + lp)
    dated = xirr([-equity] + pay[1], [close] + pay[0]) if pay else None
    return {
        "irr": dated if pay else annual, "irr_annual": annual,
        "multiple": sum(lp) / equity,
        "avg_cash_yield_y1_4": sum(lp[:min(4, len(lp) - 1)]) / max(1, min(4, len(lp) - 1)) / equity,
    }


# ---------------------------------------------------------------- distribution timing
#
# timing.mode "annual" (default; v10 and SV26 workbook convention): one distribution per year on the close
# anniversary. "schedule" (Redstone: OA 8.1 quarterly, deck first distribution Apr 20 2027, sale Oct 2031): each
# year's operating cash is paid in siena_frequency equal installments starting first_distribution; the Year-5
# sale proceeds are paid on sale_date; installments that would fall after the sale are paid on the sale date.
# Annual amounts are unchanged - only their timing moves. The vehicle collects Siena payments and pays its own
# members on vehicle_frequency (0 = whenever Siena pays).

def _scheduled(inp: dict) -> bool:
    return inp.get("timing", {}).get("mode", "annual") == "schedule"


def _close(inp: dict) -> date:
    return date.fromisoformat(inp["warehouse"]["close_date"])


def _event_date(inp: dict, year: int) -> date:
    """Schedule mode: the date of a capital event at the end of hold year `year` - the deck's sale date (end of
    Year 5) moved by whole years."""
    return add_months(date.fromisoformat(inp["timing"]["sale_date"]), 12 * (year - uw_years(inp["deal"])))


def _sale_date(inp: dict) -> date:
    return _event_date(inp, hold_years(inp["deal"]))


def deal_payments(lp: list[float], ops_part: dict, inp: dict) -> tuple[list[date], list[float]]:
    """Dated LP-class payments: (dates, amounts). ops_part maps a year index with a capital event (refinance or
    sale) to the LP cash from that year's operations alone; the rest of that year's LP cash is the event."""
    close, H = _close(inp), len(lp)
    if not _scheduled(inp):
        return [add_months(close, 12 * k) for k in range(1, H + 1)], list(lp)
    t = inp["timing"]
    f = t["siena_frequency"]
    step = 12 // f
    first, sale = date.fromisoformat(t["first_distribution"]), _sale_date(inp)
    ops = [ops_part.get(y, lp[y]) for y in range(H)]
    flows: dict = {}
    for y in range(H):
        for k in range(f):
            d = min(add_months(first, step * (y * f + k)), sale)
            flows[d] = flows.get(d, 0.0) + ops[y] / f
    for y in sorted(ops_part):
        d = sale if y == H - 1 else _event_date(inp, y + 1)
        flows[d] = flows.get(d, 0.0) + (lp[y] - ops_part[y])
    ds = sorted(flows)
    return ds, [flows[d] for d in ds]


def vehicle_periods(pay_dates: list[date], pay_amts: list[float], inp: dict):
    """The vehicle's payment dates, the Siena cash it collects for each, and each period's length in years
    (exactly 1 per period in annual mode, so the workbook tie-outs are unchanged)."""
    if not _scheduled(inp):
        return list(pay_dates), list(pay_amts), [1.0] * len(pay_dates)
    t, close = inp["timing"], _close(inp)
    sale = _sale_date(inp)
    vf = t["vehicle_frequency"]
    final = add_months(sale, t.get("vehicle_final_lag_months", 0))
    if vf == 0:
        vdates = [d for d in sorted(set(pay_dates)) if d < sale]
    else:
        first = date.fromisoformat(t.get("vehicle_first_distribution") or t["first_distribution"])
        step, vdates, k = 12 // vf, [], 0
        while True:
            d = add_months(first, step * k)
            if d >= sale:
                break
            vdates.append(d)
            k += 1
    vdates.append(final)
    rec, yfs, prev = [], [], close
    for d in vdates:
        rec.append(sum(a for pd, a in zip(pay_dates, pay_amts) if prev < pd <= d))
        yfs.append((d - prev).days / 365)
        prev = d
    return vdates, rec, yfs


# ---------------------------------------------------------------- top-level

def run_case(key: str, inp: dict) -> dict:
    deal = case_deal(inp, key)
    inp_c = inp if deal is inp["deal"] else dict(inp, deal=deal)
    case = inp["cases"][key]
    ops = case_operations(case, deal, inp["cases"])
    ex = case_exit(case, ops, deal)
    out = _returns(ops, ex["net_sale_proceeds"], inp_c)
    return {"key": key, "label": case["label"], "note": case.get("note", ""), "operations": ops, "exit": ex, **out}


def _tier_lp_gp(rows: dict, t: int, wf: dict) -> tuple[float, float]:
    """LP and sponsor amounts from the tier splits (8.1(c)-(e)) in year index t."""
    lp = gp = 0.0
    for j, amt in enumerate(rows["tier_splits"][t]):
        s = wf["tiers"][j]["lp_share"] if j < len(wf["tiers"]) else wf["residual_lp_share"]
        lp += amt * s
        gp += amt * (1 - s)
    return lp, gp


def crystallize(cash: list[float], sale: float, w: dict, refi: dict, inp: dict, events: list[float]) -> dict:
    """OA 8.7 after the refinance at the end of year R (Manager's one-time election). Net Equity Value =
    appraised value - new loan - 2% hypothetical costs (no other assets or liabilities modeled). Distributing it
    on top of the year-R payout in the 8.1 order gives the LP and sponsor shares of the 8.1(c)-(e) portion: the
    Crystallized Percentages. Afterwards (8.7(d)): cash goes first to pref accrued as of that date (no new
    accrual), then - for sale proceeds only - to unreturned capital, then by the fixed percentages. If no part of
    the hypothetical distribution reaches 8.1(c)-(e), the election has no effect."""
    deal, wf = inp["deal"], inp["waterfall"]
    eq, R, H = deal["lp_equity"], refi["year"], len(cash)
    nev = refi["appraised_value"] - refi["loan"] - deal["refi"]["crystallize_cost_pct"] * refi["appraised_value"]
    out = {"applied": False, "net_equity_value": nev, "lp_pct": None, "year": R}
    if nev <= 0:
        return out
    hyp = run_waterfall(cash[:R - 1] + [cash[R - 1] + nev], eq, wf, events[:R - 1] + [events[R - 1] + nev])
    lp2, gp2 = _tier_lp_gp(hyp, R - 1, wf)
    lp1, gp1 = _tier_lp_gp(w, R - 1, wf)
    d_lp, d_gp = lp2 - lp1, gp2 - gp1
    if d_lp + d_gp <= 1e-6:
        return out
    pct = d_lp / (d_lp + d_gp)
    accrued0, unret0 = w["unpaid_pref_end"][R - 1], w["unreturned_end"][R - 1]

    def run(last_cash, last_sale):
        accrued, unret, deficit = accrued0, unret0, w["deficit_end"][R - 1]
        lp, gp = list(w["lp"][:R]), list(w["gp"][:R])
        for t in range(R, H):
            c = (last_cash if t == H - 1 else cash[t]) + deficit
            deficit = min(0.0, c)
            c = max(0.0, c)
            capital = min(max(0.0, last_sale), c) if t == H - 1 else 0.0
            op = c - capital
            p1 = min(op, accrued)
            accrued -= p1
            p2 = min(capital, accrued)
            accrued -= p2
            rc = min(capital - p2, unret)
            unret -= rc
            rest = op - p1 + capital - p2 - rc
            lp.append(p1 + p2 + rc + pct * rest)
            gp.append((1 - pct) * rest)
        return lp, gp

    lp, gp = run(cash[-1], sale)
    out.update(applied=True, lp_pct=pct, accrued_pref=accrued0, unreturned_capital=unret0,
               hypothetical_lp_tiers=d_lp, hypothetical_sponsor_tiers=d_gp, lp=lp, gp=gp,
               lp_ops_only_last=run(cash[-1] - sale, 0.0)[0][-1])
    return out


def _returns(ops: dict, nsp: float, inp: dict) -> dict:
    """Refinance proceeds (OA 8.2: same order as 8.1) and the sale added to operating cash, run through the
    waterfall."""
    deal = inp["deal"]
    wf = inp["waterfall"]
    ocf = ops["operating_cash_flow"]
    cash = [o + r for o, r in zip(ocf, ops["refi_proceeds"])]
    cash[-1] += nsp
    ev_cash = list(ops["refi_proceeds"])  # capital-event cash per year (refinance, sale)
    ev_cash[-1] += nsp
    w = run_waterfall(cash, deal["lp_equity"], wf, ev_cash)
    sched = _scheduled(inp)
    # LP cash from operations alone in each capital-event year, so the event can be dated separately
    events = [len(ocf) - 1] + ([ops["refi"]["year"] - 1] if ops["refi"] else [])

    def ops_alone(c_all, ev_all, eq, wfx, lp_all, scale=1.0):
        part = {}
        if sched:
            for y in events:
                alone = run_waterfall(c_all[:y] + [ocf[y] * scale], eq, wfx, ev_all[:y] + [0.0])["lp"][y]
                part[y] = min(alone, lp_all[y])  # an event never shows up as a negative payment
        return part

    ops_part = ops_alone(cash, ev_cash, deal["lp_equity"], wf, w["lp"])
    pay_reg = deal_payments(w["lp"], ops_part, inp)
    m_reg = lp_metrics(w["lp"], deal["lp_equity"], pay_reg if sched else None, _close(inp))

    # OA 8.7 crystallization, if elected after a refinance. The LTEC side letter keeps LTEC's units on the
    # regular waterfall unless LTEC has its unreturned capital and accrued pref back by the crystallization date.
    cr = None
    rf = deal.get("refi") or {}
    if ops["refi"] and rf.get("crystallize"):
        cr = crystallize(cash, nsp, w, ops["refi"], inp, ev_cash)
    if cr and cr["applied"]:
        lp_c, gp_c = cr["lp"], cr["gp"]
        part_c = dict(ops_part)
        if sched:
            part_c[len(ocf) - 1] = min(cr["lp_ops_only_last"], lp_c[-1])
        pay_c = deal_payments(lp_c, part_c, inp)
        m = lp_metrics(lp_c, deal["lp_equity"], pay_c if sched else None, _close(inp))
        protected = bool(rf.get("side_letter_protects", True)) and (cr["unreturned_capital"] > 0.5 or cr["accrued_pref"] > 0.5)
        cr["ltec_protected"] = protected
        w = dict(w, lp_regular=w["lp"], gp_regular=w["gp"], lp=lp_c, gp=gp_c)
    else:
        pay_c, m, protected = pay_reg, m_reg, False
    inv_lp, inv_pay, inv_m = (w.get("lp_regular", w["lp"]), pay_reg, m_reg) if protected else (w["lp"], pay_c, m)
    check = inp["investor"]["check"]
    share = check / deal["lp_equity"]
    inv = [d * share for d in inv_lp]
    inv_amts = [a * share for a in inv_pay[1]]
    inv_irr, inv_mult = inv_m["irr"], inv_m["multiple"]

    # Side letter for our check (investor.side_letter): our pro-rata share of the partnership's cash runs through
    # our own terms (overrides of the waterfall); everyone else's cash is unchanged, so the difference comes out of
    # the sponsor's promote. Our check then follows these terms, not a crystallization.
    sl = inp["investor"]["side_letter"]
    side = None
    if sl["enabled"] and check > 0:
        swf = dict(wf, **sl["terms"])
        s_cash, s_ev = [c * share for c in cash], [e * share for e in ev_cash]
        sw = run_waterfall(s_cash, check, swf, s_ev)
        s_pay = deal_payments(sw["lp"], ops_alone(s_cash, s_ev, check, swf, sw["lp"], share), inp)
        s_m = lp_metrics(sw["lp"], check, s_pay if sched else None, _close(inp))
        side = {"applied": True, "regular_distributions": inv, "regular_total": sum(inv),
                "regular_irr": inv_irr, "regular_multiple": inv_mult,
                "uplift": sum(sw["lp"]) - sum(inv), "sponsor_cost": sum(sw["lp"]) - sum(inv)}
        inv, inv_pay, inv_amts = list(sw["lp"]), s_pay, s_pay[1]
        inv_irr, inv_mult = s_m["irr"], s_m["multiple"]
    return {
        "waterfall": w, "lp": m, "crystallization": cr,
        "payments": {"dates": [d.isoformat() for d in pay_c[0]], "amounts": pay_c[1]},
        "investor": {"distributions": inv, "total": sum(inv), "profit": sum(inv) - check,
                     "irr": inv_irr, "multiple": inv_mult,
                     "payment_dates": [d.isoformat() for d in inv_pay[0]],
                     "payments": inv_amts, "side_letter": side},
        "gp_promote_total": sum(w["gp"]),
        "direct_investors": [_direct(d, w["lp"], m, deal["lp_equity"], pay_c[1]) for d in inp.get("direct_investors", [])],
    }


def _direct(d: dict, lp: list[float], m: dict, equity: float, pay_amts: list[float]) -> dict:
    """An LP who invests in Siena directly. Same Preferred terms, so cash scales with the check."""
    dist = [x * d["check"] / equity for x in lp]
    return {"name": d["name"], "check": d["check"], "distributions": dist, "total": sum(dist),
            "profit": sum(dist) - d["check"], "irr": m["irr"], "multiple": m["multiple"],
            "payments": [a * d["check"] / equity for a in pay_amts]}


def sensitivity(inp: dict, case: dict | None = None, *, include_own: bool = False) -> dict:
    """LP IRR on one case's operations across exit caps and Year-6 NOI factors (v10 'Sensitivity', which used
    Adjusted Base). include_own adds the case's own exit cap as a row when it isn't already on the grid."""
    case = case or run_case("custom", inp)
    deal, s = case_deal(inp, case["key"]), inp["sensitivity"]
    inp = inp if deal is inp["deal"] else dict(inp, deal=deal)
    ops, y6 = case["operations"], case["operations"]["y6_noi"]
    own = case["exit"]["exit_cap"]
    caps = list(s["exit_caps"])
    if include_own and not any(abs(c - own) < 1e-9 for c in caps):
        caps = sorted(caps + [own])
    keep = 1 - deal["selling_cost_pct"] - deal["disposition_fee_pct"]
    payoff = case["exit"]["debt_payoff"]
    extra = sale_extras(ops, deal)
    grid = [[_returns(ops, y6 * f / c * keep - payoff + extra, inp)["lp"]["irr"]
             for f in s["noi_factors"]] for c in caps]
    values = [[y6 * f / c for f in s["noi_factors"]] for c in caps]
    return {"exit_caps": caps, "noi_factors": s["noi_factors"], "lp_irr": grid, "gross_value": values, "own_cap": own}


# ---------------------------------------------------------------- vehicle (SV26) warehouse
#
# Names are labels (inputs.warehouse.names). The vehicle invests investor.check in Siena and raises
# investor.check + reserve. The manager commits manager_commitment. Each person puts in `amount` at
# close in one of three roles:
#   member    - holds units for the whole hold (a fully subscribed raise is all members);
#   warehouse - holds units and sells them pro rata in the sell-down;
#   loan      - lends to the manager at loan_rate (simple); the manager holds the units, sells them, and
#               repays the lender as they sell; unsold principal converts to units at par on the last
#               sale date, with interest paid then. The manager's owners (manager_share) carry the spread.
# Warehouse + loan amounts form the pool that sales draw from. Each sale names a buyer: a person (their
# purchase is added to their flows) or an outside group. Unsold pool units pay warehouse_promote; all
# other units pay promote. The member hurdle is pooled across the whole vehicle.

def _hurdle_new(capital: float) -> dict:
    return {"bal": capital, "cap": capital, "acc": 0.0}


def _hurdle_pay(st: dict, cash: float, a: float, h: float, simple: bool) -> float:
    """Accrue the hurdle for a period of a years, pay what cash allows, return the amount paid toward it.
    Compound: the balance grows at (1 + h)^a (an IRR hurdle). Simple: h x a on unreturned capital only,
    paid to accrued return first, then capital."""
    c = max(0.0, cash)
    if simple:
        st["acc"] += st["cap"] * h * a
        paid = min(c, st["cap"] + st["acc"])
        to_acc = min(paid, st["acc"])
        st["acc"] -= to_acc
        st["cap"] -= paid - to_acc
        return paid
    st["bal"] *= (1 + h) ** a
    paid = min(c, st["bal"])
    st["bal"] -= paid
    return paid


def manager_waterfall_split(seq: list, capital: float, mw: dict) -> list:
    """The manager's own waterfall between its partners (warehouse.manager_waterfall).
    seq = [(years since the previous event, total manager cash)] in date order; capital = the manager's capital.
    Capital holders first get capital back plus `pref` (pref_type compound = an IRR, or simple). Above that, each
    tier gives capital_share of the cash to the capital holders until they reach the tier's to_irr (compounding),
    then the next tier; residual_capital_share applies above the last tier. The rest goes to the fees & promote
    holders. Negative cash is put in by the capital holders. Returns [(to_capital, to_promote)] per event."""
    simple = mw.get("pref_type", "compound") == "simple"
    pref = _hurdle_new(capital)
    tiers = mw.get("tiers", [])
    hs = [_hurdle_new(capital) for _ in tiers]
    out = []
    for a, x in seq:
        to_c = _hurdle_pay(pref, x, a, mw["pref"], simple)  # accrues; pays nothing when x <= 0
        for st, tr in zip(hs, tiers):
            st["bal"] *= (1 + tr["to_irr"]) ** a
        if x < 0:
            for st in [pref] + hs:
                st["bal"] -= x
                st["cap"] -= x
            out.append((x, 0.0))
            continue
        rem, to_p = x - to_c, 0.0
        for st, tr in zip(hs, tiers):
            need, c = max(0.0, st["bal"] - to_c), tr["capital_share"]
            z = 0.0 if need <= 0 else (rem if c <= 0 else min(rem, need / c))
            to_c += c * z
            to_p += (1 - c) * z
            rem -= z
        c = mw.get("residual_capital_share", 0.0)
        to_c += c * rem
        to_p += (1 - c) * rem
        for st in hs:
            st["bal"] = max(0.0, st["bal"] - to_c)
        out.append((to_c, to_p))
    return out


def _unit_series(gross_pu, dates, yfs, close, start, basis, rate, h, simple):
    """Per-unit net cash for units bought at `basis` on `start`, with their own hurdle (member-by-member mode)."""
    st, out = _hurdle_new(basis), []
    for t, d in enumerate(dates):
        if d <= start:
            out.append(0.0)
            continue
        prev = dates[t - 1] if t > 0 else close
        a = (d - start).days / 365 if start > prev else yfs[t]
        paid = _hurdle_pay(st, gross_pu[t], a, h, simple)
        excess = max(0.0, gross_pu[t] - paid)
        out.append(gross_pu[t] - rate * excess)
    return out


def _sale_price(tr: dict, par: float, days: int, credit: float) -> float:
    if tr["pricing"] == "carry_compound":
        base = par * (1 + tr["rate"]) ** (days / 365)
    elif tr["pricing"] == "premium":
        base = par * (1 + tr["rate"])
    else:  # carry_simple
        base = par * (1 + tr["rate"] * days / 365)
    return base - credit


def _key(name: str) -> str:
    return name.strip().lower()


LOAN_TERM_DEFAULTS = {"repayment": "sweep", "sweep_pct": 1.0, "term_years": 5.0, "source": "manager_cash",
                      "maturity": "", "on_leave": "continues", "due_on": "cash_date", "paydowns": []}


def loan_terms_of(ln: dict) -> dict:
    """A partner loan's repayment terms (#24), with the defaults that reproduce the original rule filled in."""
    return {k: (ln.get(k) if ln.get(k) is not None else v) for k, v in LOAN_TERM_DEFAULTS.items()}


def apply_loan_preset(ln: dict, preset: str, lib: dict) -> dict:
    """A copy of loan `ln` with a library preset's terms (engine/loan_terms.json); who, amount and rate are kept."""
    out = dict(ln)
    for k in LOAN_TERM_DEFAULTS:
        if k != "paydowns":  # pay-downs are dated events of this loan, not part of a method: they stay
            out.pop(k, None)
    out.update(lib["presets"][preset]["terms"])
    out["preset"] = preset
    return out



def warehouse_case(siena_lp_dists: list[float], inp: dict, *, pct_sold=None, dates=None, yfs=None) -> dict:
    """Vehicle results for one Siena case. siena_lp_dists = Siena cash the vehicle collects for each of its
    payment dates (default: the five close anniversaries); yfs = each period's length in years.
    pct_sold rescales sales so they total pct_sold of the pool."""
    w = inp["warehouse"]
    invest = inp["investor"]["check"]
    par = w["unit_price"]
    close = date.fromisoformat(w["close_date"])
    raised = invest + w["reserve"]
    mc = w["manager_commitment"]
    mr = w.get("manager_reserve", 0.0)  # cash the manager keeps outside the vehicle; back to its owners in Year 5
    U = raised / par
    mgr_units = mc / par
    if dates is None:
        dates = [add_months(close, 12 * t) for t in range(1, len(siena_lp_dists) + 1)]
        yfs = [1.0] * len(dates)
    N = len(dates)

    people = w["people"]
    amt = [p["amount"] for p in people]
    role = [p["role"] for p in people]
    pool = sum(a for a, r in zip(amt, role) if r in ("warehouse", "loan"))
    w_tot = pool / par

    # ---- sales
    trs = w["selldown"]["tranches"]
    shares = [tr["share"] for tr in trs]
    if pct_sold is not None:
        tot = sum(shares)
        shares = [s * pct_sold / tot for s in shares] if tot > 0 else [pct_sold if j == 0 else 0.0 for j in range(len(trs))]
    tot = sum(shares)
    if tot > 1:
        shares = [s / tot for s in shares]
    t_dates = [date.fromisoformat(tr["date"]) for tr in trs]
    t_days = [(d - close).days for d in t_dates]
    sold_before = [sum(s for s, d in zip(shares, t_dates) if d < dd) for dd in dates]
    unsold = max(0.0, 1 - sum(shares))
    j_last = t_dates.index(max(t_dates)) if trs else None
    last = t_dates[j_last] if trs else close
    last_days = (last - close).days
    after_last = [1 if dd > last else 0 for dd in dates]
    wh_held = [w_tot * (1 - sb) for sb in sold_before]

    # ---- vehicle cash, pooled hurdle, promote by unit class
    hurdle_end = None
    admin = w["admin_cost_pct"] * raised if w["admin_cost_method"] == "pct_raise" else w["admin_cost_per_year"]
    dist_cash, promote, members, pu_s, pu_w, fee = [], [], [], [], [], []
    p_std, p_wh = w["promote"], w["warehouse_promote"]
    # Schedule mode (Nov 3 memo): the vehicle keeps a holdback of each distribution (released at the final one),
    # carries any shortfall forward instead of calling capital, and can pay the acquisition fee after its first
    # distribution. Annual mode keeps the workbook convention.
    sched = _scheduled(inp)
    tm = inp.get("timing", {})
    hold = tm.get("vehicle_holdback", 0.0) if sched else 0.0
    acq_t = 1 if (sched and tm.get("acq_fee_after_first", False) and N > 1) else 0
    carry = 0.0
    for t in range(N):
        yf = yfs[t]
        f = (-w["acq_fee_pct"] * invest if t == acq_t else 0.0) - w["mgmt_fee_pct"] * raised * yf
        reserve = w["reserve"] if t == N - 1 else 0.0
        cash = siena_lp_dists[t] - admin * yf + f + reserve
        if sched:
            avail = cash + carry
            cash = avail if t == N - 1 else max(0.0, avail) / (1 + hold)
            carry = avail - cash
        dist_cash.append(cash); fee.append(f)

    # ---- hurdle and promote. Defaults follow the memo: "in aggregate" (whole fund), a compounding 10% IRR, no
    # catch-up, promote on every unit including the manager's. Switches: hurdle_basis "per_member" (each block of
    # units has its own hurdle from its purchase price and date), hurdle_type "simple", promote_on_manager_units.
    h = w["member_hurdle_irr"]
    simple = w.get("hurdle_type", "compound") == "simple"
    per_member = w.get("hurdle_basis", "pooled") == "per_member"
    p_mgr = p_std if w.get("promote_on_manager_units", True) else 0.0
    pu_m = []
    if not per_member:
        st = _hurdle_new(raised)
        for t in range(N):
            cash = dist_cash[t]
            paid = _hurdle_pay(st, cash, yfs[t], h, simple)
            excess = max(0.0, cash - paid)
            base, xpu = (cash - excess) / U, excess / U
            pr = xpu * (p_std * (U - wh_held[t] - mgr_units) + p_wh * wh_held[t] + p_mgr * mgr_units)
            promote.append(pr); members.append(cash - pr)
            pu_s.append(base + xpu * (1 - p_std))
            pu_w.append(base + xpu * (1 - p_wh))
            pu_m.append(base + xpu * (1 - p_mgr))
    else:
        gross_pu = [c / U for c in dist_cash]
        pu_s = _unit_series(gross_pu, dates, yfs, close, close, par, p_std, h, simple)
        pu_w = _unit_series(gross_pu, dates, yfs, close, close, par, p_wh, h, simple)
        pu_m = _unit_series(gross_pu, dates, yfs, close, close, par, p_mgr, h, simple)

    credit_on = w["selldown"]["credit_distributions"]
    prices = []
    for tr, d, days in zip(trs, t_dates, t_days):
        credit = sum(pu for pu, dd in zip(pu_w, dates) if dd <= d) if credit_on else 0.0
        prices.append(_sale_price(tr, par, days, credit))
    units_sold = [s * w_tot for s in shares]

    # people are referred to by id (stable; names are labels) or, in older files, by name; ids win
    pidx = {_key(p["name"]): i for i, p in enumerate(people)}
    pidx.update({_key(p["id"]): i for i, p in enumerate(people) if p.get("id")})
    # buyers: a person (by id or name) or an outside group
    buyer_names = [(tr.get("buyer") or "").strip() or w["names"]["buyers"] for tr in trs]
    buyer_person = [pidx.get(_key(b)) for b in buyer_names]

    # per-unit cash on bought units (their own hurdle in member-by-member mode) and on lender-converted units
    if per_member:
        pu_b = [_unit_series(gross_pu, dates, yfs, close, d, pr, p_std, h, simple) for d, pr in zip(t_dates, prices)]
        pu_c = _unit_series(gross_pu, dates, yfs, close, last, par, p_wh, h, simple)
    else:
        pu_b = [pu_s] * len(trs)
        pu_c = pu_w

    def bought_cash(match, t):
        return sum(u * pu_b[j][t] for j, (u, d, m) in enumerate(zip(units_sold, t_dates, match)) if m and d < dates[t])

    if per_member:  # promote = gross cash on every block of units held, less what its holder keeps
        W_ = [a / par for a in amt]
        mem_u = sum(x for x, r in zip(W_, role) if r == "member")
        eq_u = sum(x for x, r in zip(W_, role) if r == "warehouse")
        ln_u = sum(x for x, r in zip(W_, role) if r == "loan")
        for t in range(N):
            g, held_wh = gross_pu[t], (eq_u + ln_u * (1 - after_last[t])) * (1 - sold_before[t])
            conv = ln_u * unsold * after_last[t]
            pr = (mem_u * (g - pu_s[t]) + held_wh * (g - pu_w[t]) + mgr_units * (g - pu_m[t]) + conv * (g - pu_c[t])
                  + sum(u * (g - pu_b[j][t]) for j, (u, d) in enumerate(zip(units_sold, t_dates)) if d < dates[t]))
            promote.append(pr); members.append(dist_cash[t] - pr)
    mgr_cash = [p - f for p, f in zip(promote, fee)]

    # ---- manager's loan book
    P = amt
    W = [a / par for a in amt]
    loan = [r == "loan" for r in role]
    L = sum(Wi for Wi, ln in zip(W, loan) if ln)
    interest_total = 0.0
    mgr_tr = []
    for j in range(len(trs)):
        v = shares[j] * L * prices[j]
        for i, p in enumerate(people):
            if loan[i]:
                v -= shares[j] * P[i] * (1 + p["loan_rate"] * t_days[j] / 365)
                interest_total += shares[j] * P[i] * p["loan_rate"] * t_days[j] / 365
        if j == j_last:
            for i, p in enumerate(people):
                if loan[i]:
                    v -= unsold * P[i] * p["loan_rate"] * last_days / 365
                    interest_total += unsold * P[i] * p["loan_rate"] * last_days / 365
        mgr_tr.append(v)
    # The manager's cash comes in two kinds, owned separately:
    #   capital side - distributions on its own vehicle units, its loan book, and the reserve it holds;
    #   fees & promote side - acquisition/annual fees and promote.
    mcap = mc + mr
    cap_dist = [pu_m[t] * mgr_units + pu_w[t] * L * (1 - sold_before[t]) * (1 - after_last[t])
                + (mr if t == N - 1 else 0.0) for t in range(N)]
    pro_dist = mgr_cash

    # ---- manager buy-ins: a buyer buys part of the manager from a seller on a date, either its capital,
    # its fees & promote, or both (the same % of each). Capital (or both) is priced from cost - the
    # manager's capital mc + mr - grown by simple/compound interest or +/- a premium, less cash already
    # paid on that interest if credit_distributions; "amount" buys whatever that $ covers. Fees & promote
    # alone has no cost basis, so it is bought for a set price (0 = granted).
    cap0 = [p["manager_capital"] / mcap if mcap > 0 else 0.0 for p in people]
    pro0 = [p["manager_share"] for p in people]
    xs_in = w.get("manager_transfers", [])
    cap, pro, snaps, xfers = list(cap0), list(pro0), [], []
    # Partners leaving (manager_vesting): on `leaves`, a partner keeps the vested part of their fees & promote share
    # (years to vest from close, nothing before the cliff; terms "forfeit" keeps none); the rest goes to the other
    # partners pro rata to their fees & promote shares. Capital stays with them. Handled in date order with buy-ins.
    vest_in = w.get("manager_vesting", [])
    departures = []
    evs = sorted([(x["date"], 0, q) for q, x in enumerate(xs_in)]
                 + [(v["leaves"], 1, k) for k, v in enumerate(vest_in) if v.get("leaves")])
    for _, kind_, q in evs:
        if kind_ == 1:
            v = vest_in[q]
            d = date.fromisoformat(v["leaves"])
            i = pidx.get(_key(v["person"]))
            if i is None:
                departures.append({"person": v["person"], "date": d.isoformat(), "vested": 0.0, "share_before": 0.0,
                                   "share_kept": 0.0, "valid": False})
                continue
            yrs = (d - close).days / 365
            vy, cl = v.get("years", 0.0), v.get("cliff_years", 0.0)
            vested = 0.0 if yrs < cl else (1.0 if vy <= 0 else min(1.0, yrs / vy))
            if v.get("terms", "keep_vested") == "forfeit":
                vested = 0.0
            before = pro[i]
            others = [k for k in range(len(people)) if k != i]
            base = [pro[k] for k in others]
            if sum(base) <= 0:
                base = [cap[k] for k in others]
            if sum(base) <= 0:
                base = [1.0] * len(others)
            freed = before - before * vested
            if others and freed > 0:
                tb = sum(base)
                for k, bk in zip(others, base):
                    pro[k] += freed * bk / tb
                pro[i] = before * vested
            departures.append({"person": people[i]["name"], "date": d.isoformat(), "vested": vested,
                               "share_before": before, "share_kept": pro[i], "valid": True})
            snaps.append((d, list(cap), list(pro)))
            continue
        x = xs_in[q]
        kind = x.get("interest", "both")
        d = date.fromisoformat(x["date"])
        b, s_ = pidx.get(_key(x["buyer"])), pidx.get(_key(x["seller"]))
        ok = b is not None and s_ is not None and b != s_
        sh = paid = pps = 0.0
        if kind == "promote":
            pps = x["price"] / x["share"] if x["share"] > 0 else 0.0
            if ok and x["share"] > 0:
                sh = max(0.0, min(x["share"], pro[s_]))
                paid = x["price"] * sh / x["share"]
        else:
            credit = 0.0
            if x["credit_distributions"]:
                credit = (sum(v for v, dd in zip(mgr_tr, t_dates) if dd <= d)
                          + sum(v for v, dd in zip(cap_dist, dates) if dd <= d))
                if kind == "both":
                    credit += sum(v for v, dd in zip(pro_dist, dates) if dd <= d)
            pps = _sale_price(x, mcap, (d - close).days, credit)
            if ok and pps > 0:
                want = x["share"] if x["mode"] == "share" else x["amount"] / pps
                avail = cap[s_] if kind == "capital" else min(cap[s_], pro[s_])
                sh = max(0.0, min(want, avail))
                paid = sh * pps
        if sh > 0:
            if kind in ("capital", "both"):
                cap[s_] -= sh; cap[b] += sh
            if kind in ("promote", "both"):
                pro[s_] -= sh; pro[b] += sh
        xfers.append({"date": d, "buyer": b, "seller": s_, "interest": kind, "share": sh, "paid": paid,
                      "price_100": pps, "index": q})
        snaps.append((d, list(cap), list(pro)))

    def own_at(d):
        c, pr = cap0, pro0
        for sd, sc, sp in snaps:
            if sd < d:
                c, pr = sc, sp
        return c, pr

    # ---- the manager's own split between its partners. Off (no manager_waterfall, no manager_loans): each
    # partner gets their capital share of the capital side and their fees & promote share of the rest, as before.
    mw = w.get("manager_waterfall") or {}
    m_loans = w.get("manager_loans") or []
    split_on = bool(mw.get("enabled"))
    custom = split_on or bool(m_loans)
    n_p = len(people)
    ev = sorted([(t_dates[j], 0, j) for j in range(len(trs))] + [(dates[t], 1, t) for t in range(N)])
    split_tot = {"enabled": split_on, "to_capital": 0.0, "to_promote": 0.0, "capital": mcap}
    loans_out, lent = [], [0.0] * n_p
    moves, schedules = [], []  # partner-loan cash between people (for the ledger) and each loan's schedule
    # Off-cycle loan payments (#31): pay-downs on their own dates, and a maturity or departure settled on the exact
    # date (due_on "exact_date"), paid by the borrower from their own money. Their dates get their own flow column.
    last_ev = ev[-1][0] if ev else close

    def leave_of(b_):
        ls_ = [date.fromisoformat(v["leaves"]) for v in vest_in if v.get("leaves") and pidx.get(_key(v["person"])) == b_]
        return min(ls_) if ls_ else None

    def loan_extra(ln_):
        tm_, b_, out_ = loan_terms_of(ln_), pidx.get(_key(ln_["borrower"])), []
        for pd in tm_["paydowns"]:
            out_.append((date.fromisoformat(pd["date"]), 2, pd.get("amount", 0.0)))
        if tm_["due_on"] == "exact_date":
            if tm_["maturity"]:
                out_.append((date.fromisoformat(tm_["maturity"]), 3, "maturity"))
            lv_ = leave_of(b_) if tm_["on_leave"] != "continues" and b_ is not None else None
            if lv_ is not None:
                out_.append((lv_, 3, "leaving"))
        return [x for x in out_ if close < x[0] <= last_ev]

    l_dates = sorted({x[0] for ln_ in m_loans for x in loan_extra(ln_)}) if custom else []
    l_cash = [[0.0] * n_p for _ in l_dates]
    m_tr0 = m_dist0 = None
    if custom:
        m_tr = [[own_at(t_dates[j])[0][i] * mgr_tr[j] for i in range(n_p)] for j in range(len(trs))]
        m_dist = [[own_at(dates[t])[0][i] * cap_dist[t] + own_at(dates[t])[1][i] * pro_dist[t] for i in range(n_p)]
                  for t in range(N)]
        if split_on:
            prev, seq = close, []
            for d, k, j in ev:
                seq.append(((d - prev).days / 365, mgr_tr[j] if k == 0 else cap_dist[j] + pro_dist[j]))
                prev = d
            for (d, k, j), (to_c, to_p) in zip(ev, manager_waterfall_split(seq, mcap, mw)):
                oc, op = own_at(d)
                row = [oc[i] * to_c + op[i] * to_p for i in range(n_p)]
                if k == 0:
                    m_tr[j] = row
                else:
                    m_dist[j] = row
                split_tot["to_capital"] += to_c
                split_tot["to_promote"] += to_p
        m_tr0 = [r[:] for r in m_tr]
        m_dist0 = [r[:] for r in m_dist]
        # Partner loans: the lender pays part of the borrower's capital at close; the borrower's manager cash repays
        # it first (interest simple or compound). Left owing at the end: the borrower pays it (recourse) or it is
        # forgiven.
        for ln in m_loans:
            lo, bo = pidx.get(_key(ln["lender"])), pidx.get(_key(ln["borrower"]))
            # a loan funds the borrower's own manager capital, so it is capped at that
            a_l = min(ln["amount"], people[bo]["manager_capital"]) if bo is not None else 0.0
            rec = {"lender": people[lo]["name"] if lo is not None else ln["lender"],
                   "borrower": people[bo]["name"] if bo is not None else ln["borrower"], "amount": a_l, "repaid": 0.0,
                   "interest": 0.0, "owed_end": 0.0, "settled": "invalid"}
            loans_out.append(rec)
            sched = []
            schedules.append(sched)
            if lo is None or bo is None or lo == bo or a_l <= 0:
                continue
            q_l = len(loans_out) - 1
            lent[lo] += a_l
            lent[bo] -= a_l
            moves.append((-1, -1, lo, bo, a_l, q_l, "loan_advance"))
            sched.append({"date": close.isoformat(), "kind": "advance", "interest": 0.0, "paid": 0.0, "balance": a_l})
            # Terms (#24): how and when the loan is repaid. Defaults = the original rule (every dollar of the
            # borrower's manager cash repays it; what's left at the end is paid (recourse) or forgiven).
            tm = loan_terms_of(ln)
            rec["terms"] = tm
            simple_l = ln.get("rate_type", "simple") == "simple"
            r_l, rp = ln["rate"], tm["repayment"]
            mat = date.fromisoformat(tm["maturity"]) if tm["maturity"] else None
            leave = leave_of(bo) if tm["on_leave"] != "continues" else None
            exact = tm["due_on"] == "exact_date"
            # the loan's dates: the manager's cash dates (k 0 sale, 1 distribution), then its own (2 pay-down,
            # 3 due on the exact date); on the same day cash dates come first
            evl = [(d, k, j, None) for d, k, j in ev] + [(d, k, l_dates.index(d), x) for d, k, x in loan_extra(ln)]
            evl.sort(key=lambda z: (z[0], z[1], z[2]))
            prin, acc, prev, done, n_cash = a_l, 0.0, close, False, 0
            for d, k, j, x in evl:
                a = (d - prev).days / 365
                prev = d
                accrued = prin * r_l * a if simple_l else (prin + acc) * ((1 + r_l) ** a - 1)
                acc += accrued
                owed = prin + acc
                if k >= 2:
                    row, cash = l_cash[j], 0.0
                    ends = x if k == 3 else None
                else:
                    n_cash += 1
                    row = m_tr[j] if k == 0 else m_dist[j]
                    cash = max(0.0, row[bo])
                    ends = None if exact else ("leaving" if leave is not None and d >= leave else (
                        "maturity" if mat is not None and d >= mat else None))
                if k == 2:
                    pay = min(max(0.0, x), owed)
                elif k == 3:
                    pay = 0.0
                elif ends == "leaving":
                    pay = 0.0 if tm["on_leave"] == "forgiven" else min(owed, cash)
                elif ends == "maturity":
                    pay = 0.0 if rp == "none" else min(owed, cash)
                elif rp == "sweep":
                    pay = min(tm["sweep_pct"] * cash, owed)
                else:
                    if rp == "interest_only":
                        due = acc
                    elif rp == "equal_principal":
                        left = a_l * max(0.0, 1 - (d - close).days / 365 / tm["term_years"]) if tm["term_years"] > 0 else 0.0
                        due = acc + max(0.0, prin - left)
                    elif rp == "at_exit":
                        due = owed if n_cash == len(ev) else 0.0
                    else:
                        due = 0.0
                    pay = min(due, owed) if tm["source"] == "borrower" else min(due, cash, owed)
                pay = max(0.0, pay)
                row[bo] -= pay
                row[lo] += pay
                rec["repaid"] += pay
                ti = min(pay, acc)
                acc -= ti
                prin -= pay - ti
                mk = 2 if k >= 2 else k
                if pay > 0:
                    moves.append((mk, j, lo, bo, pay, q_l, "loan_paydown" if k == 2 else "loan_repayment"))
                sched.append({"date": d.isoformat(), "kind": "paydown" if k == 2 else "due" if k == 3 else "period",
                              "interest": accrued, "paid": pay, "balance": prin + acc})
                if ends:
                    left_ = max(0.0, prin + acc)
                    rec["interest"] = rec["repaid"] + left_ - a_l
                    rec["owed_end"] = left_
                    rec["due_date"] = d.isoformat()
                    if left_ <= 1e-9:
                        rec["settled"] = "repaid"
                    elif ends == "leaving" and tm["on_leave"] == "forgiven" or ends == "maturity" and not ln.get("recourse", True):
                        rec["settled"] = "forgiven"
                        sched.append({"date": d.isoformat(), "kind": "forgiven", "interest": 0.0, "paid": 0.0,
                                      "balance": left_})
                    else:
                        row[bo] -= left_
                        row[lo] += left_
                        rec["settled"] = "paid_on_leaving" if ends == "leaving" else "paid_at_maturity"
                        moves.append((mk, j, lo, bo, left_, q_l, "loan_settlement"))
                        sched.append({"date": d.isoformat(), "kind": rec["settled"], "interest": 0.0, "paid": left_,
                                      "balance": 0.0})
                    done = True
                    break
            if done:
                continue
            owed = max(0.0, prin + acc)
            rec["interest"] = rec["repaid"] + owed - a_l
            rec["owed_end"] = owed
            if owed > 1e-9 and ln.get("recourse", True) and ev:
                d, k, j = ev[-1]
                row = m_tr[j] if k == 0 else m_dist[j]
                row[bo] -= owed
                row[lo] += owed
                rec["settled"] = "paid_at_end"
                moves.append((k, j, lo, bo, owed, q_l, "loan_settlement"))
                sched.append({"date": d.isoformat(), "kind": "paid_at_end", "interest": 0.0, "paid": owed, "balance": 0.0})
            else:
                rec["settled"] = "repaid" if owed <= 1e-9 else "forgiven"
                if owed > 1e-9 and ev:
                    sched.append({"date": ev[-1][0].isoformat(), "kind": "forgiven", "interest": 0.0, "paid": 0.0,
                                  "balance": owed})

    # ---- people
    all_dates = [close] + t_dates + [x["date"] for x in xfers] + l_dates + dates
    out_people = []

    def mgr_pre(k, j, i):
        """The manager's cash to person i at an event (k 0 = a sale, 1 = a distribution), before partner loans."""
        if custom:
            return (m_tr0[j] if k == 0 else m_dist0[j])[i]
        if k == 0:
            return own_at(t_dates[j])[0][i] * mgr_tr[j]
        oc, op = own_at(dates[j])
        return oc[i] * cap_dist[j] + op[i] * pro_dist[j]

    for i, p in enumerate(people):
        # Ledger (#21): every part of this person's cash, dated, by account (the vehicle's units, the manager, a partner
        # loan, a buy-in). Positive = cash to the person. On every date the parts add up to the person's flows.
        led = []

        def add(d, account, kind, amount, counterparty=None, units=None, price=None):
            if amount != 0:
                led.append({"date": d.isoformat(), "account": account, "kind": kind, "amount": amount,
                            "counterparty": counterparty, "units": units, "price": price})

        def add_moves(k, j, d):
            for (mk, mj, lo_, bo_, amt_, q_, kind_) in moves:
                if mk == k and mj == j:
                    if i == bo_:
                        add(d, f"loan:{q_}", kind_, amt_ if kind_ == "loan_advance" else -amt_, people[lo_]["name"])
                    if i == lo_:
                        add(d, f"loan:{q_}", kind_, -amt_ if kind_ == "loan_advance" else amt_, people[bo_]["name"])

        if P[i]:
            add(close, "vehicle", "warehouse_loan" if role[i] == "loan" else "units_bought", -P[i])
        if p["manager_capital"]:
            add(close, "manager", "manager_capital", -p["manager_capital"])
        add_moves(-1, -1, close)
        c0 = -(P[i] + p["manager_capital"])
        if custom:
            c0 -= lent[i]
        mine = [bp == i for bp in buyer_person]
        from_mgr = 0.0
        tr_flows = []
        for j in range(len(trs)):
            if role[i] == "loan":
                v = shares[j] * P[i] * (1 + p["loan_rate"] * t_days[j] / 365)
                if j == j_last:
                    v += unsold * P[i] * p["loan_rate"] * last_days / 365
            elif role[i] == "warehouse":
                v = shares[j] * W[i] * prices[j]
            else:
                v = 0.0
            bname = people[buyer_person[j]]["name"] if buyer_person[j] is not None else buyer_names[j]
            if role[i] == "loan":
                add(t_dates[j], "vehicle", "warehouse_loan_repaid", v)
            elif role[i] == "warehouse":
                add(t_dates[j], "vehicle", "unit_sale", v, bname, shares[j] * W[i], prices[j])
            if mine[j]:
                v -= units_sold[j] * prices[j]
                add(t_dates[j], "vehicle", "unit_purchase", -units_sold[j] * prices[j], None, units_sold[j], prices[j])
            add(t_dates[j], "manager", "manager_cash", mgr_pre(0, j, i))
            add_moves(0, j, t_dates[j])
            if custom:
                tr_flows.append(v + m_tr[j][i])
                from_mgr += m_tr[j][i]
            else:
                tr_flows.append(v + own_at(t_dates[j])[0][i] * mgr_tr[j])
                from_mgr += own_at(t_dates[j])[0][i] * mgr_tr[j]
        dist = []
        for t in range(N):
            if role[i] == "loan":
                v = pu_c[t] * W[i] * unsold * after_last[t]
            elif role[i] == "warehouse":
                v = pu_w[t] * W[i] * (1 - sold_before[t])
            else:
                v = pu_s[t] * W[i]
            oc, op = own_at(dates[t])
            add(dates[t], "vehicle", "distribution", v)
            add(dates[t], "vehicle", "distribution_bought_units", bought_cash(mine, t))
            add(dates[t], "manager", "manager_cash", mgr_pre(1, t, i))
            add_moves(1, t, dates[t])
            if custom:
                dist.append(v + bought_cash(mine, t) + m_dist[t][i])
                from_mgr += m_dist[t][i]
            else:
                dist.append(v + bought_cash(mine, t) + oc[i] * cap_dist[t] + op[i] * pro_dist[t])
                from_mgr += oc[i] * cap_dist[t] + op[i] * pro_dist[t]
        x_flows = [(x["paid"] if x["seller"] == i else 0.0) - (x["paid"] if x["buyer"] == i else 0.0) for x in xfers]
        for q, x in enumerate(xfers):
            if x["seller"] == i:
                add(x["date"], f"buyin:{q}", "buyin_sale", x["paid"], people[x["buyer"]]["name"] if x["buyer"] is not None else None)
            if x["buyer"] == i:
                add(x["date"], f"buyin:{q}", "buyin_purchase", -x["paid"], people[x["seller"]]["name"] if x["seller"] is not None else None)
        l_flows = [l_cash[m][i] for m in range(len(l_dates))]
        for m in range(len(l_dates)):
            add_moves(2, m, l_dates[m])
        led.sort(key=lambda e: e["date"])
        flows = [c0] + tr_flows + x_flows + l_flows + dist
        cash_in, at_sales, at_buyins = -c0, sum(tr_flows), sum(x_flows)
        at_risk = cash_in - at_sales - at_buyins
        out_people.append({
            "name": p["name"], "flows": flows, "ledger": led,
            "summary": {"cash_in": cash_in, "returned_at_selldown": at_sales, "at_buyins": at_buyins,
                        "at_risk": at_risk, "manager_share_end": pro[i], "manager_capital_share_end": cap[i],
                        "profit": sum(flows), "irr": xirr(flows, all_dates),
                        "multiple_at_risk": sum(dist) / at_risk if at_risk > 0 else None,
                        "from_manager": from_mgr, "manager_loans_net": lent[i]},
        })

    # ---- outside buyer groups (sales whose buyer isn't a person)
    b_dates = t_dates + dates
    groups = []
    for name in dict.fromkeys(b for b, bp in zip(buyer_names, buyer_person) if bp is None):
        mine = [bp is None and _key(b) == _key(name) for b, bp in zip(buyer_names, buyer_person)]
        flows = [-u * pr if m else 0.0 for u, pr, m in zip(units_sold, prices, mine)]
        flows += [bought_cash(mine, t) for t in range(N)]
        units = sum(u for u, m in zip(units_sold, mine) if m)
        cost = -sum(flows[:len(trs)])
        groups.append({"name": name, "flows": flows,
                       "summary": {"units": units, "cost": cost, "profit": sum(flows),
                                   "irr": xirr(flows, b_dates) if units > 0 else None}})
    all_buy = [-u * pr for u, pr in zip(units_sold, prices)] + [bought_cash([True] * len(trs), t) for t in range(N)]
    total_sold = sum(units_sold)

    check = abs(round(-raised - mr - sum(x["flows"][0] for x in out_people), 2))
    for q in range(len(xfers)):
        check += abs(round(sum(x["flows"][1 + len(trs) + q] for x in out_people), 2))
    for j in range(len(trs)):
        check += abs(round(sum(x["flows"][1 + j] for x in out_people) + sum(g["flows"][j] for g in groups), 2))
    for m in range(len(l_dates)):
        check += abs(round(sum(x["flows"][1 + len(trs) + len(xfers) + m] for x in out_people), 2))
    for t in range(N):
        k = 1 + len(trs) + len(xfers) + len(l_dates) + t
        check += abs(round(sum(x["flows"][k] for x in out_people) + sum(g["flows"][len(trs) + t] for g in groups)
                           - (dist_cash[t] - fee[t]) - (mr if t == N - 1 else 0.0), 2))

    return {
        "dates": [d.isoformat() for d in all_dates],
        "sv26_distributable": dist_cash, "manager_promote": promote, "manager_fees": [-f for f in fee],
        "member_distributions": members, "per_unit": pu_s, "per_unit_warehouse": pu_w,
        "tranches": [{"date": d.isoformat(), "share": s, "units": u, "price": pr,
                      "buyer": people[bp]["name"] if bp is not None else b}
                     for d, s, u, pr, b, bp in zip(t_dates, shares, units_sold, prices, buyer_names, buyer_person)],
        "people": out_people,
        "buyers": groups,
        "manager_transfers": [{"date": x["date"].isoformat(), "index": x["index"],
                               "buyer": people[x["buyer"]]["name"] if x["buyer"] is not None else None,
                               "seller": people[x["seller"]]["name"] if x["seller"] is not None else None,
                               "interest": x["interest"], "share": x["share"], "paid": x["paid"],
                               "price_100": x["price_100"]} for x in xfers],
        "manager_split": split_tot, "manager_loans": loans_out, "manager_departures": departures,
        "loan_schedules": schedules, "loan_payment_dates": [d.isoformat() for d in l_dates],
        "summary": {
            "people": [x["summary"] for x in out_people],
            "buyers": [g["summary"] for g in groups],
            "buyers_units": total_sold, "buyers_cost": sum(u * pr for u, pr in zip(units_sold, prices)),
            "buyers_irr": xirr(all_buy, b_dates) if total_sold > 0 else None,
            "share_sold": sum(shares), "pool": pool,
            "unfunded": raised - mc - sum(amt),
            "manager_unfunded": mcap - sum(p["manager_capital"] for p in people),
            "manager_promote_total": sum(promote), "manager_fees_total": -sum(fee),
            "loan_interest_total": interest_total, "admin_per_year": admin,
            "check": check,
        },
    }


# ---------------------------------------------------------------- structure templates (engine/structures.json)

def load_structures() -> dict:
    return json.loads((Path(__file__).parent / "structures.json").read_text())


def structure_partners(inp: dict, lib: dict) -> list:
    """LTEC's partners: the people who own part of the manager (not the manager itself, not outside members), with their
    capital and fees & promote shares; or the library's default partners."""
    w = inp["warehouse"]
    mgr = _key(w["names"]["manager"])
    ps = [p for p in w["people"] if (p["manager_capital"] > 0 or p["manager_share"] > 0) and _key(p["name"]) != mgr]
    tc, tp = sum(p["manager_capital"] for p in ps), sum(p["manager_share"] for p in ps)
    if not ps or tp <= 0:
        return [dict(p) for p in lib["partners"]]
    return [{"id": p.get("id") or person_id(p["name"]), "name": p["name"],
             "capital_share": p["manager_capital"] / tc if tc > 0 else p["manager_share"] / tp,
             "promote_share": p["manager_share"] / tp} for p in ps]


def template_note(t: dict, inp: dict) -> str:
    """A structure template's description with its own numbers and the manager's name filled in: {manager}; rates and
    shares ({sale_carry}, {promote}, {reserve_pct}, ...) as percentages; {sale_months} as a whole number."""
    def val(k):
        if k == "manager":
            return inp["warehouse"]["names"]["manager"]
        v = t.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return None
        return str(int(round(v))) if k.endswith("months") else f"{v * 100:.1f}%"
    return re.sub(r"\{([a-z_]+)\}", lambda m: val(m.group(1)) or m.group(0), t.get("note", ""))


def apply_structure(inp: dict, key: str, lib: dict | None = None, partners: list | None = None) -> dict:
    """The deal's inputs with the vehicle (warehouse) rebuilt from a structure template, keeping the check, the vehicle
    close date, the names of the manager and buyers, LTEC's partners and LTEC's own terms. Nothing else changes."""
    lib = lib or load_structures()
    t = lib["templates"][key]
    out = json.loads(json.dumps(inp))
    w0 = inp["warehouse"]
    ps = partners or structure_partners(inp, lib)
    check = inp["investor"]["check"]
    reserve = check * t["reserve_pct"]
    mc = check * t["manager_commitment_pct"]
    outside = check + reserve - mc
    deal_name = inp.get("meta", {}).get("ui", {}).get("deal_short") or inp.get("meta", {}).get("name", "Deal")
    people = [{"id": p.get("id") or person_id(p["name"]), "name": p["name"], "amount": 0.0, "role": "member",
               "manager_capital": mc * p["capital_share"], "manager_share": p["promote_share"], "loan_rate": 0.08}
              for p in ps]
    tranches = []
    if t["outside"] == "members" and outside > 0.005:
        people.append({"id": "outside_members", "name": w0["names"]["buyers"], "amount": outside, "role": "member",
                       "manager_capital": 0.0, "manager_share": 0.0, "loan_rate": 0.08})
    elif t["outside"] == "warehouse" and outside > 0.005:
        people[0]["amount"] = outside
        people[0]["role"] = "warehouse"
        tranches = [{"date": add_months(date.fromisoformat(w0["close_date"]), t["sale_months"]).isoformat(), "share": 1.0,
                     "pricing": "carry_simple", "rate": t["sale_carry"], "buyer": w0["names"]["buyers"]}]
    w = out["warehouse"]
    w.update({
        "structure": key,
        "names": {"vehicle": t["vehicle_name"].replace("{deal}", deal_name).replace("{manager}", w0["names"]["manager"]), "manager": w0["names"]["manager"],
                  "buyers": w0["names"]["buyers"]},
        "unit_price": 1000.0, "reserve": reserve, "manager_commitment": mc, "manager_reserve": 0.0,
        "admin_cost_per_year": t["admin_cost_per_year"], "admin_cost_method": "fixed",
        "acq_fee_pct": t["acq_fee_pct"], "mgmt_fee_pct": t["mgmt_fee_pct"],
        "member_hurdle_irr": t["member_hurdle_irr"], "hurdle_type": "compound", "hurdle_basis": "pooled",
        "promote": t["promote"], "warehouse_promote": t["promote"], "promote_on_manager_units": True,
        "people": people,
        "selldown": {"credit_distributions": True, "tranches": tranches},
    })  # LTEC's own terms (buy-ins, waterfall, loans, vesting) belong to LTEC, not the vehicle, so they stay
    return out


# ---------------------------------------------------------------- ids, paths and variants
# People (and other list items) carry a stable `id`; names are labels. Paths address list items by id with
# `key[id]` (warehouse.people[levi].manager_capital), by position with a number, or fields with names.

def person_id(name: str, taken=()) -> str:
    """A stable id from a name: lowercase letters, digits and _; made unique against `taken`."""
    base = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_") or "person"
    pid, n = base, 2
    while pid in taken:
        pid, n = f"{base}_{n}", n + 1
    return pid


_ID_SEG = re.compile(r"^([^\[\]]+)\[([^\]]+)\]$")


def get_path(obj, path: str):
    """The value at a dotted path (None when missing)."""
    cur = obj
    for seg in path.split("."):
        m = _ID_SEG.match(seg)
        if m:
            lst = cur.get(m.group(1)) if isinstance(cur, dict) else None
            cur = next((x for x in lst or [] if isinstance(x, dict) and x.get("id") == m.group(2)), None)
        elif isinstance(cur, list):
            cur = cur[int(seg)] if seg.isdigit() and int(seg) < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(seg)
        else:
            return None
        if cur is None:
            return None
    return cur


def set_path(obj, path: str, value) -> None:
    """Set the value at a dotted path. `list[id]` as the last segment replaces that item (adding it if new, removing
    it when value is None)."""
    segs = path.split(".")
    cur = obj
    for n, seg in enumerate(segs):
        last = n == len(segs) - 1
        m = _ID_SEG.match(seg)
        if m:
            lst, iid = cur[m.group(1)], m.group(2)
            idx = next((i for i, x in enumerate(lst) if isinstance(x, dict) and x.get("id") == iid), None)
            if last:
                if value is None:
                    if idx is not None:
                        lst.pop(idx)
                elif idx is None:
                    lst.append(dict(value, id=iid))
                else:
                    lst[idx] = dict(value, id=iid)
                return
            if idx is None:
                raise KeyError(f"{path}: no item with id {iid}")
            cur = lst[idx]
        else:
            key = int(seg) if isinstance(cur, list) else seg
            if last:
                cur[key] = value
                return
            cur = cur[key]


def merge_deep(base, changes):
    """Objects merge; everything else (lists too) replaces."""
    out = json.loads(json.dumps(base))
    for k, v in changes.items():
        out[k] = merge_deep(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else json.loads(json.dumps(v))
    return out


def apply_variant(inp: dict, alt: dict, lib: dict | None = None) -> dict:
    """A variant (meta.alternatives entry) applied to inputs: its structure template first (built for the current
    check, names and partners), then `changes` merged (older variants), then each `set` path (list items by id)."""
    out = json.loads(json.dumps(inp))
    if alt.get("structure"):
        out = apply_structure(out, alt["structure"], lib)
    if alt.get("changes"):
        out = merge_deep(out, alt["changes"])
    for p, v in (alt.get("set") or {}).items():
        set_path(out, p, json.loads(json.dumps(v)))
    return out


def reference_issues(inp: dict, strict: bool = False) -> list:
    """People references that point at nobody: loans, vesting, buy-ins (by id, or by name unless strict), and missing
    or duplicate ids. Empty = every reference resolves."""
    w = inp["warehouse"]
    ids = [p.get("id") for p in w["people"]]
    out = []
    if any(not i for i in ids):
        out.append("a person has no id")
    dup = sorted({i for i in ids if i and ids.count(i) > 1})
    if dup:
        out.append(f"duplicate ids: {', '.join(dup)}")
    known = {i for i in ids if i} | (set() if strict else {_key(p["name"]) for p in w["people"]})
    ok = lambda r: bool(r) and (r in known or (not strict and _key(r) in known))  # noqa: E731
    for q, ln in enumerate(w.get("manager_loans", [])):
        for role in ("lender", "borrower"):
            if not ok(ln[role]):
                out.append(f"partner loan {q + 1}: {role} '{ln[role]}' is not a person")
    for q, v in enumerate(w.get("manager_vesting", [])):
        if not ok(v["person"]):
            out.append(f"vesting {q + 1}: '{v['person']}' is not a person")
    for q, x in enumerate(w.get("manager_transfers", [])):
        for role in ("buyer", "seller"):
            if not ok(x[role]):
                out.append(f"buy-in {q + 1}: {role} '{x[role]}' is not a person")
    return out


def fill_label(text: str, inp: dict) -> str:
    """A variant's title or note with current names: {manager}, {vehicle}, {buyers} and {<person id>}."""
    w = inp["warehouse"]
    names = dict(w["names"])
    names.update({p["id"]: p["name"] for p in w["people"] if p.get("id")})
    return re.sub(r"\{([a-z0-9_]+)\}", lambda m: names.get(m.group(1), m.group(0)), text or "")


def warehouse(inp: dict, cases: dict) -> dict:
    share = inp["investor"]["check"] / inp["deal"]["lp_equity"]
    out = {}
    for k, c in cases.items():
        pay_dates = [date.fromisoformat(d) for d in c["investor"]["payment_dates"]]
        vdates, rec, yfs = vehicle_periods(pay_dates, c["investor"]["payments"], inp)
        res = warehouse_case(rec, inp, dates=vdates, yfs=yfs)
        res["by_pct_sold"] = {
            str(p): [{kk: s[kk] for kk in ("at_risk", "profit", "irr")}
                     for s in warehouse_case(rec, inp, pct_sold=p, dates=vdates, yfs=yfs)["summary"]["people"]]
            for p in (0, 0.25, 0.5, 0.75, 1.0)
        }
        out[k] = res
    return out


def run_all(inp: dict) -> dict:
    cases = {k: run_case(k, inp) for k in inp["cases"]}
    return {
        "inputs_version": inp.get("version"),
        "cases": cases,
        "sensitivity": sensitivity(inp, cases["custom"]),
        "sensitivity_by_case": {k: sensitivity(inp, c, include_own=True) for k, c in cases.items()},
        "warehouse": warehouse(inp, cases),
    }


def _fmt_pct(x):
    return "n/a" if x is None else f"{x * 100:6.1f}%"


def main(argv: list[str]) -> None:
    slug = next((a for a in argv if not a.startswith("--") and not a.endswith(".json")), None) or list_deals()[0]
    inp = load_deal(slug)
    res = run_all(inp)
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(json.dumps(res, indent=1, default=str))
    print(f"{'Case':16}{'LP IRR':>9}{'Multiple':>10}{'Investor profit':>18}")
    for c in res["cases"].values():
        print(f"{c['label']:16}{_fmt_pct(c['lp']['irr']):>9}{c['lp']['multiple']:>9.2f}x"
              f"{c['investor']['profit']:>18,.0f}")
    names = inp["warehouse"]["names"]
    print(f"\n{names['vehicle']} warehouse (profit by person; {names['buyers']} IRR):")
    for k, w in res["warehouse"].items():
        s = w["summary"]
        ppl = "  ".join(f"{p['name']} {x['profit']:>10,.0f}" for p, x in zip(inp["warehouse"]["people"], s["people"]))
        print(f"  {inp['cases'][k]['label']:16} {ppl}  {_fmt_pct(s['buyers_irr'])}")


if __name__ == "__main__":
    main(sys.argv[1:])
