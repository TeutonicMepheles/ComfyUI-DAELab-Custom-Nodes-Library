import hashlib
import json
import re

import torch


MAX_COLOR_GROUPS = 16
CONFIG_PROPERTY = "badge_height_layer_config"
V1_CONFIG_PROPERTY = "badge_height_layer_v1_config"
V1_CONFIG_DIGEST_PROPERTY = "badge_height_layer_v1_config_digest"
V1_CONFIG_INPUT = "height_layer_config"
DEFAULT_COLORS = ("#d0ad7d", "#d4e3e2", "#055652", "#26877f")
_HEX_COLOR = re.compile(r"^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_GROUP_ID_CHARACTER = re.compile(r"[^a-zA-Z0-9_-]")


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


def _get_node_config(
    unique_id=None,
    extra_pnginfo=None,
    property_name=CONFIG_PROPERTY,
    normalizer=_normalize_config,
):
    node = _get_workflow_node(unique_id, extra_pnginfo)
    properties = node.get("properties", {}) if isinstance(node, dict) else {}
    value = properties.get(property_name) if isinstance(properties, dict) else None
    return normalizer(value)


def _normalize_v1_config(value):
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
    used_ids = set()
    for source_index, raw_group in enumerate(raw_groups[:MAX_COLOR_GROUPS]):
        group = raw_group if isinstance(raw_group, dict) else {}
        if "enabled" in group and not _as_bool(group.get("enabled"), True):
            continue

        fallback = _default_group(source_index)
        group_id = _GROUP_ID_CHARACTER.sub("", str(group.get("id", "")).strip())[:80]
        if not group_id or group_id in used_ids:
            suffix = source_index + 1
            group_id = f"height_legacy_{suffix}"
            while group_id in used_ids:
                suffix += 1
                group_id = f"height_legacy_{suffix}"
        used_ids.add(group_id)
        groups.append(
            {
                "id": group_id,
                "color": _normalize_color(group.get("color"), fallback["color"]),
                "threshold": _normalize_threshold(group.get("threshold")),
                "layer": _normalize_layer(group.get("layer", fallback["layer"])),
            }
        )

    if not groups:
        fallback = _default_group()
        groups.append(
            {
                "id": "height_legacy_1",
                "color": fallback["color"],
                "threshold": fallback["threshold"],
                "layer": fallback["layer"],
            }
        )
    return {"version": 1, "groups": groups}


def encode_v1_config(value):
    return json.dumps(_normalize_v1_config(value), ensure_ascii=False, separators=(",", ":"))


def v1_config_digest(value):
    return hashlib.sha256(encode_v1_config(value).encode("utf-8")).hexdigest()


def _resolve_v1_config(height_layer_config="", unique_id=None, extra_pnginfo=None):
    if height_layer_config is not None and str(height_layer_config).strip():
        return _normalize_v1_config(height_layer_config)
    return _get_node_config(
        unique_id,
        extra_pnginfo,
        V1_CONFIG_PROPERTY,
        _normalize_v1_config,
    )


def build_v1_config_report(config):
    canonical = _normalize_v1_config(config)
    group_lines = [
        (
            f"{index + 1}. {group['id']}: color={group['color']}, "
            f"threshold={group['threshold']}, layer={group['layer']}, "
            f"height={group['layer'] / 5.0:.1f}"
        )
        for index, group in enumerate(canonical["groups"])
    ]
    return (
        "Badge Height Layer V1 applied configuration\n"
        f"Groups: {len(group_lines)}\n"
        f"SHA-256: {v1_config_digest(canonical)}\n"
        + "\n".join(group_lines)
    )


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
        if not group.get("enabled", True):
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
        if group.get("enabled", True)
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
Image 1 is the sole authority for artwork, visible text, outline, layout, proportions, element positions, and source color-region topology. Its source colors identify design regions only and must not appear as final colors in this stage.
Image 2 controls physical surface height only. It does not define color, material, brightness, exposure, or lighting.

OUTPUT REQUIREMENT — NEUTRAL GRAYSCALE RELIEF PROOF
Return one front-facing, achromatic grayscale badge relief proof whose only purpose is to establish and inspect geometry before material assignment.
Render every solid region with the same neutral, uncolored matte base. Allow only restrained diffuse grayscale shading needed to reveal the encoded relief, rounded shoulders, fillets, cutout sidewalls, and gentle coin-like crowning.
Do not reproduce any hue from Image 1. Do not introduce gold, silver, bronze, colored enamel, lacquer, paint, glitter, crystals, gemstones, patina, texture, gloss, mirror reflections, or any other recognizable final material.
Use uniform neutral diffuse illumination, an orthographic or near-orthographic front view, and an achromatic neutral or transparent background. Do not use dramatic highlights, colored light, cast-shadow styling, depth of field, or presentation effects.
The result is a geometry proof, not a finished badge, not a material preview, and not a replacement numeric height map.

ACTIVE HEIGHT LEVELS
Image 2 contains exactly {solid_count} matched solid height level{'s' if solid_count != 1 else ''}.{cutout_note}
{active_lines}

HEIGHT RULES
Interpret the listed alpha/grayscale values as nominal discrete physical plateau elevations, not as visual brightness.
Use only the active levels listed above. Do not invent missing semantic layers, extra plateaus, or additional relief tiers.
Preserve the encoded values and front-to-back ordering; do not renormalize the active levels into replacement values.
Do not globally blur, feather, or smooth Image 2, and do not soften or move any boundary in the XY plane.

CONTOUR PRIORITY — MANDATORY
Treat the intentional narrow structural linework already present in Image 1 as the highest parts of the badge. This includes the complete outer perimeter rim or outline, internal contour strokes, metal separator lines, and narrow outline strokes around existing text or motifs.
Assign this existing contour network to the highest active solid height level listed above. If a corresponding nonzero contour-line region in Image 2 is encoded at a lower active height, promote only those contour-line pixels to the highest active solid level. This is the only permitted semantic override to Image 2.
This rule does not create another height tier and does not promote broad filled motifs merely because they touch the silhouette. Do not invent, duplicate, extend, thicken, thin, close, simplify, or reroute any line. Preserve every contour's exact XY centerline, width, junction, spacing, and ownership from Image 1.
Keep raised contour tops continuous and gently rounded or softly crowned across their narrow width, like struck or die-cast coin linework, never razor-sharp or knife-edged. Their boundaries against lower filled regions must remain crisp, using only a narrow manufacturable shoulder, small fillet, or restrained bevel.

BOUNDARY AND REGION-INTERIOR PROFILE
Keep every intentional graphic boundary, text stroke, separator line, cutout edge, and encoded height-region boundary crisp and accurately positioned in the XY plane.
Within each connected region that has one encoded height, keep the solid surface continuous, planar or gently crowned like manufacturable coin relief. Do not introduce unintended facets, creases, hard-surface panel breaks, box edges, vertical extrusions, or separate mechanical components inside that region.
Where two different encoded solid heights meet, preserve the localized discrete step and plateau ordering. Join their cross-sections with a narrow manufacturable shoulder and a small rounded fillet or restrained bevel. This local transition does not create an additional semantic height level.
Intentional rims, text strokes, metal separator lines, engraved grooves, and explicit relief boundaries may retain short, steep, well-defined transitions. Broad solid motifs must not become block-like miniature objects.
Keep every transition profile inside or centered tightly on its corresponding Image 1 boundary so the front-view silhouette, spacing, and region ownership remain unchanged.

NOMINAL NUMERIC HEIGHT ENCODING — MANDATORY
For the interior plateau of each encoded solid region, the nominal physical relative Z height equals the normalized Alpha/grayscale value encoded for that region in Image 2: nominal Z = Alpha = grayscale / 255.
Use this exact absolute mapping: 0/255 = 0.0 = empty Cut Out; 51/255 = 0.2 = Layer 1; 102/255 = 0.4 = Layer 2; 153/255 = 0.6 = Layer 3; 204/255 = 0.8 = Layer 4; 255/255 = 1.0 = Layer 5.
Interior plateau areas with the same encoded value must share the same nominal elevation. A numerically larger encoded value must always be physically higher and closer to the viewer than a smaller nonzero value at the same front-facing badge orientation.
These values are geometric data, not luminance suggestions: do not reinterpret them from apparent brightness, color, material, local contrast, lighting, neighboring regions, or artistic judgment.
Except for the explicit contour-priority promotion defined above, do not reorder, invert, normalize, rescale, compress, or replace the encoded plateau levels. Local interpolation is allowed only within narrow transition bands at explicit height boundaries to form the manufacturable shoulders, fillets, or restrained bevels defined above; never use it to blur region interiors or invent another plateau.

ALPHA-ZERO / CUTOUT RULE
Every Alpha/grayscale 0.0 region in Image 2 represents empty space, never the lowest solid surface.
Zero-valued regions outside the badge silhouette remain empty background.
Any zero-valued region enclosed by or located inside the Image 1 badge graphic must remain a true through-cut opening: preserve the hole as empty/transparent space and do not fill, cap, bridge, emboss, or place material across it.
Sidewalls or restrained edge bevels may exist only along the boundary of an interior cutout; no front-facing surface may cover the opening.

DESIGN LOCK
Do not alter, redraw, move, resize, add, remove, or reinterpret any text, graphic, contour, source-region boundary, spacing, or silhouette from Image 1.
Preserve the exact topology and ownership of Image 1 color regions while intentionally neutralizing their chroma in the output.
Do not reproduce Image 2 grayscale values as final badge colors.
Do not use global contrast, blur, sharpening, depth of field, or painted shading to simulate height.
This operation establishes badge height only; it is not a redesign, final coloring, material assignment, camera change, or presentation render."""


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


class DAELabBadgeHeightLayerV1(DAELabBadgeHeightLayer):
    """Compact selected-layer editor with a versioned configuration surface."""

    DESCRIPTION = (
        "Compact color-to-height editor with selected-layer add/delete controls. "
        "Maps colors to Cut Out or fixed relative heights from 0.2 through 1.0."
    )

    RETURN_TYPES = (
        "MASK",
        "IMAGE",
        "MASK",
        "BADGE_HEIGHT_PROFILE",
        "STRING",
        "STRING",
        "STRING",
    )
    RETURN_NAMES = (
        "height_mask",
        "height_image",
        "unmatched_mask",
        "height_profile",
        "applied_config",
        "config_digest",
        "config_report",
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"images": ("IMAGE",)},
            "optional": {
                V1_CONFIG_INPUT: (
                    "STRING",
                    {"default": "", "multiline": False},
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    @classmethod
    def IS_CHANGED(
        cls,
        images,
        height_layer_config="",
        unique_id=None,
        extra_pnginfo=None,
    ):
        del images
        config = _resolve_v1_config(
            height_layer_config,
            unique_id,
            extra_pnginfo,
        )
        return v1_config_digest(config)

    def make_height_map(
        self,
        images,
        height_layer_config="",
        unique_id=None,
        extra_pnginfo=None,
    ):
        config = _resolve_v1_config(
            height_layer_config,
            unique_id,
            extra_pnginfo,
        )
        height, height_image, unmatched, profile = _make_height_map_with_profile(images, config)
        applied_config = encode_v1_config(config)
        return (
            height,
            height_image,
            unmatched,
            profile,
            applied_config,
            v1_config_digest(config),
            build_v1_config_report(config),
        )


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
    "DAELabBadgeHeightLayerV1": DAELabBadgeHeightLayerV1,
    "BadgeHeightEstablishPromptBuilder": BadgeHeightEstablishPromptBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELabBadgeHeightLayer": "Badge Height Layer (DAELab)",
    "DAELabBadgeHeightLayerV1": "Badge Height Layer V1 (DAELab)",
    "BadgeHeightEstablishPromptBuilder": "Badge Height Establish Prompt Builder",
}
