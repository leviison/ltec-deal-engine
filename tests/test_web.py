"""Dashboard tests: build dist/index.html, then run every tests/web/*.test.js in headless Chromium (Playwright).

Each page test drives the real page with stand-ins for the claude.ai runtime (saved-scenario database, Claude for the
Ask panel, downloads) and fails on any page error, thrown error or failed check. Export tests load the PDF / Excel
libraries from node_modules (npm install). Skip these with: python -m pytest -m "not web".
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "tests" / "web"
TESTS = sorted(WEB.glob("*.test.js"))

pytestmark = pytest.mark.web


def _have_playwright():
    if not shutil.which("node"):
        return False
    return subprocess.run(["node", "-e", "require('playwright')"], cwd=ROOT, capture_output=True).returncode == 0


@pytest.fixture(scope="module", autouse=True)
def built_page():
    if not _have_playwright():
        pytest.skip("node + playwright not available")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_web.py")], check=True, capture_output=True)
    subprocess.run([sys.executable, str(WEB / "fixtures.py")], check=True)


@pytest.mark.parametrize("test", TESTS, ids=[t.name.replace(".test.js", "") for t in TESTS])
def test_page(test):
    if test.name == "exports.test.js" and not (ROOT / "node_modules" / "exceljs").exists():
        pytest.skip("run `npm install` for the export libraries")
    r = subprocess.run(["node", str(test)], cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, (r.stdout[-3000:] + "\n" + r.stderr[-3000:])
