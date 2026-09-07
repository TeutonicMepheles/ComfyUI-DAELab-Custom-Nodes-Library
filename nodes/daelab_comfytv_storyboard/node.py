from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import time
import uuid

import folder_paths
from comfy_api.latest import io

from .runtime import generate_gpt_image_2


LOGGER = logging.getLogger(__name__)

NODE_ID = "DAELAB.ComfyTV.GPTImageStoryboardStage"
WORKFLOW_LABEL = "OpenAI GPT Image 2 (Comfy Credits)"
SIZE_OPTIONS = (
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "2048x2048",
    "2048x1152",
    "1152x2048",
    "3840x2160",
    "2160x3840",
    "Custom",
)
RETRY_DELAYS = (10.0, 20.0)
RESUME_VERSION = 1
RESUME_TTL_SECONDS = 6 * 60 * 60

COMFYTV_IMAGES = io.Custom("COMFYTV_IMAGES")
COMFYTV_IMAGE = io.Custom("COMFYTV_IMAGE")


def storyboard_image_rows(storyboard_data) -> list[dict[str, str]]:
    if storyboard_data in (None, ""):
        data = {}
    else:
        try:
            data = json.loads(storyboard_data) if isinstance(storyboard_data, str) else storyboard_data
        except (TypeError, ValueError) as exc:
            raise ValueError("Storyboard list is not valid JSON") from exc

    shots = data.get("shots") if isinstance(data, dict) else None
    if not isinstance(shots, list) or not shots:
        raise ValueError("Add at least one storyboard shot before running")

    rows: list[dict[str, str]] = []
    missing: list[int] = []
    for index, shot in enumerate(shots, start=1):
        shot = shot if isinstance(shot, dict) else {}
        prompt = str(shot.get("image_prompt") or shot.get("prompt") or "").strip()
        image_url = str(shot.get("image_url") or "").strip()
        if image_url and not image_url.startswith("/view?"):
            raise ValueError(
                f"Reference image for shot {index} must be uploaded to ComfyUI first"
            )
        rows.append(
            {
                "shot_no": str(shot.get("shot_no") or index).strip(),
                "prompt": prompt,
                "camera_notes": str(shot.get("camera_notes") or "").strip(),
                "image_url": image_url,
            }
        )
        if not prompt:
            missing.append(index)
    if missing:
        numbers = ", ".join(str(index) for index in missing)
        raise ValueError(f"Every storyboard shot needs a text prompt; missing shot(s): {numbers}")
    return rows


def validate_custom_size(size: str, width: int, height: int) -> None:
    if size != "Custom":
        return
    if width % 16 or height % 16:
        raise ValueError(f"Custom width and height must be multiples of 16, got {width}x{height}")
    ratio = max(width, height) / min(width, height)
    if ratio > 3:
        raise ValueError(f"Custom resolution aspect ratio must not exceed 3:1, got {width}x{height}")
    pixels = width * height
    if not 655_360 <= pixels <= 8_294_400:
        raise ValueError(
            "Custom resolution total pixels must be between 655,360 and "
            f"8,294,400, got {pixels}"
        )


def _is_transient_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(
        fragment in message
        for fragment in (
            "api server at https://api.comfy.org is currently unreachable",
            "unable to connect to the api server due to local network issues",
        )
    )


def _resume_fingerprint(
    *,
    shots: list[dict],
    size: str,
    width: int,
    height: int,
    background: str,
    quality: str,
    seed: int,
    main_prompt: str,
) -> str:
    data = {
        "version": RESUME_VERSION,
        "shots": shots,
        "size": size,
        "custom_width": width,
        "custom_height": height,
        "background": background,
        "quality": quality,
        "seed": seed,
        "main_prompt": main_prompt,
    }
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _resume_path(unique_id: str) -> str:
    directory = os.path.join(folder_paths.get_temp_directory(), "DAELAB", "storyboard_resume")
    os.makedirs(directory, exist_ok=True)
    safe_id = hashlib.sha256(str(unique_id).encode("utf-8")).hexdigest()
    return os.path.join(directory, f"{safe_id}.json")


