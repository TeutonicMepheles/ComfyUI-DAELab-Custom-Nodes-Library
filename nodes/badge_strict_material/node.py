from __future__ import annotations

import json
import math
import re
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

try:  # The lightweight repository test interpreter does not load the ComfyUI core package.
    from comfy_api.latest import io as comfy_io
    from comfy_execution.graph_utils import GraphBuilder
except ModuleNotFoundError:  # pragma: no cover - the fallback is exercised by direct unit tests.
    comfy_io = None
    GraphBuilder = None


ROOT_DIR = Path(__file__).resolve().parents[2]
MATERIAL_FILE = ROOT_DIR / "web" / "materials.json"
LEGAL_HEIGHTS = torch.tensor((0.0, 0.2, 0.4, 0.6, 0.8, 1.0), dtype=torch.float32)
DEFAULT_MATERIAL_ID = "transparent_lacquer"
SAFE_ID = re.compile(r"[^a-zA-Z0-9_-]")

DEFAULT_RENDER_PROFILE = {
    "base_strength": 0.70,
    "mid_gain": 0.60,
    "high_gain": 0.60,
    "chroma_gain": 0.12,
    "target_mean": 0.016,
    "target_p95": 0.050,
    "dark_clip": 0.100,
    "bright_clip": 0.120,
}

# The values describe how much of the GPT candidate's material-scale response is
# retained. Macro light remains owned by BadgeHeightLockedBaseV1 in every profile.
MATERIAL_RENDER_PROFILES = {
    "dark_brushed_bronze": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.78, "mid_gain": 0.65, "high_gain": 0.75},
    "light_speckled_enamel": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.62, "mid_gain": 0.40, "high_gain": 0.78, "target_mean": 0.014},
    "baked_enamel": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.58, "mid_gain": 0.52, "high_gain": 0.38, "target_mean": 0.013, "target_p95": 0.042},
    "transparent_lacquer": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.30, "mid_gain": 0.22, "high_gain": 0.30, "target_mean": 0.008, "target_p95": 0.025},
    "satin_gold": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.72, "mid_gain": 0.68, "high_gain": 0.45, "target_mean": 0.018, "target_p95": 0.055},
    "satin_silver": {**DEFAULT_RENDER_PROFILE, "base_strength": 0.72, "mid_gain": 0.68, "high_gain": 0.45, "target_mean": 0.018, "target_p95": 0.055},
    "glitter": {
        **DEFAULT_RENDER_PROFILE,
        "base_strength": 0.92,
        "mid_gain": 0.58,
        "high_gain": 1.10,
        "chroma_gain": 0.18,
        "target_mean": 0.024,
        "target_p95": 0.085,
        "dark_clip": 0.120,
        "bright_clip": 0.180,
    },
    "rhinestone": {
        **DEFAULT_RENDER_PROFILE,
        "base_strength": 1.00,
        "mid_gain": 1.00,
        "high_gain": 0.88,
        "chroma_gain": 0.16,
        "target_mean": 0.034,
        "target_p95": 0.110,
        "dark_clip": 0.160,
        "bright_clip": 0.200,
    },
}


def _image_float(image, name="image"):
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or image.shape[-1] not in (3, 4):
        raise ValueError(f"{name} must use ComfyUI IMAGE shape [B,H,W,3 or 4].")
    if min(image.shape[:3]) < 1 or not image.is_floating_point():
        raise ValueError(f"{name} must contain non-empty floating-point data.")
    value = image[..., :3].to(dtype=torch.float32)
    if not torch.isfinite(value).all().item():
        raise ValueError(f"{name} contains NaN or infinite values.")
    minimum, maximum = float(value.amin().item()), float(value.amax().item())
    if minimum < 0.0 or maximum > 255.0:
        raise ValueError(f"{name} values must be in [0,1] or [0,255].")
    if maximum > 1.0:
        value = value / 255.0
    return value.clamp(0.0, 1.0)


def _mask_float(mask, name="mask"):
    if not isinstance(mask, torch.Tensor):
        raise TypeError(f"{name} must be a torch.Tensor.")
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    elif mask.ndim == 4 and mask.shape[1] == 1:
        mask = mask[:, 0]
    if mask.ndim != 3 or min(mask.shape) < 1:
        raise ValueError(f"{name} must use ComfyUI MASK shape [B,H,W].")
    value = mask.to(dtype=torch.float32)
    if not torch.isfinite(value).all().item():
        raise ValueError(f"{name} contains NaN or infinite values.")
    return value.clamp(0.0, 1.0)


def _broadcast(value, batch, name):
    if value.shape[0] == batch:
        return value
    if value.shape[0] == 1:
        return value.expand(batch, *value.shape[1:])
    raise ValueError(f"{name} batch must be 1 or match batch {batch}.")


def _resize_image(image, height, width):
    return F.interpolate(
        image.permute(0, 3, 1, 2),
        size=(height, width),
        mode="bicubic",
        align_corners=False,
    ).permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)


def _resize_mask(mask, height, width):
    return F.interpolate(mask.unsqueeze(1), size=(height, width), mode="nearest-exact")[:, 0]


def _mask_image(mask):
    return _mask_float(mask).unsqueeze(-1).expand(-1, -1, -1, 3).contiguous()


def _legal_height_error(height):
    legal = LEGAL_HEIGHTS.to(device=height.device, dtype=height.dtype)
    return torch.min((height.unsqueeze(-1) - legal).abs(), dim=-1).values


def _binary_iou(first, second):
    first = first > 0
    second = second > 0
    union = np.logical_or(first, second).sum()
    return float(np.logical_and(first, second).sum() / union) if union else 1.0


def _centroid(mask):
    ys, xs = np.nonzero(mask > 0)
    if not len(xs):
        raise ValueError("Height or design foreground is empty.")
    return float(xs.mean()), float(ys.mean())


def _boundary_error(first, second):
    kernel = np.ones((3, 3), np.uint8)
    first_edge = cv2.morphologyEx((first > 0).astype(np.uint8), cv2.MORPH_GRADIENT, kernel)
    second_edge = cv2.morphologyEx((second > 0).astype(np.uint8), cv2.MORPH_GRADIENT, kernel)
    if not first_edge.any() or not second_edge.any():
        return float("inf")
    to_second = cv2.distanceTransform(1 - second_edge, cv2.DIST_L2, 3)
    to_first = cv2.distanceTransform(1 - first_edge, cv2.DIST_L2, 3)
    return 0.5 * (
        float(to_second[first_edge > 0].mean())
        + float(to_first[second_edge > 0].mean())
    )


def _registration_matrix(design, height_foreground, max_rotation=3.0, max_scale_delta=0.10):
    source_height, source_width = design.shape
    factor = min(1.0, 256.0 / max(source_height, source_width))
    small_width = max(32, int(round(source_width * factor)))
    small_height = max(32, int(round(source_height * factor)))
    target = cv2.resize(design.astype(np.uint8), (small_width, small_height), interpolation=cv2.INTER_NEAREST)
    source = cv2.resize(height_foreground.astype(np.uint8), (small_width, small_height), interpolation=cv2.INTER_NEAREST)
    target_center = _centroid(target)
    source_center = _centroid(source)
    target_area = max(1, int(target.sum()))
    source_area = max(1, int(source.sum()))
    base_scale = float(np.clip(math.sqrt(target_area / source_area), 1.0 - max_scale_delta, 1.0 + max_scale_delta))
    best = None
    for angle in np.linspace(-max_rotation, max_rotation, 7):
        for offset in np.linspace(-max_scale_delta, max_scale_delta, 5):
            scale = float(np.clip(base_scale + offset, 1.0 - max_scale_delta, 1.0 + max_scale_delta))
            matrix = cv2.getRotationMatrix2D(source_center, float(angle), scale)
            matrix[0, 2] += target_center[0] - source_center[0]
            matrix[1, 2] += target_center[1] - source_center[1]
            warped = cv2.warpAffine(source, matrix, (small_width, small_height), flags=cv2.INTER_NEAREST)
            score = _binary_iou(target, warped)
            if best is None or score > best[0]:
                best = (score, matrix)
    matrix = np.vstack([best[1], [0.0, 0.0, 1.0]])
    down = np.diag([factor, factor, 1.0])
    up = np.diag([1.0 / factor, 1.0 / factor, 1.0])
    return (up @ matrix @ down)[:2].astype(np.float32)


def _warp(array, matrix, width, height, interpolation=cv2.INTER_NEAREST):
    return cv2.warpAffine(
        array,
        matrix,
        (width, height),
        flags=interpolation,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )


def _conform_height_support(height, design_foreground):
    """Lock solid support to the flat design while retaining nearest height labels."""
    design = design_foreground > 0
    solid = height > 0
    if not design.any():
        raise ValueError("Design foreground is empty.")
    if not solid.any():
        raise ValueError("Height reference has no solid legal height layer.")
    distance_source = (~solid).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(
        distance_source,
        cv2.DIST_L2,
        3,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    site_values = height[solid]
    nearest_values = site_values[np.clip(labels - 1, 0, len(site_values) - 1)]
    return np.where(design, np.where(solid, height, nearest_values), 0.0).astype(np.float32)


def _srgb_to_linear(rgb):
    return torch.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055).pow(2.4))


def _linear_to_srgb(rgb):
    return torch.where(
        rgb <= 0.0031308,
        12.92 * rgb,
        1.055 * torch.clamp(rgb, min=0.0).pow(1.0 / 2.4) - 0.055,
    )


def _rgb_to_oklab(rgb):
    rgb = _srgb_to_linear(rgb.clamp(0.0, 1.0))
    red, green, blue = rgb.unbind(-1)
    l_value = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
    m_value = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
    s_value = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue
    l_root = torch.sign(l_value) * torch.abs(l_value).pow(1.0 / 3.0)
    m_root = torch.sign(m_value) * torch.abs(m_value).pow(1.0 / 3.0)
    s_root = torch.sign(s_value) * torch.abs(s_value).pow(1.0 / 3.0)
    return torch.stack((
        0.2104542553 * l_root + 0.7936177850 * m_root - 0.0040720468 * s_root,
        1.9779984951 * l_root - 2.4285922050 * m_root + 0.4505937099 * s_root,
        0.0259040371 * l_root + 0.7827717662 * m_root - 0.8086757660 * s_root,
    ), dim=-1)


