"""Structure templates (engine/structures.json, issue #12): Python and JS build the same vehicle, the vehicle's cash
reconciles under every template on every deal, and each template has the shape it promises."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import apply_structure, list_deals, load_deal, load_structures, run_all  # noqa: E402

LIB = load_structures()
KEYS = list(LIB["templates"])

JS = """const E = require(process.argv[1]); let b = ""; process.stdin.on("data", (d) => (b += d));
process.stdin.on("end", () => { const { inp, key, lib } = JSON.parse(b); process.stdout.write(JSON.stringify(E.applyStructure(inp, key, lib))); });"""


def js_apply(inp, key):
    r = subprocess.run(["node", "-e", JS, str(ROOT / "engine" / "core.js")], input=json.dumps({"inp": inp, "key": key, "lib": LIB}),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


@pytest.mark.parametrize("slug", list_deals())
@pytest.mark.parametrize("key", KEYS)
def test_python_and_js_build_the_same_vehicle(slug, key):
    inp = load_deal(slug)
    a, b = apply_structure(inp, key, LIB), js_apply(inp, key)
    assert json.loads(json.dumps(a["warehouse"])) == b["warehouse"]  # 1000.0 == 1000; computed floats must match exactly
    assert {k: v for k, v in a.items() if k != "warehouse"} == {k: v for k, v in b.items() if k != "warehouse"}


@pytest.mark.parametrize("slug", list_deals())
@pytest.mark.parametrize("key", KEYS)
def test_every_template_reconciles(slug, key):
    inp = apply_structure(load_deal(slug), key, LIB)
    w = inp["warehouse"]
    assert abs(inp["investor"]["check"] + w["reserve"] - w["manager_commitment"] - sum(p["amount"] for p in w["people"])) < 0.01
    assert abs(sum(p["manager_share"] for p in w["people"]) - 1) < 1e-9
    for k, r in run_all(inp)["warehouse"].items():
        assert abs(r["summary"]["check"]) < 0.05, (slug, key, k)


def test_template_shapes():
    inp = load_deal("siena-villas")
    d = apply_structure(inp, "direct", LIB)["warehouse"]
    assert d["manager_commitment"] == inp["investor"]["check"] and d["promote"] == 0 and not d["selldown"]["tranches"]
    s = apply_structure(inp, "spv", LIB)["warehouse"]
    assert any(p["name"] == s["names"]["buyers"] and p["amount"] > 0 for p in s["people"]) and not s["selldown"]["tranches"]
    wh = apply_structure(inp, "spv_warehouse", LIB)["warehouse"]
    assert wh["people"][0]["role"] == "warehouse" and wh["selldown"]["tranches"][0]["share"] == 1.0
    # LTEC's partners carry over (Siena: Levi and Thaxter, 50/50), and so do LTEC's own terms
    assert [p["name"] for p in d["people"]] == ["Levi", "Thaxter"]
    assert d["manager_waterfall"] == inp["warehouse"]["manager_waterfall"]


def test_direct_partners_split_ltec_by_capital():
    """Direct: every dollar the deal pays our check reaches LTEC's partners, split by their LTEC capital."""
    inp = apply_structure(load_deal("the-bend"), "direct", LIB)
    res = run_all(inp)
    for k, r in res["warehouse"].items():
        got = sum(p["from_manager"] for p in r["summary"]["people"])
        assert got == pytest.approx(sum(res["cases"][k]["investor"]["payments"]), abs=0.05)
