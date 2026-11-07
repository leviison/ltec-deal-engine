"""Build the dashboard: inline engine/core.js and deal files into web/index.template.html.
    python scripts/build_web.py                -> dist/index.html, every deal with a deal picker (the published page)
    python scripts/build_web.py siena-villas   -> dist/siena-villas/index.html, that deal only
    python scripts/build_web.py --preview      -> dist/preview/index.html, every deal, with a PREVIEW banner (for the
                                                  preview dashboard; work on a branch is tried there before release)
The result is one self-contained page (published as a claude.ai artifact). In the all-deals page, #<slug> opens a deal.
"""
import datetime
import html
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import list_deals, load_deal  # noqa: E402

TITLE_ALL = "LTEC Deal Engine"


def build_info(preview=False):
    """What the page says about itself: the engine release, the commit and branch it was built from."""
    v = json.loads((ROOT / "engine" / "version.json").read_text())
    git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()  # noqa: E731
    return {"engine": v["engine"], "commit": git("rev-parse", "--short", "HEAD"), "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "dirty": bool(git("status", "--porcelain", "--", "engine", "web", "deals")),
            "built": datetime.date.today().isoformat(), "preview": preview}


def build(slugs, out, title, preview=False):
    tpl = (ROOT / "web" / "index.template.html").read_text()
    engine = (ROOT / "engine" / "core.js").read_text()
    deals = {s: load_deal(s) for s in slugs}
    for marker in ("/*__ENGINE__*/", "/*__DEALS__*/null", "/*__BUILD__*/null", "/*__STRUCTURES__*/null", "/*__LOAN_TERMS__*/null", "__DEAL_NAME__", "__PAGE_TITLE__"):
        assert marker in tpl, marker
    # JSON inside <script>: keep "</" from closing the tag
    data = json.dumps(deals).replace("</", "<\\/")
    page = (tpl.replace("/*__ENGINE__*/", engine)
               .replace("/*__DEALS__*/null", data)
               .replace("/*__BUILD__*/null", json.dumps(build_info(preview)))
               .replace("/*__STRUCTURES__*/null", (ROOT / "engine" / "structures.json").read_text().replace("</", "<\\/"))
               .replace("/*__LOAN_TERMS__*/null", (ROOT / "engine" / "loan_terms.json").read_text().replace("</", "<\\/"))
               .replace("__PAGE_TITLE__", html.escape(title))
               .replace("__DEAL_NAME__", html.escape(deals[slugs[0]]["meta"]["name"])))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"wrote {out.relative_to(ROOT)} ({len(page):,} bytes, {len(slugs)} deal{'s' if len(slugs) > 1 else ''})")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    # most recently added deal first, so the picker opens on the newest
    order = sorted(list_deals(), key=lambda s: load_deal(s)["meta"].get("status") != "screening")
    if "--preview" in sys.argv:
        build(order, ROOT / "dist" / "preview" / "index.html", TITLE_ALL + " (preview)", preview=True)
    elif not args:
        build(order, ROOT / "dist" / "index.html", TITLE_ALL)
    for slug in args:
        build([slug], ROOT / "dist" / slug / "index.html", f"{load_deal(slug)['meta']['name']} Model")