def _oklab_to_rgb(lab):
    lightness, a_value, b_value = lab.unbind(-1)
    l_root = lightness + 0.3963377774 * a_value + 0.2158037573 * b_value
    m_root = lightness - 0.1055613458 * a_value - 0.0638541728 * b_value
    s_root = lightness - 0.0894841775 * a_value - 1.2914855480 * b_value
    l_value, m_value, s_value = l_root.pow(3), m_root.pow(3), s_root.pow(3)
    linear = torch.stack((
        4.0767416621 * l_value - 3.3077115913 * m_value + 0.2309699292 * s_value,
        -1.2684380046 * l_value + 2.6097574011 * m_value - 0.3413193965 * s_value,
        -0.0041960863 * l_value - 0.7034186147 * m_value + 1.7076147010 * s_value,
    ), dim=-1)
    return _linear_to_srgb(linear).clamp(0.0, 1.0)


def _box_blur(value, radius=8):
    height, width = value.shape[-2:]
    radius = min(int(radius), (height - 1) // 2, (width - 1) // 2)
    if radius < 1:
        return value
    kernel = radius * 2 + 1
    padded = F.pad(value, (radius, radius, radius, radius), mode="reflect")
    return F.avg_pool2d(padded, kernel_size=kernel, stride=1)


def _parse_hex(value, fallback="#808080", device="cpu"):
    text = str(value or "").strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        text = fallback
    return torch.tensor(
        [int(text[index:index + 2], 16) / 255.0 for index in (1, 3, 5)],
        dtype=torch.float32,
        device=device,
    )


def _load_materials():
    try:
        with MATERIAL_FILE.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _material_render_profile(material_id):
    return dict(MATERIAL_RENDER_PROFILES.get(str(material_id or ""), DEFAULT_RENDER_PROFILE))


def _signal_metrics(signal, editable):
    values = signal[:, 0][editable].abs()
    if not values.numel():
        return 0.0, 0.0
    return float(values.mean().item()), float(torch.quantile(values, 0.95).item())


def _boost_material_signal(signal, editable, profile, strength):
    source_mean, source_p95 = _signal_metrics(signal, editable)
    weak = source_mean < 0.001 or source_p95 < 0.003
    target_scale = max(0.5, min(1.5, float(strength)))
    target_mean = float(profile["target_mean"]) * target_scale
    target_p95 = float(profile["target_p95"]) * target_scale
    if weak:
        gain = 1.0
    else:
        gain = max(
            1.0,
            target_mean / max(source_mean, 1e-6),
            target_p95 / max(source_p95, 1e-6),
        )
        gain = min(3.0, gain)
    boosted = (signal * gain).clamp(
        -float(profile["dark_clip"]) * target_scale,
        float(profile["bright_clip"]) * target_scale,
    )
    output_mean, output_p95 = _signal_metrics(boosted, editable)
    return boosted, {
        "source_mean": source_mean,
        "source_p95": source_p95,
        "gain": gain,
        "target_mean": target_mean,
        "target_p95": target_p95,
        "output_mean": output_mean,
        "output_p95": output_p95,
        "weak": weak,
    }


def _deterministic_material_signal(material_id, batch, height, width, seed, device, dtype):
    y_coord, x_coord = torch.meshgrid(
        torch.arange(height, device=device, dtype=dtype),
        torch.arange(width, device=device, dtype=dtype),
        indexing="ij",
    )
    phase = float(int(seed) % 10007)
    random_field = torch.remainder(
        torch.sin(x_coord * 12.9898 + y_coord * 78.233 + phase * 0.137) * 43758.5453,
        1.0,
    )
    material_id = str(material_id or "")
    if material_id == "glitter":
        bright = ((random_field - 0.86) / 0.14).clamp(0.0, 1.0).pow(1.6) * 0.18
        dark = -((0.10 - random_field) / 0.10).clamp(0.0, 1.0) * 0.055
        micro = torch.sin(x_coord * 1.73 + y_coord * 2.41 + phase) * 0.012
        signal = bright + dark + micro
    elif material_id == "rhinestone":
        cell = 13.0
        u = torch.remainder(x_coord + phase * 0.71, cell) / cell * 2.0 - 1.0
        v = torch.remainder(y_coord + phase * 0.43, cell) / cell * 2.0 - 1.0
        diamond = u.abs() + v.abs()
        stone = (diamond <= 0.92).to(dtype)
        facet = torch.where(u + v < 0.0, 0.105, -0.060)
        facet = facet + torch.where(u - v < 0.0, 0.050, -0.025)
        rim = ((diamond - 0.68) / 0.24).clamp(0.0, 1.0) * 0.075
        center_flash = ((0.18 - diamond) / 0.18).clamp(0.0, 1.0) * 0.10
        signal = stone * (facet + rim + center_flash) - (1.0 - stone) * 0.045
    elif material_id == "dark_brushed_bronze":
        fine = torch.sin(x_coord * 2.8 + torch.sin(y_coord * 0.07 + phase) * 1.8) * 0.032
        irregular = (random_field - 0.5) * 0.025
        signal = fine + irregular
    elif material_id in {"satin_gold", "satin_silver"}:
        signal = torch.sin(x_coord * 0.42 + y_coord * 0.08 + phase) * 0.032
        signal += torch.sin(x_coord * 1.81 + phase * 0.3) * 0.012
    elif material_id == "light_speckled_enamel":
        signal = (random_field - 0.5) * 0.060
        signal += torch.sin((x_coord + y_coord) * 0.38 + phase) * 0.012
    elif material_id == "baked_enamel":
        signal = torch.sin(x_coord * 0.18 + y_coord * 0.11 + phase) * 0.028
        signal += torch.sin(x_coord * 0.73 - y_coord * 0.51) * 0.008
    else:
        signal = torch.sin(x_coord * 0.31 + y_coord * 0.17 + phase) * 0.030
        signal += (random_field - 0.5) * 0.018
    return signal.view(1, 1, height, width).expand(batch, -1, -1, -1).contiguous()


def build_region_edit_prompt(region, material):
    color_policy = region.get("color_policy", "preserve")
    material_strength = max(0.25, min(1.5, float(region.get("material_strength", 1.0))))
    if color_policy == "material_intrinsic" and material.get("intrinsic_color_hex"):
        color_rule = (
            f"Use the catalog-declared intrinsic material color {material['intrinsic_color_hex']} inside the mask only."
        )
    else:
        color_rule = "Preserve the input badge's existing intrinsic hue and chroma inside the mask."
    return "\n\n".join((
        "MASKED MATERIAL EDIT\nEdit only white pixels of the supplied mask. Keep every black-mask pixel exactly unchanged.",
        "IMMUTABLE GEOMETRY\nThe supplied image is the sole macro-relief authority. Do not move, redraw, raise, lower, bevel, crop, or reshape any badge feature, text, separator line, or outer silhouette.",
        f"MATERIAL\n{material.get('semantic', region.get('material_id', 'material'))} {material.get('application', '')}",
        f"MATERIAL VISIBILITY\nUse {material_strength * 100:.0f}% of the catalog-recommended material intensity. Make the assigned material unmistakably recognizable at normal 1024-pixel viewing size. Produce clear material-scale mid-frequency structure and crisp micro-highlights appropriate to the named material; do not return a faint or nearly unchanged surface. Keep all of this optical detail inside the existing relief envelope.",
        f"COLOR\n{color_rule} Do not progressively darken the region and do not copy colors from a material thumbnail.",
        f"AVOID\n{material.get('avoid', '')} No spill, halo, seam, new shadow, new text, new object, or background change.",
    ))


class BadgeMaterialCanvasNormalizeV1:
    RETURN_TYPES = ("IMAGE", "MASK", "MASK", "STRING")
    RETURN_NAMES = (
        "normalized_flat_image",
        "normalized_height_map",
        "normalized_foreground_mask",
        "report",
    )
    FUNCTION = "normalize"
    CATEGORY = "DAELab/Badge/Strict"
    DESCRIPTION = (
        "Normalize flat artwork, height, and foreground masks to the actual baked-enamel base canvas "
        "before masked GPT-Image-2 material edits. Label-bearing inputs use nearest-neighbor scaling."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_image": ("IMAGE",),
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "foreground_mask": ("MASK",),
        }}

    def normalize(self, base_image, flat_image, height_map, foreground_mask):
        base = _image_float(base_image, "base_image")
        if base.shape[0] != 1:
            raise ValueError("Badge Material Canvas Normalize V1 requires exactly one base image.")
        batch, target_height, target_width, _ = base.shape

        flat = _broadcast(_image_float(flat_image, "flat_image"), batch, "flat_image")
        height = _broadcast(_mask_float(height_map, "height_map"), batch, "height_map")
        foreground = _broadcast(
            _mask_float(foreground_mask, "foreground_mask"),
            batch,
            "foreground_mask",
        )
        source_sizes = {
            "flat_image": [int(flat.shape[2]), int(flat.shape[1])],
            "height_map": [int(height.shape[2]), int(height.shape[1])],
            "foreground_mask": [int(foreground.shape[2]), int(foreground.shape[1])],
        }

        if flat.shape[1:3] != (target_height, target_width):
            flat = F.interpolate(
                flat.permute(0, 3, 1, 2),
                size=(target_height, target_width),
                mode="nearest-exact",
            ).permute(0, 2, 3, 1).contiguous()
        if height.shape[1:] != (target_height, target_width):
            height = _resize_mask(height, target_height, target_width)
        if foreground.shape[1:] != (target_height, target_width):
            foreground = _resize_mask(foreground, target_height, target_width)
        foreground = (foreground > 0.5).to(dtype=torch.float32)

        expected_image_shape = (batch, target_height, target_width, 3)
        expected_mask_shape = (batch, target_height, target_width)
        if tuple(flat.shape) != expected_image_shape:
            raise RuntimeError("Normalized flat image does not match the base image canvas.")
        if tuple(height.shape) != expected_mask_shape or tuple(foreground.shape) != expected_mask_shape:
            raise RuntimeError("Normalized material masks do not match the base image canvas.")

        report = {
            "version": 1,
            "base_canvas": [target_width, target_height],
            "source_sizes": source_sizes,
            "output_sizes": {
                "flat_image": [int(flat.shape[2]), int(flat.shape[1])],
                "height_map": [int(height.shape[2]), int(height.shape[1])],
                "foreground_mask": [int(foreground.shape[2]), int(foreground.shape[1])],
            },
            "flat_interpolation": "nearest-exact",
            "mask_interpolation": "nearest-exact",
            "foreground_binary": True,
            "legal_height_max_error": float(_legal_height_error(height).max().item()),
        }
        return flat.clamp(0.0, 1.0), height, foreground, json.dumps(report, separators=(",", ":"))


