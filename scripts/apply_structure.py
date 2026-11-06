"""Set how LTEC holds a deal from a structure template (engine/structures.json).
    python scripts/apply_structure.py <slug> <template>                    -> the deal file's vehicle becomes the template
    python scripts/apply_structure.py <slug> <template> --variant "Name"   -> adds it as a variant (meta.alternatives)
Templates: direct, spv, spv_warehouse. Keeps the check, the vehicle close date, LTEC's partners and LTEC's own terms.
Then source the result in the deal's `sources` (who funds LTEC, the SPV's fees) and run python -m pytest.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import apply_structure, load_structures, template_note  # noqa: E402


def main(argv):
    slug, key = argv[0], argv[1]
    variant = argv[argv.index("--variant") + 1] if "--variant" in argv else None
    lib = load_structures()
    if key not in lib["templates"]:
        raise SystemExit(f"template must be one of: {', '.join(lib['templates'])}")
    path = ROOT / "deals" / slug / "deal.json"
    deal = json.loads(path.read_text())
    if variant:
        # a variant names the template, so it is built for the deal's check, names and partners when applied (#14)
        alts = deal["meta"].setdefault("alternatives", [])
        alts[:] = [a for a in alts if a["name"] != variant]
        alts.append({"name": variant, "note": template_note(lib["templates"][key], deal), "structure": key})
    else:
        deal["warehouse"] = apply_structure(deal, key, lib)["warehouse"]
    path.write_text(json.dumps(deal, indent=2, ensure_ascii=False) + "\n")
    print(f"{slug}: {'variant ' + repr(variant) if variant else 'vehicle'} set to {lib['templates'][key]['label']}")


if __name__ == "__main__":
    main(sys.argv[1:])
