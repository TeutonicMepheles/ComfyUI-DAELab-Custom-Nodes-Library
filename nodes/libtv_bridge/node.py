from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

import folder_paths
import numpy as np
import torch
from PIL import Image, ImageOps
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
        return io.Schema(node_id=NODE_ID, display_name="DAELAB · 生成节点", category="DAELab/LibTV",
            description="在节点内编辑并运行图片或视频任务；连接多维表格后每行对应一个任务。原生输出读取当前任务已完成的结果。",
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
                io.String.Input("text_input", optional=True, force_input=True),
                io.String.Input("table_json", optional=True, force_input=True),
                io.String.Input("task_data", default="", optional=True, socketless=True, extra_dict={'hidden': True}),
            ],
            outputs=[io.Video.Output("video"), io.Custom("COMFYTV_VIDEO").Output("comfytv_video"),
                     io.String.Output("local_path"), io.String.Output("task_report"), io.Image.Output("image")])

    @classmethod
    def execute(cls, project_uuid, request_id, model, mode, prompt, duration, resolution, ratio,
                sound=False, reference_files="[]", first_frame=None, last_frame=None,
                reference_images=None, reference_video=None, text_input=None, table_json=None, task_data=""):
        if task_data:
            tasks = json.loads(task_data)
            row = next((r for r in tasks['table']['records'] if r['id'] == tasks['currentId']), None)
            results = row['values'].get(tasks['fieldId'], []) if row else []
            if not results:
                raise ValueError('请先在生成节点内运行任务；完成后原生输出读取当前任务的最新结果')
            asset = results[-1]
            media = local_media(asset['url'])
            report = json.dumps([dict(id=r['id'], name=r.get('name', ''), results=r['values'].get(tasks['fieldId'], []))
                                 for r in tasks['table']['records']], ensure_ascii=False)
            if media['kind'] == 'image':
                with Image.open(media['path']) as source:
                    image = torch.from_numpy(np.array(ImageOps.exif_transpose(source).convert('RGB'), dtype=np.float32) / 255.0).unsqueeze(0)
                return io.NodeOutput(None, None, media['path'], report, image,
                                     ui={'daelab_video_task_result': [asset['url']]})
            if media['kind'] != 'video':
                raise ValueError('当前任务结果不是图片或视频')
            return io.NodeOutput(InputImpl.VideoFromFile(media['path']), asset['url'], media['path'], report, None,
                                 ui={'daelab_video_task_result': [asset['url']]})
        if table_json:
            raise ValueError('请刷新页面，在生成节点中导入表格任务后运行')
        if text_input is not None:
            prompt = text_input
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
        return io.NodeOutput(InputImpl.VideoFromFile(str(path)), url, str(path), report, None,
                             ui={**ui.PreviewVideo([ui.SavedResult(path.name, subfolder, io.FolderType.output)]).as_dict(),
                                 'daelab_video_identity': [json.dumps([project_uuid, request_id, model], ensure_ascii=False, separators=(',', ':'))]})


NODE_CLASS_MAPPINGS = {NODE_ID: LibTVVideo}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "DAELAB · 生成节点"}
