"""Paid five-model acceptance via ComfyUI, with durable workflows and evidence."""
import argparse
import json
from pathlib import Path
import time
import urllib.request

MODELS = ["Seedance 2.5", "Seedance 2.0", "Seedance 2.0 Mini", "Seedance 2.0 Fast", "Minimax H3"]
IDS = ["acceptance-seedance25-001", "acceptance-seedance2-001", "acceptance-seedance-mini-001", "acceptance-seedance-fast-001", "acceptance-minimax-h3-001"]
PROMPT = "A small blue ceramic sphere slowly rolling a short distance across a light gray studio tabletop, soft daylight, fixed camera, realistic shadows, no people, no text."
parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
parser.add_argument("--server", default="http://127.0.0.1:8001")
parser.add_argument("--project", required=True)
parser.add_argument("--run", action="store_true", help="Submit paid generation tests")
args = parser.parse_args()
root = Path(args.root)
destination = root / "user/default/workflows/LibTV"
destination.mkdir(parents=True, exist_ok=True)
reports = root / "output/daelab/libtv/acceptance"
reports.mkdir(parents=True, exist_ok=True)


def api(path, data=None):
    request = urllib.request.Request(args.server + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


results = []
for model, request_id in zip(MODELS, IDS):
    inputs = dict(project_uuid=args.project, request_id=request_id, model=model, mode="text2video", prompt=PROMPT,
                  duration=5 if model == "Minimax H3" else 4,
                  resolution="768P" if model == "Minimax H3" else "480p", ratio="16:9", sound=False,
                  reference_files="[]")
    workflow = {"last_node_id": 1, "last_link_id": 0, "nodes": [{"id": 1,
        "type": "DAELAB.LibTV.VideoGenerate", "pos": [100, 100], "size": [650, 780], "flags": {}, "order": 0,
        "mode": 0, "title": model + " — LibTV → Comfy", "inputs": [
            {"name": "first_frame", "type": "IMAGE", "link": None},
            {"name": "last_frame", "type": "IMAGE", "link": None},
            {"name": "reference_images", "type": "IMAGE", "link": None},
            {"name": "reference_video", "type": "COMFYTV_VIDEO", "link": None}],
        "outputs": [{"name": n, "type": t, "links": None, "slot_index": i} for i, (n, t) in enumerate([
            ("video", "VIDEO"), ("comfytv_video", "COMFYTV_VIDEO"), ("local_path", "STRING"), ("task_report", "STRING")])],
        "properties": {"Node name for S&R": "DAELAB.LibTV.VideoGenerate"}, "widgets_values": list(inputs.values())}],
        "links": [], "groups": [], "config": {}, "extra": {"ds": {"scale": 0.9, "offset": [50, 30]},
        "linearData": {"inputs": [[1, "daelab_libtv_panel"]], "outputs": [1]}}, "version": 0.4}
    path = destination / (model.replace(".", "_") + ".json")
    path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2), "utf-8")
    result = {"model": model, "workflow": str(path), "request_id": request_id}
    if args.run:
        try:
            submitted = api("/prompt", {"prompt": {"1": {"class_type": "DAELAB.LibTV.VideoGenerate", "inputs": inputs}},
                                       "extra_data": {"extra_pnginfo": {"workflow": workflow}}})
            result["prompt_id"] = submitted["prompt_id"]
            print(model + " submitted to Comfy: " + result["prompt_id"], flush=True)
            # This polls Comfy's queue, NOT LibTV. The node waits on libtv --run itself.
            while True:
                history = api("/history/" + result["prompt_id"])
                if result["prompt_id"] in history:
                    entry = history[result["prompt_id"]]
                    result.update(status=entry["status"], outputs=entry.get("outputs", {}))
                    break
                time.sleep(3)
        except Exception as exc:
            result["error"] = str(exc)
        status = result.get("status", {}).get("status_str", "error")
        error = next((e[1]["exception_message"] for e in result.get("status", {}).get("messages", [])
                      if e[0] == "execution_error"), result.get("error", ""))
        print(json.dumps({"model": model, "status": status, "error": error[:250]}, ensure_ascii=False), flush=True)
        note = f"Model: {model}\nComfy prompt: {result.get('prompt_id', '')}\nStatus: {status}\n"
        note += ("No generated video returned.\n" + error[:1400]) if status != "success" else "See the completed job in Comfy history for video preview."
        workflow["last_node_id"] = 2
        workflow["nodes"].append({"id": 2, "type": "Note", "pos": [800, 100], "size": [520, 420],
            "flags": {}, "order": 1, "mode": 0, "title": "Live test result / 实测记录", "properties": {},
            "widgets_values": [note], "color": "#432", "bgcolor": "#653"})
        path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2), "utf-8")
        with (reports / "attempts.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
    results.append(result)
    if args.run:
        (reports / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), "utf-8")
