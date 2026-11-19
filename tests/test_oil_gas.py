"""Oil & gas module (#46): engine/oil_gas.py = engine/oil_gas.js, its deal files, the sponsor tie-out, hand checks,
and the module switch (engine/modules.json).

- every oil & gas deal file validates against engine/schema/oil_gas.schema.json, every input has a source, every
  source points at an input, listed documents exist
- the sponsor's conversion table is rebuilt to the printed dollar (deals/<slug>/reference/sponsor_table_printed.json)
- JS matches Python on each deal's defaults and on its randomized set-ups (deals/<slug>/tests/randomize.py)
- hand checks: one month of cash by hand; payments add up to net cash; tax rows add up to the after-tax difference
- modules: real-estate callers never see oil & gas deals; a module switched off hides its deals and the dashboard
  build only takes modules marked for it
"""
import json
import math
import sys
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import core, oil_gas  # noqa: E402
from engine.core import DEALS_DIR, list_deals, load_deal  # noqa: E402
from tests.test_deal_files import leaves, resolves, unsourced  # noqa: E402
from tests.test_parity import compare, js, randomizer  # noqa: E402

SCHEMA = json.loads((ROOT / "engine" / "schema" / "oil_gas.schema.json").read_text())
DEALS = list_deals("oil_gas")
SEEDS = 60


def py(inp):
    return json.loads(json.dumps(oil_gas.run_all(inp), default=str))


@pytest.mark.parametrize("slug", DEALS)
def test_deal_file(slug):
    d = load_deal(slug)
    jsonschema.validate(d, SCHEMA)
    assert d["meta"]["slug"] == slug
    for doc in d["meta"].get("documents", []):
        if "path" in doc:
            assert (DEALS_DIR / slug / doc["path"]).exists(), doc["path"]
    for k in d["sources"]:
        assert resolves(d, k), f"source for a missing input: {k}"
    assert not unsourced(d), unsourced(d)
    for k, c in d["cases"].items():  # a derived case's chain ends at a full case
        seen = {k}
        while c.get("from"):
            assert c["from"] in d["cases"] and c["from"] not in seen, (k, c["from"])
            seen.add(c["from"])
            c = d["cases"][c["from"]]


@pytest.mark.parametrize("slug", [s for s in DEALS if (DEALS_DIR / s / "reference" / "sponsor_table_printed.json").exists()])
def test_sponsor_table_tieout(slug):
    want = json.loads((DEALS_DIR / slug / "reference" / "sponsor_table_printed.json").read_text())
    got = oil_gas.sponsor_table(load_deal(slug))
    assert abs(got["tax_saving"] - want["tax_saving"]) < 0.01
    assert abs(got["risk_capital"] - want["risk_capital"]) < 0.01
    for part, pct_keys in (("monthly", ("cash_on_cash", "with_tax")), ("totals", ("roi", "with_tax"))):
        assert len(got[part]) == len(want[part])
        for g, w in zip(got[part], want[part]):
            for a, b in zip(g["by_ticket"], w["by_ticket"]):
                assert abs(a - b) <= 1.0, (part, w, g["by_ticket"])
            for k in pct_keys:
                assert round(g[k] * 100) == w[k], (part, k, g[k], w[k])


@pytest.mark.parametrize("slug", DEALS)
def test_defaults_match_js(slug):
    inp = load_deal(slug)
    errs = compare(py(inp), js(inp))
    assert not errs, errs[:10]


@pytest.mark.parametrize("slug", DEALS)
def test_randomized_match_js(slug):
    rnd = randomizer(slug)
    if rnd is None:
        pytest.skip(f"{slug} has no randomizer yet")
    base = load_deal(slug)
    for seed in range(SEEDS):
        inp = rnd(base, seed)
        res = py(inp)
        for k, c in res["cases"].items():
            reconcile(inp, c, (slug, seed, k))
        errs = compare(res, js(inp))
        assert not errs, (slug, seed, errs[:10])


def reconcile(inp, c, tag):
    """Cash in = cash out: payments are the check, assessments and every month's net; the after-tax flows add the
    tax rows' cash and nothing else."""
    i, a = c["investor"], c["after_tax"]
    assert abs(sum(i["payments"]) - (sum(c["production"]["net"]) - i["paid_in"])) < 1e-6 * max(1, i["paid_in"]), tag
    assert abs(sum(a["payments"]) - sum(i["payments"]) - sum(t["tax_cash"] for t in a["years"])) < 1e-6 * max(1, i["paid_in"]), tag
    for t in a["years"]:
        assert abs(t["taxable"] - (t["net_income"] - t["deduction"] - t["depletion"])) < 1e-6, tag
        assert abs(t["tax_cash"] + t["taxable"] * inp["investor"]["tax_rate"]) < 1e-6, tag


