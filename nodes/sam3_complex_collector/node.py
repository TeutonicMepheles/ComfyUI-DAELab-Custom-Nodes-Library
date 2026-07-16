import asyncio
import hashlib
import json
import threading
import time
import uuid
from collections import OrderedDict

from aiohttp import web
from server import PromptServer

from .._shared_sam3 import (
    _empty_mask_for_image,
    _has_sam3_prompt_content,
    _pil_to_base64,
    _pil_to_tensor,
    _prepare_sam3_session,
    _render_sam3_session_results,
    _run_sam3_session_prompts,
    _tensor_to_pil,
)


COLLECTOR_MODE_BBOX = "bbox"
COLLECTOR_MODE_INTERACTIVE = "interactive"
_SESSION_CACHE_MAX = 2
_SESSION_CACHE_TTL_SECONDS = 10 * 60
_SESSION_CACHE = OrderedDict()
_SESSION_CACHE_LOCK = threading.RLock()
_SEGMENT_LOCK = threading.Lock()


class _CacheMissError(Exception):
    pass


def _prompt_key(prompt, index=0):
    prompt_id = prompt.get("id") if isinstance(prompt, dict) else None
    return str(prompt_id or f"legacy-prompt-{index}")


def _prompt_fingerprint(prompt):
    content = {
        key: prompt.get(key, []) if isinstance(prompt, dict) else []
        for key in ("positive_points", "negative_points", "positive_boxes", "negative_boxes")
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _prune_session_cache(now=None):
    now = time.monotonic() if now is None else now
    with _SESSION_CACHE_LOCK:
        expired = [
            token
            for token, entry in _SESSION_CACHE.items()
            if now - entry["last_access"] >= _SESSION_CACHE_TTL_SECONDS
        ]
        for token in expired:
            _SESSION_CACHE.pop(token, None)
        while len(_SESSION_CACHE) > _SESSION_CACHE_MAX:
            _SESSION_CACHE.popitem(last=False)


def _store_session(session, prompt_results, unique_id=None):
    token = uuid.uuid4().hex
    now = time.monotonic()
    entry = {
        "token": token,
        "unique_id": str(unique_id or ""),
        "session": session,
        "prompt_results": prompt_results,
        "last_access": now,
    }
    with _SESSION_CACHE_LOCK:
        _SESSION_CACHE[token] = entry
        _SESSION_CACHE.move_to_end(token)
        while len(_SESSION_CACHE) > _SESSION_CACHE_MAX:
            _SESSION_CACHE.popitem(last=False)
    return token


def _get_session(token):
    _prune_session_cache()
    with _SESSION_CACHE_LOCK:
        entry = _SESSION_CACHE.get(str(token or ""))
        if entry is None:
            raise _CacheMissError("Interactive session is missing or expired.")
        entry["last_access"] = time.monotonic()
        _SESSION_CACHE.move_to_end(entry["token"])
        return entry


def _flatten_prompt_results(prompt_results, prompts):
    all_masks = []
    all_scores = []
    for index, prompt in enumerate(prompts):
        result = prompt_results.get(_prompt_key(prompt, index))
        if not result:
            continue
        all_masks.extend(result["masks"])
        all_scores.extend(result["scores"])
    return all_masks, all_scores


def _segment_cached_prompt(entry, prompts, active_prompt_id=None, run_scope="active"):
    if not isinstance(prompts, list):
        raise ValueError("prompts must be a list")
    if run_scope not in ("active", "all"):
        raise ValueError("run_scope must be 'active' or 'all'")

    prompt_map = {_prompt_key(prompt, index): prompt for index, prompt in enumerate(prompts) if isinstance(prompt, dict)}
    if not prompt_map:
        raise ValueError("prompts must contain at least one prompt")

    with _SEGMENT_LOCK:
        prompt_results = entry["prompt_results"]
        valid_ids = set(prompt_map)
        for prompt_id in list(prompt_results):
            prompt = prompt_map.get(prompt_id)
            if prompt_id not in valid_ids or prompt_results[prompt_id]["fingerprint"] != _prompt_fingerprint(prompt):
                prompt_results.pop(prompt_id, None)

        if run_scope == "active":
            active_prompt_id = str(active_prompt_id or "")
            active_prompt = prompt_map.get(active_prompt_id)
            if active_prompt is None:
                raise ValueError("active_prompt_id does not identify a current prompt")
            if not _has_sam3_prompt_content([active_prompt]):
                raise ValueError("The active prompt has no points or boxes")
            targets = [(active_prompt_id, active_prompt)]
        else:
            targets = [
                (prompt_id, prompt)
                for prompt_id, prompt in prompt_map.items()
                if prompt_id not in prompt_results
            ]

        computed_masks = 0
        for prompt_id, prompt in targets:
            if not _has_sam3_prompt_content([prompt]):
                continue
            masks, scores = _run_sam3_session_prompts(entry["session"], [prompt])
            prompt_results[prompt_id] = {
                "fingerprint": _prompt_fingerprint(prompt),
                "masks": masks,
                "scores": scores,
            }
            computed_masks += len(masks)

        all_masks, all_scores = _flatten_prompt_results(prompt_results, prompts)
        _, _, overlay = _render_sam3_session_results(entry["session"], all_masks, all_scores)

    entry["last_access"] = time.monotonic()
    return {
        "overlay": _pil_to_base64(overlay),
        "num_masks": len(all_masks),
        "computed_masks": computed_masks,
    }


def _prompt_queue_is_busy():
    prompt_queue = getattr(PromptServer.instance, "prompt_queue", None)
    return bool(prompt_queue and prompt_queue.get_tasks_remaining() > 0)


@PromptServer.instance.routes.post("/daelab/sam3-complex/segment")
async def sam3_complex_segment(request):
    if _prompt_queue_is_busy():
        return web.json_response(
            {"error": "workflow_busy", "message": "A ComfyUI workflow is currently running or queued."},
            status=409,
        )

    try:
        body = await request.json()
        entry = _get_session(body.get("cache_token"))
        result = await asyncio.to_thread(
            _segment_cached_prompt,
            entry,
            body.get("prompts"),
            body.get("active_prompt_id"),
            body.get("run_scope", "active"),
        )
        return web.json_response(result)
    except _CacheMissError as exc:
        return web.json_response({"error": "cache_miss", "message": str(exc)}, status=404)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        return web.json_response({"error": "invalid_request", "message": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"error": "segment_failed", "message": str(exc)}, status=500)


def _parse_json_list(value, input_name):
    if not value:
        return []

    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid {input_name} JSON: {exc}") from exc

    return parsed if isinstance(parsed, list) else []


def _normalize_bbox(box):
    if not isinstance(box, dict):
        return None

    try:
        if all(key in box for key in ("x1", "y1", "x2", "y2")):
            x1 = float(box.get("x1", 0))
            y1 = float(box.get("y1", 0))
            x2 = float(box.get("x2", 0))
            y2 = float(box.get("y2", 0))
        else:
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
            x1 = x
            y1 = y
            x2 = x + w
            y2 = y + h
    except (TypeError, ValueError):
        return None

    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    if x2 <= x1 or y2 <= y1:
        return None

    normalized = {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
    if box.get("id"):
        normalized["id"] = str(box["id"])
    return normalized


def _bbox_store_to_prompts(bboxes, neg_bboxes):
    positive_boxes = [_normalize_bbox(box) for box in _parse_json_list(bboxes, "bboxes")]
    negative_boxes = [_normalize_bbox(box) for box in _parse_json_list(neg_bboxes, "neg_bboxes")]
    positive_boxes = [box for box in positive_boxes if box is not None]
    negative_boxes = [box for box in negative_boxes if box is not None]

    prompts = []
    for index, box in enumerate(positive_boxes):
        box_id = str(box.get("id") or f"legacy-{index}")
        prompts.append(
            {
                "id": f"bbox:{box_id}",
                "name": f"BBox {index + 1}",
                "positive_points": [],
                "negative_points": [],
                "positive_boxes": [{key: box[key] for key in ("x1", "y1", "x2", "y2")}],
                "negative_boxes": [dict(neg_box) for neg_box in negative_boxes],
            }
        )

    return prompts


def _empty_result(image):
    pil_image = _tensor_to_pil(image[0])
    return _empty_mask_for_image(image), _pil_to_tensor(pil_image), pil_image


class SAM3ComplexCollector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sam3_model_config": (
                    "SAM3_MODEL_CONFIG",
                    {
                        "tooltip": "SAM3 model config from LoadSAM3Model.",
                    },
                ),
                "image": (
                    "IMAGE",
                    {
                        "tooltip": "Image to annotate with the active SAM3 collector.",
                    },
                ),
                "collector_mode": (
                    [COLLECTOR_MODE_BBOX, COLLECTOR_MODE_INTERACTIVE],
                    {
                        "default": COLLECTOR_MODE_BBOX,
                        "advanced": True,
                        "tooltip": "Internal UI state: active collector tab.",
                    },
                ),
                "bboxes": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Internal BBox Collector positive boxes.",
                    },
                ),
                "neg_bboxes": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Internal BBox Collector negative boxes.",
                    },
                ),
                "multi_prompts_store": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Internal Interactive Collector prompt data.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    DESCRIPTION = "Collect SAM3 bbox or interactive prompts in one tabbed node and output masks plus visualization."
    RETURN_TYPES = ("MASK", "IMAGE")
    RETURN_NAMES = ("masks", "visualization")
    FUNCTION = "execute"
    CATEGORY = "SAM3"
    OUTPUT_NODE = True
    SEARCH_ALIASES = ["sam3 complex collector", "sam3 bbox interactive collector", "sam3 collector"]

    def execute(
        self,
        sam3_model_config,
        image,
        collector_mode=COLLECTOR_MODE_BBOX,
        bboxes="[]",
        neg_bboxes="[]",
        multi_prompts_store="[]",
        unique_id=None,
    ):
        mode = str(collector_mode or COLLECTOR_MODE_BBOX).strip().lower()

        if mode == COLLECTOR_MODE_INTERACTIVE:
            raw_prompts = _parse_json_list(multi_prompts_store, "multi_prompts_store")
        else:
            raw_prompts = _bbox_store_to_prompts(bboxes, neg_bboxes)

        cache_token = None
        if not _has_sam3_prompt_content(raw_prompts):
            masks, visualization, pil_image = _empty_result(image)
        else:
            with _SEGMENT_LOCK:
                session = _prepare_sam3_session(sam3_model_config, image)
                prompt_results = {}
                for index, prompt in enumerate(raw_prompts):
                    if not isinstance(prompt, dict) or not _has_sam3_prompt_content([prompt]):
                        continue
                    prompt_masks, prompt_scores = _run_sam3_session_prompts(session, [prompt])
                    prompt_results[_prompt_key(prompt, index)] = {
                        "fingerprint": _prompt_fingerprint(prompt),
                        "masks": prompt_masks,
                        "scores": prompt_scores,
                    }
                all_masks, all_scores = _flatten_prompt_results(prompt_results, raw_prompts)
                masks, visualization, pil_image = _render_sam3_session_results(session, all_masks, all_scores)
                cache_token = _store_session(session, prompt_results, unique_id=unique_id)

        ui = {
            "bg_image": [_pil_to_base64(_tensor_to_pil(image[0]))],
            "overlay_image": [_pil_to_base64(pil_image)],
        }
        if cache_token:
            ui["cache_token"] = [cache_token]

        return {
            "result": (masks, visualization),
            "ui": ui,
        }


NODE_CLASS_MAPPINGS = {
    "SAM3ComplexCollector": SAM3ComplexCollector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SAM3ComplexCollector": "SAM3 Complex Collector",
}
