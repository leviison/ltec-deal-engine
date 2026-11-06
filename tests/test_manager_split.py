"""LTEC's own split between its partners (warehouse.manager_waterfall / manager_loans / manager_vesting), issue #9.

Hand calculations for the waterfall, plus whole-vehicle checks: off = unchanged, cash is conserved, a loan moves
exactly the borrower's cash to the lender, and vesting moves promote share on the leave date.
"""
import copy
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import load_deal, manager_waterfall_split, run_all, xirr  # noqa: E402
from datetime import date  # noqa: E402


def test_hand_calc_tiers():
    # Capital 100. Capital back + 8% compounding pref; then 50% to capital until it reaches a 15% IRR; then 20%.
    mw = {"pref": 0.08, "pref_type": "compound", "tiers": [{"capital_share": 0.5, "to_irr": 0.15}],
          "residual_capital_share": 0.2}
    (c1, p1), (c2, p2) = manager_waterfall_split([(1.0, 50.0), (1.0, 200.0)], 100.0, mw)
    # Year 1: all 50 to capital (pref balance 108 -> 58).
    assert (c1, p1) == pytest.approx((50.0, 0.0))
    # Year 2: pref 58 x 1.08 = 62.64 to capital. Tier: 15% balance 115 - 50 = 65 -> 74.75; still needed
    # 74.75 - 62.64 = 12.11, at 50% that takes 24.22 of cash. The remaining 113.14 splits 20/80.
    assert c2 == pytest.approx(62.64 + 12.11 + 0.2 * 113.14)
    assert p2 == pytest.approx(12.11 + 0.8 * 113.14)
    assert c2 + p2 == pytest.approx(200.0)
    # At the tier boundary the capital holders have exactly 15%.
    assert xirr([-100.0, 50.0, 62.64 + 12.11], [date(2026, 1, 1), date(2027, 1, 1), date(2028, 1, 1)]) == pytest.approx(0.15, abs=1e-4)


def test_hand_calc_simple_pref_and_shortfall():
    # Simple 10% pref on unreturned capital, then everything to promote holders. Negative cash is put in by capital.
    mw = {"pref": 0.10, "pref_type": "simple", "tiers": [], "residual_capital_share": 0.0}
    out = manager_waterfall_split([(1.0, 5.0), (1.0, -20.0), (1.0, 150.0)], 100.0, mw)
    # Y1: accrued 10, pay 5 (to accrued) -> acc 5, cap 100. Y2: accrue 10 -> acc 15; 20 more capital -> 120.
    # Y3: accrue 12 -> acc 27; owed 147 to capital, 3 left to promote.
    assert out[0] == pytest.approx((5.0, 0.0))
    assert out[1] == pytest.approx((-20.0, 0.0))
    assert out[2] == pytest.approx((147.0, 3.0))


def _siena():
    d = load_deal("siena-villas")
    w = d["warehouse"]
    # Levi funds all of LTEC; Thaxter has half the fees & promote.
    w["people"][0]["manager_capital"] = w["manager_commitment"] + w.get("manager_reserve", 0)
    w["people"][1]["manager_capital"] = 0.0
    return d


def _wh(d, case="base"):
    return run_all(d)["warehouse"][case]


def test_off_is_unchanged_and_cash_conserved():
    d = _siena()
    a = _wh(d)
    d2 = copy.deepcopy(d)
    d2["warehouse"]["manager_waterfall"] = {"enabled": False, "pref": 0.08, "pref_type": "compound", "tiers": [],
                                            "residual_capital_share": 0.0}
    d2["warehouse"]["manager_loans"] = []
    b = _wh(d2)
    assert [p["flows"] for p in a["people"]] == [p["flows"] for p in b["people"]]
    d2["warehouse"]["manager_waterfall"]["enabled"] = True
    c = _wh(d2)
    assert c["summary"]["check"] == pytest.approx(0, abs=0.05)
    # Same total to the partners from LTEC; the funder gets more of it first.
    tot = lambda r: sum(p["from_manager"] for p in r["summary"]["people"])  # noqa: E731
    assert tot(c) == pytest.approx(tot(a))
    assert c["summary"]["people"][0]["from_manager"] > a["summary"]["people"][0]["from_manager"]


