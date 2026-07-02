import hashlib
import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths


def _empty_boxes_prompt():
    return {"boxes": [], "labels": []}


def _load_image_tensor(image_name):
    image_path = folder_paths.get_annotated_filepath(image_name)

    image = Image.open(image_path)
    output_images = []

    excluded_formats = ["MPO"]
    for frame in ImageSequence.Iterator(image):
        frame = ImageOps.exif_transpose(frame)

        if frame.mode == "I":
            frame = frame.point(lambda i: i * (1 / 255))

        frame = frame.convert("RGB")
        image_np = np.array(frame).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_np)[None,]

        if len(output_images) > 0 and output_images[0].shape[1:] != image_tensor.shape[1:]:
            continue

        output_images.append(image_tensor)

        if image.format in excluded_formats:
            break

    if not output_images:
        raise ValueError(f"No image frames could be loaded from '{image_name}'")

    return torch.cat(output_images, dim=0)


def _normalize_box(box):
    if isinstance(box, dict):
        x = float(box.get("x", 0))
        y = float(box.get("y", 0))
        w = float(box.get("w", 0))
        h = float(box.get("h", 0))
        x1 = min(x, x + w)
        y1 = min(y, y + h)
        x2 = max(x, x + w)
        y2 = max(y, y + h)
    elif isinstance(box, (list, tuple)) and len(box) >= 4:
        x1, y1, x2, y2 = [float(v) for v in box[:4]]
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
    else:
        return None

    if x2 <= x1 or y2 <= y1:
        return None

    return [x1, y1, x2, y2]


def _parse_boxes(info, key):
    boxes = info.get(key, [])
    if boxes is None:
        return []

    parsed = []
    if isinstance(boxes, list):
        for box in boxes:
            normalized = _normalize_box(box)
            if normalized is not None:
                parsed.append(normalized)

    return parsed


def _boxes_to_sam3_prompt(boxes, image_tensor, label):
    height = float(image_tensor.shape[1])
    width = float(image_tensor.shape[2])
    prompt_boxes = []
    labels = []

    if width <= 0 or height <= 0:
        return {"boxes": prompt_boxes, "labels": labels}

    for x1, y1, x2, y2 in boxes:
        x1_norm = x1 / width
        y1_norm = y1 / height
        x2_norm = x2 / width
        y2_norm = y2 / height

        center_x = (x1_norm + x2_norm) / 2.0
        center_y = (y1_norm + y2_norm) / 2.0
        box_width = x2_norm - x1_norm
        box_height = y2_norm - y1_norm

        prompt_boxes.append([center_x, center_y, box_width, box_height])
        labels.append(label)

    return {"boxes": prompt_boxes, "labels": labels}


def _get_node_bbox_info(unique_id, extra_pnginfo):
    node = _get_workflow_node(unique_id, extra_pnginfo)
    if node is None:
        return {}

    properties = node.get("properties", {})
    bbox_info = properties.get("bbox_info", "")
    if isinstance(bbox_info, str) and bbox_info:
        try:
            return json.loads(bbox_info)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid stored bbox_info JSON: {exc}") from exc
    if isinstance(bbox_info, dict):
        return bbox_info

    return {}


def _get_workflow_node(unique_id, extra_pnginfo):
    if not extra_pnginfo:
        return None

    workflow = extra_pnginfo.get("workflow", {})
    nodes = workflow.get("nodes", [])
    node_id = str(unique_id)

    for node in nodes:
        if str(node.get("id")) != node_id:
            continue

        return node

    return None


def _get_node_properties(unique_id, extra_pnginfo):
    node = _get_workflow_node(unique_id, extra_pnginfo)
    if node is None:
        return {}

    properties = node.get("properties", {})
    return properties if isinstance(properties, dict) else {}


def _resolve_string_value(unique_id, extra_pnginfo, string_value):
    if string_value is not None:
        return str(string_value)

    properties = _get_node_properties(unique_id, extra_pnginfo)
    return str(properties.get("string_value", ""))


class LoadImageBooleanBBox:
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])

        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "optional": {
                "string_value": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "User-defined string value to output from this node.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    DESCRIPTION = "Load an image and draw positive/negative bounding boxes for SAM3."
    RETURN_TYPES = (
        "IMAGE",
        "SAM3_BOXES_PROMPT",
        "SAM3_BOXES_PROMPT",
        "STRING",
    )
    RETURN_NAMES = (
        "image",
        "bboxes",
        "neg_bboxes",
        "string",
    )
    FUNCTION = "execute"
    CATEGORY = "image/bbox"
    SEARCH_ALIASES = ["load image bbox", "bbox loader", "neg bbox"]

    def execute(
        self,
        image,
        string_value=None,
        unique_id=None,
        extra_pnginfo=None,
    ):
        image_tensor = _load_image_tensor(image)
        info = _get_node_bbox_info(unique_id, extra_pnginfo)

        bbox = _parse_boxes(info, "bbox")
        neg_bbox = _parse_boxes(info, "neg_bbox")

        bboxes_prompt = _boxes_to_sam3_prompt(bbox, image_tensor, True)
        neg_bboxes_prompt = _boxes_to_sam3_prompt(neg_bbox, image_tensor, False)

        return (
            image_tensor,
            bboxes_prompt,
            neg_bboxes_prompt,
            _resolve_string_value(unique_id, extra_pnginfo, string_value),
        )

    @classmethod
    def IS_CHANGED(
        cls,
        image,
        string_value=None,
        unique_id=None,
        extra_pnginfo=None,
    ):
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as file:
            digest.update(file.read())
        digest.update(_resolve_string_value(unique_id, extra_pnginfo, string_value).encode("utf-8"))
        bbox_info = _get_node_bbox_info(unique_id, extra_pnginfo)
        digest.update(json.dumps(bbox_info, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


class BBoxPromptReroute:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "bboxes": (
                    "SAM3_BOXES_PROMPT",
                    {
                        "tooltip": "Positive bbox prompt to pass through.",
                    },
                ),
                "neg_bboxes": (
                    "SAM3_BOXES_PROMPT",
                    {
                        "tooltip": "Negative bbox prompt to pass through.",
                    },
                ),
            },
        }

    DESCRIPTION = "Reroute paired positive and negative SAM3 bbox prompts."
    RETURN_TYPES = ("SAM3_BOXES_PROMPT", "SAM3_BOXES_PROMPT")
    RETURN_NAMES = ("bboxes", "neg_bboxes")
    FUNCTION = "execute"
    CATEGORY = "image/bbox"
    SEARCH_ALIASES = ["bbox reroute", "bboxes reroute", "neg bboxes reroute", "sam3 bbox reroute"]

    def execute(self, bboxes=None, neg_bboxes=None):
        return (
            bboxes if bboxes is not None else _empty_boxes_prompt(),
            neg_bboxes if neg_bboxes is not None else _empty_boxes_prompt(),
        )


NODE_CLASS_MAPPINGS = {
    "LoadImageBooleanBBox": LoadImageBooleanBBox,
    "BBoxPromptReroute": BBoxPromptReroute,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageBooleanBBox": "Load Image + BBox",
    "BBoxPromptReroute": "BBox Prompt Reroute",
}
