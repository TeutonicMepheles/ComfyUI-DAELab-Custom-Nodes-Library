import json

import torch
import torch.nn.functional as F


LEGAL_HEIGHT_LEVELS = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
NEUTRAL_STRUCTURE_LEVEL = 0.68


def _image_float(value, name):
    if not isinstance(value, torch.Tensor):
        raise TypeError(f"{name} must be a torch.Tensor IMAGE.")
    image = value.detach().to(dtype=torch.float32)
    if image.ndim == 3:
        image = image.unsqueeze(0)
    if image.ndim != 4 or image.shape[-1] < 3:
        raise ValueError(f"{name} must have shape [B,H,W,C] with at least three channels.")
    return image[..., :3]


def _mask_float(value, name):
    if not isinstance(value, torch.Tensor):
        raise TypeError(f"{name} must be a torch.Tensor MASK.")
    mask = value.detach().to(dtype=torch.float32)
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    if mask.ndim != 3:
        raise ValueError(f"{name} must have shape [H,W] or [B,H,W].")
    return mask


def _broadcast(value, batch, name):
    if value.shape[0] == batch:
        return value
    if value.shape[0] == 1:
        return value.expand(batch, *value.shape[1:])
    raise ValueError(f"{name} batch {value.shape[0]} cannot broadcast to batch {batch}.")


def _resize_image(image, height, width):
    return F.interpolate(
        image.permute(0, 3, 1, 2),
        size=(height, width),
        mode="bicubic",
        align_corners=False,
        antialias=True,
    ).permute(0, 2, 3, 1).clamp(0.0, 1.0)


def _resize_mask(mask, height, width):
    return F.interpolate(mask.unsqueeze(1), size=(height, width), mode="nearest-exact")[:, 0]


def _luminance(image):
    return (
        image[..., 0] * 0.2126
        + image[..., 1] * 0.7152
        + image[..., 2] * 0.0722
    )


def _binary_edges(mask):
    value = mask > 0.5
    edges = torch.zeros_like(value)
    horizontal = value[:, :, 1:] != value[:, :, :-1]
    vertical = value[:, 1:, :] != value[:, :-1, :]
    edges[:, :, 1:] |= horizontal
    edges[:, :, :-1] |= horizontal
    edges[:, 1:, :] |= vertical
    edges[:, :-1, :] |= vertical
    return edges


def _scalar_edges(value, threshold):
    edges = torch.zeros_like(value, dtype=torch.bool)
    horizontal = (value[:, :, 1:] - value[:, :, :-1]).abs() > threshold
    vertical = (value[:, 1:, :] - value[:, :-1, :]).abs() > threshold
    edges[:, :, 1:] |= horizontal
    edges[:, :, :-1] |= horizontal
    edges[:, 1:, :] |= vertical
    edges[:, :-1, :] |= vertical
    return edges


def _color_edges(image, threshold=0.04):
    edges = torch.zeros(image.shape[:3], dtype=torch.bool, device=image.device)
    horizontal = (image[:, :, 1:] - image[:, :, :-1]).abs().amax(dim=-1) > threshold
    vertical = (image[:, 1:, :] - image[:, :-1, :]).abs().amax(dim=-1) > threshold
    edges[:, :, 1:] |= horizontal
    edges[:, :, :-1] |= horizontal
    edges[:, 1:, :] |= vertical
    edges[:, :-1, :] |= vertical
    return edges


def _dilate(mask, radius):
    radius = max(0, int(radius))
    if radius == 0:
        return mask
    kernel = radius * 2 + 1
    return F.max_pool2d(mask.float().unsqueeze(1), kernel, stride=1, padding=radius)[:, 0] > 0.5


def _gradient_magnitude(value):
    gradient = torch.zeros_like(value)
    horizontal = (value[:, :, 1:] - value[:, :, :-1]).abs()
    vertical = (value[:, 1:, :] - value[:, :-1, :]).abs()
    gradient[:, :, 1:] = torch.maximum(gradient[:, :, 1:], horizontal)
    gradient[:, :, :-1] = torch.maximum(gradient[:, :, :-1], horizontal)
    gradient[:, 1:, :] = torch.maximum(gradient[:, 1:, :], vertical)
    gradient[:, :-1, :] = torch.maximum(gradient[:, :-1, :], vertical)
    return gradient


def _quantile_range(value, support):
    ranges = []
    for index in range(value.shape[0]):
        selected = value[index][support[index]]
        if selected.numel() == 0:
            ranges.append(0.0)
            continue
        low = torch.quantile(selected, 0.05)
        high = torch.quantile(selected, 0.95)
        ranges.append(float((high - low).item()))
    return min(ranges) if ranges else 0.0


def _normalize_candidate_lightness(lightness, support):
    normalized = lightness.clone()
    for index in range(lightness.shape[0]):
        selected = lightness[index][support[index]]
        if selected.numel() == 0:
            continue
        median = torch.quantile(selected, 0.5)
        normalized[index] = (lightness[index] + (NEUTRAL_STRUCTURE_LEVEL - median)).clamp(0.08, 0.96)
    return normalized


