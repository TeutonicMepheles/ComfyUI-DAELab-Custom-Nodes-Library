import hashlib
import importlib
import json
import math
import os
import re
import sys
import types
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps, ImageSequence

import folder_paths


MIN_VERTEX_COUNT = 3
MAX_VERTEX_COUNT = 12
DEFAULT_COLOR = "#FF0000"
DEFAULT_POLYGON_RADIUS_RATIO = 0.08
_SAM3_PACKAGE_ALIAS = "_daelab_external_comfyui_sam3_nodes"


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


def _get_workflow_node(unique_id, extra_pnginfo):
    if not extra_pnginfo:
        return None

    workflow = extra_pnginfo.get("workflow", {})
    nodes = workflow.get("nodes", [])
    node_id = str(unique_id)

    for node in nodes:
        if str(node.get("id")) == node_id:
            return node

    return None


def _get_node_properties(unique_id, extra_pnginfo):
    node = _get_workflow_node(unique_id, extra_pnginfo)
    if node is None:
        return {}

    properties = node.get("properties", {})
    return properties if isinstance(properties, dict) else {}


def _get_node_polygon_info(unique_id, extra_pnginfo):
    properties = _get_node_properties(unique_id, extra_pnginfo)
    polygon_info = properties.get("polygon_info", "")

    if isinstance(polygon_info, str) and polygon_info:
        try:
            parsed = json.loads(polygon_info)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid stored polygon_info JSON: {exc}") from exc
        return parsed if isinstance(parsed, dict) else {}

    if isinstance(polygon_info, dict):
        return polygon_info

    return {}


def _clamp_int(value, min_value, max_value, default):
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, numeric))


def _parse_color_component(value):
    numeric = int(float(value))
    return max(0, min(255, numeric))


def _parse_color(color):
    value = str(color or DEFAULT_COLOR).strip()
    hex_match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value)
    if hex_match:
        hex_value = hex_match.group(1)
        return (
            int(hex_value[0:2], 16),
            int(hex_value[2:4], 16),
            int(hex_value[4:6], 16),
        )

    short_hex_match = re.fullmatch(r"#?([0-9a-fA-F]{3})", value)
    if short_hex_match:
        hex_value = short_hex_match.group(1)
        return tuple(int(channel * 2, 16) for channel in hex_value)

    number_values = re.findall(r"-?\d+(?:\.\d+)?", value)
    if len(number_values) >= 3:
        return tuple(_parse_color_component(component) for component in number_values[:3])

    return (255, 0, 0)


def _normalize_point(point, width, height):
    if isinstance(point, dict):
        x = point.get("x", 0)
        y = point.get("y", 0)
    elif isinstance(point, (list, tuple)) and len(point) >= 2:
        x, y = point[:2]
    else:
        return None

    try:
        x = float(x)
        y = float(y)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(x) or not math.isfinite(y):
        return None

    return {
        "x": max(0.0, min(float(width), x)),
        "y": max(0.0, min(float(height), y)),
    }


def _parse_polygon_points_from_value(points, width, height):
    if not isinstance(points, list):
        return []

    parsed = []
    for point in points:
        normalized = _normalize_point(point, width, height)
        if normalized is not None:
            parsed.append(normalized)

    return parsed if len(parsed) >= MIN_VERTEX_COUNT else []


def _parse_polygons(info, width, height):
    parsed_polygons = []

    polygons = info.get("polygons")
    if isinstance(polygons, list):
        for polygon in polygons:
            points = polygon.get("points") if isinstance(polygon, dict) else polygon
            parsed_points = _parse_polygon_points_from_value(points, width, height)
            if parsed_points:
                parsed_polygons.append(parsed_points)
        return parsed_polygons

    parsed_points = _parse_polygon_points_from_value(info.get("points"), width, height)
    if parsed_points:
        parsed_polygons.append(parsed_points)

    return parsed_polygons


def _default_polygon_points(width, height, vertex_count):
    count = _clamp_int(vertex_count, MIN_VERTEX_COUNT, MAX_VERTEX_COUNT, MIN_VERTEX_COUNT)
    radius = min(width, height) * DEFAULT_POLYGON_RADIUS_RATIO
    center_x = width / 2.0
    center_y = height / 2.0
    points = []

    for index in range(count):
        angle = -math.pi / 2.0 + (math.pi * 2.0 * index / count)
        points.append(
            {
                "x": center_x + math.cos(angle) * radius,
                "y": center_y + math.sin(angle) * radius,
            }
        )

    return points


def _tensor_to_pil(image_tensor):
    image_np = np.clip(255.0 * image_tensor.cpu().numpy(), 0, 255).astype(np.uint8)
    return Image.fromarray(image_np).convert("RGB")


