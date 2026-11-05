"""Siena Villas acceptance tests: the engine must reproduce the v10 and SV26 workbooks at default inputs.

Run: python -m pytest  (or python deals/siena-villas/tests/test_tieout.py)
"""
import json
import sys
from pathlib import Path

DEAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEAL.parents[1]))
from engine.core import load_deal, run_all  # noqa: E402


def load_inputs():
    return load_deal(DEAL / "deal.json")


REF = json.loads((DEAL / "reference" / "excel_values.json").read_text())
RES = run_all(load_inputs())


def close(a, b, tol):
    assert a is not None and b is not None, (a, b)
    assert abs(a - b) <= tol, f"{a} vs {b} (tol {tol})"


def test_cases_tie_to_v10():
    for k, ref in REF["cases"].items():
        c = RES["cases"][k]
        for mine, theirs in zip(c["operations"]["operating_cash_flow"], ref["ocf"]):
            close(mine, theirs, 0.01)
        for mine, theirs in zip(c["waterfall"]["lp"], ref["lp"]):
            close(mine, theirs, 0.01)
        for mine, theirs in zip(c["waterfall"]["gp"], ref["gp"]):
            close(mine, theirs, 0.01)
        close(c["exit"]["net_sale_proceeds"], ref["nsp"], 0.01)
        close(c["lp"]["irr"], ref["irr"], 1e-7)
        close(c["lp"]["multiple"], ref["multiple"], 1e-9)


def test_custom_case_and_sensitivity():
    # The Custom case defaults to Adjusted Base with v10's Exit & Disposition settings,
    # so it must reproduce that tab.
    ce = RES["cases"]["custom"]
    close(ce["exit"]["gross_value"], REF["custom_exit"]["gross"], 0.01)
    close(ce["exit"]["net_sale_proceeds"], REF["custom_exit"]["nsp"], 0.01)
    close(ce["lp"]["irr"], REF["custom_exit"]["irr"], 1e-7)
    for mine, theirs in zip(ce["waterfall"]["lp"], REF["cases"]["base"]["lp"]):
        close(mine, theirs, 0.01)
    for row_mine, row_ref in zip(RES["sensitivity"]["lp_irr"], REF["sensitivity_lp_irr"]):
        for a, b in zip(row_mine, row_ref):
            close(a, b, 1e-7)


def test_warehouse_ties_to_sv26_workbook():
    # The workbook typed in v10 distributions rounded to $1, so allow a few dollars.
    # Default people: [0] = Levi, [1] = Thaxter; one sale.
    for k, ref in list(REF["warehouse"].items()) + [("custom", REF["warehouse"]["base"])]:
        res = RES["warehouse"][k]
        s = res["summary"]
        levi, thax = s["people"][0], s["people"][1]
        assert s["check"] < 0.05
        close(levi["cash_in"], ref["levi_cash_in"], 0.01)
        close(levi["returned_at_selldown"], ref["levi_returned_at_selldown"], 0.01)
        close(levi["at_risk"], ref["levi_at_risk"], 0.01)
        close(res["tranches"][0]["price"], ref["new_member_price"], 0.01)
        close(levi["profit"], ref["levi_profit"], 10)
        close(thax["profit"], ref["thaxter_profit"], 10)
        close(s["manager_promote_total"], ref["ltec_promote_total"], 10)
        close(levi["irr"], ref["levi_irr"], 2e-4)
        close(thax["irr"], ref["thaxter_irr"], 2e-4)
        close(s["buyers_irr"], ref["new_member_irr"], 2e-4)
        for p, v in ref["levi_profit_by_pct_sold"].items():
            close(res["by_pct_sold"][p][0]["profit"], v, 10)


def test_each_case_grid_hits_its_own_result():
    # Every case's sensitivity grid, at its own exit cap and 100% NOI, is that case's LP IRR.
    for k, sens in RES["sensitivity_by_case"].items():
        i = next(n for n, c in enumerate(sens["exit_caps"]) if abs(c - sens["own_cap"]) < 1e-9)
        j = sens["noi_factors"].index(1.0)
        close(sens["lp_irr"][i][j], RES["cases"][k]["lp"]["irr"], 1e-7)


def test_member_hurdle_equals_pooled_when_everyone_buys_in_together():
    # With no sales every unit is bought at par at close, so a member-by-member hurdle must equal the pooled one.
    import copy
    for typ in ("compound", "simple"):
        base = copy.deepcopy(load_inputs())
        base["warehouse"]["selldown"]["tranches"] = []
        base["warehouse"]["hurdle_type"] = typ
        per = copy.deepcopy(base)
        per["warehouse"]["hurdle_basis"] = "per_member"
        a, b = run_all(base)["warehouse"], run_all(per)["warehouse"]
        for k in a:
            for x, y in zip(a[k]["summary"]["people"], b[k]["summary"]["people"]):
                close(x["profit"], y["profit"], 0.01)


def test_refinance_shortfall_is_carried_not_lost():
    # A refinance that doesn't cover the old loan: every dollar of partnership cash is still accounted for.
    import copy
    from engine.core import run_case
    inp = copy.deepcopy(load_inputs())
    inp["deal"]["hold_years"] = 8
    inp["deal"]["refi"].update(enabled=True, year=5)
    c = run_case("stress", inp)
    assert c["operations"]["refi"]["net_proceeds"] < 0
    cash = [o + r for o, r in zip(c["operations"]["operating_cash_flow"], c["operations"]["refi_proceeds"])]
    cash[-1] += c["exit"]["net_sale_proceeds"]
    paid = sum(c["waterfall"]["lp"]) + sum(c["waterfall"]["gp"])
    close(paid, sum(cash), 0.01)


def test_crystallization_conserves_cash_and_side_letter_protects_ltec():
    import copy
    from engine.core import run_case
    inp = copy.deepcopy(load_inputs())
    inp["deal"]["hold_years"] = 8
    inp["deal"]["refi"].update(enabled=True, year=5, crystallize=True)
    for k in ("sponsor", "base"):
        c = run_case(k, inp)
        cr = c["crystallization"]
        assert cr["applied"] and cr["ltec_protected"]
        cash = [o + r for o, r in zip(c["operations"]["operating_cash_flow"], c["operations"]["refi_proceeds"])]
        cash[-1] += c["exit"]["net_sale_proceeds"]
        close(sum(c["waterfall"]["lp"]) + sum(c["waterfall"]["gp"]), sum(cash), 0.01)
        # protected: LTEC's check earns the regular waterfall's IRR
        close(c["investor"]["irr"], run_case(k, dict(inp, deal=dict(inp["deal"], refi=dict(inp["deal"]["refi"], crystallize=False))))["lp"]["irr"], 1e-9)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