def _load_resume(unique_id: str, fingerprint: str) -> list[str]:
    if not unique_id:
        return []
    try:
        with open(_resume_path(unique_id), "r", encoding="utf-8") as file:
            data = json.load(file)
        if data.get("version") != RESUME_VERSION or data.get("fingerprint") != fingerprint:
            return []
        saved_at = float(data.get("saved_at") or 0)
        if saved_at <= 0 or time.time() - saved_at > RESUME_TTL_SECONDS:
            return []
        urls = data.get("image_urls")
        if not isinstance(urls, list):
            return []
        return [str(url) for url in urls if str(url).startswith("/view?")]
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return []


def _store_resume(unique_id: str, fingerprint: str, image_urls: list[str]) -> None:
    if not unique_id:
        return
    path = _resume_path(unique_id)
    temporary_path = f"{path}.{os.getpid()}.tmp"
    data = {
        "version": RESUME_VERSION,
        "fingerprint": fingerprint,
        "saved_at": time.time(),
        "image_urls": image_urls,
    }
    try:
        with open(temporary_path, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary_path, path)
    except OSError:
        with contextlib.suppress(OSError):
            os.remove(temporary_path)
        LOGGER.warning("Could not persist DAELab storyboard resume state", exc_info=True)


def _delete_resume(unique_id: str) -> None:
    if unique_id:
        with contextlib.suppress(OSError):
            os.remove(_resume_path(unique_id))


def _emit_progress(node_class, value: int, total: int, text: str) -> None:
    try:
        node_id = getattr(getattr(node_class, "hidden", None), "unique_id", None)
        from comfy.utils import ProgressBar

        ProgressBar(total, node_id=node_id).update_absolute(value, total)
        if node_id is not None and text:
            from server import PromptServer

            PromptServer.instance.send_progress_text(text, node_id)
    except Exception as exc:
        LOGGER.debug("Storyboard progress update failed: %s", exc)


def _result_row(index: int, shot: dict, image_url: str) -> dict:
    return {
        "index": str(index),
        "label": f"Shot {shot['shot_no']}",
        "shot_no": shot["shot_no"],
        "prompt": shot["prompt"],
        "camera_notes": shot["camera_notes"],
        "image_url": image_url,
    }