class BadgeHeightReferenceAlignV1:
    RETURN_TYPES = ("MASK", "IMAGE", "MASK", "FLOAT", "FLOAT", "BOOLEAN", "STRING")
    RETURN_NAMES = (
        "aligned_height",
        "aligned_height_image",
        "aligned_unmatched",
        "contour_iou",
        "boundary_error_px",
        "valid",
        "report",
    )
    FUNCTION = "align"
    CATEGORY = "DAELab/Badge/Strict"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "design_foreground_mask": ("MASK",),
            "height_map": ("MASK",),
            "unmatched_mask": ("MASK",),
            "minimum_iou": ("FLOAT", {"default": 0.985, "min": 0.0, "max": 1.0, "step": 0.001}),
            "maximum_boundary_error_px": ("FLOAT", {"default": 1.5, "min": 0.0, "max": 20.0, "step": 0.1}),
            "maximum_unmatched_percent": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 100.0, "step": 0.1}),
            "enforce": ("BOOLEAN", {"default": True}),
        }}

    def align(
        self,
        design_foreground_mask,
        height_map,
        unmatched_mask,
        minimum_iou=0.985,
        maximum_boundary_error_px=1.5,
        maximum_unmatched_percent=0.5,
        enforce=True,
    ):
        design = (_mask_float(design_foreground_mask, "design_foreground_mask") > 0.5).float()
        height = _mask_float(height_map, "height_map")
        unmatched = _mask_float(unmatched_mask, "unmatched_mask")
        batch, target_height, target_width = design.shape
        height = _broadcast(height, batch, "height_map")
        unmatched = _broadcast(unmatched, batch, "unmatched_mask")
        if height.shape[1:] != (target_height, target_width):
            height = _resize_mask(height, target_height, target_width)
            unmatched = _resize_mask(unmatched, target_height, target_width)
        error = _legal_height_error(height)
        if float(error.max().item()) > 1e-4:
            raise ValueError("height_map contains values outside {0,.2,.4,.6,.8,1}.")

        aligned_height, aligned_unmatched, ious, boundary_errors = [], [], [], []
        prerepair_ious, prerepair_boundary_errors = [], []
        for index in range(batch):
            design_np = design[index].detach().cpu().numpy() > 0.5
            height_np = height[index].detach().cpu().numpy()
            solid_np = height_np > 0.0
            matrix = _registration_matrix(design_np, solid_np)
            warped_height = _warp(height_np, matrix, target_width, target_height)
            warped_height = np.round(warped_height * 5.0) / 5.0
            warped_unmatched = _warp(unmatched[index].detach().cpu().numpy(), matrix, target_width, target_height)
            prerepair_solid = warped_height > 0.0
            prerepair_ious.append(_binary_iou(design_np, prerepair_solid))
            prerepair_boundary_errors.append(_boundary_error(design_np, prerepair_solid))
            conformed_height = _conform_height_support(warped_height, design_np)
            conformed_solid = conformed_height > 0.0
            ious.append(_binary_iou(design_np, conformed_solid))
            boundary_errors.append(_boundary_error(design_np, conformed_solid))
            aligned_height.append(torch.from_numpy(conformed_height).to(height.device, height.dtype))
            aligned_unmatched.append(torch.from_numpy(warped_unmatched).to(unmatched.device, unmatched.dtype))
        aligned_height = torch.stack(aligned_height)
        aligned_unmatched = torch.stack(aligned_unmatched).clamp(0.0, 1.0)
        if float(_legal_height_error(aligned_height).max().item()) > 1e-6:
            raise RuntimeError("Nearest-exact height registration changed a legal discrete level.")
        foreground_pixels = float(design.sum().item())
        unmatched_ratio = float(((aligned_unmatched > 0.5) & (design > 0.5)).sum().item()) / max(1.0, foreground_pixels)
        minimum_observed_iou = min(ious)
        maximum_observed_boundary = max(boundary_errors)
        valid = (
            minimum_observed_iou >= float(minimum_iou)
            and maximum_observed_boundary <= float(maximum_boundary_error_px)
            and unmatched_ratio * 100.0 <= float(maximum_unmatched_percent)
            and min(prerepair_ious) >= 0.80
        )
        report = {
            "valid": valid,
            "minimum_iou": float(minimum_iou),
            "observed_iou": minimum_observed_iou,
            "maximum_boundary_error_px": float(maximum_boundary_error_px),
            "observed_boundary_error_px": maximum_observed_boundary,
            "maximum_unmatched_percent": float(maximum_unmatched_percent),
            "observed_unmatched_percent": unmatched_ratio * 100.0,
            "prerepair_iou": min(prerepair_ious),
            "prerepair_boundary_error_px": max(prerepair_boundary_errors),
            "support_conformed_to_design": True,
            "legal_levels": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        }
        if enforce and not valid:
            raise ValueError("Height reference alignment failed before GPT execution: " + json.dumps(report))
        return (
            aligned_height,
            _mask_image(aligned_height),
            aligned_unmatched,
            minimum_observed_iou,
            maximum_observed_boundary,
            valid,
            json.dumps(report, ensure_ascii=False, separators=(",", ":")),
        )


class BadgeHeightLockedBaseV1:
    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "STRING")
    RETURN_NAMES = ("height_locked_base", "base_lightness", "normal_preview", "report")
    FUNCTION = "render"
    CATEGORY = "DAELab/Badge/Strict"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "foreground_mask": ("MASK",),
            "normal_strength": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 20.0, "step": 0.1}),
            "ambient": ("FLOAT", {"default": 0.78, "min": 0.0, "max": 1.0, "step": 0.01}),
            "key_strength": ("FLOAT", {"default": 0.24, "min": 0.0, "max": 1.0, "step": 0.01}),
            "edge_darkening": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 0.5, "step": 0.01}),
            "enforce_1024": ("BOOLEAN", {"default": True}),
        }}

    def render(self, flat_image, height_map, foreground_mask, normal_strength=5.0, ambient=0.78, key_strength=0.24, edge_darkening=0.08, enforce_1024=True):
        flat = _image_float(flat_image, "flat_image")
        batch, height, width, _ = flat.shape
        if enforce_1024 and (height, width) != (1024, 1024):
            raise ValueError("Badge Height Locked Base V1 requires a 1024x1024 canvas.")
        height_value = _broadcast(_mask_float(height_map, "height_map"), batch, "height_map")
        foreground = (_broadcast(_mask_float(foreground_mask, "foreground_mask"), batch, "foreground_mask") > 0.5).float()
        if height_value.shape[1:] != (height, width) or foreground.shape[1:] != (height, width):
            raise ValueError("flat_image, height_map, and foreground_mask must have identical canvas dimensions.")
        if float(_legal_height_error(height_value).max().item()) > 1e-4:
            raise ValueError("height_map is not a legal six-level reference.")
        value = height_value.unsqueeze(1)
        dx = F.pad(value[:, :, :, 2:] - value[:, :, :, :-2], (1, 1, 0, 0), mode="replicate") * 0.5
        dy = F.pad(value[:, :, 2:, :] - value[:, :, :-2, :], (0, 0, 1, 1), mode="replicate") * 0.5
        nx = -dx * float(normal_strength)
        ny = -dy * float(normal_strength)
        nz = torch.ones_like(nx)
        norm = torch.sqrt(nx * nx + ny * ny + nz * nz).clamp_min(1e-6)
        nx, ny, nz = nx / norm, ny / norm, nz / norm
        light = torch.tensor((-0.35, -0.45, 0.82), device=flat.device, dtype=flat.dtype)
        light = light / torch.linalg.vector_norm(light)
        diffuse = (nx * light[0] + ny * light[1] + nz * light[2]).clamp(0.0, 1.0)
        slope = torch.sqrt(dx * dx + dy * dy).clamp(0.0, 1.0)
        shading = (
            float(ambient)
            + float(key_strength) * diffuse
            - float(edge_darkening) * torch.clamp(slope * 5.0, 0.0, 1.0)
        ).clamp(0.55, 1.20)
        base = (flat * shading.permute(0, 2, 3, 1)).clamp(0.0, 1.0)
        mask = foreground.unsqueeze(-1)
        base = torch.where(mask > 0.5, base, torch.ones_like(base))
        lab = _rgb_to_oklab(base)
        normal_preview = torch.cat((nx, ny, nz), dim=1).permute(0, 2, 3, 1) * 0.5 + 0.5
        report = {
            "canvas": [width, height],
            "legal_height_max_error": float(_legal_height_error(height_value).max().item()),
            "normal_strength": float(normal_strength),
            "lighting": {"ambient": float(ambient), "key": float(key_strength), "edge_darkening": float(edge_darkening)},
            "deterministic": True,
        }
        return base, lab[..., 0], normal_preview.clamp(0.0, 1.0), json.dumps(report, separators=(",", ":"))


