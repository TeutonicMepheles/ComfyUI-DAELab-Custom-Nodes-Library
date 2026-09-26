"""Explicit, paid smoke test. Run one model at a time; same ID recovers only."""
import argparse
import importlib.util
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--project", required=True)
parser.add_argument("--root", required=True)
parser.add_argument("--request-id", required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("libtv_runtime", Path(__file__).resolve().parents[1] / "nodes/libtv_bridge/runtime.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
root = Path(args.root)
bridge = r.Bridge(root / "user/daelab/libtv/jobs", root / "output/daelab/libtv")
settings = dict(duration=5 if args.model == "Minimax H3" else 4,
                resolution="768P" if args.model == "Minimax H3" else "480p", ratio="16:9")
if args.model != "Minimax H3":
    settings["enableSound"] = "off"
state = bridge.generate(args.project, args.request_id, args.model, "text2video",
    "A small blue ceramic sphere slowly rolling a short distance across a light gray studio tabletop, soft daylight, fixed camera, realistic shadows, no people, no text.", settings)
print(json.dumps(state, ensure_ascii=False, indent=2))