class DAELabComfyTVGPTImageStoryboardStage(io.ComfyNode):
    """Generate one Comfy-credit GPT Image 2 image for each storyboard row."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=NODE_ID,
            display_name="DAELAB - GPT Image 2 StoryBoard",
            category="DAELab/ComfyTV",
            description=(
                "DAELab-owned storyboard editor. Runs ComfyUI's OpenAI GPT Image 2 "
                "partner node once per row using signed-in ComfyUI account credits."
            ),
            inputs=[
                io.Int.Input(
                    "force_run_token",
                    default=0,
                    min=0,
                    max=2_147_483_647,
                    step=1,
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.String.Input(
                    "project_id", default="", socketless=True, extra_dict={"hidden": True}
                ),
                io.Int.Input(
                    "parent_output_id",
                    default=0,
                    min=0,
                    max=2_147_483_647,
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.Combo.Input("workflow", options=[WORKFLOW_LABEL], default=WORKFLOW_LABEL),
                io.Combo.Input("size", options=list(SIZE_OPTIONS), default="auto"),
                io.Int.Input("custom_width", default=1024, min=1024, max=3840, step=16),
                io.Int.Input("custom_height", default=1024, min=1024, max=3840, step=16),
                io.Combo.Input("background", options=["auto", "opaque"], default="auto"),
                io.Combo.Input(
                    "quality",
                    options=["low", "medium", "high"],
                    default="low",
                    tooltip="Higher quality consumes more ComfyUI credits.",
                ),
                io.Int.Input("seed", default=0, min=0, max=2_147_483_647, step=1),
                io.String.Input(
                    "main_prompt",
                    default="",
                    multiline=True,
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip="Optional style shared by every storyboard shot.",
                ),
                io.String.Input(
                    "storyboard_data",
                    default="",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip="DAELab storyboard editor state (JSON).",
                ),
                io.Int.Input(
                    "selected_index",
                    default=1,
                    min=1,
                    max=999,
                    step=1,
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.String.Input(
                    "custom_params",
                    default="{}",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[COMFYTV_IMAGES.Output("images"), COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            is_api_node=True,
            hidden=[
                io.Hidden.unique_id,
                io.Hidden.auth_token_comfy_org,
                io.Hidden.api_key_comfy_org,
            ],
        )

    @classmethod
    async def execute(
        cls,
        force_run_token=0,
        project_id="",
        parent_output_id=0,
        workflow=WORKFLOW_LABEL,
        size="auto",
        custom_width=1024,
        custom_height=1024,
        background="auto",
        quality="low",
        seed=0,
        main_prompt="",
        storyboard_data="",
        selected_index=1,
        custom_params="{}",
    ):
        del project_id, parent_output_id, custom_params
        shots = storyboard_image_rows(storyboard_data)
        width = int(custom_width or 1024)
        height = int(custom_height or 1024)
        validate_custom_size(size, width, height)
        if workflow != WORKFLOW_LABEL:
            raise ValueError("This DAELab StoryBoard node only supports its bundled workflow")

        hidden = getattr(cls, "hidden", None)
        auth_token = getattr(hidden, "auth_token_comfy_org", None)
        api_key = getattr(hidden, "api_key_comfy_org", None)
        unique_id = str(getattr(hidden, "unique_id", None) or "")
        if hidden is not None and not auth_token and not api_key:
            raise RuntimeError(
                "ComfyUI account authentication was not attached to the DAELab StoryBoard "
                "request. Sign in to ComfyUI and queue this node through the normal ComfyUI "
                "Run button. No OpenAI API key is required."
            )

        fingerprint = _resume_fingerprint(
            shots=shots,
            size=size,
            width=width,
            height=height,
            background=background,
            quality=quality,
            seed=int(seed or 0),
            main_prompt=str(main_prompt or ""),
        )
        resumed_urls = _load_resume(unique_id, fingerprint)
        if len(resumed_urls) > len(shots):
            resumed_urls = []
        results = [
            _result_row(index, shots[index - 1], url)
            for index, url in enumerate(resumed_urls, start=1)
        ]

        for index, shot in enumerate(shots, start=1):
            if index <= len(results):
                _emit_progress(cls, index, len(shots), f"DAELab StoryBoard · reused {index}/{len(shots)}")
                continue
            prompt_parts = [str(main_prompt or "").strip(), shot["prompt"]]
            if shot["camera_notes"]:
                prompt_parts.append(f"Camera notes: {shot['camera_notes']}")
            full_prompt = "\n".join(part for part in prompt_parts if part)
            shot_seed = (
                int(seed or 0) + int(force_run_token or 0) * 1009 + index - 1
            ) % 2_147_483_648
            _emit_progress(cls, index - 1, len(shots), f"DAELab StoryBoard · shot {index}/{len(shots)}")

            attempt = 0
            while True:
                sub_prompt_id = f"daelab-storyboard-{uuid.uuid4().hex[:8]}"
                try:
                    image_url = await generate_gpt_image_2(
                        prompt=full_prompt,
                        size=size,
                        custom_width=width,
                        custom_height=height,
                        background=background,
                        quality=quality,
                        seed=shot_seed,
                        image_url=shot["image_url"],
                        auth_token=auth_token,
                        api_key=api_key,
                        sub_prompt_id=sub_prompt_id,
                    )
                    break
                except Exception as exc:
                    if attempt >= len(RETRY_DELAYS) or not _is_transient_error(exc):
                        raise RuntimeError(
                            f"DAELab GPT Image 2 storyboard failed at shot "
                            f"{index}/{len(shots)}: {exc}"
                        ) from exc
                    delay = RETRY_DELAYS[attempt]
                    attempt += 1
                    _emit_progress(
                        cls,
                        index - 1,
                        len(shots),
                        f"DAELab StoryBoard · retry {attempt}/{len(RETRY_DELAYS)} in {int(delay)}s",
                    )
                    await asyncio.sleep(delay)

            results.append(_result_row(index, shot, image_url))
            _store_resume(unique_id, fingerprint, [row["image_url"] for row in results])

        _delete_resume(unique_id)
        payload = json.dumps({"images": results}, ensure_ascii=False)
        picked_index = max(1, min(int(selected_index or 1), len(results)))
        picked_url = results[picked_index - 1]["image_url"]
        _emit_progress(cls, len(shots), len(shots), "DAELab StoryBoard · done")
        return io.NodeOutput(
            payload,
            picked_url,
            ui={
                "output": [payload],
                "picked": [picked_url],
                "picked_index": [picked_index],
            },
        )


NODE_CLASS_MAPPINGS = {
    "DAELAB.ComfyTV.GPTImageStoryboardStage": DAELabComfyTVGPTImageStoryboardStage,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.ComfyTV.GPTImageStoryboardStage": "DAELAB - GPT Image 2 StoryBoard",
}
