"""Write the page tests' fixtures to tests/web/.fixtures/ from the current deal files (so they never go stale).
    python tests/web/fixtures.py
- scen.json:  The Bend with the side letter on and a 6.0% Downside exit cap (a saved "Aggressive ask")
- siena_variants.json: Python results for each Siena variant (LTEC structures), which the page must match
- test1.json: Siena with the changes of the first live saved scenario, "test 1 _ hold all capital" (Nov 6, 2026),
              including its fees & promote shares totalling 50% (a known input problem the page must flag)
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from engine.core import apply_variant, fill_label, load_deal, run_all  # noqa: E402

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

    # Python results for each Siena variant (LTEC structures, issue #9), for the page to match
    base = load_deal("siena-villas")
    exp = []
    for a in base["meta"].get("alternatives", []):
        inp = apply_variant(base, a)
        wh = run_all(inp)["warehouse"]
        if not (a.get("set") or a.get("structure") or "warehouse" in a.get("changes", {})):
            continue
        exp.append({"name": fill_label(a["name"], base), "cases": {k: [{"name": p["name"], "profit": x["profit"], "from_manager": x["from_manager"]}
                                                      for p, x in zip(v["people"], v["summary"]["people"])] for k, v in wh.items()}})
    (OUT / "siena_variants.json").write_text(json.dumps(exp))


def _merge(b, c):
    """The page's mergeDeep: objects merge, everything else (lists too) replaces."""
    o = copy.deepcopy(b)
    for k, v in c.items():
        o[k] = _merge(o[k], v) if isinstance(v, dict) and isinstance(o.get(k), dict) else copy.deepcopy(v)
    return o


if __name__ == "__main__":
    main()
