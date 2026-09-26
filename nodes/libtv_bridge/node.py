from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

import folder_paths
from comfy_api.latest import io, ui, InputImpl
from .runtime import Bridge, MODELS

NODE_ID = "DAELAB.LibTV.VideoGenerate"


def local_media(value):
    roots = [Path(folder_paths.get_input_directory()).resolve(),
             Path(folder_paths.get_output_directory()).resolve(),
             Path(folder_paths.get_temp_directory()).resolve()]
    if value.startswith("/view?"):
        query = parse_qs(urlparse(value).query)
        kind = query.get("type", ["output"])[0]
        root = dict(zip(("input", "output", "temp"), roots)).get(kind)
        if root is None:
            raise ValueError("Invalid Comfy media type")
        path = root / query.get("subfolder", [""])[0] / query.get("filename", [""])[0]
    else:
        path = Path(value)
        if not path.is_absolute():
            path = roots[0] / path
    path = path.resolve()
    if not any(path.is_relative_to(root) for root in roots) or not path.is_file():
        raise ValueError("Reference must be an existing file inside Comfy input/output/temp")
    suffix = path.suffix.lower()
    kind = ("image" if suffix in (".png", ".jpg", ".jpeg", ".webp") else
            "video" if suffix in (".mp4", ".mov", ".webm") else
            "audio" if suffix in (".wav", ".mp3", ".flac", ".m4a") else None)
    if kind is None:
        raise ValueError("Unsupported reference media format")
    return dict(kind=kind, path=str(path))


def image_files(tensor, single=False):
    if tensor is None:
        return []
    if single and len(tensor) != 1:
        raise ValueError("First/last frame inputs require exactly one image")
    from PIL import Image
    directory = Path(folder_paths.get_temp_directory()) / "daelab_libtv_refs"
    directory.mkdir(parents=True, exist_ok=True)
    results = []
    for image in tensor:
        array = (image.detach().cpu().clamp(0, 1).numpy() * 255).round().astype("uint8")
        name = hashlib.sha256(array.tobytes() + str(array.shape).encode()).hexdigest() + ".png"
        path = directory / name
        Image.fromarray(array).save(path)
        results.append(dict(kind="image", path=str(path)))
    return results


class LibTVVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id=NODE_ID, display_name="LibTV Video Bridge / 视频互传", category="DAELab/LibTV",
            description="Uses the logged-in LibTV CLI and LibTV credits. Keep request_id unchanged to recover a result; change it deliberately for a new paid generation.",
            is_output_node=True, not_idempotent=True,
            inputs=[
                io.String.Input("project_uuid", default=""),
                io.String.Input("request_id", default="video-001"),
                io.Combo.Input("model", options=list(MODELS)),
                io.Combo.Input("mode", options=["text2video", "singleImage2video", "frames2video", "image2video", "mixed2video"]),
                io.String.Input("prompt", default="", multiline=True),
                io.Int.Input("duration", default=4, min=4, max=30),
                io.Combo.Input("resolution", options=["480p", "720p", "1080p", "4k", "768P", "2K"]),
                io.Combo.Input("ratio", options=["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]),
                io.Boolean.Input("sound", default=False),
                io.String.Input("reference_files", default="[]", multiline=True, tooltip="JSON array of local paths or Comfy /view URLs. Order is preserved; first/last frame sockets precede these references."),
                io.Image.Input("first_frame", optional=True),
                io.Image.Input("last_frame", optional=True),
                io.Image.Input("reference_images", optional=True),
                io.Custom("COMFYTV_VIDEO").Input("reference_video", optional=True),
            ],
            outputs=[io.Video.Output("video"), io.Custom("COMFYTV_VIDEO").Output("comfytv_video"),
                     io.String.Output("local_path"), io.String.Output("task_report")])

    @classmethod
    def execute(cls, project_uuid, request_id, model, mode, prompt, duration, resolution, ratio,
                sound=False, reference_files="[]", first_frame=None, last_frame=None,
                reference_images=None, reference_video=None):
        files = json.loads(reference_files)
        if not isinstance(files, list) or not all(isinstance(p, str) for p in files):
            raise ValueError("reference_files must be a JSON array of paths")
        if last_frame is not None and first_frame is None:
            raise ValueError("A last frame requires a first frame")
        media = image_files(first_frame, True) + image_files(last_frame, True) + image_files(reference_images)
        media += [local_media(p) for p in files]
        if reference_video:
            media.append(local_media(reference_video))
        settings = dict(duration=duration, resolution=resolution, ratio=ratio)
        if model != "Minimax H3":
            settings["enableSound"] = "on" if sound else "off"
        elif sound:
            raise ValueError("Minimax H3 does not expose a sound setting")
        output = Path(folder_paths.get_output_directory())
        bridge = Bridge(Path(folder_paths.get_user_directory()) / "daelab/libtv/jobs", output / "daelab/libtv")
        state = bridge.generate(project_uuid, request_id, model, mode, prompt, settings, media)
        path = Path(state["file"])
        subfolder = path.parent.relative_to(output).as_posix()
        url = "/view?" + urlencode(dict(filename=path.name, subfolder=subfolder, type="output"))
        report = json.dumps({k: state.get(k) for k in ("phase", "model_name", "node_key", "task_id", "width", "height", "sha256")}, ensure_ascii=False)
        return io.NodeOutput(InputImpl.VideoFromFile(str(path)), url, str(path), report,
                             ui=ui.PreviewVideo([ui.SavedResult(path.name, subfolder, io.FolderType.output)]))


NODE_CLASS_MAPPINGS = {NODE_ID: LibTVVideo}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "LibTV Video Bridge / 视频互传"}
