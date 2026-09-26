"""LibTV CLI transport. No ComfyTV imports and no private HTTP endpoints."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess

MODELS = {
    "Seedance 2.5": "star-video2.5",
    "Seedance 2.0": "star-video2",
    "Seedance 2.0 Mini": "star-video2-mini",
    "Seedance 2.0 Fast": "star-video2-fast",
    "Minimax H3": "MiniMax-Hailuo-H3",
}


def json_stream(text):
    decoder, result, pos = json.JSONDecoder(), [], 0
    while pos < len(text):
        if text[pos].isspace():
            pos += 1
            continue
        value, end = decoder.raw_decode(text, pos)
        result.append(value)
        pos = end
    return result


class CLI:
    def __init__(self, executable=None, timeout=None, cwd=None):
        self.executable = executable or os.environ.get("DAELAB_LIBTV_CLI") or shutil.which("libtv") or str(Path.home() / ".libtv" / ("libtv.exe" if os.name == "nt" else "libtv"))
        self.timeout, self.cwd = timeout, cwd

    def __call__(self, *args):
        # --run is synchronous; never add a timeout/retry around a paid submission.
        proc = subprocess.run([self.executable, *map(str, args)], capture_output=True,
                              encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                              timeout=self.timeout, cwd=self.cwd)
        try:
            values = json_stream(proc.stdout)
        except ValueError:
            values = []
        if proc.returncode:
            detail = next((v.get("data", {}).get("taskInfo", {}).get("failedReason")
                           for v in reversed(values) if isinstance(v, dict)
                           and v.get("data", {}).get("taskInfo", {}).get("failedReason")), None)
            raise RuntimeError(detail or proc.stderr[-2000:] or "LibTV CLI failed")
        if not values:
            if args and args[0] == "download":
                # Official CLI prints downloaded paths, not JSON. The caller
                # independently verifies the file and decodes its video frames.
                return {"download_output": proc.stdout.strip()}
            if args and args[0] == "node" and "--run" in args:
                # A successful synchronous run may print progress instead of JSON.
                # Reconcile once with a read-only query; never repeat --run.
                return self(*(arg for arg in args if arg != "--run"))
            raise RuntimeError("LibTV returned no JSON; no generation will be retried automatically")
        if args and (args[0] == "upload" or tuple(args[:2]) == ("node", "create")):
            created = next((v for v in reversed(values) if isinstance(v, dict) and v.get("nodeKey")), None)
            if created:
                return created
        return values[-1]


def digest_file(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


@contextlib.contextmanager
def job_lock(path):
    """OS lock survives process crashes without leaving a permanently locked job."""
    with open(path, "a+b") as stream:
        stream.seek(0)
        stream.write(b"0")
        stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError("This LibTV request is already running") from exc
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def validate(schema, mode, prompt, settings, media):
    props = schema["properties"]
    modes = props.get("modeType", {}).get("items", {})
    if mode != "text2video" and mode not in modes:
        raise ValueError(f"Model does not support {mode}")
    counts = {kind: sum(m["kind"] == kind for m in media) for kind in ("image", "video", "audio")}
    for kind, index in re.findall(r"@(image|video|audio)_(\d+)\b", prompt):
        if not 1 <= int(index) <= counts[kind]:
            raise ValueError(f"Reference @{kind}_{index} has no connected asset")
    if mode == "text2video" and media:
        raise ValueError("Text-to-video does not accept reference media")
    if mode in ("frames2video", "singleImage2video", "image2video"):
        lo, hi = modes[mode]
        if counts["video"] or counts["audio"] or not lo <= counts["image"] <= hi:
            raise ValueError(f"{mode} requires {lo}–{hi} images only")
    if mode == "mixed2video":
        lo, hi = modes[mode]
        if not lo <= len(media) <= hi:
            raise ValueError(f"Mixed reference requires {lo}–{hi} assets")
        limits = props["modeType"].get("mixed2videoConfig", {})
        for kind, count in counts.items():
            if count > limits.get(kind + "Max", 0):
                raise ValueError(f"Too many {kind} references")
        if counts["audio"] and not (counts["image"] or counts["video"]):
            raise ValueError("Audio references require an image or video reference")
    if not prompt.strip():
        raise ValueError("A prompt is required")
    maximum = props.get("prompt", {}).get("maxLength", 0)
    if maximum and len(prompt) > maximum:
        raise ValueError(f"Prompt exceeds {maximum} characters")
    configured = schema["config"].get("settings", [])
    configured = configured.get(mode, []) if isinstance(configured, dict) else configured
    specs = {props[k].get("originalField", k): props[k] for k in configured}
    for key, value in settings.items():
        if key not in specs:
            raise ValueError(f"Setting {key} is not supported in {mode}")
        spec = specs[key]
        choices = [v.get("value") if isinstance(v, dict) else v for v in spec.get("enum", [])]
        if choices and value not in choices:
            raise ValueError(f"{key}: choose from {choices}")
        if "min" in spec and not spec["min"] <= value <= spec["max"]:
                raise ValueError(f"{key}: expected {spec['min']}–{spec['max']}")


def reference_prompt(prompt, media, keys):
    refs = {kind: [key for item, key in zip(media, keys) if item["kind"] == kind]
            for kind in ("image", "video", "audio")}
    return re.sub(r"@(image|video|audio)_(\d+)\b",
                  lambda m: "{{Node " + refs[m[1]][int(m[2]) - 1] + "}}", prompt)


class Bridge:
    def __init__(self, cache, output, cli=None):
        self.cache, self.output, self.cli = Path(cache), Path(output), cli or CLI()
        self.cache.mkdir(parents=True, exist_ok=True)
        self.output.mkdir(parents=True, exist_ok=True)

    def generate(self, project, request_id, model, mode, prompt, settings, media=()):
        if not project.strip() or not request_id.strip():
            raise ValueError("project_uuid and request_id are required")
        if model not in MODELS:
            raise ValueError("Unsupported model")
        request = dict(project=project, request_id=request_id, model=model, mode=mode,
                       prompt=prompt, settings=settings,
                       media=[dict(kind=m["kind"], sha256=digest_file(m["path"])) for m in media])
        fingerprint = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        key = hashlib.sha256((project + "\n" + request_id).encode()).hexdigest()[:24]
        record = self.cache / (key + ".json")
        with job_lock(self.cache / (key + ".lock")):
            state = json.loads(record.read_text("utf-8")) if record.exists() else None
            if state and state["fingerprint"] != fingerprint:
                raise ValueError("Request ID already belongs to different inputs. Use a new request_id to generate again.")
            if state and state.get("file") and Path(state["file"]).is_file():
                if digest_file(state["file"]) == state.get("sha256"):
                    return state
            if not state:
                matches = self.cli("model", "search", "--type", "video").get("matches", [])
                model_info = next((m for m in matches if m["modelKey"] == MODELS[model]), None)
                if not model_info:
                    raise RuntimeError(f"{model} absent from current LibTV model list; no substitute submitted")
                name = model_info["modelName"]
                schema = self.cli("model", name)["schema"]
                validate(schema, mode, prompt, settings, media)
                state = dict(request=request, fingerprint=fingerprint, model_name=name,
                             phase="preparing", node_name="DAELab-" + key, references=[])
                atomic_json(record, state)
            if not state.get("node_key"):
                try:
                    # Read back after a preparation failure; creation never includes --run.
                    existing = self.cli("node", "list", "-p", project).get("nodes", [])
                    by_name = {n["name"]: n["id"] for n in existing}
                    if state["node_name"] in by_name:
                        existing_key = by_name[state["node_name"]]
                        found = self.cli("node", existing_key, "-p", project)
                        found_data = found.get("data", {})
                        has_task = bool(found_data.get("taskInfo", {}).get("taskId") or
                                        found.get("taskId") or found_data.get("url"))
                        state.update(node_key=existing_key,
                                     phase="submitted_or_uncertain" if has_task else "prepared")
                        atomic_json(record, state)
                    for index, item in enumerate(media[len(state["references"]):], len(state["references"])):
                        ref_name = f"{state['node_name']}-ref-{index + 1}"
                        if ref_name in by_name:
                            state["references"].append(by_name[ref_name])
                            atomic_json(record, state)
                            continue
                        ref = self.cli("upload", f"{state['node_name']}-ref-{index + 1}",
                                       "-p", project, "-t", item["kind"], "-f", item["path"])
                        state["references"].append(ref["nodeKey"])
                        atomic_json(record, state)
                    args = ["node", "create", state["node_name"], "-p", project, "-t", "video",
                            "-s", "model=" + state["model_name"], "-s", "modeType=" + mode, "-s", "count=1",
                            "--prompt", reference_prompt(prompt, media, state["references"])]
                    for k, v in settings.items():
                        args += ["-s", f"{k}={v}"]
                    for ref in state["references"]:
                        args += ["--left", ref]
                    if not state.get("node_key"):
                        node = self.cli(*args)
                        created_key = node.get("nodeKey")
                        if not created_key:
                            # Reference linking can append a separate CLI response.
                            # Reconcile the created node by exact name, never create again.
                            matches = [n for n in self.cli("node", "list", "-p", project).get("nodes", [])
                                       if n.get("name") == state["node_name"]]
                            if len(matches) != 1:
                                raise RuntimeError("Cannot uniquely reconcile created LibTV node; no generation submitted")
                            created_key = matches[0]["id"]
                        state.update(node_key=created_key, phase="prepared")
                    atomic_json(record, state)
                except Exception as exc:
                    state.update(error=str(exc), phase="prepare_uncertain")
                    atomic_json(record, state)
                    raise
            if not state.get("node_key"):
                raise RuntimeError("Previous preparation interrupted; inspect LibTV canvas before using a new request ID")
            if state["phase"] == "prepared":
                # Persist BEFORE the paid command. An ambiguous failure must never resubmit.
                state["phase"] = "submitted_or_uncertain"
                atomic_json(record, state)
                try:
                    node = self.cli("node", state["node_key"], "-p", project, "--run")
                except Exception as exc:
                    state["error"] = str(exc)
                    atomic_json(record, state)
                    raise
            else:
                node = self.cli("node", state["node_key"], "-p", project)
            data = node.get("data", {})
            task = data.get("taskInfo", {})
            state.update(task_id=node.get("taskId") or task.get("taskId"), remote=node)
            if not data.get("url"):
                atomic_json(record, state)
                raise RuntimeError(task.get("failedReason") or "Original task has no video yet; rerun to recover, never resubmit")
            state["phase"] = "generated"
            atomic_json(record, state)
            directory = self.output / key
            directory.mkdir(parents=True, exist_ok=True)
            self.cli("download", "-p", project, "-n", state["node_key"], "-o", directory)
            videos = [p for p in directory.rglob("*") if p.suffix.lower() in (".mp4", ".webm", ".mov")]
            if len(videos) != 1:
                raise RuntimeError("Expected exactly one downloaded video")
            import av
            with av.open(str(videos[0])) as container:
                frame = next(container.decode(video=0), None)
                if frame is None:
                    raise RuntimeError("Downloaded video has no decodable frame")
                state["width"], state["height"] = frame.width, frame.height
            state.update(phase="complete", file=str(videos[0].resolve()), sha256=digest_file(videos[0]))
            atomic_json(record, state)
            return state
