"""DAELab-owned nested ComfyUI execution for the GPT Image 2 storyboard node.

The event translation and nested PromptExecutor pattern are adapted from
ComfyTV's MIT-licensed local workflow runner. This module deliberately has no
runtime import from ComfyTV so the upstream package can remain untouched.
"""

from __future__ import annotations

import asyncio
import copy
import json
import urllib.parse
from pathlib import Path


_WORKFLOW_PATH = Path(__file__).with_name("workflows") / "openai-gpt-image-2-storyboard.api.json"
_NESTED_EXECUTOR = None
_NESTED_LOCK: asyncio.Lock | None = None


def _view_url(filename: str, subfolder: str, type_: str) -> str:
    query = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": type_}
    )
    return f"/view?{query}"


def view_url_to_annotated(url: str) -> str:
    if not isinstance(url, str) or not url.startswith("/view?"):
        raise ValueError(f"Reference image must be a ComfyUI /view? URL; got {url!r}")
    params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    filename = params.get("filename", "").strip()
    subfolder = params.get("subfolder", "").strip().strip("/\\")
    type_ = params.get("type", "input").strip().lower()
    if not filename:
        raise ValueError("Reference image URL has no filename")
    if type_ not in {"input", "output", "temp"}:
        raise ValueError(f"Reference image URL has unsupported type {type_!r}")
    path = f"{subfolder}/{filename}" if subfolder else filename
    return f"{path} [{type_}]"


def build_gpt_image_2_subprompt(
    *,
    prompt: str,
    size: str,
    custom_width: int,
    custom_height: int,
    background: str,
    quality: str,
    seed: int,
    image_url: str = "",
) -> dict:
    template = json.loads(_WORKFLOW_PATH.read_text(encoding="utf-8"))
    workflow = copy.deepcopy(template)
    inputs = workflow["1"]["inputs"]
    inputs.update(
        {
            "prompt": prompt,
            "model": "gpt-image-2",
            "model.size": size,
            "model.custom_width": int(custom_width),
            "model.custom_height": int(custom_height),
            "model.background": background,
            "model.quality": quality,
            "n": 1,
            "seed": int(seed),
        }
    )
    workflow["2"]["inputs"]["filename_prefix"] = "DAELAB/storyboard_gpt_image_2"
    if image_url:
        workflow["3"]["inputs"]["image"] = view_url_to_annotated(image_url)
    else:
        workflow.pop("3", None)
        inputs.pop("model.images.image_1", None)
    return workflow


def _get_nested_lock() -> asyncio.Lock:
    global _NESTED_LOCK
    if _NESTED_LOCK is None:
        _NESTED_LOCK = asyncio.Lock()
    return _NESTED_LOCK


def _get_nested_executor():
    global _NESTED_EXECUTOR
    if _NESTED_EXECUTOR is not None:
        return _NESTED_EXECUTOR
    from execution import CacheType, PromptExecutor
    from server import PromptServer

    _NESTED_EXECUTOR = PromptExecutor(
        PromptServer.instance,
        cache_type=CacheType.CLASSIC,
        cache_args={"lru": 0, "ram": 0, "ram_inactive": 0},
    )
    return _NESTED_EXECUTOR


def nested_execution_extra_data(client_id, auth_token=None, api_key=None) -> dict:
    extra_data = {"client_id": client_id}
    if auth_token:
        extra_data["auth_token_comfy_org"] = auth_token
    if api_key:
        extra_data["api_key_comfy_org"] = api_key
    return extra_data


def nested_failure_detail(executor) -> str | None:
    for event, data in reversed(getattr(executor, "status_messages", ())):
        if event == "execution_error" and isinstance(data, dict):
            message = str(data.get("exception_message") or "").strip()
            if message:
                return message
    return None


def _translate_subprompt_event(event, data, sub_prompt_id, outer_node_id, aggregate):
    if event == "progress_state":
        nodes = data.get("nodes") or {}
        if not nodes:
            return []
        value, maximum = aggregate(nodes)
        return [("progress", {
            "value": value,
            "max": maximum,
            "prompt_id": sub_prompt_id,
            "node": str(outer_node_id),
        })]
    if event == "progress":
        return [("progress", {**data, "node": str(outer_node_id)})]
    if event == "progress_text":
        return [("progress_text", {
            **data,
            "node_id": str(outer_node_id),
            "nodeId": str(outer_node_id),
        })]
    return []


