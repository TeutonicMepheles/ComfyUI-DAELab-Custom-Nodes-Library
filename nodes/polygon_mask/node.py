import hashlib
import json
import math
import re
import base64
from io import BytesIO

import numpy as np
import torch
from PIL import Image, ImageDraw

from comfy_api.latest import io


MIN_VERTEX_COUNT = 3
MAX_VERTEX_COUNT = 12
DEFAULT_COLOR = "#FF0000"
DEFAULT_POLYGON_RADIUS_RATIO = 0.08


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


def _has_polygon_state(info):
    return isinstance(info, dict) and (
        info.get("cleared") is True or "polygons" in info or "points" in info
    )


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
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _tensor_digest(image_tensor):
    digest = hashlib.sha256()
    digest.update(str(tuple(image_tensor.shape)).encode("utf-8"))
    digest.update(np.ascontiguousarray(image_tensor.detach().cpu().numpy()).tobytes())
    return digest.hexdigest()


def _ui_source_image(image_tensor):
    source_pil = _tensor_to_pil(image_tensor[0])
    return {
        "source_image": [_pil_to_base64(source_pil)],
        "source_image_hash": [_tensor_digest(image_tensor)],
    }


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


def _draw_polygons_to_mask(width, height, polygons):
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    for points in polygons:
        if len(points) < MIN_VERTEX_COUNT:
            continue

        xy = [(point["x"], point["y"]) for point in points]
        draw.polygon(xy, fill=255)

    mask_np = np.array(mask).astype(np.float32) / 255.0
    return torch.from_numpy(mask_np)


class PolygonMask(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PolygonMask",
            display_name="Polygon Mask",
            description="Load an image, edit closed polygon overlays, and output the composited image plus a raw polygon mask.",
            category="image/polygon",
            search_aliases=["load image polygon", "polygon mask", "polygon overlay"],
            inputs=[
                io.Image.Input("image"),
                io.Int.Input(
                    "vertex_count",
                    default=MIN_VERTEX_COUNT,
                    min=MIN_VERTEX_COUNT,
                    max=MAX_VERTEX_COUNT,
                    step=1,
                ),
                io.Color.Input("color", default=DEFAULT_COLOR),
                io.Int.Input(
                    "fill_opacity",
                    default=35,
                    min=0,
                    max=100,
                    step=1,
                ),
                io.Int.Input(
                    "outline_width",
                    default=3,
                    min=0,
                    max=20,
                    step=1,
                ),
                io.String.Input(
                    "polygon_data",
                    default="",
                ),
            ],
            outputs=[
                io.Image.Output(display_name="masked_image"),
                io.Mask.Output(display_name="raw_mask"),
            ],
            hidden=[io.Hidden.unique_id, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(
        cls,
        image,
        vertex_count=MIN_VERTEX_COUNT,
        color=DEFAULT_COLOR,
        fill_opacity=35,
        outline_width=3,
        polygon_data="",
    ):
        image_tensor = image
        if image_tensor is None or len(image_tensor.shape) != 4:
            raise ValueError("Polygon Mask requires an IMAGE input tensor.")

        ui = _ui_source_image(image_tensor)
        property_info = _get_node_polygon_info(cls.hidden.unique_id, cls.hidden.extra_pnginfo)
        input_info = {}
        if polygon_data:
            try:
                parsed_polygon_data = json.loads(str(polygon_data))
                input_info = parsed_polygon_data if isinstance(parsed_polygon_data, dict) else {}
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid polygon_data JSON: {exc}") from exc
        info = property_info if _has_polygon_state(property_info) else input_info

        width = int(image_tensor.shape[2])
        height = int(image_tensor.shape[1])

        if info.get("cleared") is True:
            raw_mask = torch.zeros((int(image_tensor.shape[0]), height, width), dtype=torch.float32)
            return io.NodeOutput(image_tensor, raw_mask, ui=ui)

        polygons = _parse_polygons(info, width, height)

        if not polygons:
            if "polygons" in info or "points" in info:
                raw_mask = torch.zeros((int(image_tensor.shape[0]), height, width), dtype=torch.float32)
                return io.NodeOutput(image_tensor, raw_mask, ui=ui)
            polygons = [_default_polygon_points(width, height, vertex_count)]

        output_images = []
        output_masks = []
        for frame in image_tensor:
            pil_image = _tensor_to_pil(frame)
            composited = _draw_polygons_on_image(pil_image, polygons, color, fill_opacity, outline_width)
            output_images.append(_pil_to_tensor(composited))
            output_masks.append(_draw_polygons_to_mask(width, height, polygons))

        return io.NodeOutput(torch.cat(output_images, dim=0), torch.stack(output_masks, dim=0), ui=ui)

    @classmethod
    def fingerprint_inputs(
        cls,
        image,
        vertex_count=MIN_VERTEX_COUNT,
        color=DEFAULT_COLOR,
        fill_opacity=35,
        outline_width=3,
        polygon_data="",
    ):
        digest = hashlib.sha256()
        if hasattr(image, "shape"):
            digest.update(_tensor_digest(image).encode("utf-8"))
        else:
            digest.update(str(image).encode("utf-8"))

        digest.update(str(_clamp_int(vertex_count, MIN_VERTEX_COUNT, MAX_VERTEX_COUNT, MIN_VERTEX_COUNT)).encode("utf-8"))
        digest.update(str(color).encode("utf-8"))
        digest.update(str(_clamp_int(fill_opacity, 0, 100, 35)).encode("utf-8"))
        digest.update(str(_clamp_int(outline_width, 0, 20, 3)).encode("utf-8"))
        digest.update(str(polygon_data or "").encode("utf-8"))
        polygon_info = _get_node_polygon_info(cls.hidden.unique_id, cls.hidden.extra_pnginfo)
        digest.update(json.dumps(polygon_info, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()


NODE_CLASS_MAPPINGS = {
    "PolygonMask": PolygonMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PolygonMask": "Polygon Mask",
}
