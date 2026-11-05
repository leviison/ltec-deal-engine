"""The Bend acceptance tests: at default inputs the engine reproduces the sponsor model (9-23-26) to the cent.

- operations, debt, TIF rebate, fees and cash available by year (UW Model tab)
- sale: price, costs, disposition fee, loan payoff, reserves returned, TIF NPV, net proceeds
- the default waterfall = 'Partnership Returns - Annual' (deck headline 17.08% / 2.06x)
- the 'Sponsor UW-tab waterfall' alternative = UW Model tab (17.06%) and its exit-cap sensitivity
- the deck's $100k sample investment
Run: python -m pytest  (or python deals/the-bend/tests/test_tieout.py)
"""
import copy
import json
import sys
from pathlib import Path

DEAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEAL.parents[1]))
from engine.core import load_deal, run_all, run_case  # noqa: E402

REF = json.loads((DEAL / "reference" / "excel_values.json").read_text())
INP = load_deal(DEAL / "deal.json")
RES = run_all(INP)
SP = RES["cases"]["sponsor"]


def close(a, b, tol):
    assert a is not None and b is not None, (a, b)
    assert abs(a - b) <= tol, f"{a} vs {b} (tol {tol})"


def series(mine, theirs, tol=0.01):
    assert len(mine) == len(theirs), (mine, theirs)
    for a, b in zip(mine, theirs):
        close(a, b, tol)


def merge(base, changes):
    out = copy.deepcopy(base)
    for k, v in changes.items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def alternative(name):
    alt = next(a for a in INP["meta"]["alternatives"] if a["name"] == name)
    return merge(INP, alt["changes"])


def test_operations_tie_to_uw_model():
    o, r = SP["operations"], REF["ops"]
    series(o["total_income"], r["egi"])
    series(o["opex"], r["opex"])
    series(o["noi"], r["noi"])
    series(o["capex"], r["capex"])
    series(o["below_noi_income"], r["tif"])
    series(o["debt_service"], r["ds"])
    series(o["asset_mgmt_fee"], r["am"])
    series(o["operating_cash_flow"], r["cfad"])


def test_sale_ties_to_uw_model():
    e, s = SP["exit"], REF["sale"]
    close(e["gross_value"], s["gross"], 0.01)
    close(e["selling_costs"], s["costs"], 0.01)
    close(e["disposition_fee"], s["dispo"], 0.01)
    close(e["debt_payoff"], s["payoff"], 0.01)
    close(e["reserves_returned"], s["reserves"], 0.01)
    close(e["below_noi_sale_value"], s["bond"], 0.01)
    close(e["net_sale_proceeds"], s["proceeds"], 0.01)


def test_default_waterfall_ties_to_partnership_returns():
    w, p = SP["waterfall"], REF["partnership"]
    series(w["cash"], p["cash"])
    series(w["lp"], p["lp"])
    series(w["gp"], p["gp"])
    close(SP["lp"]["irr"], p["irr"], 1e-9)
    close(SP["lp"]["multiple"], p["multiple"], 1e-9)
    # sponsor fees after close: asset management by year, disposition fee in the sale year
    fees = [a for a in SP["operations"]["asset_mgmt_fee"]]
    fees[-1] += SP["exit"]["disposition_fee"]
    series(fees, p["gp_fees"][1:])


def test_uw_tab_waterfall_alternative():
    # The model rounds the capital account to whole dollars (UW Model row 177), so allow $0.25.
    c = run_case("sponsor", alternative("Sponsor UW-tab waterfall"))
    series(c["waterfall"]["lp"], REF["uw"]["lp"], 0.25)
    series(c["waterfall"]["gp"], REF["uw"]["gp"], 0.25)
    close(c["lp"]["irr"], REF["uw"]["irr"], 1e-7)


def test_exit_cap_sensitivity_matches_model_tab():
    inp = alternative("Sponsor UW-tab waterfall")
    inp["sensitivity"]["exit_caps"] = [cap for cap, _ in REF["sensitivity_uw"]]
    res = run_all(inp)["sensitivity_by_case"]["sponsor"]
    j = res["noi_factors"].index(1.0)
    for (cap, irr), row in zip(REF["sensitivity_uw"], res["lp_irr"]):
        close(row[j], irr, 1e-7)


def test_sample_100k_investment():
    s = REF["sample_100k"]
    share = 100000 / INP["deal"]["lp_equity"]
    close(share, s["ownership"], 1e-12)
    series([x * share for x in SP["waterfall"]["lp"]], s["distributions"])


def test_side_letter_identity_and_cost():
    # Side-letter terms equal to the deal's own terms leave our check exactly where it was ...
    same = copy.deepcopy(INP)
    same["investor"]["side_letter"] = {"enabled": True, "terms": {}}
    inv = run_case("sponsor", same)["investor"]
    series(inv["distributions"], SP["investor"]["distributions"], 1e-6)
    close(inv["irr"], SP["investor"]["irr"], 1e-9)
    # ... and the offer's better terms pay us more, all of it out of the sponsor's promote on our share.
    off = run_case("sponsor", alternative("Side letter offer (Oct 14)"))["investor"]
    sl = off["side_letter"]
    assert sl["uplift"] > 0 and off["irr"] > SP["investor"]["irr"]
    share = INP["investor"]["check"] / INP["deal"]["lp_equity"]
    assert sl["sponsor_cost"] <= SP["gp_promote_total"] * share + 0.01


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