class BadgeMaterialConstraintV1:
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN", "FLOAT", "FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = (
        "constrained_candidate",
        "strict_mask",
        "accepted",
        "mean_chroma_error",
        "p95_chroma_error",
        "median_low_frequency_lightness_error",
        "outside_max_abs_diff",
        "report",
    )
    FUNCTION = "constrain"
    CATEGORY = "DAELab/Badge/Strict"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_image": ("IMAGE",),
            "candidate_image": ("IMAGE",),
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "region_mask": ("MASK",),
            "color_policy": (["preserve", "material_intrinsic"],),
            "intrinsic_color_hex": ("STRING", {"default": "#808080"}),
            "mean_chroma_limit": ("FLOAT", {"default": 0.02, "min": 0.0, "max": 1.0, "step": 0.001}),
            "p95_chroma_limit": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 1.0, "step": 0.001}),
            "median_low_frequency_lightness_limit": ("FLOAT", {"default": 0.03, "min": 0.0, "max": 1.0, "step": 0.001}),
            "high_frequency_strength": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
            "material_id": ("STRING", {"default": "generic"}),
            "material_strength": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 1.5, "step": 0.05}),
            "mid_frequency_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.5, "step": 0.05}),
            "minimum_visible_mean": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.25, "step": 0.001}),
            "minimum_visible_p95": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.4, "step": 0.001}),
            "pattern_seed": ("INT", {"default": 0, "min": 0, "max": 2147483647}),
            "deterministic_fallback": ("BOOLEAN", {"default": True}),
        }}

    def constrain(
        self,
        base_image,
        candidate_image,
        flat_image,
        height_map,
        region_mask,
        color_policy="preserve",
        intrinsic_color_hex="#808080",
        mean_chroma_limit=0.02,
        p95_chroma_limit=0.05,
        median_low_frequency_lightness_limit=0.03,
        high_frequency_strength=0.35,
        material_id="generic",
        material_strength=1.0,
        mid_frequency_strength=1.0,
        minimum_visible_mean=0.0,
        minimum_visible_p95=0.0,
        pattern_seed=0,
        deterministic_fallback=True,
    ):
        base = _image_float(base_image, "base_image")
        candidate_invalid = not isinstance(candidate_image, torch.Tensor) or not torch.isfinite(candidate_image).all().item()
        candidate = base.clone() if candidate_invalid else _image_float(candidate_image, "candidate_image")
        flat = _image_float(flat_image, "flat_image")
        batch, height, width, _ = base.shape
        candidate = _broadcast(candidate, batch, "candidate_image")
        flat = _broadcast(flat, batch, "flat_image")
        if candidate.shape[1:3] != (height, width):
            candidate = _resize_image(candidate, height, width)
        if flat.shape[1:3] != (height, width):
            flat = _resize_image(flat, height, width)
        height_value = _broadcast(_mask_float(height_map, "height_map"), batch, "height_map")
        mask = (_broadcast(_mask_float(region_mask, "region_mask"), batch, "region_mask") > 0.5)
        if height_value.shape[1:] != (height, width) or mask.shape[1:] != (height, width):
            raise ValueError("base, flat, height, and region mask canvases must match.")

        # Protect the one-pixel inner mask boundary plus artwork/height jumps and text-like line edges.
        mask_channel = mask.float().unsqueeze(1)
        eroded = 1.0 - F.max_pool2d(1.0 - mask_channel, kernel_size=3, stride=1, padding=1)
        region_edge = mask_channel > eroded + 0.5
        flat_cf = flat.permute(0, 3, 1, 2)
        flat_dx = F.pad((flat_cf[:, :, :, 1:] - flat_cf[:, :, :, :-1]).abs().amax(1, keepdim=True), (0, 1, 0, 0))
        flat_dy = F.pad((flat_cf[:, :, 1:, :] - flat_cf[:, :, :-1, :]).abs().amax(1, keepdim=True), (0, 0, 0, 1))
        height_cf = height_value.unsqueeze(1)
        height_dx = F.pad((height_cf[:, :, :, 1:] - height_cf[:, :, :, :-1]).abs(), (0, 1, 0, 0))
        height_dy = F.pad((height_cf[:, :, 1:, :] - height_cf[:, :, :-1, :]).abs(), (0, 0, 0, 1))
        structure_edge = (torch.maximum(flat_dx, flat_dy) > 0.08) | (torch.maximum(height_dx, height_dy) > 0.05)
        structure_guard = F.max_pool2d(structure_edge.float(), 3, 1, 1) > 0.5
        guard = (region_edge | structure_guard) & (mask_channel > 0.5)

        weights = []
        for index in range(batch):
            distance = cv2.distanceTransform(mask[index].detach().cpu().numpy().astype(np.uint8), cv2.DIST_L2, 3)
            weight = np.clip((distance - 1.0) / 2.0, 0.0, 1.0)
            weights.append(torch.from_numpy(weight).to(base.device, base.dtype))
        weight = torch.stack(weights).unsqueeze(1)
        weight = torch.where(guard, torch.zeros_like(weight), weight)
        weight = torch.where(mask_channel > 0.5, weight, torch.zeros_like(weight))

        base_lab = _rgb_to_oklab(base)
        candidate_lab = _rgb_to_oklab(candidate)
        flat_lab = _rgb_to_oklab(flat)
        base_light = base_lab[..., 0].unsqueeze(1)
        candidate_light = candidate_lab[..., 0].unsqueeze(1)
        profile = _material_render_profile(material_id)
        requested_strength = max(0.25, min(1.5, float(material_strength)))
        editable = weight[:, 0] > 0.0
        evaluation_mask = weight[:, 0] > 0.99
        if not evaluation_mask.any().item():
            evaluation_mask = editable

        candidate_light_delta = candidate_light - base_light
        candidate_small = _box_blur(candidate_light_delta, 2)
        candidate_large = _box_blur(candidate_light_delta, 18)
        candidate_mid = (candidate_small - candidate_large).clamp(-0.14, 0.16)
        candidate_high = (candidate_light_delta - candidate_small).clamp(-0.12, 0.16)
        candidate_signal = (
            candidate_mid * float(profile["mid_gain"]) * float(mid_frequency_strength)
            + candidate_high * float(profile["high_gain"]) * float(high_frequency_strength)
        ) * float(profile["base_strength"]) * requested_strength
        candidate_signal, candidate_signal_report = _boost_material_signal(
            candidate_signal,
            evaluation_mask,
            profile,
            requested_strength,
        )

        if color_policy == "material_intrinsic":
            intrinsic = _parse_hex(intrinsic_color_hex, device=base.device).view(1, 1, 1, 3)
            intrinsic_lab = _rgb_to_oklab(intrinsic)
            target_a = intrinsic_lab[..., 1].expand(batch, height, width)
            target_b = intrinsic_lab[..., 2].expand(batch, height, width)
        else:
            target_a, target_b = flat_lab[..., 1], flat_lab[..., 2]

        candidate_a = (candidate_lab[..., 1] - base_lab[..., 1]).unsqueeze(1)
        candidate_b = (candidate_lab[..., 2] - base_lab[..., 2]).unsqueeze(1)
        chroma_a = candidate_a - _box_blur(candidate_a, 4)
        chroma_b = candidate_b - _box_blur(candidate_b, 4)
        chroma_radius = torch.sqrt(chroma_a.pow(2) + chroma_b.pow(2)).clamp_min(1e-6)
        chroma_limit = 0.018
        chroma_scale = torch.clamp(chroma_limit / chroma_radius, max=1.0)
        chroma_gain = float(profile["chroma_gain"]) * requested_strength
        chroma_a = chroma_a * chroma_scale * chroma_gain
        chroma_b = chroma_b * chroma_scale * chroma_gain

        blend = weight.permute(0, 2, 3, 1)
        guard_image = guard.permute(0, 2, 3, 1)

        def compose(signal, detail_a, detail_b):
            output_light = (base_light + signal).clamp(0.03, 0.97)
            corrected_lab = torch.stack((
                output_light[:, 0],
                target_a + detail_a[:, 0],
                target_b + detail_b[:, 0],
            ), dim=-1)
            corrected = _oklab_to_rgb(corrected_lab)
            output = base * (1.0 - blend) + corrected * blend
            output = torch.where(mask.unsqueeze(-1), output, base)
            return torch.where(guard_image, base, output)

        def measure(output):
            result_lab = _rgb_to_oklab(output)
            if evaluation_mask.any().item():
                chroma_error = torch.sqrt(
                    (result_lab[..., 1] - target_a).pow(2)
                    + (result_lab[..., 2] - target_b).pow(2)
                )[evaluation_mask]
                mean_chroma_value = float(chroma_error.mean().item())
                p95_chroma_value = float(torch.quantile(chroma_error, 0.95).item())
                low_error = (
                    _box_blur(result_lab[..., 0].unsqueeze(1), 24)
                    - _box_blur(base_light, 24)
                ).abs()[:, 0][evaluation_mask]
                median_low_value = float(torch.median(low_error).item())
                visible_delta = (result_lab[..., 0] - base_lab[..., 0]).abs()[evaluation_mask]
                visible_mean_value = float(visible_delta.mean().item())
                visible_p95_value = float(torch.quantile(visible_delta, 0.95).item())
                rgb_delta = (output - base).abs().amax(dim=-1)[evaluation_mask]
                changed_ratio_value = float((rgb_delta >= (2.0 / 255.0)).float().mean().item())
            else:
                mean_chroma_value = p95_chroma_value = median_low_value = 0.0
                visible_mean_value = visible_p95_value = changed_ratio_value = 0.0
            outside_value = float(((output - base).abs() * (~mask).unsqueeze(-1)).max().item())
            guard_value = float(((output - base).abs() * guard_image).max().item())
            return {
                "mean_chroma": mean_chroma_value,
                "p95_chroma": p95_chroma_value,
                "median_low": median_low_value,
                "visible_mean": visible_mean_value,
                "visible_p95": visible_p95_value,
                "changed_ratio": changed_ratio_value,
                "outside_max": outside_value,
                "guard_max": guard_value,
            }

        required_visible_mean = max(
            float(minimum_visible_mean),
            float(profile["target_mean"]) * requested_strength * 0.72,
        )
        required_visible_p95 = max(
            float(minimum_visible_p95),
            float(profile["target_p95"]) * requested_strength * 0.72,
        )
        constrained = compose(candidate_signal, chroma_a, chroma_b)
        candidate_metrics = measure(constrained)
        candidate_safe = (
            not candidate_invalid
            and not candidate_signal_report["weak"]
            and candidate_metrics["mean_chroma"] <= float(mean_chroma_limit)
            and candidate_metrics["p95_chroma"] <= float(p95_chroma_limit)
            and candidate_metrics["median_low"] <= float(median_low_frequency_lightness_limit)
            and candidate_metrics["outside_max"] == 0.0
            and candidate_metrics["guard_max"] == 0.0
            and candidate_metrics["visible_mean"] >= required_visible_mean
            and candidate_metrics["visible_p95"] >= required_visible_p95
        )

        fallback_reason = None
        output_source = "gpt_candidate"
        final_metrics = candidate_metrics
        if not candidate_safe:
            if candidate_invalid:
                fallback_reason = "candidate_invalid"
            elif candidate_signal_report["weak"]:
                fallback_reason = "candidate_material_signal_too_weak"
            elif (
                candidate_metrics["visible_mean"] < required_visible_mean
                or candidate_metrics["visible_p95"] < required_visible_p95
            ):
                fallback_reason = "candidate_output_too_weak"
            else:
                fallback_reason = "candidate_constraint_rejected"
            if deterministic_fallback:
                fallback_signal = _deterministic_material_signal(
                    material_id,
                    batch,
                    height,
                    width,
                    pattern_seed,
                    base.device,
                    base.dtype,
                ) * float(profile["base_strength"]) * requested_strength
                fallback_signal, fallback_signal_report = _boost_material_signal(
                    fallback_signal,
                    evaluation_mask,
                    profile,
                    requested_strength,
                )
                zero_chroma = torch.zeros_like(chroma_a)
                constrained = compose(fallback_signal, zero_chroma, zero_chroma)
                final_metrics = measure(constrained)
                output_source = "deterministic_material_fallback"
                for _ in range(4):
                    if (
                        final_metrics["mean_chroma"] <= float(mean_chroma_limit)
                        and final_metrics["p95_chroma"] <= float(p95_chroma_limit)
                        and final_metrics["median_low"] <= float(median_low_frequency_lightness_limit)
                    ):
                        break
                    fallback_signal = fallback_signal * 0.75
                    constrained = compose(fallback_signal, zero_chroma, zero_chroma)
                    final_metrics = measure(constrained)
            else:
                fallback_signal_report = None
                constrained = base.clone()
                final_metrics = measure(constrained)
                output_source = "base_fallback"
        else:
            fallback_signal_report = None

        final_safe = (
            final_metrics["mean_chroma"] <= float(mean_chroma_limit)
            and final_metrics["p95_chroma"] <= float(p95_chroma_limit)
            and final_metrics["median_low"] <= float(median_low_frequency_lightness_limit)
            and final_metrics["outside_max"] == 0.0
            and final_metrics["guard_max"] == 0.0
        )
        if not final_safe:
            constrained = base.clone()
            final_metrics = measure(constrained)
            output_source = "base_safety_fallback"
            fallback_reason = f"{fallback_reason or 'candidate_constraint_rejected'};deterministic_fallback_failed_safety"

        mean_chroma = final_metrics["mean_chroma"]
        p95_chroma = final_metrics["p95_chroma"]
        median_low = final_metrics["median_low"]
        outside_max = final_metrics["outside_max"]
        guard_max = final_metrics["guard_max"]
        accepted = candidate_safe
        report = {
            "accepted": accepted,
            "fallback": not accepted,
            "output_source": output_source,
            "fallback_reason": fallback_reason,
            "output_valid": final_safe,
            "candidate_invalid": candidate_invalid,
            "material_id": material_id,
            "material_strength": requested_strength,
            "frequency_profile": {
                "mid_gain": float(profile["mid_gain"]) * float(mid_frequency_strength),
                "high_gain": float(profile["high_gain"]) * float(high_frequency_strength),
                "base_strength": float(profile["base_strength"]),
            },
            "color_policy": color_policy,
            "mean_chroma_error": mean_chroma,
            "p95_chroma_error": p95_chroma,
            "median_low_frequency_lightness_error": median_low,
            "required_visible_mean": required_visible_mean,
            "required_visible_p95": required_visible_p95,
            "candidate_visible_mean": candidate_metrics["visible_mean"],
            "candidate_visible_p95": candidate_metrics["visible_p95"],
            "output_visible_mean": final_metrics["visible_mean"],
            "output_visible_p95": final_metrics["visible_p95"],
            "output_changed_pixel_ratio": final_metrics["changed_ratio"],
            "candidate_signal": candidate_signal_report,
            "fallback_signal": fallback_signal_report,
            "outside_max_abs_diff": outside_max,
            "structure_guard_max_abs_diff": guard_max,
            "guard_pixels": int(guard.sum().item()),
            "editable_pixels": int((weight > 0).sum().item()),
        }
        return constrained, weight[:, 0], accepted, mean_chroma, p95_chroma, median_low, outside_max, json.dumps(report, separators=(",", ":"))