def test_hand_check_one_month():
    """Our Base, December 2026, by hand from the deal file: realized price, revenue at the NRI, production taxes,
    gathering, LOE at the WI, the management fee share."""
    inp = load_deal("lapetco-oxy-2")
    c = oil_gas.run_case("base", inp)
    j = c["production"]["months"].index("2026-12")
    boe = c["production"]["boe"][j]
    s = 250000 / 4.5e6
    wi, nri = 0.07982427 * 0.99 * s, 0.0598682 * 0.99 * s
    price = 0.8 * (88 - 6) + 0.2 * 18
    rev = boe * nri * price
    net = rev - rev * 0.12 - boe * nri * 2.0 - (boe * 8 + 5 * 10000) * wi - 1000 * s
    assert abs(c["production"]["revenue"][j] - rev) < 1e-6
    assert abs(c["production"]["net"][j] - net) < 1e-6
    assert abs(wi - 0.01756134 / 4) < 1e-9 and abs(nri - 0.013171 / 4) < 1e-7  # the CIM's per-unit interests
    # December production is paid Jan 20, 2027 (one-month lag); Aug-Nov production on the back-pay date
    i = c["investor"]
    assert "2027-01-20" in i["payment_dates"]
    back = sum(c["production"]["net"][k] for k, m in enumerate(c["production"]["months"]) if m <= "2026-11")
    assert abs(i["back_production"] - back) < 1e-6


def test_hand_check_decline():
    """well_shape: hyperbolic until its decline falls to dmin, exponential after, continuous at the switch."""
    b, di, dmin = 1.0, 1.6, 0.06
    ts = (di / dmin - 1) / (b * di)
    assert abs(oil_gas.well_shape(1.0, b, di, dmin) - 1 / 2.6) < 1e-12
    left = oil_gas.well_shape(ts, b, di, dmin)
    assert abs(oil_gas.well_shape(ts + 1e-9, b, di, dmin) - left) < 1e-9
    assert abs(oil_gas.well_shape(ts + 1, b, di, dmin) / left - math.exp(-dmin)) < 1e-12
    assert abs(oil_gas.well_shape(2.0, 0.0, 0.5, 0.06) - math.exp(-1.0)) < 1e-12


def test_sponsor_case_tax_story():
    """The sponsor case deducts 85% in the funding year and 15% the next; the deduction is offset by the back
    production taxed in the same year, so the first-year saving is less than the pitched $85k per $250k."""
    c = oil_gas.run_case("sponsor", load_deal("lapetco-oxy-2"))
    y = {t["year"]: t for t in c["after_tax"]["years"]}
    assert abs(y[2026]["deduction"] - 212500) < 1e-6 and abs(y[2027]["depletion"] - 37500) < 1e-6
    assert 0 < y[2026]["tax_cash"] < 85000


def test_investor_shape_matches_real_estate():
    """Shared layers (compare, Ask, the vehicle) read these investor fields from any module."""
    re_inv = core.run_all(load_deal(list_deals()[0]))["cases"]["sponsor"]["investor"]
    og_inv = oil_gas.run_case("sponsor", load_deal("lapetco-oxy-2"))["investor"]
    for k in ("payment_dates", "payments", "total", "profit", "irr", "multiple"):
        assert k in re_inv and k in og_inv, k


def test_modules_switch(monkeypatch):
    mods = core.load_modules()
    assert set(mods["modules"]) >= {"real_estate", "oil_gas"}
    assert "lapetco-oxy-2" not in list_deals()                    # real-estate callers (every RE test, the dashboard)
    assert "lapetco-oxy-2" in list_deals("oil_gas")
    assert set(list_deals(None)) == set(list_deals()) | set(list_deals("oil_gas"))
    off = json.loads(json.dumps(mods))
    off["modules"]["oil_gas"]["enabled"] = False
    monkeypatch.setattr(core, "load_modules", lambda: off)
    assert list_deals("oil_gas") == [] and "lapetco-oxy-2" not in list_deals(None)
    assert "lapetco-oxy-2" in list_deals("oil_gas", include_disabled=True)
    from scripts import build_web
    monkeypatch.setattr(build_web, "load_modules", lambda: off)
    assert "lapetco-oxy-2" not in build_web.dashboard_deals()
    on = json.loads(json.dumps(mods))
    on["modules"]["oil_gas"]["dashboard"] = True
    monkeypatch.setattr(core, "load_modules", lambda: on)
    monkeypatch.setattr(build_web, "load_modules", lambda: on)
    assert "lapetco-oxy-2" in build_web.dashboard_deals()


def test_every_deal_has_a_known_module():
    mods = core.load_modules()
    for p in DEALS_DIR.glob("*/deal.json"):
        assert core.deal_asset_class(json.loads(p.read_text()), mods) in mods["modules"], p
