import json

from ..load_image_polygon_mask.node import (
    _empty_mask_for_image,
    _has_sam3_prompt_content,
    _pil_to_base64,
    _pil_to_tensor,
    _run_sam3_prompts,
    _tensor_to_pil,
)


COLLECTOR_MODE_BBOX = "bbox"
COLLECTOR_MODE_INTERACTIVE = "interactive"


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

    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2}


def _bbox_store_to_prompts(bboxes, neg_bboxes):
    positive_boxes = [_normalize_bbox(box) for box in _parse_json_list(bboxes, "bboxes")]
    negative_boxes = [_normalize_bbox(box) for box in _parse_json_list(neg_bboxes, "neg_bboxes")]
    positive_boxes = [box for box in positive_boxes if box is not None]
    negative_boxes = [box for box in negative_boxes if box is not None]

    prompts = []
    for index, box in enumerate(positive_boxes):
        prompts.append(
            {
                "name": f"BBox {index + 1}",
                "positive_points": [],
                "negative_points": [],
                "positive_boxes": [box],
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
            }
        }

    DESCRIPTION = "Collect SAM3 bbox or interactive prompts in one tabbed node and output masks plus visualization."
    RETURN_TYPES = ("MASK", "IMAGE")
    RETURN_NAMES = ("masks", "visualization")
    FUNCTION = "execute"
    CATEGORY = "SAM3"
    SEARCH_ALIASES = ["sam3 complex collector", "sam3 bbox interactive collector", "sam3 collector"]

    def execute(
        self,
        sam3_model_config,
        image,
        collector_mode=COLLECTOR_MODE_BBOX,
        bboxes="[]",
        neg_bboxes="[]",
        multi_prompts_store="[]",
    ):
        mode = str(collector_mode or COLLECTOR_MODE_BBOX).strip().lower()

        if mode == COLLECTOR_MODE_INTERACTIVE:
            raw_prompts = _parse_json_list(multi_prompts_store, "multi_prompts_store")
        else:
            raw_prompts = _bbox_store_to_prompts(bboxes, neg_bboxes)

        if not _has_sam3_prompt_content(raw_prompts):
            masks, visualization, pil_image = _empty_result(image)
        else:
            masks, visualization = _run_sam3_prompts(sam3_model_config, image, json.dumps(raw_prompts))
            pil_image = _tensor_to_pil(visualization[0])

        return {
            "result": (masks, visualization),
            "ui": {
                "bg_image": [_pil_to_base64(_tensor_to_pil(image[0]))],
                "overlay_image": [_pil_to_base64(pil_image)],
            },
        }


NODE_CLASS_MAPPINGS = {
    "SAM3ComplexCollector": SAM3ComplexCollector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SAM3ComplexCollector": "SAM3 Complex Collector",
}
