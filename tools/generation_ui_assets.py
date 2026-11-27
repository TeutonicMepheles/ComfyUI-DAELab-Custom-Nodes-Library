"""Build and verify scoped Creative Canvas assets from a fixed Git object."""
import argparse
import json
import re
import subprocess
from pathlib import Path

from prompt_opt_assets import digest

REVISION = "47fdb09e2988397c6fc1d22d10b5d4c575f02552"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web/vendor/generation-ui-shared"
FONT = "vendor/alibaba-puhuiti-3"
TRANSFORM = "replace-canvas-root-v1"
FILES = (
    "creative_button.mjs", "creative_field.mjs", "creative_theme.css",
    "vendor/remixicon/LICENSE", "vendor/remixicon/arrow-down-line.svg",
    f"{FONT}/LICENSE.txt", f"{FONT}/manifest.json",
    f"{FONT}/AlibabaPuHuiTi-3-55-Regular.woff2",
    f"{FONT}/AlibabaPuHuiTi-3-65-Medium.woff2",
    f"{FONT}/AlibabaPuHuiTi-3-75-SemiBold.woff2",
)


def source_bytes(repo, name):
    source = f"web/{name}"
    data = subprocess.check_output(["git", "-C", str(repo), "show", f"{REVISION}:{source}"])
    if name == "creative_theme.css":
        selector = b":is(.dae-creative,.dae-ui)"
        assert selector in data
        data = data.replace(selector, b".cnl-generation-ui")
    return data


def assemble(repo):
    entries = []
    for name in FILES:
        source = f"web/{name}"
        data = source_bytes(repo, name)
        target = OUTPUT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        entries.append(dict(path=name, source=source, bytes=len(data), sha256=digest(data)))
    (OUTPUT / "source-manifest.json").write_bytes(
        (json.dumps(dict(canvasRevision=REVISION, transform=TRANSFORM, files=entries), indent=2) + "\n").encode()
    )
    (OUTPUT / ".gitattributes").write_bytes(b"* -text\n")


def check(repo=None):
    manifest = json.loads((OUTPUT / "source-manifest.json").read_bytes())
    assert manifest["canvasRevision"] == REVISION and manifest["transform"] == TRANSFORM
    assert {entry["path"] for entry in manifest["files"]} == set(FILES)
    assert {p.relative_to(OUTPUT).as_posix() for p in OUTPUT.rglob("*") if p.is_file()} == {
        *FILES, "source-manifest.json", ".gitattributes",
    }
    for entry in manifest["files"]:
        data = (OUTPUT / entry["path"]).read_bytes()
        assert entry["source"] == f'web/{entry["path"]}'
        assert digest(data) == entry["sha256"] and len(data) == entry["bytes"], entry["path"]
        if repo:
            assert data == source_bytes(repo, entry["path"]), entry["path"]
    for font in json.loads((OUTPUT / FONT / "manifest.json").read_bytes()):
        assert digest((OUTPUT / FONT / font["file"]).read_bytes()) == font["sha256"]
    theme = (OUTPUT / "creative_theme.css").read_text(encoding="utf-8")
    for path in re.findall(r"url\(['\"]?\./([^'\")]+)", theme):
        assert path in FILES, path
    assert ".dae-creative" not in theme and ".dae-ui" not in theme
    print(f"Verified {len(FILES)} shared assets from {REVISION}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canvas-repo", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        if not args.canvas_repo:
            parser.error("--canvas-repo is required to assemble")
        assemble(args.canvas_repo)
    check(args.canvas_repo)
