"""Rebuild/verify offline assets from immutable Git objects, never a dirty checkout."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

CANVAS_SHA = "785bad3441550f580cb42b7a9532cc0f4ee547f9"
REMIX_SHA = "9fb7967c0a4c09910161192bde99efd3df09f5eb"
REMIX_PATHS = ("icons/Weather/sparkling-line.svg", "License")
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web/vendor/prompt-optimization-shared"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canvas-repo", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest_path = OUTPUT / "source-manifest.json"
    if args.check:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected = {entry["path"] for entry in manifest["files"]}
        actual = {p.relative_to(OUTPUT).as_posix() for p in OUTPUT.rglob("*") if p.is_file()}
        assert actual == expected | {"source-manifest.json", ".gitattributes"}, "Unexpected/missing vendored files"
        for entry in manifest["files"]:
            data = (OUTPUT / entry["path"]).read_bytes()
            assert digest(data) == entry["sha256"] and len(data) == entry["bytes"], entry["path"]
        font_root = OUTPUT / "vendor/alibaba-puhuiti-3"
        for font in json.loads((font_root / "manifest.json").read_text(encoding="utf-8")):
            assert digest((font_root / font["file"]).read_bytes()) == font["sha256"]
        print(f"Verified {len(expected)} immutable shared assets, including all original font hashes")
        return
    if not args.canvas_repo:
        parser.error("--canvas-repo is required to assemble")
    archive = subprocess.check_output(["git", "-C", str(args.canvas_repo), "archive", "--format=tar", CANVAS_SHA,
                                      "web/creative_theme.css", "web/vendor/alibaba-puhuiti-3", "web/vendor/remixicon"])
    entries = []
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = Path(member.name).relative_to("web")
            data = tar.extractfile(member).read()
            target = OUTPUT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            entries.append({"path": relative.as_posix(), "source": member.name, "revision": CANVAS_SHA,
                            "sha256": digest(data), "bytes": len(data)})
    # Supplemental AI icon is absent from the locked Canvas release. Pin the official original.
    for source, destination in ((REMIX_PATHS[0], "vendor/remixicon/sparkling-line.svg"),
                                (REMIX_PATHS[1], "vendor/remixicon/LICENSE-supplemental")):
        url = f"https://raw.githubusercontent.com/Remix-Design/RemixIcon/{REMIX_SHA}/{source}"
        data = urllib.request.urlopen(url, timeout=30).read()
        (OUTPUT / destination).write_bytes(data)
        entries.append({"path": destination, "source": url, "revision": REMIX_SHA,
                        "sha256": digest(data), "bytes": len(data)})
    manifest = {"schemaVersion": 1, "canvasRepository": "https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Canvas.git",
                "canvasRevision": CANVAS_SHA, "files": sorted(entries, key=lambda entry: entry["path"])}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Assembled {len(entries)} files from committed sources")


if __name__ == "__main__":
    main()