class BadgeStudioCompositeV1:
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("studio_image", "shadow_mask", "report")
    FUNCTION = "composite"
    CATEGORY = "DAELab/Badge/Strict"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "badge_image": ("IMAGE",),
            "foreground_mask": ("MASK",),
            "background_color": ("STRING", {"default": "#FFFFFF"}),
            "shadow_opacity": ("FLOAT", {"default": 0.10, "min": 0.0, "max": 1.0, "step": 0.01}),
            "shadow_blur_px": ("INT", {"default": 10, "min": 0, "max": 100}),
            "shadow_offset_x": ("INT", {"default": 0, "min": -100, "max": 100}),
            "shadow_offset_y": ("INT", {"default": 6, "min": -100, "max": 100}),
            "edge_light_strength": ("FLOAT", {"default": 0.04, "min": 0.0, "max": 1.0, "step": 0.01}),
            "enforce_1024": ("BOOLEAN", {"default": True}),
        }}

    def composite(self, badge_image, foreground_mask, background_color="#FFFFFF", shadow_opacity=0.10, shadow_blur_px=10, shadow_offset_x=0, shadow_offset_y=6, edge_light_strength=0.04, enforce_1024=True):
        if str(background_color).strip().upper() != "#FFFFFF":
            raise ValueError("Badge Studio Composite V1 background_color is fixed to #FFFFFF.")
        badge = _image_float(badge_image, "badge_image")
        batch, height, width, _ = badge.shape
        if enforce_1024 and (height, width) != (1024, 1024):
            raise ValueError("Badge Studio Composite V1 requires a 1024x1024 canvas.")
        mask = (_broadcast(_mask_float(foreground_mask, "foreground_mask"), batch, "foreground_mask") > 0.5).float()
        if mask.shape[1:] != (height, width):
            raise ValueError("foreground_mask must match badge_image dimensions.")
        shifted = torch.zeros_like(mask)
        dx, dy = int(shadow_offset_x), int(shadow_offset_y)
        source_x0, source_x1 = max(0, -dx), min(width, width - dx)
        source_y0, source_y1 = max(0, -dy), min(height, height - dy)
        target_x0, target_x1 = source_x0 + dx, source_x1 + dx
        target_y0, target_y1 = source_y0 + dy, source_y1 + dy
        if source_x1 > source_x0 and source_y1 > source_y0:
            shifted[:, target_y0:target_y1, target_x0:target_x1] = mask[:, source_y0:source_y1, source_x0:source_x1]
        shadows = []
        blur = max(0, int(shadow_blur_px))
        kernel = blur * 2 + 1
        for value in shifted:
            array = value.detach().cpu().numpy()
            blurred = cv2.GaussianBlur(array, (kernel, kernel), sigmaX=max(0.1, blur / 2.0)) if blur else array
            shadows.append(torch.from_numpy(blurred).to(mask.device, mask.dtype))
        shadow = torch.stack(shadows).clamp(0.0, 1.0)
        background = _parse_hex(background_color, "#FFFFFF", badge.device).view(1, 1, 1, 3)
        canvas = background.expand_as(badge).clone()
        canvas = canvas * (1.0 - shadow.unsqueeze(-1) * float(shadow_opacity))
        eroded = 1.0 - F.max_pool2d(1.0 - mask.unsqueeze(1), 3, 1, 1)
        inner_edge = (mask.unsqueeze(1) - eroded).clamp(0.0, 1.0)[:, 0]
        lit_badge = (badge + inner_edge.unsqueeze(-1) * float(edge_light_strength)).clamp(0.0, 1.0)
        output = torch.where(mask.unsqueeze(-1) > 0.5, lit_badge, canvas)
        report = {
            "background_color": "#FFFFFF" if background_color.upper() == "#FFFFFF" else background_color.upper(),
            "shadow": {"opacity": float(shadow_opacity), "blur_px": blur, "offset": [dx, dy]},
            "edge_light_strength": float(edge_light_strength),
            "canvas": [width, height],
            "generative_repaint": False,
        }
        return output, shadow, json.dumps(report, separators=(",", ":"))


def _validated_semantic_mask(base_image, region_mask, foreground_mask):
    base = _image_float(base_image, "base_image")
    if base.shape[0] != 1:
        raise ValueError("GPT masked editing requires exactly one immutable base image.")
    region = _broadcast(_mask_float(region_mask, "region_mask"), 1, "region_mask")
    foreground = _broadcast(_mask_float(foreground_mask, "foreground_mask"), 1, "foreground_mask")
    if region.shape[1:] != base.shape[1:3] or foreground.shape[1:] != base.shape[1:3]:
        raise ValueError("base_image, region_mask, and foreground_mask must share the same canvas.")
    return base, ((region > 0.5) & (foreground > 0.5)).to(base.dtype)


def _semantic_prompt(user_prompt):
    instruction = str(user_prompt or "").strip()
    if not instruction:
        instruction = "Refine the selected region while preserving its original design intent."
    return (
        "Image 1 is the completed badge material master and the only reference image. "
        "Edit only pixels selected by the white mask. Keep every pixel outside the mask visually unchanged. "
        "Preserve the badge canvas, camera, framing, silhouette, geometry, visible text, typography, linework, "
        "region boundaries, neighboring materials, and background. Do not expand beyond the mask, reinterpret "
        "the design, add unrelated objects, change perspective, or create a studio scene. This is a local semantic "
        "repaint, not a full-image regeneration.\n\nLOCAL EDIT INSTRUCTION: " + instruction
    )


