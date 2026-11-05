"""Add LTEC's standard cases (Adjusted Base, Downside, Stress) to a deal, built from its sponsor case.
    python scripts/add_standard_cases.py <deal-slug> [--from sponsor] [--force]
Defaults live in engine/standard_cases.json. Existing cases are kept unless --force. Each added case gets a
`TODO:` source so test_deal_files.py lists it until the deal's own diligence tunes it.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import deal_path, load_deal, run_case  # noqa: E402

STD = json.loads((ROOT / "engine" / "standard_cases.json").read_text())


def add(slug, src="sponsor", force=False):
    d = load_deal(slug)
    if src not in d["cases"]:
        sys.exit(f"{slug} has no '{src}' case to build from")
    cap0 = run_case(src, d)["exit"]["exit_cap"]
    has_below = bool(d["deal"].get("below_noi_income", {}).get("amounts"))
    added = []
    ordered = {src: d["cases"][src]}
    for k in ("base", "downside", "stress"):
        if k in d["cases"] and not force:
            ordered[k] = d["cases"][k]
            continue
        t = {kk: v for kk, v in STD[k].items() if not kk.startswith("_")}
        spread = t.pop("exit_cap_spread")
        ov = t.pop("deal_overrides_if_below_noi")
        case = dict(t, kind="derived", **{"from": src}, exit_cap=round(cap0 + spread, 6))
        if has_below:
            case["deal_overrides"] = ov
        ordered[k] = case
        d["sources"][f"cases.{k}"] = "TODO: LTEC standard case (engine/standard_cases.json); tune to this deal's diligence"
        added.append(k)
    for k, v in d["cases"].items():
        ordered.setdefault(k, v)
    d["cases"] = dict(ordered)
    if "custom" in d["cases"]:  # keep Custom last
        d["cases"]["custom"] = d["cases"].pop("custom")
    deal_path(slug).write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    return added


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("slug")
    a.add_argument("--from", dest="src", default="sponsor")
    a.add_argument("--force", action="store_true")
    args = a.parse_args()
    print("added:", add(args.slug, args.src, args.force) or "nothing (cases exist; --force to replace)")
