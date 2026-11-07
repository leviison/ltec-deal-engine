"""Partner-loan terms (issue #24): how and when a loan between LTEC's partners is repaid.

Set-up: Siena, Levi lends Thaxter his $175,000 half of LTEC's capital at 8% simple. Thaxter's LTEC cash before the
loan on each date is read from his ledger ("manager_cash" entries); the expected schedule is then worked out by hand
here, rule by rule, and compared with the engine's.
"""
import copy
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import apply_loan_preset, apply_variant, load_deal, run_all  # noqa: E402

LIB = json.loads((ROOT / "engine" / "loan_terms.json").read_text())
LOAN = {"lender": "levi", "borrower": "thaxter", "amount": 175000.0, "rate": 0.08, "rate_type": "simple", "recourse": True}
CASES = ["base", "stress"]


def run(**terms):
    d = load_deal("siena-villas")
    w = d["warehouse"]
    w["people"][0]["manager_capital"] = w["people"][1]["manager_capital"] = 175000.0
    w["manager_loans"] = [dict(LOAN, **terms)]
    return d, run_all(d)["warehouse"]


def cash_dates(r):
    """Thaxter's LTEC cash before the loan on each of LTEC's cash dates (sales and distributions; the dates are
    taken from the loan's schedule, the amounts from Thaxter's ledger)."""
    by = defaultdict(float)
    for e in r["people"][1]["ledger"]:
        if e["kind"] == "manager_cash":
            by[e["date"]] += e["amount"]
    ds = sorted({x["date"] for x in r["loan_schedules"][0] if x["kind"] == "period"} | set(by))
    return [(d, by[d]) for d in ds]