def _merge_semantic_channels(base_image, channels):
    base = _image_float(base_image, "base_image")
    batch, height, width, _ = base.shape
    result = base.clone()
    total_weight = torch.zeros((batch, height, width), device=base.device, dtype=base.dtype)
    statuses = []
    for slot, (region_image, region_mask, status) in enumerate(channels, start=1):
        image = _broadcast(_image_float(region_image, f"region_{slot}_image"), batch, f"region_{slot}_image")
        mask = _broadcast(_mask_float(region_mask, f"region_{slot}_mask"), batch, f"region_{slot}_mask")
        if image.shape[1:3] != (height, width) or mask.shape[1:] != (height, width):
            raise ValueError(f"Semantic channel {slot} must match the base canvas.")
        mask = (mask > 0.5).to(base.dtype)
        result = result * (1.0 - mask.unsqueeze(-1)) + image * mask.unsqueeze(-1)
        total_weight += mask
        try:
            statuses.append(json.loads(str(status or "{}")))
        except (TypeError, json.JSONDecodeError):
            statuses.append({"region_slot": slot, "status_parse_error": True})
    outside = (total_weight <= 0.0).unsqueeze(-1)
    outside_max = float(torch.where(outside, (result - base).abs(), torch.zeros_like(result)).max().item())
    overlap_pixels = int((total_weight > 1.0).sum().item())
    return result.clamp(0.0, 1.0), statuses, overlap_pixels, outside_max


class BadgeSemanticRegionMergeV1:
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "report")
    FUNCTION = "merge"
    CATEGORY = "DAELab/Badge/PP"
    DESCRIPTION = "Merge four strict semantic repaint channels. Later slots win on overlap."

    @classmethod
    def INPUT_TYPES(cls):
        required = {"base_image": ("IMAGE",)}
        for slot in range(1, 5):
            required[f"region_{slot}_image"] = ("IMAGE",)
            required[f"region_{slot}_mask"] = ("MASK",)
            required[f"region_{slot}_status"] = ("STRING", {"forceInput": True})
        return {"required": required}

    def merge(self, base_image, **kwargs):
        channels = [(
            kwargs[f"region_{slot}_image"],
            kwargs[f"region_{slot}_mask"],
            kwargs[f"region_{slot}_status"],
        ) for slot in range(1, 5)]
        image, statuses, overlap_pixels, outside_max = _merge_semantic_channels(base_image, channels)
        report = {
            "visible_semantic_channels": 4,
            "gpt_node_use_count": sum(bool(item.get("gpt_node_used")) for item in statuses),
            "overlap_policy": "later_slot_wins",
            "overlap_pixels": overlap_pixels,
            "outside_max_abs_diff": outside_max,
            "channels": statuses,
        }
        return image, json.dumps(report, ensure_ascii=False, separators=(",", ":"))


class BadgeStudioColorLockV1:
    RETURN_TYPES = ("IMAGE", "IMAGE", "FLOAT", "STRING")
    RETURN_NAMES = ("presentation_image", "color_locked_badge", "subject_geometry_max_diff", "report")
    FUNCTION = "compose"
    CATEGORY = "DAELab/Badge/PP"
    DESCRIPTION = "Deterministically restore badge geometry and pull subject chroma toward the normalized flat artwork."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "editable_master": ("IMAGE",),
            "studio_candidate": ("IMAGE",),
            "flat_image": ("IMAGE",),
            "foreground_mask": ("MASK",),
            "color_lock_strength": ("FLOAT", {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01}),
            "neutral_material_protection": ("FLOAT", {"default": 0.75, "min": 0.0, "max": 1.0, "step": 0.01}),
        }}

    def compose(
        self,
        editable_master,
        studio_candidate,
        flat_image,
        foreground_mask,
        color_lock_strength=0.65,
        neutral_material_protection=0.75,
    ):
        master = _image_float(editable_master, "editable_master")
        studio = _broadcast(_image_float(studio_candidate, "studio_candidate"), master.shape[0], "studio_candidate")
        flat = _broadcast(_image_float(flat_image, "flat_image"), master.shape[0], "flat_image")
        foreground = _broadcast(_mask_float(foreground_mask, "foreground_mask"), master.shape[0], "foreground_mask")
        if studio.shape != master.shape or flat.shape != master.shape or foreground.shape[1:] != master.shape[1:3]:
            raise ValueError("All studio color-lock inputs must share identical batch and canvas dimensions.")
        foreground = (foreground > 0.5).to(master.dtype)
        master_lab = _rgb_to_oklab(master)
        flat_lab = _rgb_to_oklab(flat)
        flat_chroma = torch.linalg.vector_norm(flat_lab[..., 1:3], dim=-1)
        neutral_scale = (flat_chroma / 0.08).clamp(0.0, 1.0)
        protection = float(neutral_material_protection)
        effective = float(color_lock_strength) * ((1.0 - protection) + protection * neutral_scale)
        locked_lab = master_lab.clone()
        locked_lab[..., 1:3] = (
            master_lab[..., 1:3] * (1.0 - effective.unsqueeze(-1))
            + flat_lab[..., 1:3] * effective.unsqueeze(-1)
        )
        locked = _oklab_to_rgb(locked_lab)
        subject = torch.where(foreground.unsqueeze(-1) > 0.5, locked, master)
        presentation = torch.where(foreground.unsqueeze(-1) > 0.5, subject, studio)
        geometry_diff = float(
            (((presentation - subject).abs()) * foreground.unsqueeze(-1)).max().item()
        )
        report = {
            "color_space": "OKLab",
            "color_lock_strength": float(color_lock_strength),
            "neutral_material_protection": protection,
            "subject_geometry_policy": "editable_master_foreground_reinserted_exactly_after_chroma_lock",
            "studio_candidate_used_only_outside_foreground": True,
            "subject_geometry_max_diff": geometry_diff,
        }
        return presentation, subject, geometry_diff, json.dumps(report, ensure_ascii=False, separators=(",", ":"))


def _executor_preflight(material_region_set, max_regions=4, minimum_region_pixels=16):
    if not isinstance(material_region_set, dict):
        raise TypeError("material_region_set must come from Badge Material Region V1.")
    assignment = material_region_set.get("assignment") or {}
    masks = material_region_set.get("region_masks") or []
    groups = assignment.get("groups") or []
    nonempty = [group for group in groups if int(group.get("matched_pixels", 0)) > 0 and group.get("material_id") != DEFAULT_MATERIAL_ID]
    if len(nonempty) > int(max_regions):
        raise ValueError(f"Material API budget exceeded before GPT execution: {len(nonempty)} active regions; maximum is {int(max_regions)}.")
    active, skipped = [], []
    for index, group in enumerate(groups):
        pixels = int(group.get("matched_pixels", 0))
        reason = None
        if pixels <= 0:
            reason = "empty"
        elif group.get("material_id") == DEFAULT_MATERIAL_ID:
            reason = "transparent_lacquer"
        elif pixels < int(minimum_region_pixels):
            reason = "too_small"
        elif index >= len(masks):
            reason = "missing_mask"
        if reason:
            skipped.append({"id": group.get("id"), "reason": reason})
        else:
            active.append((group, masks[index]))
    return active, skipped


def _material_channel_plan(material_region_set, region_slot=1, max_regions=4, minimum_region_pixels=16):
    """Resolve one visible GPT channel without creating an API node."""
    slot = int(region_slot)
    if slot < 1 or slot > 4:
        raise ValueError("region_slot must be between 1 and 4.")
    active, skipped = _executor_preflight(material_region_set, max_regions, minimum_region_pixels)
    selected = active[slot - 1] if slot <= len(active) else None
    return selected, active, skipped


def _channel_status(group, region_slot, quality, *, active_count, skipped, gpt_used):
    region_id = str(group.get("id")) if group else None
    material_id = str(group.get("material_id")) if group else None
    safe_id = SAFE_ID.sub("", region_id or "region")[:80] or "region"
    return json.dumps({
        "region_slot": int(region_slot),
        "gpt_node_used": bool(gpt_used),
        "billable_api_request_on_cache_miss": bool(gpt_used),
        "native_gpt_node_type": "OpenAIGPTImageNodeV2" if gpt_used else None,
        "gpt_node_id": f"gpt_{safe_id}" if gpt_used else None,
        "region_id": region_id,
        "material_id": material_id,
        "material_strength": float(group.get("material_strength", 1.0)) if group else None,
        "reroll_revision": int(group.get("reroll_revision", 0)) if group else None,
        "quality": str(quality),
        "active_region_count": int(active_count),
        "reason": "active_material_region" if gpt_used else "no_active_region_for_slot",
        "skipped": skipped,
    }, ensure_ascii=False, separators=(",", ":"))


def _merge_material_channels(base_image, channels):
    base = _image_float(base_image, "base_image")
    batch, height, width, _ = base.shape
    result = base.clone()
    total_weight = torch.zeros((batch, height, width), device=base.device, dtype=base.dtype)
    reports = []
    for index, (region_image, region_mask, status) in enumerate(channels, start=1):
        image = _image_float(region_image, f"region_{index}_image")
        image = _broadcast(image, batch, f"region_{index}_image")
        if image.shape[1:3] != (height, width):
            raise ValueError(f"region_{index}_image must match base_image dimensions.")
        weight = _broadcast(_mask_float(region_mask, f"region_{index}_mask"), batch, f"region_{index}_mask")
        if weight.shape[1:] != (height, width):
            raise ValueError(f"region_{index}_mask must match base_image dimensions.")
        weight = weight.clamp(0.0, 1.0)
        total_weight = total_weight + weight
        result = result * (1.0 - weight.unsqueeze(-1)) + image * weight.unsqueeze(-1)
        try:
            parsed = json.loads(str(status or "{}"))
        except (TypeError, json.JSONDecodeError):
            parsed = {"region_slot": index, "gpt_node_used": False, "status_parse_error": True}
        reports.append(parsed)
    overlap = float((total_weight - 1.0).clamp_min(0.0).max().item())
    if overlap > 1e-6:
        raise ValueError(f"Visible material channel masks overlap by {overlap:.8f}; merge stopped.")
    outside = (total_weight <= 0.0).unsqueeze(-1)
    outside_max = float(torch.where(outside, (result - base).abs(), torch.zeros_like(result)).max().item())
    return result.clamp(0.0, 1.0), reports, overlap, outside_max


