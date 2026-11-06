"""The release is consistent: engine/version.json is semver and CHANGELOG.md's newest entry is that version."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_version_and_changelog():
    v = json.loads((ROOT / "engine" / "version.json").read_text())["engine"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", v), v
    heads = re.findall(r"^## (\S+)", (ROOT / "CHANGELOG.md").read_text(), flags=re.M)
    assert heads and heads[0] == v, f"CHANGELOG.md's newest entry is {heads[:1]}, engine/version.json says {v}"


def test_preview_build_is_marked(tmp_path):
    import subprocess
    import sys
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_web.py"), "--preview"], check=True, capture_output=True)
    page = (ROOT / "dist" / "preview" / "index.html").read_text()
    assert '"preview": true' in page and "(preview)</title>" in page
    v = json.loads((ROOT / "engine" / "version.json").read_text())["engine"]
    assert f'"engine": "{v}"' in page