def _pil_to_tensor(image):
    image_np = np.array(image.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(image_np)[None,]


def _pil_to_base64(image):
    import base64
    import io

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _empty_mask_for_image(image_tensor):
    return torch.zeros(1, int(image_tensor.shape[1]), int(image_tensor.shape[2]), dtype=torch.float32)


def _parse_sam3_prompts(value):
    if not value:
        return []

    try:
        prompts = json.loads(str(value))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid sam3_prompts_data JSON: {exc}") from exc

    return prompts if isinstance(prompts, list) else []


def _has_sam3_prompt_content(prompts):
    for prompt in prompts:
        if not isinstance(prompt, dict):
            continue
        for key in ("positive_points", "negative_points", "positive_boxes", "negative_boxes"):
            if isinstance(prompt.get(key), list) and prompt[key]:
                return True
    return False


def _find_sam3_nodes_dir():
    custom_nodes_dir = Path(__file__).resolve().parents[3]
    sam3_nodes_dir = custom_nodes_dir / "comfyui-sam3" / "nodes"
    if sam3_nodes_dir.exists():
        return sam3_nodes_dir
    return None


def _load_sam3_modules():
    if _SAM3_PACKAGE_ALIAS in sys.modules:
        return (
            importlib.import_module(f"{_SAM3_PACKAGE_ALIAS}._model_cache"),
            importlib.import_module(f"{_SAM3_PACKAGE_ALIAS}.utils"),
        )

    sam3_nodes_dir = _find_sam3_nodes_dir()
    if sam3_nodes_dir is None:
        raise RuntimeError("comfyui-sam3 is required for SAM3 prompt output. Install and enable custom_nodes/comfyui-sam3.")

    package = types.ModuleType(_SAM3_PACKAGE_ALIAS)
    package.__path__ = [str(sam3_nodes_dir)]
    package.__file__ = str(sam3_nodes_dir / "__init__.py")
    sys.modules[_SAM3_PACKAGE_ALIAS] = package

    return (
        importlib.import_module(f"{_SAM3_PACKAGE_ALIAS}._model_cache"),
        importlib.import_module(f"{_SAM3_PACKAGE_ALIAS}.utils"),
    )


def _normalize_sam3_prompts(raw_prompts, img_w, img_h):
    multi_prompts = []
    for idx, raw in enumerate(raw_prompts):
        if not isinstance(raw, dict):
            continue

        prompt = {
            "id": idx,
            "positive_points": {"points": [], "labels": []},
            "negative_points": {"points": [], "labels": []},
            "positive_boxes": {"boxes": [], "labels": []},
            "negative_boxes": {"boxes": [], "labels": []},
        }

        for pt in raw.get("positive_points", []):
            prompt["positive_points"]["points"].append([pt["x"] / img_w, pt["y"] / img_h])
            prompt["positive_points"]["labels"].append(1)
        for pt in raw.get("negative_points", []):
            prompt["negative_points"]["points"].append([pt["x"] / img_w, pt["y"] / img_h])
            prompt["negative_points"]["labels"].append(0)
        for box in raw.get("positive_boxes", []):
            x1n, y1n = box["x1"] / img_w, box["y1"] / img_h
            x2n, y2n = box["x2"] / img_w, box["y2"] / img_h
            prompt["positive_boxes"]["boxes"].append([(x1n + x2n) / 2, (y1n + y2n) / 2, x2n - x1n, y2n - y1n])
            prompt["positive_boxes"]["labels"].append(True)
        for box in raw.get("negative_boxes", []):
            x1n, y1n = box["x1"] / img_w, box["y1"] / img_h
            x2n, y2n = box["x2"] / img_w, box["y2"] / img_h
            prompt["negative_boxes"]["boxes"].append([(x1n + x2n) / 2, (y1n + y2n) / 2, x2n - x1n, y2n - y1n])
            prompt["negative_boxes"]["labels"].append(False)

        has_content = (
            prompt["positive_points"]["points"]
            or prompt["negative_points"]["points"]
            or prompt["positive_boxes"]["boxes"]
            or prompt["negative_boxes"]["boxes"]
        )
        if has_content:
            multi_prompts.append(prompt)

    return multi_prompts


def _run_sam3_prompt_masks(model, state, multi_prompts, img_w, img_h):
    import comfy.model_management
    import comfy.utils

    all_masks = []
    all_scores = []
    pbar = comfy.utils.ProgressBar(len(multi_prompts))

    for prompt in multi_prompts:
        comfy.model_management.throw_exception_if_processing_interrupted()
        points = []
        labels = []
        for pt in prompt["positive_points"]["points"]:
            points.append([pt[0] * img_w, pt[1] * img_h])
            labels.append(1)
        for pt in prompt["negative_points"]["points"]:
            points.append([pt[0] * img_w, pt[1] * img_h])
            labels.append(0)

        box_array = None
        pos_boxes = prompt.get("positive_boxes", {}).get("boxes", [])
        if pos_boxes:
            cx, cy, width, height = pos_boxes[0]
            box_array = np.array([
                (cx - width / 2) * img_w,
                (cy - height / 2) * img_h,
                (cx + width / 2) * img_w,
                (cy + height / 2) * img_h,
            ])

        point_coords = np.array(points) if points else None
        point_labels = np.array(labels) if labels else None
        if point_coords is None and box_array is None:
            continue

        masks_np, scores_np, _ = model.predict_inst(
            state,
            point_coords=point_coords,
            point_labels=point_labels,
            box=box_array,
            mask_input=None,
            multimask_output=True,
            normalize_coords=True,
        )
        best_idx = np.argmax(scores_np)
        all_masks.append(torch.from_numpy(masks_np[best_idx]).float())
        all_scores.append(scores_np[best_idx])
        pbar.update(1)

    return all_masks, all_scores


def _run_sam3_prompts(sam3_model_config, image_tensor, sam3_prompts_data):
    raw_prompts = _parse_sam3_prompts(sam3_prompts_data)
    pil_image = _tensor_to_pil(image_tensor[0])
    empty_mask = _empty_mask_for_image(image_tensor)
    source_vis = _pil_to_tensor(pil_image)

    if not _has_sam3_prompt_content(raw_prompts):
        return empty_mask, source_vis

    if sam3_model_config is None:
        raise ValueError("sam3_model_config is required when sam3_prompts_data contains prompt points or boxes.")

    try:
        model_cache, utils = _load_sam3_modules()
    except Exception as exc:
        raise RuntimeError("Unable to use comfyui-sam3. Ensure custom_nodes/comfyui-sam3 is installed and enabled.") from exc

    import comfy.model_management

    sam3_model = model_cache.get_or_build_model(sam3_model_config)
    comfy.model_management.load_models_gpu([sam3_model])

    processor = sam3_model.processor
    model = processor.model
    if hasattr(processor, "sync_device_with_model"):
        processor.sync_device_with_model()

    state = processor.set_image(pil_image)
    img_w, img_h = pil_image.size
    multi_prompts = _normalize_sam3_prompts(raw_prompts, img_w, img_h)
    all_masks, all_scores = _run_sam3_prompt_masks(model, state, multi_prompts, img_w, img_h)

    if not all_masks:
        return empty_mask, source_vis

    masks = torch.stack(all_masks, dim=0)
    scores = torch.tensor(all_scores)
    boxes_list = []
    for index in range(masks.shape[0]):
        coords = torch.where(masks[index] > 0)
        if len(coords[0]) > 0:
            boxes_list.append([coords[1].min().item(), coords[0].min().item(), coords[1].max().item(), coords[0].max().item()])
        else:
            boxes_list.append([0, 0, 0, 0])
    boxes = torch.tensor(boxes_list).float()

    masks_out = utils.masks_to_comfy_mask(masks)
    vis_image = utils.visualize_masks_on_image(pil_image, masks, boxes, scores, alpha=0.5)
    return masks_out, utils.pil_to_comfy_image(vis_image)


def _draw_polygons_on_image(image, polygons, color, fill_opacity, outline_width):
    if not polygons:
        return image

    rgb = _parse_color(color)
    opacity = _clamp_int(fill_opacity, 0, 100, 35)
    line_width = _clamp_int(outline_width, 0, 20, 3)

    base = image.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for points in polygons:
        if len(points) < MIN_VERTEX_COUNT:
            continue

        xy = [(point["x"], point["y"]) for point in points]

        if opacity > 0:
            draw.polygon(xy, fill=(*rgb, round(255 * opacity / 100)))
        if line_width > 0:
            draw.line(xy + [xy[0]], fill=(*rgb, 255), width=line_width, joint="curve")

    return Image.alpha_composite(base, overlay).convert("RGB")


class LoadImagePolygonMask:
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])

        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "vertex_count": (
                    "INT",
                    {
                        "default": MIN_VERTEX_COUNT,
                        "min": MIN_VERTEX_COUNT,
                        "max": MAX_VERTEX_COUNT,
                        "step": 1,
                        "display": "slider",
                    },
                ),
                "color": ("COLOR", {"default": DEFAULT_COLOR}),
                "fill_opacity": (
                    "INT",
                    {"default": 35, "min": 0, "max": 100, "step": 1, "display": "slider"},
                ),
                "outline_width": (
                    "INT",
                    {"default": 3, "min": 0, "max": 20, "step": 1, "display": "slider"},
                ),
                "polygon_data": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Internal cached polygon data. It is managed by the node UI.",
                    },
                ),
                "sam3_prompts_data": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Internal cached SAM3 prompt data. It is managed by the node UI.",
                    },
                ),
            },
            "optional": {
                "sam3_model_config": (
                    "SAM3_MODEL_CONFIG",
                    {
                        "tooltip": "SAM3 model config from LoadSAM3Model. Required when SAM3 prompts contain points or boxes.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    DESCRIPTION = "Load an image, edit polygon overlays and SAM3 prompts, then output polygon and SAM3 mask results."
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("masked_image", "source_image", "masks", "visualization")
    FUNCTION = "execute"
    CATEGORY = "image/polygon"
    SEARCH_ALIASES = ["load image polygon", "polygon mask", "polygon overlay"]

    def execute(
        self,
        image,
        vertex_count=MIN_VERTEX_COUNT,
        color=DEFAULT_COLOR,
        fill_opacity=35,
        outline_width=3,
        polygon_data="",
        sam3_prompts_data="[]",
        sam3_model_config=None,
        unique_id=None,
        extra_pnginfo=None,
    ):
        image_tensor = _load_image_tensor(image)
        sam3_masks, sam3_visualization = _run_sam3_prompts(sam3_model_config, image_tensor, sam3_prompts_data)
        info = {}
        if polygon_data:
            try:
                parsed_polygon_data = json.loads(str(polygon_data))
                info = parsed_polygon_data if isinstance(parsed_polygon_data, dict) else {}
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid polygon_data JSON: {exc}") from exc
        if not info:
            info = _get_node_polygon_info(unique_id, extra_pnginfo)

        if info.get("cleared") is True:
            source_pil = _tensor_to_pil(image_tensor[0])
            return {
                "result": (image_tensor, image_tensor, sam3_masks, sam3_visualization),
                "ui": {"masked_image": [_pil_to_base64(source_pil)]},
            }

        width = int(image_tensor.shape[2])
        height = int(image_tensor.shape[1])
        polygons = _parse_polygons(info, width, height)

        if not polygons:
            if "polygons" in info or "points" in info:
                source_pil = _tensor_to_pil(image_tensor[0])
                return {
                    "result": (image_tensor, image_tensor, sam3_masks, sam3_visualization),
                    "ui": {"masked_image": [_pil_to_base64(source_pil)]},
                }
            polygons = [_default_polygon_points(width, height, vertex_count)]

        output_images = []
        first_masked_pil = None
        for frame in image_tensor:
            pil_image = _tensor_to_pil(frame)
            composited = _draw_polygons_on_image(pil_image, polygons, color, fill_opacity, outline_width)
            if first_masked_pil is None:
                first_masked_pil = composited
            output_images.append(_pil_to_tensor(composited))

        return {
            "result": (torch.cat(output_images, dim=0), image_tensor, sam3_masks, sam3_visualization),
            "ui": {"masked_image": [_pil_to_base64(first_masked_pil)] if first_masked_pil else []},
        }

    @classmethod
    def IS_CHANGED(
        cls,
        image,
        vertex_count=MIN_VERTEX_COUNT,
        color=DEFAULT_COLOR,
        fill_opacity=35,
        outline_width=3,
        polygon_data="",
        sam3_prompts_data="[]",
        sam3_model_config=None,
        unique_id=None,
        extra_pnginfo=None,
    ):
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as file:
            digest.update(file.read())

        digest.update(str(_clamp_int(vertex_count, MIN_VERTEX_COUNT, MAX_VERTEX_COUNT, MIN_VERTEX_COUNT)).encode("utf-8"))
        digest.update(str(color).encode("utf-8"))
        digest.update(str(_clamp_int(fill_opacity, 0, 100, 35)).encode("utf-8"))
        digest.update(str(_clamp_int(outline_width, 0, 20, 3)).encode("utf-8"))
        digest.update(str(polygon_data or "").encode("utf-8"))
        digest.update(str(sam3_prompts_data or "").encode("utf-8"))
        digest.update(str(sam3_model_config or "").encode("utf-8"))
        polygon_info = _get_node_polygon_info(unique_id, extra_pnginfo)
        digest.update(json.dumps(polygon_info, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {
    "LoadImagePolygonMask": LoadImagePolygonMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImagePolygonMask": "Load Image + Polygon Mask",
}
