"""engine/core.js must match engine/core.py on every deal's defaults and on each deal's randomized set-ups.

A deal supplies its randomizer in deals/<slug>/tests/randomize.py: randomized(deal, seed) -> deal.
Every randomized set-up must also reconcile to the cent (vehicle cash in = cash out).
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import DEALS_DIR, list_deals, load_deal, run_all  # noqa: E402

SEEDS = 60


def js(inp):
    out = subprocess.run(["node", str(ROOT / "scripts" / "run_engine.js")], input=json.dumps(inp),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def compare(a, b, path="", errs=None):
    errs = [] if errs is None else errs
    if isinstance(a, dict):
        for k in a:
            if k in b:
                compare(a[k], b[k], f"{path}.{k}", errs)
            else:
                errs.append(f"missing in JS: {path}.{k}")
    elif isinstance(a, (list, tuple)):
        if len(a) != len(b):
            errs.append(f"length {path}")
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, f"{path}[{i}]", errs)
    elif isinstance(a, (int, float)) and not isinstance(a, bool):
        if b is None or abs(a - b) > 1e-6 * max(1.0, abs(a)):
            errs.append(f"{path}: py={a} js={b}")
    elif a != b:
        errs.append(f"{path}: py={a!r} js={b!r}")
    return errs


def randomizer(slug):
    f = DEALS_DIR / slug / "tests" / "randomize.py"
    if not f.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"randomize_{slug.replace('-', '_')}", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.randomized


def py(inp):
    return json.loads(json.dumps(run_all(inp), default=str))


@pytest.mark.parametrize("slug", list_deals())
def test_defaults_match(slug):
    inp = load_deal(slug)
    errs = compare(py(inp), js(inp))
    assert not errs, errs[:10]


@pytest.mark.parametrize("slug", list_deals())
def test_randomized_match_and_reconcile(slug):
    rnd = randomizer(slug)
    if rnd is None:
        pytest.skip(f"{slug} has no randomizer yet")
    base = load_deal(slug)
    for seed in range(SEEDS):
        inp = rnd(base, seed)
        res = run_all(inp)
        for k, wcase in res["warehouse"].items():
            assert wcase["summary"]["check"] < 0.05, (slug, seed, k, wcase["summary"]["check"])
            for p in wcase["people"]:  # the ledger (#21) adds up to each person's flows on every date
                by_date, led = {}, {}
                for d, f in zip(wcase["dates"], p["flows"]):
                    by_date[d] = by_date.get(d, 0.0) + f
                for e in p["ledger"]:
                    led[e["date"]] = led.get(e["date"], 0.0) + e["amount"]
                for d in set(by_date) | set(led):
                    assert abs(led.get(d, 0.0) - by_date.get(d, 0.0)) < 1e-6, (slug, seed, k, p["name"], d)
        errs = compare(json.loads(json.dumps(res, default=str)), js(inp))
        assert not errs, (slug, seed, errs[:10])


if __name__ == "__main__":
    for slug in list_deals():
        test_defaults_match(slug); print("PASS defaults", slug)
        test_randomized_match_and_reconcile(slug); print(f"PASS randomized x{SEEDS} match + reconcile", slug)
