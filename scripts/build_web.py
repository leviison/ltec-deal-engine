"""Build a deal's dashboard: inline engine/core.js and the deal file into web/index.template.html.
    python scripts/build_web.py siena-villas      -> dist/siena-villas/index.html
    python scripts/build_web.py --all
The result is one self-contained page (published as a claude.ai artifact).
"""
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import list_deals, load_deal  # noqa: E402


def build(slug):
    tpl = (ROOT / "web" / "index.template.html").read_text()
    engine = (ROOT / "engine" / "core.js").read_text()
    deal = load_deal(slug)
    for marker in ("/*__ENGINE__*/", "/*__INPUTS__*/null", "__DEAL_NAME__"):
        assert marker in tpl, marker
    page = (tpl.replace("/*__ENGINE__*/", engine)
               .replace("/*__INPUTS__*/null", json.dumps(deal))
               .replace("__DEAL_NAME__", html.escape(deal["meta"]["name"]))
               .replace("__DEAL_SLUG__", html.escape(slug)))
    out = ROOT / "dist" / slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"wrote {out.relative_to(ROOT)} ({len(page):,} bytes)")


if __name__ == "__main__":
    args = sys.argv[1:]
    for slug in (list_deals() if "--all" in args or not args else args):
        build(slug)
