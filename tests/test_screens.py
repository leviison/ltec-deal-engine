"""Quick checks (issue #37): standard first-pass tests computed from each case's own numbers.

- Hand calculations for Siena and The Bend, year 1 and the deal-level metrics, from the deal files.
- Every deal, case and variant: each check has a status, every number is finite (new deals are covered
  automatically, since this walks deals/).
- Edge set-ups: an all-cash deal (no loan) reads "n/a", not red; a deal file's own threshold overrides the house's.
- Both engines agree (defaults, variants and randomized set-ups).
"""
import copy
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import (DEALS_DIR, all_quick_checks, apply_variant, list_deals, load_deal, load_screens,  # noqa: E402
                         run_all)

HOUSE = load_screens()


def js_checks(inp):
    out = subprocess.run(["node", str(ROOT / "scripts" / "run_checks.js")], input=json.dumps({"inp": inp, "house": HOUSE}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def by_id(q):
    return {c["id"]: c for c in q["checks"]}


def setups():
    for slug in list_deals():
        d = load_deal(slug)
        yield slug, "defaults", d
        for a in d["meta"].get("alternatives", []):
            yield slug, a["name"], apply_variant(d, a)


def test_hand_calculation_siena():
    d = load_deal("siena-villas")
    c = d["cases"]["sponsor"]
    q = all_quick_checks(d)["sponsor"]
    y1, deal = q["years"][0], q["deal"]
    price, units, loan, ds = 19_100_000, 81, 9_769_000, 467_935
    noi = c["rents"][0] + c["other_income"][0] - c["opex"][0]
    assert y1["noi"] == pytest.approx(noi)
    assert y1["dscr"] == pytest.approx(noi / ds)
    assert y1["debt_yield"] == pytest.approx(noi / loan)
    assert y1["breakeven_rent_debt"] == pytest.approx(ds / units / 12)          # Thaxter's number: ~$481
    assert round(y1["breakeven_rent_debt"]) == 481
    costs = c["opex"][0] + ds + 40_500 + 0.01 * (c["rents"][0] + c["other_income"][0])
    assert y1["cost_per_unit_month"] == pytest.approx(costs / units / 12)
    assert y1["rent_needed"] == pytest.approx((costs - c["other_income"][0]) / c["rents"][0])
    assert deal["price_per_unit"] == pytest.approx(price / units)
    assert deal["going_in_cap"] == pytest.approx(noi / price)
    assert deal["ltv"] == pytest.approx(loan / price)
    assert by_id(q)["ltv"]["status"] == "green" and by_id(q)["dscr"]["status"] == "green"


def test_hand_calculation_bend_counts_the_tif_as_cash():
    d = load_deal("the-bend")
    q = all_quick_checks(d)["sponsor"]
    y1 = q["years"][0]
    o = run_all(d)["cases"]["sponsor"]["operations"]
    costs = o["opex"][0] + o["debt_service"][0] + o["capex"][0] + o["asset_mgmt_fee"][0]
    assert y1["rent_needed"] == pytest.approx((costs - o["other_income"][0] - o["below_noi_income"][0]) / o["rents"][0])
    assert y1["dscr"] == pytest.approx(o["noi"][0] / o["debt_service"][0])        # NOI only, as lenders measure it
    assert by_id(q)["ltv"]["status"] == "amber"                                   # 75% LTV


@pytest.mark.parametrize("slug,name,inp", list(setups()), ids=lambda x: x if isinstance(x, str) else "")
def test_every_deal_case_and_variant(slug, name, inp):
    for k, q in all_quick_checks(inp).items():
        assert [c["id"] for c in q["checks"]] == [c["id"] for c in HOUSE["checks"]]
        for c in q["checks"]:
            assert c["status"] in ("green", "amber", "red", "n/a"), (slug, name, k, c)
            assert c["value"] is None or math.isfinite(c["value"]), (slug, name, k, c)
        for y in q["years"]:
            for key, v in y.items():
                assert v is None or math.isfinite(v), (slug, name, k, key)


def test_worst_year_is_reported():
    q = all_quick_checks(load_deal("siena-villas"))["stress"]
    dscr = by_id(q)["dscr"]
    assert dscr["value"] == pytest.approx(min(y["dscr"] for y in q["years"]))
    assert q["years"][dscr["year"] - 1]["dscr"] == pytest.approx(dscr["value"])


def test_all_cash_deal_reads_na_not_red():
    d = load_deal("siena-villas")
    d["deal"]["loan_amount"] = 0
    d["deal"]["annual_debt_service"] = 0
    q = by_id(all_quick_checks(d)["base"])
    assert q["dscr"]["status"] == "n/a" and q["debt_yield"]["status"] == "n/a"
    assert q["ltv"]["value"] == 0 and q["ltv"]["status"] == "green"


def test_deal_file_overrides_a_threshold():
    d = load_deal("the-bend")
    assert by_id(all_quick_checks(d)["base"])["dscr"]["status"] == "amber"       # 1.23x vs the house 1.25x
    d["screens"] = {"dscr": {"green": 1.20, "amber": 1.10, "source": "Loan agreement §6.1 (example)"}}
    c = by_id(all_quick_checks(d)["base"])["dscr"]
    assert c["status"] == "green" and c["green"] == 1.20 and c["source"].startswith("Loan agreement")


def test_house_rules_are_well_formed():
    for c in HOUSE["checks"]:
        assert c["better"] in ("higher", "lower", "range") and c["over"] in ("worst", "first", "deal"), c
        if c["better"] == "range":
            assert c["amber"][0] <= c["green"][0] <= c["green"][1] <= c["amber"][1], c
        elif c["better"] == "higher":
            assert c["green"] >= c["amber"], c
        else:
            assert c["green"] <= c["amber"], c
        assert c["why"], c


def _close(a, b):
    if isinstance(a, dict):
        return all(_close(a[k], b.get(k)) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    if isinstance(a, float) and not isinstance(a, bool):
        return b is not None and abs(a - b) <= 1e-6 * max(1.0, abs(a))
    return a == b


@pytest.mark.parametrize("slug,name,inp", list(setups()), ids=lambda x: x if isinstance(x, str) else "")
def test_engines_agree(slug, name, inp):
    py = json.loads(json.dumps(all_quick_checks(inp)))
    assert _close(py, js_checks(inp)), (slug, name)


def _randomizer(slug):
    f = DEALS_DIR / slug / "tests" / "randomize.py"
    if not f.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"rnd_screens_{slug.replace('-', '_')}", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.randomized


@pytest.mark.parametrize("slug", list_deals())
def test_engines_agree_randomized(slug):
    rnd = _randomizer(slug)
    if rnd is None:
        pytest.skip("no randomizer")
    base = load_deal(slug)
    for seed in range(15):
        inp = rnd(copy.deepcopy(base), seed)
        assert _close(json.loads(json.dumps(all_quick_checks(inp))), js_checks(inp)), (slug, seed)
