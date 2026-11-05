"""Our own cases ('derived' kind) and per-case deal overrides, on every deal.

- a derived case with neutral settings reproduces its source case exactly (any source kind)
- deal_overrides change only that case
"""
import copy
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import list_deals, load_deal, run_case  # noqa: E402

NEUTRAL = {"kind": "derived", "label": "Neutral", "rent_factor": 1.0, "rent_adjust": [], "rent_path": "source", "rent_growth": 0.0,
           "other_income_factor": 1.0, "other_income_path": "source", "other_income_growth": 0.0, "opex_factor": 1.0,
           "opex_path": "source", "opex_growth": 0.0, "opex_add": 0.0, "opex_add_start_year": 1, "opex_add_growth": 0.0}


def strip(c):
    return {k: v for k, v in c.items() if k not in ("key", "label", "note")}


@pytest.mark.parametrize("slug", list_deals())
def test_neutral_derived_equals_source(slug):
    base = load_deal(slug)
    for src, sc in base["cases"].items():
        if sc["kind"] in ("explicit", "derived"):
            continue  # an explicit case's sale is the deck's figure, not a cap; derived ones chain
        inp = copy.deepcopy(base)
        inp["cases"]["zz"] = dict(NEUTRAL, **{"from": src, "exit_cap": run_case(src, base)["exit"]["exit_cap"]})
        a, b = run_case(src, inp), run_case("zz", inp)
        for x, y in zip(a["operations"]["noi"], b["operations"]["noi"]):
            assert abs(x - y) < 1e-6
        assert abs(a["lp"]["irr"] - b["lp"]["irr"]) < 1e-9, (slug, src)
        assert abs(a["exit"]["net_sale_proceeds"] - b["exit"]["net_sale_proceeds"]) < 1e-4


@pytest.mark.parametrize("slug", list_deals())
def test_deal_overrides_stay_in_their_case(slug):
    inp = copy.deepcopy(load_deal(slug))
    # first case that prices its own sale (an explicit case takes the deck's net sale proceeds as given)
    keys = sorted(inp["cases"], key=lambda k: inp["cases"][k]["kind"] == "explicit")
    before = {k: run_case(k, inp)["lp"]["irr"] for k in keys}
    inp["cases"][keys[0]]["deal_overrides"] = {"selling_cost_pct": 0.10}
    after = {k: run_case(k, inp)["lp"]["irr"] for k in keys}
    assert after[keys[0]] < before[keys[0]]
    for k in keys[1:]:
        if inp["cases"][k].get("from") != keys[0]:
            assert after[k] == before[k], k
