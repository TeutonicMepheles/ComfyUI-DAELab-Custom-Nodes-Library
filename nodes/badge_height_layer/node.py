import hashlib
import json
import re

import torch


MAX_COLOR_GROUPS = 16
CONFIG_PROPERTY = "badge_height_layer_config"
DEFAULT_COLORS = ("#d0ad7d", "#d4e3e2", "#055652", "#26877f")
_HEX_COLOR = re.compile(r"^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _default_group(index=0):
    return {
        "enabled": True,
        "color": DEFAULT_COLORS[index % len(DEFAULT_COLORS)],
        "threshold": 30,
        "layer": min(5, index + 1),
    }


def _default_config():
    return {"version": 1, "groups": [_default_group()]}


def _as_bool(value, default=False):
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off", ""}:
            return False
        return default
    if value is None:
        return default
    return bool(value)


def _normalize_color(value, fallback):
    if not isinstance(value, str):
        return fallback
    value = value.strip()
    if not _HEX_COLOR.fullmatch(value):
        return fallback
    digits = value.lstrip("#")
    if len(digits) == 3:
        digits = "".join(character * 2 for character in digits)
    return f"#{digits.lower()}"


def _normalize_threshold(value):
    try:
        threshold = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        threshold = 30
    return min(255, max(0, threshold))


def _normalize_layer(value):
    text = str(value).strip().lower()
    if re.search(r"cut\s*out|hollow|background", text):
        return 0
    if text.startswith("layer_"):
        text = text.split("_", 1)[1]
    try:
        layer = int(round(float(text)))
    except (TypeError, ValueError, OverflowError):
        layer = 1
    return min(5, max(0, layer))


def _normalize_config(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            value = None

    source = value if isinstance(value, dict) else {}
    raw_groups = source.get("groups")
    if not isinstance(raw_groups, list):
        raw_groups = []

    groups = []
    for index, raw_group in enumerate(raw_groups[:MAX_COLOR_GROUPS]):
        fallback = _default_group(index)
        group = raw_group if isinstance(raw_group, dict) else {}
        groups.append(
            {
                "enabled": _as_bool(group.get("enabled"), fallback["enabled"]),
                "color": _normalize_color(group.get("color"), fallback["color"]),
                "threshold": _normalize_threshold(group.get("threshold")),
                "layer": _normalize_layer(group.get("layer", fallback["layer"])),
            }
        )

    if not groups:
        groups.append(_default_group())
    return {"version": 1, "groups": groups}


def _get_workflow_node(unique_id, extra_pnginfo):
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
    for node in nodes:
        if isinstance(node, dict) and str(node.get("id")) == str(unique_id):
            return node
    return None


def _get_node_config(unique_id=None, extra_pnginfo=None):
    node = _get_workflow_node(unique_id, extra_pnginfo)
    properties = node.get("properties", {}) if isinstance(node, dict) else {}
    value = properties.get(CONFIG_PROPERTY) if isinstance(properties, dict) else None
    return _normalize_config(value)


def _parse_color(value, *, device):
    normalized = _normalize_color(value, "#000000")
    channels = [int(normalized[index:index + 2], 16) / 255.0 for index in (1, 3, 5)]
    return torch.tensor(channels, dtype=torch.float32, device=device)


def _validate_images(images):
    if not isinstance(images, torch.Tensor):
        raise TypeError("images must be a torch.Tensor in ComfyUI IMAGE format [B, H, W, C].")
    if images.ndim != 4:
        raise ValueError(f"images must have shape [B, H, W, C]; received {tuple(images.shape)}.")
    if min(images.shape[:3]) < 1:
        raise ValueError(f"images must have non-empty dimensions; received {tuple(images.shape)}.")
    if images.shape[-1] not in (3, 4):
        raise ValueError(f"images must have 3 (RGB) or 4 (RGBA) channels; received {images.shape[-1]}.")
    if not images.is_floating_point():
        raise TypeError(f"images must use a floating-point dtype; received {images.dtype}.")
    if not torch.isfinite(images).all().item():
        raise ValueError("images contains NaN or infinite pixel values.")

    rgb = images[..., :3]
    minimum, maximum = rgb.amin().item(), rgb.amax().item()
    if minimum < 0.0 or maximum > 255.0:
        raise ValueError(f"images pixel values must be in [0, 1] or [0, 255]; received [{minimum}, {maximum}].")
    return rgb, maximum


def _make_height_map(images, config):
    height, height_image, unmatched, _ = _make_height_map_with_profile(images, config)
    return height, height_image, unmatched


def _make_height_map_with_profile(images, config):
    """Assign every accepted pixel to its nearest configured color and layer."""
    rgb, maximum = _validate_images(images)
    working = rgb.to(dtype=torch.float32)
    if maximum > 1.0:
        working = working / 255.0

    shape = images.shape[:3]
    height = torch.zeros(shape, dtype=torch.float32, device=images.device)
    best_distance = torch.full(shape, float("inf"), dtype=torch.float32, device=images.device)
    matched = torch.zeros(shape, dtype=torch.bool, device=images.device)
    assigned_layer = torch.full(shape, -1, dtype=torch.int8, device=images.device)

    for group in config["groups"]:
        if not group["enabled"]:
            continue
        color = _parse_color(group["color"], device=images.device)
        distance = torch.linalg.vector_norm(working - color, dim=-1)
        within = distance <= (group["threshold"] / 255.0)
        level = group["layer"] / 5.0
        closer = distance < best_distance
        tied_higher = torch.isclose(distance, best_distance, rtol=0.0, atol=1e-7) & (level > height)
        selected = within & (closer | tied_higher)
        height = torch.where(selected, level, height)
        assigned_layer = torch.where(
            selected,
            torch.full_like(assigned_layer, int(group["layer"])),
            assigned_layer,
        )
        best_distance = torch.where(selected, distance, best_distance)
        matched |= within

    if images.shape[-1] == 4:
        alpha = images[..., 3].to(dtype=torch.float32)
        if alpha.amax().item() > 1.0:
            alpha = alpha / 255.0
        transparent = alpha <= 0.0
        height = torch.where(transparent, 0.0, height)
        assigned_layer = torch.where(transparent, torch.full_like(assigned_layer, -2), assigned_layer)
        matched |= transparent

    height = height.clamp_(0.0, 1.0)
    height_image = height.unsqueeze(-1).expand(-1, -1, -1, 3).contiguous()
    unmatched = (~matched).to(dtype=torch.float32)
    configured_layers = sorted({
        int(group["layer"])
        for group in config["groups"]
        if group["enabled"]
    })
    layer_counts = {
        layer: int((assigned_layer == layer).sum().item())
        for layer in configured_layers
    }
    present_layers = [layer for layer in configured_layers if layer_counts[layer] > 0]
    profile = {
        "version": 1,
        "configured_layers": configured_layers,
        "present_layers": present_layers,
        "missing_layers": [layer for layer in configured_layers if layer_counts[layer] == 0],
        "layer_counts": {str(layer): layer_counts[layer] for layer in configured_layers},
        "alpha_values": {str(layer): layer / 5.0 for layer in present_layers},
        "unmatched_pixels": int((~matched).sum().item()),
        "transparent_pixels": int((assigned_layer == -2).sum().item()),
        "total_pixels": int(assigned_layer.numel()),
    }
    return height, height_image, unmatched, profile


def _layer_line(layer):
    alpha = layer / 5.0
    if layer == 0:
        return "- Alpha/grayscale 0.0: Cut Out, an intentional opening with no solid badge surface."
    labels = {
        1: "the lowest legal solid badge surface",
        2: "the second legal solid elevation",
        3: "the third legal solid elevation",
        4: "the fourth legal solid elevation",
        5: "the highest legal solid badge surface",
    }
    return f"- Alpha/grayscale {alpha:.1f}: Layer {layer}, {labels[layer]}."


def build_height_establish_prompt(height_profile):
    if not isinstance(height_profile, dict) or height_profile.get("version") != 1:
        raise ValueError("height_profile must be a Badge Height Layer version 1 profile.")
    present_layers = sorted({int(value) for value in height_profile.get("present_layers", [])})
    if any(layer < 0 or layer > 5 for layer in present_layers):
        raise ValueError("height_profile contains an unsupported layer outside 0-5.")
    solid_layers = [layer for layer in present_layers if layer > 0]
    if not solid_layers:
        raise ValueError("Badge Height Layer found no matched solid height level; check the color groups and input image.")

    active_lines = "\n".join(_layer_line(layer) for layer in present_layers)
    solid_count = len(solid_layers)
    cutout_note = " An explicit Cut Out level is also active." if 0 in present_layers else " No explicit Cut Out level is active."
    return f"""TASK
Establish the physical Z-axis height structure of the badge in Image 1 by using Image 2 strictly as a discrete height reference.

IMAGE ROLES
Image 1 is the sole authority for artwork, visible text, outline, layout, proportions, element positions, and base colors.
Image 2 controls physical surface height only. It does not define color, material, brightness, exposure, or lighting.

ACTIVE HEIGHT LEVELS
Image 2 contains exactly {solid_count} matched solid height level{'s' if solid_count != 1 else ''}.{cutout_note}
{active_lines}

HEIGHT RULES
Interpret the listed alpha/grayscale values as absolute discrete physical elevations, not as visual brightness.
Use only the active levels listed above. Do not invent missing layers, intermediate ramps, or additional elevations.
Preserve the absolute values and front-to-back ordering; do not renormalize the active levels into replacement values.
Generate only the sidewalls, restrained bevels, localized highlights, self-shadows, and ambient occlusion physically required by these elevations.
Keep every sidewall and bevel strictly inside the corresponding Image 1 boundary.

MANDATORY NUMERIC HEIGHT ENCODING — NON-NEGOTIABLE
For every pixel inside the Image 1 badge graphic, physical relative Z height MUST equal the normalized Alpha/grayscale value encoded at the same XY coordinate in Image 2: Z = Alpha = grayscale / 255.
Use this exact absolute mapping: 0/255 = 0.0 = empty Cut Out; 51/255 = 0.2 = Layer 1; 102/255 = 0.4 = Layer 2; 153/255 = 0.6 = Layer 3; 204/255 = 0.8 = Layer 4; 255/255 = 1.0 = Layer 5.
Pixels with the same encoded value MUST produce the same physical elevation. A numerically larger encoded value MUST always be physically higher and closer to the viewer than a smaller nonzero value at the same front-facing badge orientation.
These values are geometric data, not luminance suggestions: do not reinterpret them from apparent brightness, color, material, local contrast, lighting, neighboring regions, or artistic judgment.
Do not reorder, invert, normalize, rescale, compress, smooth, blend, interpolate, or replace the encoded levels. Do not create any height that is not explicitly encoded in Image 2, except narrow sidewalls or restrained bevels required to join two encoded plateaus.

ALPHA-ZERO / CUTOUT RULE
Every Alpha/grayscale 0.0 region in Image 2 represents empty space, never the lowest solid surface.
Zero-valued regions outside the badge silhouette remain empty background.
Any zero-valued region enclosed by or located inside the Image 1 badge graphic must remain a true through-cut opening: preserve the hole as empty/transparent space and do not fill, cap, bridge, emboss, or place material across it.
Sidewalls or restrained edge bevels may exist only along the boundary of an interior cutout; no front-facing surface may cover the opening.

DESIGN LOCK
Do not alter, redraw, move, resize, add, remove, or reinterpret any text, graphic, contour, color region, spacing, or silhouette from Image 1.
Do not reproduce Image 2 grayscale values as final badge colors.
Do not use global contrast, blur, sharpening, depth of field, or painted shading to simulate height.
This operation establishes badge height only; it is not a redesign, recoloring, material change, camera change, or presentation render."""


def build_height_profile_report(height_profile):
    configured = height_profile.get("configured_layers", [])
    present = height_profile.get("present_layers", [])
    missing = height_profile.get("missing_layers", [])
    counts = height_profile.get("layer_counts", {})
    format_layers = lambda values: ", ".join(
        "Cut Out (0.0)" if int(value) == 0 else f"Layer {int(value)} ({int(value) / 5.0:.1f})"
        for value in values
    ) or "none"
    count_text = ", ".join(
        f"L{layer}={counts.get(str(layer), 0)} px" for layer in configured
    ) or "none"
    return (
        f"Configured: {format_layers(configured)}\n"
        f"Present: {format_layers(present)}\n"
        f"Configured but empty: {format_layers(missing)}\n"
        f"Matched pixels by layer: {count_text}\n"
        f"Unmatched pixels: {int(height_profile.get('unmatched_pixels', 0))}\n"
        f"Transparent pixels excluded: {int(height_profile.get('transparent_pixels', 0))}"
    )


class DAELabBadgeHeightLayer:
    """Convert a color-ID badge drawing into a discrete six-value height map."""

    RETURN_TYPES = ("MASK", "IMAGE", "MASK", "BADGE_HEIGHT_PROFILE")
    RETURN_NAMES = ("height_mask", "height_image", "unmatched_mask", "height_profile")
    FUNCTION = "make_height_map"
    CATEGORY = "DAELab/Mask"
    DESCRIPTION = (
        "Map picked colors to Cut Out or badge height layers 1-5. "
        "Layers use fixed values 0.0, 0.2, 0.4, 0.6, 0.8 and 1.0."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"images": ("IMAGE",)},
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    @classmethod
    def IS_CHANGED(cls, images, unique_id=None, extra_pnginfo=None):
        del images
        config = _get_node_config(unique_id, extra_pnginfo)
        payload = json.dumps(config, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def make_height_map(self, images, unique_id=None, extra_pnginfo=None):
        config = _get_node_config(unique_id, extra_pnginfo)
        return _make_height_map_with_profile(images, config)


class BadgeHeightEstablishPromptBuilder:
    """Build a GPT Image height-only prompt from observed Badge Height Layer levels."""

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "height_report")
    FUNCTION = "build"
    CATEGORY = "DAELab/Badge/Prompt"
    DESCRIPTION = (
        "Build a material-independent GPT Image prompt from the height levels that "
        "actually matched pixels in Badge Height Layer."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"height_profile": ("BADGE_HEIGHT_PROFILE",)}}

    def build(self, height_profile):
        return (
            build_height_establish_prompt(height_profile),
            build_height_profile_report(height_profile),
        )


NODE_CLASS_MAPPINGS = {
    "DAELabBadgeHeightLayer": DAELabBadgeHeightLayer,
    "BadgeHeightEstablishPromptBuilder": BadgeHeightEstablishPromptBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELabBadgeHeightLayer": "Badge Height Layer (DAELab)",
    "BadgeHeightEstablishPromptBuilder": "Badge Height Establish Prompt Builder",
}