def test_loan_moves_borrowers_cash_to_lender():
    d = _siena()
    w = d["warehouse"]
    half = w["people"][0]["manager_capital"] / 2
    w["people"][0]["manager_capital"] = w["people"][1]["manager_capital"] = half
    base = _wh(d)
    w["manager_loans"] = [{"lender": w["people"][0]["name"], "borrower": w["people"][1]["name"], "amount": half,
                           "rate": 0.08, "rate_type": "simple", "recourse": True}]
    r = _wh(d)
    ln = r["manager_loans"][0]
    assert r["summary"]["check"] == pytest.approx(0, abs=0.05)
    lender, borrower = r["summary"]["people"][0], r["summary"]["people"][1]
    b0, b1 = base["summary"]["people"][0], base["summary"]["people"][1]
    # The lender's profit rises by exactly the interest; the borrower's falls by it.
    assert lender["profit"] - b0["profit"] == pytest.approx(ln["interest"], abs=0.01)
    assert b1["profit"] - borrower["profit"] == pytest.approx(ln["interest"], abs=0.01)
    assert borrower["cash_in"] == pytest.approx(b1["cash_in"] - half)
    # Recourse: nothing is left owing (paid from LTEC cash or at the end).
    assert ln["settled"] in ("repaid", "paid_at_end")
    # Non-recourse on a deal that can't repay forgives the rest.
    d["warehouse"]["manager_loans"][0].update(recourse=False, rate=0.5)
    r2 = _wh(d, "stress")
    assert r2["manager_loans"][0]["settled"] in ("forgiven", "repaid")


def test_vesting_departure_moves_promote_share():
    d = _siena()
    w = d["warehouse"]
    w["people"].append({"name": "GP partner", "amount": 0.0, "role": "member", "manager_capital": 0.0,
                        "manager_share": 0.2, "loan_rate": 0.0})
    w["people"][0]["manager_share"] = w["people"][1]["manager_share"] = 0.4
    close = date.fromisoformat(w["close_date"])
    leaves = date(close.year + 2, close.month, close.day).isoformat()
    w["manager_vesting"] = [{"person": "GP partner", "years": 4, "cliff_years": 1, "leaves": leaves,
                             "terms": "keep_vested"}]
    r = _wh(d)
    dep = r["manager_departures"][0]
    assert dep["vested"] == pytest.approx(2 * 365 / 365 / 4, abs=0.01)
    assert dep["share_kept"] == pytest.approx(0.2 * dep["vested"])
    end = r["summary"]["people"]
    assert end[2]["manager_share_end"] == pytest.approx(dep["share_kept"])
    assert end[0]["manager_share_end"] == pytest.approx(0.4 + (0.2 - dep["share_kept"]) / 2)
    assert sum(p["manager_share_end"] for p in end) == pytest.approx(1.0)
    assert r["summary"]["check"] == pytest.approx(0, abs=0.05)
    w["manager_vesting"][0]["terms"] = "forfeit"
    assert _wh(d)["summary"]["people"][2]["manager_share_end"] == 0.0


def test_loan_is_capped_at_borrowers_capital():
    d = _siena()  # Thaxter puts nothing into LTEC
    w = d["warehouse"]
    base = _wh(d)
    w["manager_loans"] = [{"lender": w["people"][0]["name"], "borrower": w["people"][1]["name"], "amount": 70000.0,
                           "rate": 0.08, "rate_type": "simple", "recourse": True}]
    r = _wh(d)
    assert r["manager_loans"][0]["settled"] == "invalid" and r["manager_loans"][0]["amount"] == 0
    for a, b in zip(r["people"], base["people"]):
        assert a["flows"] == pytest.approx(b["flows"])