def _neutral_fallback(fallback, flat, foreground):
    fallback_luma = _luminance(fallback)
    flat_luma = _luminance(flat)
    safe = flat_luma > 0.08
    shading = torch.where(
        safe,
        fallback_luma / flat_luma.clamp_min(0.08),
        torch.ones_like(flat_luma),
    ).clamp(0.62, 1.38)
    neutral = (NEUTRAL_STRUCTURE_LEVEL * shading).clamp(0.30, 0.94)
    return torch.where(foreground, neutral, fallback_luma.clamp(0.0, 1.0))


def _prepare_required_inputs(fallback_image, flat_image, height_map, foreground_mask, enforce_1024):
    fallback = _image_float(fallback_image, "fallback_image")
    flat = _image_float(flat_image, "flat_image")
    height = _mask_float(height_map, "height_map")
    foreground = _mask_float(foreground_mask, "foreground_mask")

    batch = max(fallback.shape[0], flat.shape[0], height.shape[0], foreground.shape[0])
    fallback = _broadcast(fallback, batch, "fallback_image")
    flat = _broadcast(flat, batch, "flat_image")
    height = _broadcast(height, batch, "height_map")
    foreground = _broadcast(foreground, batch, "foreground_mask")

    target_height, target_width = foreground.shape[1:]
    if enforce_1024 and (target_height, target_width) != (1024, 1024):
        raise ValueError("Badge Structure Constraint V1 requires a 1024x1024 foreground mask.")
    for name, value in (("fallback_image", fallback), ("flat_image", flat)):
        if value.shape[1:3] != (target_height, target_width):
            if enforce_1024:
                raise ValueError(f"{name} must match the 1024x1024 foreground mask.")
    if height.shape[1:] != (target_height, target_width) and enforce_1024:
        raise ValueError("height_map must match the 1024x1024 foreground mask.")

    if fallback.shape[1:3] != (target_height, target_width):
        fallback = _resize_image(fallback, target_height, target_width)
    if flat.shape[1:3] != (target_height, target_width):
        flat = _resize_image(flat, target_height, target_width)
    if height.shape[1:] != (target_height, target_width):
        height = _resize_mask(height, target_height, target_width)

    if not bool(torch.isfinite(fallback).all()) or not bool(torch.isfinite(flat).all()):
        raise ValueError("fallback_image and flat_image must contain only finite values.")
    if not bool(torch.isfinite(height).all()) or not bool(torch.isfinite(foreground).all()):
        raise ValueError("height_map and foreground_mask must contain only finite values.")

    legal_height = torch.round(height * 5.0) / 5.0
    if float((height - legal_height).abs().max().item()) > 1e-4:
        raise ValueError("height_map contains values outside {0,.2,.4,.6,.8,1}.")
    return (
        fallback.clamp(0.0, 1.0),
        flat.clamp(0.0, 1.0),
        legal_height.clamp(0.0, 1.0),
        foreground > 0.5,
    )


def _prepare_candidate(candidate_image, batch, height, width, enforce_1024):
    try:
        candidate = _image_float(candidate_image, "candidate_image")
    except (TypeError, ValueError) as error:
        return None, str(error)
    if candidate.shape[0] not in (1, batch):
        return None, f"candidate batch {candidate.shape[0]} cannot broadcast to batch {batch}."
    candidate = _broadcast(candidate, batch, "candidate_image")
    if candidate.shape[1:3] != (height, width):
        if enforce_1024:
            return None, "candidate_image does not match the required 1024x1024 canvas."
        candidate = _resize_image(candidate, height, width)
    if not bool(torch.isfinite(candidate).all()):
        return None, "candidate_image contains non-finite values."
    return candidate.clamp(0.0, 1.0), ""