def years(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days / 365


def hand(r, close, rule, *, maturity=None, recourse=True):
    """Walk the dates by hand: simple interest on principal; payments go to interest first. Returns the payments,
    what's left, and the date and way it was settled."""
    prin, acc, prev, pays = 175000.0, 0.0, close, []
    dates = cash_dates(r)
    for n, (d, cash) in enumerate(dates):
        acc += prin * 0.08 * years(prev, d)
        prev = d
        due_now = maturity and d >= maturity
        pay = min(prin + acc, cash) if due_now else rule(d, cash, prin, acc, n == len(dates) - 1)
        pays.append(pay)
        ti = min(pay, acc)
        acc -= ti
        prin -= pay - ti
        if due_now:
            return pays, prin + acc, d, "paid_at_maturity" if recourse else "forgiven"
    return pays, prin + acc, dates[-1][0], "paid_at_end" if recourse else "forgiven"


def engine_pays(r):
    return [x["paid"] for x in r["loan_schedules"][0] if x["kind"] == "period"]


@pytest.mark.parametrize("k", CASES)
def test_default_is_the_original_sweep(k):
    """No terms, the cash-sweep preset and explicit defaults give the same results."""
    _, a = run()
    _, b = run(**{x: v for x, v in apply_loan_preset(LOAN, "cash_sweep", LIB).items() if x not in LOAN})
    assert json.dumps(a[k]["people"], default=str) == json.dumps(b[k]["people"], default=str)
    pays, left, _, _ = hand(a[k], a[k]["dates"][0], lambda d, c, p, i, last: min(c, p + i))
    assert engine_pays(a[k]) == pytest.approx(pays, abs=1e-6)


@pytest.mark.parametrize("k", CASES)
def test_half_sweep(k):
    _, r = run(repayment="sweep", sweep_pct=0.5)
    pays, left, _, how = hand(r[k], r[k]["dates"][0], lambda d, c, p, i, last: min(0.5 * c, p + i))
    assert engine_pays(r[k]) == pytest.approx(pays, abs=1e-6)
    ln = r[k]["manager_loans"][0]
    assert ln["owed_end"] == pytest.approx(left, abs=1e-6) and ln["settled"] == (how if left > 1e-9 else "repaid")


@pytest.mark.parametrize("k", CASES)
def test_interest_only_balloon(k):
    _, r = run(repayment="interest_only", source="manager_cash")
    pays, left, _, _ = hand(r[k], r[k]["dates"][0], lambda d, c, p, i, last: min(i, c))
    assert engine_pays(r[k]) == pytest.approx(pays, abs=1e-6)
    ln = r[k]["manager_loans"][0]
    # the principal is never touched before the end; whatever interest was short is still owed too
    assert ln["owed_end"] == pytest.approx(left) and left >= 175000.0 - 1e-6 and ln["settled"] == "paid_at_end"


@pytest.mark.parametrize("k", CASES)
def test_interest_paid_current_by_the_borrower(k):
    """source = borrower: exactly the interest on every date, whatever LTEC paid; the balloon is the $175,000."""
    _, r = run(repayment="interest_only", source="borrower")
    sch = [x for x in r[k]["loan_schedules"][0] if x["kind"] == "period"]
    assert all(x["paid"] == pytest.approx(x["interest"]) for x in sch)
    assert r[k]["manager_loans"][0]["owed_end"] == pytest.approx(175000.0)


@pytest.mark.parametrize("k", CASES)
def test_equal_principal(k):
    close = None
    _, r = run(repayment="equal_principal", term_years=4, source="borrower")
    close = r[k]["dates"][0]

    def rule(d, c, p, i, last):
        left = 175000.0 * max(0.0, 1 - years(close, d) / 4)
        return i + max(0.0, p - left)
    pays, left, _, _ = hand(r[k], close, rule)
    assert engine_pays(r[k]) == pytest.approx(pays, abs=1e-6)
    # paid off on the first cash date at least 4 years after close
    sch = r[k]["loan_schedules"][0]
    first_4y = next(x for x in sch if x["kind"] == "period" and years(close, x["date"]) >= 4)
    assert first_4y["balance"] == pytest.approx(0.0, abs=1e-6) and r[k]["manager_loans"][0]["settled"] == "repaid"


@pytest.mark.parametrize("k", CASES)
def test_accrue_to_exit(k):
    _, r = run(repayment="at_exit")
    pays, left, _, _ = hand(r[k], r[k]["dates"][0], lambda d, c, p, i, last: min(c, p + i) if last else 0.0)
    assert engine_pays(r[k]) == pytest.approx(pays, abs=1e-6)
    assert all(p == 0 for p in engine_pays(r[k])[:-1])


@pytest.mark.parametrize("k", CASES)
@pytest.mark.parametrize("recourse", [True, False])
def test_maturity(k, recourse):
    """Due on the first cash date on or after the maturity: paid from that date's cash, the rest paid or forgiven."""
    _, r = run(repayment="interest_only", maturity="2029-06-30", recourse=recourse)
    pays, left, d, how = hand(r[k], r[k]["dates"][0], lambda d, c, p, i, last: min(i, c), maturity="2029-06-30",
                              recourse=recourse)
    assert engine_pays(r[k]) == pytest.approx(pays, abs=1e-6)
    ln = r[k]["manager_loans"][0]
    assert ln["due_date"] == d and d >= "2029-06-30" and ln["settled"] == how
    assert ln["owed_end"] == pytest.approx(left, abs=1e-6)
    # nothing more happens after maturity
    assert r[k]["loan_schedules"][0][-1]["date"] == d


@pytest.mark.parametrize("k", CASES)
def test_forgivable(k):
    """Variant G: nothing repaid; forgiven at maturity. Levi is out the $175,000 and Thaxter keeps all his cash."""
    d = load_deal("siena-villas")
    g = next(a for a in d["meta"]["alternatives"] if a["name"].startswith("{manager} G"))
    r = run_all(apply_variant(d, g))["warehouse"][k]
    ln = r["manager_loans"][0]
    assert ln["repaid"] == 0 and ln["settled"] == "forgiven" and ln["due_date"] >= "2029-11-05"
    th = r["people"][1]
    assert not [e for e in th["ledger"] if e["kind"] in ("loan_repayment", "loan_settlement")]
    # same as Levi simply paying Thaxter's half: Thaxter's profit is his LTEC cash; he put in nothing himself
    assert th["flows"][0] == pytest.approx(-175000.0 + 175000.0, abs=1e-6)


@pytest.mark.parametrize("k", CASES)
def test_due_when_borrower_leaves(k):
    d, _ = run()
    w = d["warehouse"]
    w["manager_loans"][0].update(repayment="interest_only", on_leave="due")
    w["manager_vesting"] = [{"person": "thaxter", "years": 4, "cliff_years": 1, "leaves": "2028-07-01", "terms": "keep_vested"}]
    r = run_all(d)["warehouse"][k]
    ln = r["manager_loans"][0]
    assert ln["settled"] in ("paid_on_leaving", "repaid") and ln["due_date"] >= "2028-07-01"
    assert ln["due_date"] == min(x for x, _ in cash_dates(r) if x >= "2028-07-01")
    # forgiven on leaving instead
    w["manager_loans"][0]["on_leave"] = "forgiven"
    ln2 = run_all(d)["warehouse"][k]["manager_loans"][0]
    assert ln2["settled"] == "forgiven" and ln2["due_date"] == ln["due_date"]


def test_presets_are_valid_parts():
    parts = LIB["parts"]
    for key, p in LIB["presets"].items():
        t = p["terms"]
        assert t["repayment"] in parts["repayment"]["options"], key
        assert t.get("source", "manager_cash") in parts["source"]["options"], key
        assert t.get("on_leave", "continues") in parts["on_leave"]["options"], key
        ln = apply_loan_preset(LOAN, key, LIB)
        assert ln["preset"] == key and ln["amount"] == LOAN["amount"] and ln["rate"] == LOAN["rate"]
