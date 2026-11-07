"""Ledger (#21): each person's dated entries add up to their cash flows on every date; loan schedules end where the
loan reports; entries are cash only from known kinds."""
import copy
import sys
from collections import defaultdict
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import apply_variant, list_deals, load_deal, run_all  # noqa: E402

KINDS = {"units_bought", "warehouse_loan", "manager_capital", "loan_advance", "warehouse_loan_repaid", "unit_sale",
         "unit_purchase", "manager_cash", "distribution", "distribution_bought_units", "loan_repayment",
         "loan_settlement", "buyin_sale", "buyin_purchase"}


def setups():
    for slug in list_deals():
        d = load_deal(slug)
        yield slug, "defaults", d
        for a in d["meta"].get("alternatives", []):
            yield slug, a["name"], apply_variant(d, a)


def check_ledger(r):
    for p in r["people"]:
        by_date = defaultdict(float)
        for d, f in zip(r["dates"], p["flows"]):
            by_date[d] += f
        led = defaultdict(float)
        for e in p["ledger"]:
            assert e["kind"] in KINDS, e
            led[e["date"]] += e["amount"]
        for d in set(by_date) | set(led):
            assert led[d] == pytest.approx(by_date[d], abs=1e-6), (p["name"], d, led[d], by_date[d])
        assert [e["date"] for e in p["ledger"]] == sorted(e["date"] for e in p["ledger"])
    for ln, sch in zip(r["manager_loans"], r["loan_schedules"]):
        if ln["settled"] == "invalid":
            assert sch == []
            continue
        assert sch[0]["kind"] == "advance" and sch[0]["balance"] == pytest.approx(ln["amount"])
        paid = sum(x["paid"] for x in sch)
        assert paid == pytest.approx(ln["repaid"] + (ln["owed_end"] if ln["settled"] in ("paid_at_end", "paid_at_maturity", "paid_on_leaving") else 0), abs=1e-6)
        assert sum(x["interest"] for x in sch) == pytest.approx(ln["interest"], abs=1e-6)
        assert sch[-1]["balance"] == pytest.approx(0 if ln["settled"] != "forgiven" else ln["owed_end"], abs=1e-6)


@pytest.mark.parametrize("slug,name,inp", list(setups()), ids=lambda x: x if isinstance(x, str) else "")
def test_ledger_adds_up(slug, name, inp):
    for k, r in run_all(inp)["warehouse"].items():
        check_ledger(r)


def test_ledger_with_loans_buyins_and_sales():
    """A busy set-up: warehouse sales, a buy-in, two partner loans (one recourse that can't be repaid from the
    manager's cash), the capital-first waterfall, and a departure."""
    d = load_deal("siena-villas")
    w = d["warehouse"]
    w["manager_waterfall"]["enabled"] = True
    w["people"][1]["manager_capital"] = 175000.0
    w["manager_loans"] = [{"lender": "levi", "borrower": "thaxter", "amount": 175000.0, "rate": 0.12, "rate_type": "compound", "recourse": True},
                          {"lender": "thaxter", "borrower": "levi", "amount": 10000.0, "rate": 0.05, "rate_type": "simple", "recourse": False}]
    w["manager_transfers"] = [{"date": "2027-06-30", "buyer": "thaxter", "seller": "levi", "interest": "promote", "mode": "share",
                               "share": 0.1, "amount": 0, "price": 5000, "pricing": "fixed", "rate": 0, "credit_distributions": False}]
    r = run_all(d)["warehouse"]
    for k in r:
        check_ledger(r[k])
    kinds = {e["kind"] for p in r["stress"]["people"] for e in p["ledger"]}
    assert {"loan_advance", "loan_repayment", "unit_sale", "manager_cash", "buyin_sale", "buyin_purchase"} <= kinds