class BadgeMaterialRegionMergeV1:
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "report")
    FUNCTION = "merge"
    CATEGORY = "DAELab/Badge/Strict"
    DESCRIPTION = "Merge four visible GPT-Image-2 material channels with mutually exclusive strict masks."

    @classmethod
    def INPUT_TYPES(cls):
        required = {"base_image": ("IMAGE",)}
        for slot in range(1, 5):
            required[f"region_{slot}_image"] = ("IMAGE",)
            required[f"region_{slot}_mask"] = ("MASK",)
            required[f"region_{slot}_status"] = ("STRING", {"forceInput": True})
        return {"required": required}

    def merge(self, base_image, **kwargs):
        channels = [
            (
                kwargs[f"region_{slot}_image"],
                kwargs[f"region_{slot}_mask"],
                kwargs[f"region_{slot}_status"],
            )
            for slot in range(1, 5)
        ]
        image, statuses, overlap, outside_max = _merge_material_channels(base_image, channels)
        report = json.dumps({
            "visible_gpt_channels": 4,
            "gpt_node_use_count": sum(bool(item.get("gpt_node_used")) for item in statuses),
            "billing_note": "An active GPT node can reuse cache; a billable API request occurs only on cache miss.",
            "native_gpt_node_type": "OpenAIGPTImageNodeV2",
            "immutable_base_for_all_gpt_nodes": True,
            "maximum_channel_overlap": overlap,
            "outside_max_abs_diff": outside_max,
            "channels": statuses,
        }, ensure_ascii=False, separators=(",", ":"))
        return image, report


if comfy_io is not None:
    MaterialRegionSetType = comfy_io.Custom("BADGE_MATERIAL_REGION_SET")

    class BadgeMaterialRegionGPTChannelV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="BadgeMaterialRegionGPTChannelV1",
                display_name="GPT-Image-2 Material Region Channel V1",
                category="DAELab/Badge/Strict",
                description=(
                    "Visible, billable-call-aware material channel. It expands exactly one native "
                    "OpenAI GPT Image 2 node only when its active region slot exists."
                ),
                enable_expand=True,
                inputs=[
                    comfy_io.Image.Input("base_image"),
                    comfy_io.Image.Input("flat_image"),
                    comfy_io.Mask.Input("height_map"),
                    MaterialRegionSetType.Input("material_region_set"),
                    comfy_io.Int.Input("region_slot", default=1, min=1, max=4),
                    comfy_io.Combo.Input("quality", options=["low", "medium", "high"], default="medium"),
                    comfy_io.Int.Input("max_regions", default=4, min=1, max=4),
                    comfy_io.Int.Input("minimum_region_pixels", default=16, min=1, max=65536),
                ],
                outputs=[
                    comfy_io.Image.Output("region_image"),
                    comfy_io.Mask.Output("region_mask"),
                    comfy_io.String.Output("call_status"),
                ],
            )

        @classmethod
        def execute(
            cls,
            base_image,
            flat_image,
            height_map,
            material_region_set,
            region_slot=1,
            quality="medium",
            max_regions=4,
            minimum_region_pixels=16,
        ):
            base = _image_float(base_image, "base_image")
            if base.shape[0] != 1:
                raise ValueError("GPT masked editing requires exactly one immutable base image.")
            selected, active, skipped = _material_channel_plan(
                material_region_set,
                region_slot,
                max_regions,
                minimum_region_pixels,
            )
            if selected is None:
                empty = torch.zeros(base.shape[:3], device=base.device, dtype=base.dtype)
                status = _channel_status(
                    None,
                    region_slot,
                    quality,
                    active_count=len(active),
                    skipped=skipped,
                    gpt_used=False,
                )
                return comfy_io.NodeOutput(base_image, empty, status)

            group, region_mask = selected
            region_id = SAFE_ID.sub("", str(group.get("id") or "region"))[:80] or "region"
            material = _load_materials().get(group.get("material_id"), {})
            prompt = build_region_edit_prompt(group, material)
            graph = GraphBuilder()
            gpt = graph.node(
                "OpenAIGPTImageNodeV2",
                id=f"gpt_{region_id}",
                prompt=prompt,
                model="gpt-image-2",
                **{
                    "model.size": "1024x1024",
                    "model.custom_width": 1024,
                    "model.custom_height": 1024,
                    "model.background": "opaque",
                    "model.quality": quality,
                    "model.images.image_1": base_image,
                    "model.mask": region_mask,
                },
                n=1,
                seed=int(group.get("reroll_revision", 0)),
            )
            constraint = graph.node(
                "BadgeMaterialConstraintV1",
                id=f"constraint_{region_id}",
                base_image=base_image,
                candidate_image=gpt.out(0),
                flat_image=flat_image,
                height_map=height_map,
                region_mask=region_mask,
                color_policy=group.get("color_policy", "preserve"),
                intrinsic_color_hex=material.get("intrinsic_color_hex", "#808080"),
                mean_chroma_limit=0.02,
                p95_chroma_limit=0.05,
                median_low_frequency_lightness_limit=0.03,
                high_frequency_strength=1.0,
                material_id=group.get("material_id", "generic"),
                material_strength=float(group.get("material_strength", 1.0)),
                mid_frequency_strength=1.0,
                minimum_visible_mean=0.0,
                minimum_visible_p95=0.0,
                pattern_seed=int(group.get("reroll_revision", 0)),
                deterministic_fallback=True,
            )
            status = _channel_status(
                group,
                region_slot,
                quality,
                active_count=len(active),
                skipped=skipped,
                gpt_used=True,
            )
            return comfy_io.NodeOutput(
                constraint.out(0),
                constraint.out(1),
                status,
                expand=graph.finalize(),
            )

    class BadgeSemanticRegionGPTChannelV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeSemanticRegionGPTChannelV1",
                display_name="Badge Semantic Region GPT Channel V1",
                category="DAELab/Badge/PP",
                description=(
                    "One visible GPT-Image-2 local semantic repaint channel. Disabled, empty, or tiny masks "
                    "return the immutable base without expanding a billable API node."
                ),
                enable_expand=True,
                inputs=[
                    comfy_io.Image.Input("base_image"),
                    comfy_io.Mask.Input("region_mask"),
                    comfy_io.Mask.Input("foreground_mask"),
                    comfy_io.Boolean.Input("enabled", default=False),
                    comfy_io.String.Input(
                        "edit_prompt",
                        default="Refine the selected region while preserving its original color and boundaries.",
                        multiline=True,
                    ),
                    comfy_io.Combo.Input("quality", options=["low", "medium", "high"], default="medium"),
                    comfy_io.Int.Input("reroll_revision", default=0, min=0, max=2147483647),
                    comfy_io.Int.Input("minimum_region_pixels", default=16, min=1, max=65536),
                ],
                outputs=[
                    comfy_io.Image.Output("region_image"),
                    comfy_io.Mask.Output("validated_mask"),
                    comfy_io.String.Output("call_status"),
                ],
            )

        @classmethod
        def execute(
            cls,
            base_image,
            region_mask,
            foreground_mask,
            enabled=False,
            edit_prompt="",
            quality="medium",
            reroll_revision=0,
            minimum_region_pixels=16,
        ):
            base, validated = _validated_semantic_mask(base_image, region_mask, foreground_mask)
            selected_pixels = int(validated.sum().item())
            active = bool(enabled) and selected_pixels >= int(minimum_region_pixels)
            reason = "active_semantic_region" if active else (
                "disabled" if not bool(enabled) else "empty_or_too_small_mask"
            )
            status = json.dumps({
                "gpt_node_used": active,
                "billable_api_request_on_cache_miss": active,
                "native_gpt_node_type": "OpenAIGPTImageNodeV2" if active else None,
                "selected_pixels": selected_pixels,
                "minimum_region_pixels": int(minimum_region_pixels),
                "quality": str(quality),
                "reroll_revision": int(reroll_revision),
                "reason": reason,
                "mask_polarity": "white_is_edited",
                "masked_reference_image_count": 1,
            }, ensure_ascii=False, separators=(",", ":"))
            if not active:
                empty = torch.zeros_like(validated)
                return comfy_io.NodeOutput(base, empty, status)

            graph = GraphBuilder()
            gpt = graph.node(
                "OpenAIGPTImageNodeV2",
                id="semantic_gpt",
                prompt=_semantic_prompt(edit_prompt),
                model="gpt-image-2",
                **{
                    "model.size": "1024x1024",
                    "model.custom_width": 1024,
                    "model.custom_height": 1024,
                    "model.background": "opaque",
                    "model.quality": quality,
                    "model.images.image_1": base_image,
                    "model.mask": validated,
                },
                n=1,
                seed=int(reroll_revision),
            )
            composite = graph.node(
                "BadgeDeterministicComposite",
                id="semantic_strict_composite",
                previous_master=base_image,
                edit_candidate=gpt.out(0),
                edit_mask=validated,
            )
            return comfy_io.NodeOutput(
                composite.out(0),
                validated,
                status,
                expand=graph.finalize(),
            )

    class BadgeStudioBackgroundGPTV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeStudioBackgroundGPTV1",
                display_name="Badge Studio Background GPT V1",
                category="DAELab/Badge/PP",
                description=(
                    "Generate only the studio environment outside a protected badge foreground. "
                    "The flat artwork is applied later by the deterministic color-lock node."
                ),
                enable_expand=True,
                inputs=[
                    comfy_io.Image.Input("badge_image"),
                    comfy_io.Mask.Input("foreground_mask"),
                    comfy_io.Boolean.Input("enabled", default=True),
                    comfy_io.String.Input(
                        "studio_prompt",
                        default="Clean premium product photography on a pure white seamless studio background, soft contact shadow, controlled softbox lighting.",
                        multiline=True,
                    ),
                    comfy_io.Int.Input("protection_px", default=2, min=0, max=64),
                    comfy_io.Combo.Input("quality", options=["low", "medium", "high"], default="high"),
                    comfy_io.Int.Input("reroll_revision", default=0, min=0, max=2147483647),
                ],
                outputs=[
                    comfy_io.Image.Output("studio_candidate"),
                    comfy_io.Mask.Output("background_edit_mask"),
                    comfy_io.String.Output("call_status"),
                ],
            )

        @classmethod
        def execute(
            cls,
            badge_image,
            foreground_mask,
            enabled=True,
            studio_prompt="",
            protection_px=2,
            quality="high",
            reroll_revision=0,
        ):
            badge = _image_float(badge_image, "badge_image")
            if badge.shape[0] != 1:
                raise ValueError("Studio masked editing requires exactly one badge image.")
            foreground = _broadcast(_mask_float(foreground_mask, "foreground_mask"), 1, "foreground_mask")
            if foreground.shape[1:] != badge.shape[1:3]:
                raise ValueError("foreground_mask must match badge_image dimensions.")
            protected = (foreground > 0.5).to(badge.dtype)
            radius = max(0, int(protection_px))
            if radius:
                protected = F.max_pool2d(
                    protected.unsqueeze(1),
                    kernel_size=radius * 2 + 1,
                    stride=1,
                    padding=radius,
                )[:, 0]
            background_mask = (1.0 - protected).clamp(0.0, 1.0)
            active = bool(enabled) and int(background_mask.sum().item()) > 0
            status = json.dumps({
                "gpt_node_used": active,
                "billable_api_request_on_cache_miss": active,
                "native_gpt_node_type": "OpenAIGPTImageNodeV2" if active else None,
                "reason": "active_background_edit" if active else ("disabled" if not enabled else "empty_background_mask"),
                "protection_px": radius,
                "quality": str(quality),
                "reroll_revision": int(reroll_revision),
                "mask_polarity": "white_is_background_edit",
                "masked_reference_image_count": 1,
            }, ensure_ascii=False, separators=(",", ":"))
            if not active:
                return comfy_io.NodeOutput(badge, torch.zeros_like(background_mask), status)

            direction = str(studio_prompt or "").strip()
            prompt = (
                "Image 1 contains the completed badge master. Edit only the white background mask. "
                "The protected badge foreground, silhouette, edge, graphics, text, colors, materials, geometry, "
                "framing, scale, and position must remain unchanged. Create only a coherent product-photography "
                "environment on a clean pure white seamless studio background in the editable area. The final "
                "background must read as white, not gray, beige, colored, gradient, or environmental scenery. "
                "Do not duplicate, move, redraw, crop, or cover the badge. "
                "Keep the background compatible with the existing front-view object and reserve natural space for "
                "a subtle contact shadow.\n\nSTUDIO DIRECTION: " + direction
            )
            graph = GraphBuilder()
            gpt = graph.node(
                "OpenAIGPTImageNodeV2",
                id="studio_background_gpt",
                prompt=prompt,
                model="gpt-image-2",
                **{
                    "model.size": "1024x1024",
                    "model.custom_width": 1024,
                    "model.custom_height": 1024,
                    "model.background": "opaque",
                    "model.quality": quality,
                    "model.images.image_1": badge_image,
                    "model.mask": background_mask,
                },
                n=1,
                seed=int(reroll_revision),
            )
            return comfy_io.NodeOutput(gpt.out(0), background_mask, status, expand=graph.finalize())

    class BadgeMaterialRegionExecutorV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="BadgeMaterialRegionExecutorV1",
                display_name="Badge Material Region Executor V1",
                category="DAELab/Badge/Strict",
                description="Expand up to four independent real-mask GPT-Image-2 material edits against one immutable base.",
                enable_expand=True,
                inputs=[
                    comfy_io.Image.Input("base_image"),
                    comfy_io.Image.Input("flat_image"),
                    comfy_io.Mask.Input("height_map"),
                    MaterialRegionSetType.Input("material_region_set"),
                    comfy_io.Combo.Input("quality", options=["low", "medium", "high"], default="medium"),
                    comfy_io.Int.Input("max_regions", default=4, min=1, max=4),
                    comfy_io.Int.Input("minimum_region_pixels", default=16, min=1, max=65536),
                ],
                outputs=[comfy_io.Image.Output("image"), comfy_io.String.Output("report")],
            )

        @classmethod
        def execute(cls, base_image, flat_image, height_map, material_region_set, quality="medium", max_regions=4, minimum_region_pixels=16):
            base = _image_float(base_image, "base_image")
            if base.shape[0] != 1:
                raise ValueError("GPT masked editing requires exactly one immutable base image.")
            active, skipped = _executor_preflight(material_region_set, max_regions, minimum_region_pixels)
            graph = GraphBuilder()
            materials = _load_materials()
            current = base_image
            expanded = []
            for group, region_mask in active:
                region_id = SAFE_ID.sub("", str(group.get("id") or "region"))[:80] or "region"
                material = materials.get(group.get("material_id"), {})
                prompt = build_region_edit_prompt(group, material)
                gpt = graph.node(
                    "OpenAIGPTImageNodeV2",
                    id=f"gpt_{region_id}",
                    prompt=prompt,
                    model="gpt-image-2",
                    **{
                        "model.size": "1024x1024",
                        "model.custom_width": 1024,
                        "model.custom_height": 1024,
                        "model.background": "opaque",
                        "model.quality": quality,
                        "model.images.image_1": base_image,
                        "model.mask": region_mask,
                    },
                    n=1,
                    seed=int(group.get("reroll_revision", 0)),
                )
                constraint = graph.node(
                    "BadgeMaterialConstraintV1",
                    id=f"constraint_{region_id}",
                    base_image=base_image,
                    candidate_image=gpt.out(0),
                    flat_image=flat_image,
                    height_map=height_map,
                    region_mask=region_mask,
                    color_policy=group.get("color_policy", "preserve"),
                    intrinsic_color_hex=material.get("intrinsic_color_hex", "#808080"),
                    mean_chroma_limit=0.02,
                    p95_chroma_limit=0.05,
                    median_low_frequency_lightness_limit=0.03,
                    high_frequency_strength=1.0,
                    material_id=group.get("material_id", "generic"),
                    material_strength=float(group.get("material_strength", 1.0)),
                    mid_frequency_strength=1.0,
                    minimum_visible_mean=0.0,
                    minimum_visible_p95=0.0,
                    pattern_seed=int(group.get("reroll_revision", 0)),
                    deterministic_fallback=True,
                )
                composite = graph.node(
                    "BadgeDeterministicComposite",
                    id=f"composite_{region_id}",
                    previous_master=current,
                    edit_candidate=constraint.out(0),
                    edit_mask=region_mask,
                )
                current = composite.out(0)
                expanded.append({
                    "id": group.get("id"),
                    "material_id": group.get("material_id"),
                    "material_strength": float(group.get("material_strength", 1.0)),
                    "render_profile": _material_render_profile(group.get("material_id")),
                    "reroll_revision": int(group.get("reroll_revision", 0)),
                    "nodes": [f"gpt_{region_id}", f"constraint_{region_id}", f"composite_{region_id}"],
                })
            report = json.dumps({
                "active_region_count": len(active),
                "maximum_region_count": int(max_regions),
                "immutable_base_for_all_gpt_nodes": True,
                "masked_reference_image_count": 1,
                "expanded": expanded,
                "skipped": skipped,
            }, ensure_ascii=False, separators=(",", ":"))
            return comfy_io.NodeOutput(current, report, expand=graph.finalize())

