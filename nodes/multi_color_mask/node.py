import hashlib
import json
import re

import torch


MAX_MASK_GROUPS = 16
CONFIG_PROPERTY = "multi_color_mask_config"
COMBINED_OUTPUT = "combined_mask"
DEFAULT_COLORS = ("#0000ff", "#00ff00", "#ff0000", "#ffffff")
_HEX_COLOR = re.compile(r"^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _default_group(index=0):
    return {
        "enabled": True,
        "color": DEFAULT_COLORS[index % len(DEFAULT_COLORS)],
        "threshold": 30,
        "invert": False,
    }


def _default_config():
    return {
        "version": 1,
        "groups": [_default_group()],
        "output": COMBINED_OUTPUT,
    }


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
    for index, raw_group in enumerate(raw_groups[:MAX_MASK_GROUPS]):
        fallback = _default_group(index)
        group = raw_group if isinstance(raw_group, dict) else {}
        groups.append(
            {
                "enabled": _as_bool(group.get("enabled"), fallback["enabled"]),
                "color": _normalize_color(group.get("color"), fallback["color"]),
                "threshold": _normalize_threshold(group.get("threshold")),
                "invert": _as_bool(group.get("invert"), fallback["invert"]),
            }
        )

    if not groups:
        groups.append(_default_group())

    output = str(source.get("output", COMBINED_OUTPUT)).strip().lower()
    valid_outputs = {COMBINED_OUTPUT, *(f"mask_{index}" for index in range(1, len(groups) + 1))}
    if output not in valid_outputs:
        output = COMBINED_OUTPUT

    return {"version": 1, "groups": groups, "output": output}


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
        raise ValueError(f"images must have non-empty batch and spatial dimensions; received {tuple(images.shape)}.")
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


def _make_masks(images, config):
    rgb, maximum = _validate_images(images)
    working = rgb.to(dtype=torch.float32)
    if maximum > 1.0:
        working = working / 255.0

    black = torch.zeros(images.shape[:3], dtype=torch.float32, device=images.device)
    masks = []
    enabled_masks = []
    for group in config["groups"]:
        if not group["enabled"]:
            masks.append(black.clone())
            continue

        color = _parse_color(group["color"], device=images.device)
        distance = torch.linalg.vector_norm(working - color, dim=-1)
        mask = distance <= (group["threshold"] / 255.0)
        if group["invert"]:
            mask = ~mask
        output = mask.to(dtype=torch.float32)
        masks.append(output)
        enabled_masks.append(output)

    combined = (
        torch.stack(enabled_masks, dim=0).amax(dim=0).clamp_(0.0, 1.0)
        if enabled_masks
        else black.clone()
    )
    return masks, combined


class DAELabMultiColorMask:
    """Create one selectable mask from a dynamic set of color-matching groups."""

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask",)
    FUNCTION = "make_mask"
    CATEGORY = "DAELab/Mask"
    DESCRIPTION = (
        "Build color masks from a dynamic group list and output one selected group "
        "mask or the union of all enabled groups."
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

    def make_mask(self, images, unique_id=None, extra_pnginfo=None):
        config = _get_node_config(unique_id, extra_pnginfo)
        masks, combined = _make_masks(images, config)
        if config["output"] == COMBINED_OUTPUT:
            return (combined,)

        index = int(config["output"].split("_", 1)[1]) - 1
        return (masks[index],)


NODE_CLASS_MAPPINGS = {
    "DAELabMultiColorMask": DAELabMultiColorMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELabMultiColorMask": "Multi Color Mask (DAELab)",
}