def _filter_subprompt_preview(event, data, sub_prompt_id, outer_node_id, preview_type):
    if event != preview_type:
        return False, None
    if not (isinstance(data, tuple) and len(data) == 2 and isinstance(data[1], dict)):
        return False, None
    image, metadata = data
    if metadata.get("prompt_id") != sub_prompt_id:
        return False, None
    if outer_node_id is None:
        return True, None
    node_id = str(outer_node_id)
    rewritten = {**metadata, "node_id": node_id, "display_node_id": node_id}
    return True, (event, (image, rewritten))


async def run_subprompt(
    sub_prompt: dict,
    sub_prompt_id: str,
    execute_outputs: list[str],
    *,
    auth_token=None,
    api_key=None,
):
    from server import BinaryEventTypes, PromptServer

    server = PromptServer.instance
    preview_type = getattr(BinaryEventTypes, "PREVIEW_IMAGE_WITH_METADATA", None)
    total_nodes = float(len(sub_prompt) or 1)

    def aggregate(nodes: dict) -> tuple[float, float]:
        finished = 0.0
        running_fraction = 0.0
        for state in nodes.values():
            if not isinstance(state, dict):
                continue
            if state.get("state") in {"finished", "cached"}:
                finished += 1.0
            elif state.get("state") == "running":
                try:
                    maximum = float(state.get("max") or 1)
                    if maximum > 0:
                        running_fraction += min(1.0, float(state.get("value") or 0) / maximum)
                except (TypeError, ValueError):
                    pass
        return finished + running_fraction, total_nodes

    loop = asyncio.get_running_loop()
    async with _get_nested_lock():
        executor = _get_nested_executor()
        outer_client_id = server.client_id
        outer_node_id = getattr(server, "last_node_id", None)
        original_send_sync = server.send_sync
        extra_data = nested_execution_extra_data(outer_client_id, auth_token, api_key)

        import comfy_execution.progress as progress_module

        outer_registry = getattr(progress_module, "global_progress_registry", None)

        def wrapped_send_sync(event, data, sid=None):
            if preview_type is not None:
                handled, payload = _filter_subprompt_preview(
                    event, data, sub_prompt_id, outer_node_id, preview_type
                )
                if handled:
                    if payload is not None:
                        original_send_sync(payload[0], payload[1], sid)
                    return None
            is_nested = isinstance(data, dict) and data.get("prompt_id") == sub_prompt_id
            if is_nested and outer_node_id is not None:
                try:
                    for translated_event, payload in _translate_subprompt_event(
                        event, data, sub_prompt_id, outer_node_id, aggregate
                    ):
                        original_send_sync(translated_event, payload, sid)
                except Exception:
                    pass
                return None
            return original_send_sync(event, data, sid)

        server.send_sync = wrapped_send_sync
        try:
            await loop.run_in_executor(
                None,
                lambda: executor.execute(
                    sub_prompt,
                    sub_prompt_id,
                    extra_data=extra_data,
                    execute_outputs=execute_outputs,
                ),
            )
        finally:
            server.send_sync = original_send_sync
            server.client_id = outer_client_id
            if outer_registry is not None:
                progress_module.global_progress_registry = outer_registry

        if not executor.success:
            detail = nested_failure_detail(executor)
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(
                f"Local workflow failed (sub_prompt_id={sub_prompt_id}){suffix}"
            )
        return executor


def _save_files_from(save_output: dict) -> list[dict]:
    if not isinstance(save_output, dict):
        return []
    for key in ("images", "audio", "videos", "gifs", "video", "3d"):
        if save_output.get(key):
            return list(save_output[key])
    return []


def first_saved_image_url(executor, node_id: str = "2") -> str:
    outputs = (executor.history_result or {}).get("outputs", {})
    files = _save_files_from(outputs.get(node_id) or {})
    if not files:
        raise RuntimeError(f"Save node {node_id!r} produced no image files")
    first = files[0]
    return _view_url(
        filename=first.get("filename", ""),
        subfolder=first.get("subfolder", ""),
        type_=first.get("type", "output"),
    )


async def generate_gpt_image_2(
    *,
    prompt: str,
    size: str,
    custom_width: int,
    custom_height: int,
    background: str,
    quality: str,
    seed: int,
    image_url: str,
    auth_token,
    api_key,
    sub_prompt_id: str,
) -> str:
    workflow = build_gpt_image_2_subprompt(
        prompt=prompt,
        size=size,
        custom_width=custom_width,
        custom_height=custom_height,
        background=background,
        quality=quality,
        seed=seed,
        image_url=image_url,
    )
    executor = await run_subprompt(
        workflow,
        sub_prompt_id,
        ["2"],
        auth_token=auth_token,
        api_key=api_key,
    )
    return first_saved_image_url(executor)