else:
    class BadgeMaterialRegionGPTChannelV1:  # pragma: no cover
        @classmethod
        def define_schema(cls):
            return None

        @classmethod
        def execute(cls, *args, **kwargs):
            raise RuntimeError("ComfyUI V3 API is required for BadgeMaterialRegionGPTChannelV1.")

    class BadgeMaterialRegionExecutorV1:  # pragma: no cover
        @classmethod
        def define_schema(cls):
            return None

        @classmethod
        def execute(cls, *args, **kwargs):
            raise RuntimeError("ComfyUI V3 API is required for BadgeMaterialRegionExecutorV1.")

    class BadgeSemanticRegionGPTChannelV1:  # pragma: no cover
        @classmethod
        def define_schema(cls):
            return None

        @classmethod
        def execute(cls, *args, **kwargs):
            raise RuntimeError("ComfyUI V3 API is required for BadgeSemanticRegionGPTChannelV1.")

    class BadgeStudioBackgroundGPTV1:  # pragma: no cover
        @classmethod
        def define_schema(cls):
            return None

        @classmethod
        def execute(cls, *args, **kwargs):
            raise RuntimeError("ComfyUI V3 API is required for BadgeStudioBackgroundGPTV1.")


NODE_CLASS_MAPPINGS = {
    "DAELAB.BadgeMaterialCanvasNormalizeV1": BadgeMaterialCanvasNormalizeV1,
    "BadgeHeightReferenceAlignV1": BadgeHeightReferenceAlignV1,
    "BadgeHeightLockedBaseV1": BadgeHeightLockedBaseV1,
    "BadgeMaterialConstraintV1": BadgeMaterialConstraintV1,
    "BadgeMaterialRegionGPTChannelV1": BadgeMaterialRegionGPTChannelV1,
    "BadgeMaterialRegionMergeV1": BadgeMaterialRegionMergeV1,
    "BadgeMaterialRegionExecutorV1": BadgeMaterialRegionExecutorV1,
    "BadgeStudioCompositeV1": BadgeStudioCompositeV1,
    "DAELAB.BadgeSemanticRegionGPTChannelV1": BadgeSemanticRegionGPTChannelV1,
    "DAELAB.BadgeSemanticRegionMergeV1": BadgeSemanticRegionMergeV1,
    "DAELAB.BadgeStudioBackgroundGPTV1": BadgeStudioBackgroundGPTV1,
    "DAELAB.BadgeStudioColorLockV1": BadgeStudioColorLockV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.BadgeMaterialCanvasNormalizeV1": "Badge Material Canvas Normalize V1 (DAELab)",
    "BadgeHeightReferenceAlignV1": "Badge Height Reference Align V1 (DAELab)",
    "BadgeHeightLockedBaseV1": "Badge Height Locked Base V1 (DAELab)",
    "BadgeMaterialConstraintV1": "Badge Material Constraint V1 (DAELab)",
    "BadgeMaterialRegionGPTChannelV1": "GPT-Image-2 Material Region Channel V1 (DAELab)",
    "BadgeMaterialRegionMergeV1": "Badge Material Region Merge V1 (DAELab)",
    "BadgeMaterialRegionExecutorV1": "Badge Material Region Executor V1 (DAELab)",
    "BadgeStudioCompositeV1": "Badge Studio Composite V1 (DAELab)",
    "DAELAB.BadgeSemanticRegionGPTChannelV1": "Badge Semantic Region GPT Channel V1 (DAELab)",
    "DAELAB.BadgeSemanticRegionMergeV1": "Badge Semantic Region Merge V1 (DAELab)",
    "DAELAB.BadgeStudioBackgroundGPTV1": "Badge Studio Background GPT V1 (DAELab)",
    "DAELAB.BadgeStudioColorLockV1": "Badge Studio Color Lock V1 (DAELab)",
}
