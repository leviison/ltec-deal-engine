"""Stable ids (issue #14): names are labels, ids are identity. Renaming a person or the manager must flow through
every variant, label and reference with no change in results; deal files reference people by id; Python and JS agree
on variants, labels and reference checks."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import (apply_variant, fill_label, list_deals, load_deal, load_structures,  # noqa: E402
                         reference_issues, run_all)

LIB = load_structures()


def variants(slug):
    return load_deal(slug)["meta"].get("alternatives", [])


@pytest.mark.parametrize("slug", list_deals())
def test_deal_files_reference_people_by_id(slug):
    d = load_deal(slug)
    assert reference_issues(d, strict=True) == []
    for a in variants(slug):
        assert reference_issues(apply_variant(d, a, LIB), strict=True) == [], a["name"]


@pytest.mark.parametrize("slug", list_deals())
def test_renames_flow_through_variants(slug):
    """Levi -> Bob and LTEC -> Acme Partners in the deal file: every variant shows the new names, keeps every reference
    working and gives the same results as before the rename."""
    d = load_deal(slug)
    r = copy.deepcopy(d)
    r["warehouse"]["people"][0]["name"] = "Bob"
    r["warehouse"]["names"]["manager"] = "Acme Partners"
    for a in variants(slug):
        before, after = apply_variant(d, a, LIB), apply_variant(r, a, LIB)
        w = after["warehouse"]
        assert w["names"]["manager"] == "Acme Partners", a["name"]
        assert "Levi" not in [p["name"] for p in w["people"]], a["name"]
        assert reference_issues(after, strict=True) == [], a["name"]
        assert "Levi" not in fill_label(a["name"], after) and "LTEC " not in fill_label(a["name"], after)
        rb, ra = run_all(before)["warehouse"], run_all(after)["warehouse"]
        for k in rb:
            assert [x["profit"] for x in rb[k]["summary"]["people"]] == [x["profit"] for x in ra[k]["summary"]["people"]]
            assert [l["settled"] for l in rb[k]["manager_loans"]] == [l["settled"] for l in ra[k]["manager_loans"]]


def test_labels_fill_current_names():
    d = load_deal("siena-villas")
    c = next(a for a in variants("siena-villas") if "lends" in a["name"])
    assert fill_label(c["name"], d) == "LTEC C · Levi lends Thaxter his half at 8%"
    d["warehouse"]["people"][0]["name"] = "Bob"
    d["warehouse"]["names"]["manager"] = "Acme"
    assert fill_label(c["name"], d) == "Acme C · Bob lends Thaxter his half at 8%"


def test_reference_issues_catch_dangling_ids():
    d = load_deal("siena-villas")
    d["warehouse"]["manager_loans"] = [{"lender": "levi", "borrower": "nobody", "amount": 1.0, "rate": 0.08,
                                        "rate_type": "simple", "recourse": True}]
    d["warehouse"]["people"].append(dict(d["warehouse"]["people"][1]))
    issues = reference_issues(d)
    assert any("borrower 'nobody'" in i for i in issues) and any("duplicate ids: thaxter" in i for i in issues)


JS = """const E = require(process.argv[1]); let b = ""; process.stdin.on("data", (d) => (b += d));
process.stdin.on("end", () => { const { inp, alts, lib } = JSON.parse(b);
  process.stdout.write(JSON.stringify(alts.map((a) => { const v = E.applyVariant(inp, a, lib);
    return { inp: v, name: E.fillLabel(a.name, v), note: E.fillLabel(a.note, v), issues: E.referenceIssues(v, true) }; }))); });"""


@pytest.mark.parametrize("slug", list_deals())
def test_python_and_js_agree_on_variants(slug):
    d = load_deal(slug)
    d["warehouse"]["people"][0]["name"] = "Bob"
    alts = variants(slug)
    r = subprocess.run(["node", "-e", JS, str(ROOT / "engine" / "core.js")], input=json.dumps({"inp": d, "alts": alts, "lib": LIB}),
                       capture_output=True, text=True, check=True)
    for a, js in zip(alts, json.loads(r.stdout)):
        py = apply_variant(d, a, LIB)
        assert json.loads(json.dumps(py)) == js["inp"], a["name"]
        assert fill_label(a["name"], py) == js["name"] and fill_label(a.get("note", ""), py) == js["note"]
        assert reference_issues(py, True) == js["issues"]