class BadgeStructureConstraintV1:
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN", "STRING")
    RETURN_NAMES = ("structure_image", "structure_lightness", "accepted", "report")
    FUNCTION = "constrain"
    CATEGORY = "DAELab/Badge/Height"
    DESCRIPTION = (
        "Validate a global GPT-Image-2 grayscale relief proof, preserve exact badge and "
        "height boundaries, and fall back to the deterministic height base when needed."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "candidate_image": ("IMAGE",),
            "fallback_image": ("IMAGE",),
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "foreground_mask": ("MASK",),
            "edge_protection_px": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
            "minimum_relief_contrast": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.005}),
            "minimum_boundary_contrast": ("FLOAT", {"default": 0.015, "min": 0.0, "max": 1.0, "step": 0.001}),
            "minimum_boundary_coverage": ("FLOAT", {"default": 0.60, "min": 0.0, "max": 1.0, "step": 0.01}),
            "enforce_grayscale": ("BOOLEAN", {"default": True}),
            "enforce_1024": ("BOOLEAN", {"default": True}),
        }}

    def constrain(
        self,
        candidate_image,
        fallback_image,
        flat_image,
        height_map,
        foreground_mask,
        edge_protection_px=1,
        minimum_relief_contrast=0.08,
        minimum_boundary_contrast=0.015,
        minimum_boundary_coverage=0.60,
        enforce_grayscale=True,
        enforce_1024=True,
    ):
        fallback, flat, height, foreground = _prepare_required_inputs(
            fallback_image, flat_image, height_map, foreground_mask, bool(enforce_1024)
        )
        batch, target_height, target_width = foreground.shape
        neutral_fallback = _neutral_fallback(fallback, flat, foreground)
        candidate, invalid_reason = _prepare_candidate(
            candidate_image, batch, target_height, target_width, bool(enforce_1024)
        )

        height_edges = _scalar_edges(height, 0.05)
        design_edges = _color_edges(flat) & foreground
        silhouette_edges = _binary_edges(foreground.float())
        protected = _dilate(height_edges | design_edges | silhouette_edges, edge_protection_px)

        candidate_valid = candidate is not None
        candidate_chroma_mean = 0.0
        observed_relief_contrast = 0.0
        observed_boundary_coverage = 0.0
        fallback_reason = invalid_reason

        if candidate_valid:
            candidate_chroma = candidate.amax(dim=-1) - candidate.amin(dim=-1)
            supported_chroma = candidate_chroma[foreground]
            if supported_chroma.numel() > 0:
                candidate_chroma_mean = float(supported_chroma.mean().item())
            candidate_lightness = _normalize_candidate_lightness(_luminance(candidate), foreground)
            observed_relief_contrast = _quantile_range(candidate_lightness, foreground)
            local_gradient = F.max_pool2d(
                _gradient_magnitude(candidate_lightness).unsqueeze(1),
                kernel_size=5,
                stride=1,
                padding=2,
            )[:, 0]
            boundary_pixels = height_edges & foreground
            if bool(boundary_pixels.any()):
                observed_boundary_coverage = float(
                    (local_gradient[boundary_pixels] >= float(minimum_boundary_contrast)).float().mean().item()
                )
            else:
                observed_boundary_coverage = 1.0
            if observed_relief_contrast < float(minimum_relief_contrast):
                fallback_reason = "candidate_relief_signal_too_weak"
            elif observed_boundary_coverage < float(minimum_boundary_coverage):
                fallback_reason = "candidate_height_boundary_signal_too_weak"
            else:
                fallback_reason = ""

        accepted = bool(candidate_valid and not fallback_reason)
        if accepted:
            edit_weight = (foreground & ~protected).to(dtype=torch.float32)
            output_lightness = (
                neutral_fallback * (1.0 - edit_weight)
                + candidate_lightness * edit_weight
            ).clamp(0.0, 1.0)
            output_source = "gpt_structure_candidate"
        else:
            output_lightness = neutral_fallback
            output_source = "deterministic_height_fallback"

        if bool(enforce_grayscale):
            structure_image = output_lightness.unsqueeze(-1).repeat(1, 1, 1, 3)
        else:
            if accepted:
                edit_weight = (foreground & ~protected).unsqueeze(-1).to(dtype=torch.float32)
                neutral_rgb = neutral_fallback.unsqueeze(-1).repeat(1, 1, 1, 3)
                structure_image = neutral_rgb * (1.0 - edit_weight) + candidate * edit_weight
            else:
                structure_image = neutral_fallback.unsqueeze(-1).repeat(1, 1, 1, 3)

        neutral_rgb = neutral_fallback.unsqueeze(-1).repeat(1, 1, 1, 3)
        outside = (~foreground).unsqueeze(-1)
        protected_support = protected.unsqueeze(-1)
        outside_diff = (structure_image - neutral_rgb).abs() * outside
        protected_diff = (structure_image - neutral_rgb).abs() * protected_support
        report = {
            "version": 1,
            "accepted": accepted,
            "output_source": output_source,
            "fallback_reason": fallback_reason or None,
            "candidate_valid": candidate_valid,
            "candidate_input_chroma_mean": candidate_chroma_mean,
            "grayscale_forced": bool(enforce_grayscale),
            "observed_relief_contrast": observed_relief_contrast,
            "minimum_relief_contrast": float(minimum_relief_contrast),
            "observed_boundary_coverage": observed_boundary_coverage,
            "minimum_boundary_contrast": float(minimum_boundary_contrast),
            "minimum_boundary_coverage": float(minimum_boundary_coverage),
            "edge_protection_px": int(edge_protection_px),
            "protected_pixels": int(protected.sum().item()),
            "foreground_pixels": int(foreground.sum().item()),
            "outside_max_abs_diff": float(outside_diff.max().item()) if outside_diff.numel() else 0.0,
            "protected_max_abs_diff": float(protected_diff.max().item()) if protected_diff.numel() else 0.0,
            "height_levels": sorted(round(float(value), 1) for value in torch.unique(height).tolist()),
            "canvas": [target_width, target_height],
        }
        return structure_image, output_lightness, accepted, json.dumps(report, sort_keys=True)


NODE_CLASS_MAPPINGS = {
    "DAELAB.BadgeStructureConstraintV1": BadgeStructureConstraintV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.BadgeStructureConstraintV1": "Badge Structure Constraint V1 (DAELab)",
}
