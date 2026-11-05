"""Every deal file is valid, self-consistent and sourced.

- validates against engine/schema/deal.schema.json
- meta.slug matches the folder; listed document paths exist
- every key in `sources` points at a real input
- prints the inputs with no source and sources marked TODO (a report, not a failure: intake works that list down)
"""
import json
import sys
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import DEALS_DIR, list_deals, load_deal  # noqa: E402

SCHEMA = json.loads((ROOT / "engine" / "schema" / "deal.schema.json").read_text())
NOT_INPUTS = {"schema_version", "meta", "sources", "version", "as_of"}


def leaves(x, path=""):
    """Dotted paths of every input value (lists of numbers count as one input; lists of objects by index)."""
    if isinstance(x, dict):
        for k, v in x.items():
            if not k.startswith("_"):
                yield from leaves(v, f"{path}.{k}" if path else k)
    elif isinstance(x, list) and x and all(isinstance(v, dict) for v in x):
        for i, v in enumerate(x):
            yield from leaves(v, f"{path}.{i}")
    else:
        yield path


def resolves(deal, dotted):
    x = deal
    for part in dotted.split("."):
        if isinstance(x, dict) and part in x:
            x = x[part]
        elif isinstance(x, list) and part.isdigit() and int(part) < len(x):
            x = x[int(part)]
        else:
            return False
    return True


def unsourced(deal):
    src = deal["sources"]
    inputs = {k: v for k, v in deal.items() if k not in NOT_INPUTS}
    out = []
    for p in leaves(inputs):
        parts = p.split(".")
        if not any(".".join(parts[:n]) in src for n in range(1, len(parts) + 1)):
            out.append(p)
    return out


@pytest.mark.parametrize("slug", list_deals())
def test_schema(slug):
    jsonschema.validate(load_deal(slug), SCHEMA, format_checker=jsonschema.FormatChecker())


@pytest.mark.parametrize("slug", list_deals())
def test_meta_and_documents(slug):
    d = load_deal(slug)
    assert d["meta"]["slug"] == slug
    for doc in d["meta"].get("documents", []):
        if "path" in doc:
            assert (DEALS_DIR / slug / doc["path"]).exists(), doc["path"]


@pytest.mark.parametrize("slug", list_deals())
def test_sources_point_at_inputs(slug):
    d = load_deal(slug)
    bad = [k for k in d["sources"] if k.split(".")[0] in NOT_INPUTS or not resolves(d, k)]
    assert not bad, bad


def change_paths(x, path=""):
    if isinstance(x, dict) and x:
        for k, v in x.items():
            yield from change_paths(v, f"{path}.{k}" if path else k)
    else:
        yield path


@pytest.mark.parametrize("slug", list_deals())
def test_alternatives_point_at_inputs(slug):
    d = load_deal(slug)
    for alt in d["meta"].get("alternatives", []):
        bad = [p for p in change_paths(alt["changes"]) if p.split(".")[0] in NOT_INPUTS or not resolves(d, p)]
        assert not bad, (alt["name"], bad)


@pytest.mark.parametrize("slug", list_deals())
def test_report_unsourced(slug, capsys):
    d = load_deal(slug)
    missing = unsourced(d)
    todo = [k for k, v in d["sources"].items() if "TODO" in v]
    with capsys.disabled():
        print(f"\n{slug}: {len(missing)} inputs without a source, {len(todo)} sources marked TODO"
              + (f"; unsourced: {', '.join(missing[:12])}" if missing else ""))


if __name__ == "__main__":
    for slug in list_deals():
        d = load_deal(slug)
        jsonschema.validate(d, SCHEMA, format_checker=jsonschema.FormatChecker())
        print(slug, "valid;", len(unsourced(d)), "unsourced:", unsourced(d))
