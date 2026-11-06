"""Write the page tests' fixtures to tests/web/.fixtures/ from the current deal files (so they never go stale).
    python tests/web/fixtures.py
- scen.json:  The Bend with the side letter on and a 6.0% Downside exit cap (a saved "Aggressive ask")
- test1.json: Siena with the changes of the first live saved scenario, "test 1 _ hold all capital" (Nov 6, 2026),
              including its fees & promote shares totalling 50% (a known input problem the page must flag)
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from engine.core import load_deal  # noqa: E402

OUT = Path(__file__).parent / ".fixtures"


def main():
    OUT.mkdir(exist_ok=True)
    d = load_deal("the-bend")
    d["investor"]["side_letter"]["enabled"] = True
    d["cases"]["downside"]["exit_cap"] = 0.06
    (OUT / "scen.json").write_text(json.dumps({"inputs": json.dumps(d)}))

    t = copy.deepcopy(load_deal("siena-villas"))
    t["timing"].update(mode="schedule", sale_date="2031-10-30")
    t["waterfall"]["pref_compounds"] = True
    t["cases"]["custom"].update(exit_method="sale_price", sale_price=22000000)
    t["warehouse"]["close_date"] = "2026-11-05"
    t["warehouse"]["people"] = [
        {"name": "Levi", "amount": 700000, "role": "warehouse", "manager_capital": 350000, "manager_share": 0.5, "loan_rate": 0.08},
        {"name": "Thaxter", "amount": 0, "role": "member", "manager_capital": 0, "manager_share": 0, "loan_rate": 0.08}]
    t["warehouse"]["selldown"]["tranches"] = [
        {"date": "2027-03-31", "share": 0.25, "pricing": "carry_simple", "rate": 0.06, "buyer": "bob"},
        {"date": "2027-09-30", "share": 0.25, "pricing": "carry_simple", "rate": 0.06, "buyer": "Tom"},
        {"date": "2028-07-27", "share": 0.5, "pricing": "carry_simple", "rate": 0.06, "buyer": "Harry"}]
    t["warehouse"]["manager_transfers"] = [{"date": "2027-01-31", "buyer": "Thaxter", "seller": "Levi", "interest": "both", "mode": "share",
                                            "share": 0.5, "amount": 175000, "price": 0, "pricing": "premium", "rate": 0.1,
                                            "credit_distributions": False}]
    (OUT / "test1.json").write_text(json.dumps({"inputs": json.dumps(t)}))


if __name__ == "__main__":
    main()
