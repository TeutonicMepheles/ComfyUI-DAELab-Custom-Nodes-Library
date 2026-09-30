import io
import json
import math
import re
import time
import zipfile
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F


_HEX_COLOR = re.compile(r"^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_LAYERS = {
    "Cut Out (0.0)": 0.0,
    "Layer 1 (0.2)": 0.2,
    "Layer 2 (0.4)": 0.4,
    "Layer 3 (0.6)": 0.6,
    "Layer 4 (0.8)": 0.8,
    "Layer 5 (1.0)": 1.0,
}


def _parse_color(value, fallback="#ffffff"):
    text = str(value or "").strip()
    if not _HEX_COLOR.fullmatch(text):
        text = fallback
    digits = text.lstrip("#")
    if len(digits) == 3:
        digits = "".join(channel * 2 for channel in digits)
    return torch.tensor(
        [int(digits[index:index + 2], 16) / 255.0 for index in (0, 2, 4)],
        dtype=torch.float32,
    )


def _image_float(image, name="image"):
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError(f"{name} must use ComfyUI IMAGE shape [B, H, W, C].")
    if image.shape[-1] not in (3, 4) or min(image.shape[:3]) < 1:
        raise ValueError(f"{name} has an invalid shape: {tuple(image.shape)}.")
    if not image.is_floating_point() or not torch.isfinite(image).all().item():
        raise ValueError(f"{name} must contain finite floating-point values.")
    output = image[..., :3].to(dtype=torch.float32)
    maximum = float(output.amax().item())
    minimum = float(output.amin().item())
    if minimum < 0.0 or maximum > 255.0:
        raise ValueError(f"{name} values must be in [0, 1] or [0, 255].")
    if maximum > 1.0:
        output = output / 255.0
    return output.clamp(0.0, 1.0)


def _mask_float(mask, name="mask"):
    if not isinstance(mask, torch.Tensor):
        raise TypeError(f"{name} must be a torch.Tensor.")
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    elif mask.ndim == 4 and mask.shape[1] == 1:
        mask = mask[:, 0]
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    if mask.ndim != 3 or min(mask.shape) < 1:
        raise ValueError(f"{name} must use ComfyUI MASK shape [B, H, W].")
    if not mask.is_floating_point():
        mask = mask.float()
    if not torch.isfinite(mask).all().item():
        raise ValueError(f"{name} contains NaN or infinite values.")
    return mask.to(dtype=torch.float32).clamp(0.0, 1.0)


def _broadcast_batch(tensor, batch, name):
    if tensor.shape[0] == batch:
        return tensor
    if tensor.shape[0] == 1:
        return tensor.expand(batch, *tensor.shape[1:])
    raise ValueError(f"{name} batch {tensor.shape[0]} cannot match batch {batch}.")


def _mask_image(mask):
    value = _mask_float(mask)
    return value.unsqueeze(-1).expand(-1, -1, -1, 3).contiguous()


def _overlay(image, mask, color=(1.0, 0.15, 0.05), opacity=0.62):
    base = _image_float(image)
    selected = _broadcast_batch(_mask_float(mask), base.shape[0], "mask")
    if selected.shape[1:3] != base.shape[1:3]:
        raise ValueError("overlay image and mask dimensions must match.")
    tint = torch.tensor(color, device=base.device, dtype=base.dtype).view(1, 1, 1, 3)
    alpha = selected.unsqueeze(-1) * float(opacity)
    return base * (1.0 - alpha) + tint * alpha


def _resize_image(image, height, width, mode="bicubic"):
    channels_first = image.permute(0, 3, 1, 2)
    resized = F.interpolate(
        channels_first,
        size=(height, width),
        mode=mode,
        align_corners=False if mode in {"bilinear", "bicubic"} else None,
    )
    if not torch.isfinite(resized).all().item():
        raise ValueError("Image resampling produced NaN or infinite values.")
    # Bicubic kernels legitimately overshoot around high-contrast color edges.
    # Clamp at the normalization boundary so every downstream ComfyUI IMAGE
    # remains in its documented [0, 1] range while strict nodes can continue to
    # reject genuinely invalid external tensors.
    return resized.permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)


def _resize_mask(mask, height, width):
    return F.interpolate(mask.unsqueeze(1), size=(height, width), mode="nearest")[:, 0]


def _fit_to_canvas(image, mask, width, height, background, image_mode="bicubic"):
    batch, source_height, source_width, _ = image.shape
    scale = min(width / source_width, height / source_height)
    target_width = max(1, int(round(source_width * scale)))
    target_height = max(1, int(round(source_height * scale)))
    resized_image = _resize_image(image, target_height, target_width, image_mode)
    resized_mask = _resize_mask(mask, target_height, target_width)
    canvas = background.to(device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
    canvas = canvas.expand(batch, height, width, 3).clone()
    mask_canvas = torch.zeros((batch, height, width), device=mask.device, dtype=mask.dtype)
    left = (width - target_width) // 2
    top = (height - target_height) // 2
    canvas[:, top:top + target_height, left:left + target_width] = resized_image
    mask_canvas[:, top:top + target_height, left:left + target_width] = resized_mask
    return canvas, mask_canvas, {
        "source_size": [source_width, source_height],
        "canvas_size": [width, height],
        "content_box": [left, top, target_width, target_height],
        "scale": scale,
    }


def _binary_check(mask, name, tolerance=1e-6):
    distance = torch.minimum(mask.abs(), (mask - 1.0).abs())
    if float(distance.max().item()) > tolerance:
        raise ValueError(f"{name} must be binary (only 0 or 1).")


def _largest_component(mask):
    binary = (mask > 0.5).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count <= 1:
        return binary
    index = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == index).astype(np.uint8)


def _infer_foreground(image, tolerance):
    height, width = image.shape[:2]
    border = max(1, int(round(min(height, width) * 0.03)))
    samples = np.concatenate([
        image[:border].reshape(-1, 3),
        image[-border:].reshape(-1, 3),
        image[:, :border].reshape(-1, 3),
        image[:, -border:].reshape(-1, 3),
    ])
    background = np.median(samples, axis=0)
    distance = np.linalg.norm(image - background[None, None, :], axis=-1)
    foreground = (distance > float(tolerance)).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel)
    return _largest_component(foreground), background


def _centroid_and_bbox(mask):
    ys, xs = np.nonzero(mask > 0)
    if len(xs) == 0:
        raise ValueError("foreground mask is empty.")
    center = (float(xs.mean()), float(ys.mean()))
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    return center, bbox, len(xs)


def _iou(first, second):
    first = first > 0
    second = second > 0
    union = np.logical_or(first, second).sum()
    return float(np.logical_and(first, second).sum() / union) if union else 1.0


def _registration_search(design, candidate, max_rotation, max_scale_delta):
    target_height, target_width = design.shape
    search_scale = min(1.0, 256.0 / max(target_height, target_width))
    search_width = max(32, int(round(target_width * search_scale)))
    search_height = max(32, int(round(target_height * search_scale)))
    design_small = cv2.resize(design, (search_width, search_height), interpolation=cv2.INTER_NEAREST)
    candidate_small = cv2.resize(candidate, (search_width, search_height), interpolation=cv2.INTER_NEAREST)
    design_center, design_bbox, design_area = _centroid_and_bbox(design_small)
    candidate_center, candidate_bbox, candidate_area = _centroid_and_bbox(candidate_small)
    design_w = max(1, design_bbox[2] - design_bbox[0] + 1)
    design_h = max(1, design_bbox[3] - design_bbox[1] + 1)
    candidate_w = max(1, candidate_bbox[2] - candidate_bbox[0] + 1)
    candidate_h = max(1, candidate_bbox[3] - candidate_bbox[1] + 1)
    area_scale = math.sqrt(design_area / max(candidate_area, 1))
    bbox_scale = 0.5 * (design_w / candidate_w + design_h / candidate_h)
    base_scale = float(np.clip(0.5 * (area_scale + bbox_scale), 1.0 - max_scale_delta, 1.0 + max_scale_delta))
    angles = np.linspace(-max_rotation, max_rotation, 7) if max_rotation > 0 else [0.0]
    scale_offsets = (-0.02, 0.0, 0.02)
    translation_offsets = (-4.0, 0.0, 4.0)
    best = None
    for angle in angles:
        for offset in scale_offsets:
            scale = float(np.clip(base_scale + offset, 1.0 - max_scale_delta, 1.0 + max_scale_delta))
            matrix = cv2.getRotationMatrix2D(candidate_center, float(angle), scale)
            matrix[0, 2] += design_center[0] - candidate_center[0]
            matrix[1, 2] += design_center[1] - candidate_center[1]
            for dx in translation_offsets:
                for dy in translation_offsets:
                    trial = matrix.copy()
                    trial[0, 2] += dx
                    trial[1, 2] += dy
                    warped = cv2.warpAffine(
                        candidate_small,
                        trial,
                        (search_width, search_height),
                        flags=cv2.INTER_NEAREST,
                        borderMode=cv2.BORDER_CONSTANT,
                        borderValue=0,
                    )
                    score = _iou(design_small, warped)
                    if best is None or score > best[0]:
                        best = (score, trial, float(angle), scale)
    _, matrix_small, angle, scale = best
    small_to_full_x = target_width / search_width
    small_to_full_y = target_height / search_height
    down = np.array([[1.0 / small_to_full_x, 0.0, 0.0], [0.0, 1.0 / small_to_full_y, 0.0], [0.0, 0.0, 1.0]])
    up = np.array([[small_to_full_x, 0.0, 0.0], [0.0, small_to_full_y, 0.0], [0.0, 0.0, 1.0]])
    matrix3 = np.vstack([matrix_small, [0.0, 0.0, 1.0]])
    matrix_full = up @ matrix3 @ down
    warped_full = cv2.warpAffine(
        candidate,
        matrix_full[:2].astype(np.float32),
        (target_width, target_height),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    return matrix_full[:2].astype(np.float32), _iou(design, warped_full), angle, scale, warped_full


def _boundary_error(first, second):
    first_u8 = (first > 0).astype(np.uint8)
    second_u8 = (second > 0).astype(np.uint8)
    first_edge = cv2.morphologyEx(first_u8, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    second_edge = cv2.morphologyEx(second_u8, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    if first_edge.sum() == 0 or second_edge.sum() == 0:
        return float("inf")
    distance_to_second = cv2.distanceTransform(1 - second_edge, cv2.DIST_L2, 3)
    distance_to_first = cv2.distanceTransform(1 - first_edge, cv2.DIST_L2, 3)
    return 0.5 * (
        float(distance_to_second[first_edge > 0].mean())
        + float(distance_to_first[second_edge > 0].mean())
    )


class BadgeDesignCanvas:
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING")
    RETURN_NAMES = ("normalized_flat_image", "design_foreground_mask", "width", "height", "diagnostic")
    FUNCTION = "normalize"
    CATEGORY = "DAELab/Badge"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "canvas_width": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 64}),
                "canvas_height": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 64}),
                "image_resampling": (["bicubic", "nearest"],),
                "foreground_source": (["Auto: alpha, else explicit colors", "Load Image alpha", "Explicit colors"],),
                "background_color": ("STRING", {"default": "#ffffff"}),
                "cutout_color": ("STRING", {"default": "#ff00ff"}),
                "color_tolerance": ("INT", {"default": 8, "min": 0, "max": 255}),
            },
            "optional": {"alpha_mask": ("MASK",)},
        }

    def normalize(
        self,
        images,
        canvas_width,
        canvas_height,
        image_resampling,
        foreground_source,
        background_color,
        cutout_color,
        color_tolerance,
        alpha_mask=None,
    ):
        image = _image_float(images, "images")
        batch, height, width, _ = image.shape
        use_alpha = foreground_source != "Explicit colors" and alpha_mask is not None
        if use_alpha:
            transparency = _mask_float(alpha_mask, "alpha_mask")
            if transparency.shape[1:3] != (height, width):
                if bool((transparency > 1e-6).any().item()):
                    raise ValueError("alpha_mask and images must have identical spatial dimensions.")
                if foreground_source == "Load Image alpha":
                    transparency = torch.zeros((batch, height, width), device=image.device, dtype=image.dtype)
                else:
                    use_alpha = False
            if use_alpha:
                transparency = _broadcast_batch(transparency, batch, "alpha_mask")
                has_alpha = bool((transparency > 1e-6).any().item())
                if foreground_source == "Load Image alpha" or has_alpha:
                    foreground = (1.0 - transparency > 0.5).float()
                    source_used = "load_image_alpha"
                else:
                    use_alpha = False
        if not use_alpha:
            background = _parse_color(background_color).to(image.device)
            cutout = _parse_color(cutout_color, "#ff00ff").to(image.device)
            tolerance = float(color_tolerance) / 255.0
            background_distance = torch.linalg.vector_norm(image - background.view(1, 1, 1, 3), dim=-1)
            cutout_distance = torch.linalg.vector_norm(image - cutout.view(1, 1, 1, 3), dim=-1)
            foreground = ((background_distance > tolerance) & (cutout_distance > tolerance)).float()
            source_used = "explicit_background_and_cutout_colors"
        canvas, normalized_mask, info = _fit_to_canvas(
            image,
            foreground,
            int(canvas_width),
            int(canvas_height),
            _parse_color(background_color),
            str(image_resampling),
        )
        normalized_mask = (normalized_mask > 0.5).float()
        info.update({"foreground_source": source_used, "foreground_coverage": float(normalized_mask.mean().item())})
        return canvas, normalized_mask, int(canvas_width), int(canvas_height), json.dumps(info, ensure_ascii=False)


class BadgeRenderPromptBuilder:
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("prompt", "structure_constraints", "material_semantics", "height_semantics")
    FUNCTION = "build"
    CATEGORY = "DAELab/Badge/Prompt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "use_material": ("BOOLEAN", {"default": True}),
                "use_height": ("BOOLEAN", {"default": True}),
                "unmatched_limit_percent": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 100.0, "step": 0.1}),
                "user_prompt": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "material_semantics_input": ("STRING",),
                "unmatched_mask": ("MASK",),
                "design_foreground_mask": ("MASK",),
            },
        }

    def build(
        self,
        use_material,
        use_height,
        unmatched_limit_percent,
        user_prompt,
        material_semantics_input="",
        unmatched_mask=None,
        design_foreground_mask=None,
    ):
        structure = (
            "Image 1 is the normalized flat badge design and is the sole authority for outline, "
            "graphics, visible text, colors, proportions, and element positions. Create a physical badge "
            "master viewed perfectly front-on, centered, fully inside frame, with orthographic or extremely "
            "weak perspective, neutral even low-contrast lighting, a simple stable background, and no crop. "
            "Preserve every visible character, its order, type direction, layout, silhouette, internal line, "
            "color boundary, and relative position. Do not add or remove text, symbols, decoration, or structure. "
            "Do not use studio drama, depth of field, macro framing, camera rotation, strong shadow, or perspective change."
        )
        material = str(material_semantics_input or "").strip() if use_material else ""
        if use_height:
            if unmatched_mask is None or design_foreground_mask is None:
                raise ValueError("Height-enabled badge rendering requires unmatched_mask and design_foreground_mask validation inputs.")
            unmatched = _mask_float(unmatched_mask, "unmatched_mask")
            foreground = _broadcast_batch(_mask_float(design_foreground_mask), unmatched.shape[0], "design_foreground_mask")
            if unmatched.shape != foreground.shape:
                raise ValueError("unmatched_mask and design_foreground_mask must share the same canvas.")
            foreground_area = float(foreground.sum().item())
            unmatched_ratio = float((unmatched * foreground).sum().item()) / foreground_area if foreground_area else 0.0
            limit = float(unmatched_limit_percent) / 100.0
            if unmatched_ratio > limit:
                raise ValueError(
                    f"Height color validation failed: {unmatched_ratio * 100.0:.3f}% of the design foreground is unmatched; "
                    f"the limit is {float(unmatched_limit_percent):.3f}%."
                )
            height = (
                "Image 2 is a grayscale discrete height reference only: black means cut out/zero and the legal "
                "solid levels are 0.2, 0.4, 0.6, 0.8, and 1.0. It does not define color or material. Reproduce its "
                f"front-to-back ordering while Image 1 continues to control design and color. Height color validation passed "
                f"with {unmatched_ratio * 100.0:.3f}% unmatched foreground pixels."
            )
        else:
            height = "No height reference is enabled; infer only conservative manufacturing depth without redesigning the artwork."
        sections = [structure, height]
        if material:
            sections.append("Enabled material semantics: " + material)
        if str(user_prompt or "").strip():
            sections.append("Additional business intent: " + str(user_prompt).strip())
        return "\n\n".join(sections), structure, material, height


class BadgeMasterRegistration:
    RETURN_TYPES = ("IMAGE", "STRING", "FLOAT", "FLOAT", "IMAGE", "BOOLEAN")
    RETURN_NAMES = ("base_render", "transform", "contour_iou", "boundary_error", "diagnostic", "registration_valid")
    FUNCTION = "register"
    CATEGORY = "DAELab/Badge"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "design_image": ("IMAGE",),
                "design_foreground_mask": ("MASK",),
                "candidate_image": ("IMAGE",),
                "minimum_iou": ("FLOAT", {"default": 0.97, "min": 0.0, "max": 1.0, "step": 0.001}),
                "max_rotation_degrees": ("FLOAT", {"default": 3.0, "min": 0.0, "max": 10.0, "step": 0.25}),
                "max_scale_delta": ("FLOAT", {"default": 0.10, "min": 0.0, "max": 0.30, "step": 0.01}),
                "background_tolerance": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.01}),
                "enforce_threshold": ("BOOLEAN", {"default": True}),
            },
            "optional": {"candidate_foreground_mask": ("MASK",)},
        }

    def register(
        self,
        design_image,
        design_foreground_mask,
        candidate_image,
        minimum_iou,
        max_rotation_degrees,
        max_scale_delta,
        background_tolerance,
        enforce_threshold,
        candidate_foreground_mask=None,
    ):
        design_rgb = _image_float(design_image, "design_image")
        candidate_rgb = _image_float(candidate_image, "candidate_image")
        target_batch, target_height, target_width, _ = design_rgb.shape
        candidate_rgb = _broadcast_batch(candidate_rgb, target_batch, "candidate_image")
        if candidate_rgb.shape[1:3] != (target_height, target_width):
            candidate_rgb = _resize_image(candidate_rgb, target_height, target_width, "bicubic")
        design_mask = _broadcast_batch(_mask_float(design_foreground_mask), target_batch, "design_foreground_mask")
        if design_mask.shape[1:3] != (target_height, target_width):
            raise ValueError("design_foreground_mask and design_image dimensions must match.")
        provided_mask = None
        if candidate_foreground_mask is not None:
            provided_mask = _broadcast_batch(_mask_float(candidate_foreground_mask), target_batch, "candidate_foreground_mask")
            if provided_mask.shape[1:3] != (target_height, target_width):
                provided_mask = _resize_mask(provided_mask, target_height, target_width)

        registered_images = []
        diagnostics = []
        transforms = []
        scores = []
        errors = []
        for index in range(target_batch):
            design_np = (design_mask[index].detach().cpu().numpy() > 0.5).astype(np.uint8)
            candidate_np = candidate_rgb[index].detach().cpu().numpy()
            if provided_mask is None:
                foreground_np, background = _infer_foreground(candidate_np, background_tolerance)
            else:
                foreground_np = _largest_component((provided_mask[index].detach().cpu().numpy() > 0.5).astype(np.uint8))
                background = np.median(candidate_np.reshape(-1, 3), axis=0)
            matrix, score, angle, scale, registered_mask = _registration_search(
                design_np,
                foreground_np,
                float(max_rotation_degrees),
                float(max_scale_delta),
            )
            registered_np = cv2.warpAffine(
                candidate_np,
                matrix,
                (target_width, target_height),
                flags=cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=tuple(float(value) for value in background),
            )
            error = _boundary_error(design_np, registered_mask)
            diagnostic = np.zeros((target_height, target_width, 3), dtype=np.float32)
            diagnostic[..., 1] = design_np
            diagnostic[..., 0] = registered_mask
            diagnostic[..., 2] = np.logical_and(design_np, registered_mask)
            registered_images.append(torch.from_numpy(registered_np).float())
            diagnostics.append(torch.from_numpy(diagnostic).float())
            scores.append(score)
            errors.append(error)
            transforms.append({
                "matrix": matrix.tolist(),
                "rotation_degrees": angle,
                "scale": scale,
                "contour_iou": score,
                "boundary_error_px": error,
            })
        minimum_score = min(scores)
        valid = minimum_score >= float(minimum_iou)
        if enforce_threshold and not valid:
            raise ValueError(
                f"Badge master registration rejected: contour IoU {minimum_score:.4f} "
                f"is below the required {float(minimum_iou):.4f}."
            )
        return (
            torch.stack(registered_images).to(candidate_rgb.device),
            json.dumps({"batch": transforms}, ensure_ascii=False),
            float(minimum_score),
            float(max(errors)),
            torch.stack(diagnostics).to(candidate_rgb.device),
            bool(valid),
        )


class BadgeEditMaskValidator:
    RETURN_TYPES = ("MASK", "BOOLEAN", "FLOAT", "STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("edit_mask", "should_edit", "coverage", "bounding_box", "validation_status", "diagnostic")
    FUNCTION = "validate"
    CATEGORY = "DAELab/Badge"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "edit_mask_flat": ("MASK",),
                "design_foreground_mask": ("MASK",),
                "base_render": ("IMAGE",),
                "registration_iou": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
                "minimum_registration_iou": ("FLOAT", {"default": 0.97, "min": 0.0, "max": 1.0, "step": 0.001}),
                "allow_full_mask": ("BOOLEAN", {"default": False}),
                "full_mask_threshold": ("FLOAT", {"default": 0.995, "min": 0.5, "max": 1.0, "step": 0.001}),
            }
        }

    def validate(
        self,
        edit_mask_flat,
        design_foreground_mask,
        base_render,
        registration_iou,
        minimum_registration_iou,
        allow_full_mask,
        full_mask_threshold,
    ):
        image = _image_float(base_render, "base_render")
        edit = _broadcast_batch(_mask_float(edit_mask_flat, "edit_mask_flat"), image.shape[0], "edit_mask_flat")
        foreground = _broadcast_batch(_mask_float(design_foreground_mask, "design_foreground_mask"), image.shape[0], "design_foreground_mask")
        if edit.shape[1:3] != image.shape[1:3] or foreground.shape[1:3] != image.shape[1:3]:
            raise ValueError("edit mask, foreground mask, and base render must share the same canvas.")
        _binary_check(edit, "edit_mask_flat")
        _binary_check(foreground, "design_foreground_mask")
        if float(registration_iou) < float(minimum_registration_iou):
            raise ValueError("Registration validation failed; local editing is blocked.")
        validated = edit * foreground
        selected = float(validated.sum().item())
        foreground_area = float(foreground.sum().item())
        coverage = selected / foreground_area if foreground_area else 0.0
        if selected == 0.0:
            bbox = {"empty": True}
            status = "EMPTY_MASK: GPT edit is skipped and the previous master is passed through."
            should_edit = False
        else:
            if coverage >= float(full_mask_threshold) and not allow_full_mask:
                raise ValueError(
                    f"Full-mask edit blocked: foreground coverage {coverage:.4f}. "
                    "Enable the expert allow_full_mask option to proceed."
                )
            coordinates = torch.nonzero(validated > 0.5, as_tuple=False)
            bbox = {
                "batch_min": int(coordinates[:, 0].min().item()),
                "batch_max": int(coordinates[:, 0].max().item()),
                "x": int(coordinates[:, 2].min().item()),
                "y": int(coordinates[:, 1].min().item()),
                "width": int(coordinates[:, 2].max().item() - coordinates[:, 2].min().item() + 1),
                "height": int(coordinates[:, 1].max().item() - coordinates[:, 1].min().item() + 1),
            }
            status = "VALID: white pixels are the selected GPT edit region; polarity is not inverted."
            should_edit = True
        return validated, should_edit, float(coverage), json.dumps(bbox), status, _overlay(image, validated)


class BadgeLocalEditPromptBuilder:
    RETURN_TYPES = ("STRING", "BOOLEAN", "BADGE_HEIGHT_LAYER", "STRING")
    RETURN_NAMES = ("prompt", "apply_height_patch", "target_layer_value", "operation_summary")
    FUNCTION = "build"
    CATEGORY = "DAELab/Badge/Prompt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "operation_type": (["prompt", "color", "material", "height"],),
                "user_prompt": ("STRING", {"default": "", "multiline": True}),
                "target_color": ("STRING", {"default": "#c9a86a"}),
                "target_layer": (list(_LAYERS),),
                "height_enabled": ("BOOLEAN", {"default": True}),
            },
            "optional": {"material_semantics": ("STRING",)},
        }

    def build(self, operation_type, user_prompt, target_color, target_layer, height_enabled, material_semantics=""):
        common = (
            "Image 1 is the current registered front-view master and the only image to edit. "
            "Image 2 is the normalized flat design reference for exact graphics, colors, visible text, and layout. "
            "Image 3, when present, is a grayscale height reference only and never defines color or material. "
            "Edit only the object region selected by the white mask. Keep camera angle, perspective, framing, badge "
            "position, size, outline, all visible text and typography unchanged. Do not expand the edit boundary, "
            "redraw unrelated areas, add a new background, studio lighting, depth of field, macro crop, or decoration."
        )
        operation_type = str(operation_type)
        if operation_type == "prompt":
            instruction = str(user_prompt or "Refine the selected content").strip()
            specific = f"Prompt-only operation: {instruction}. Preserve color, material, and height unless explicitly requested."
        elif operation_type == "color":
            specific = (
                f"Color-only operation: replace the selected object's intrinsic base color with {target_color}. "
                "Preserve material, texture, shape, relief height, shading logic, and all text."
            )
        elif operation_type == "material":
            semantics = str(material_semantics or "").strip()
            specific = (
                f"Material-only operation: apply this material to the selected object: {semantics}. "
                f"Use intrinsic color {target_color}; preserve outline, dimensions, height, graphics, and text."
            )
        else:
            if not height_enabled:
                raise ValueError("Height editing requires the height branch to be enabled.")
            specific = (
                f"Height-only operation: the deterministic height reference has replaced the selected region with {target_layer}. "
                "Render only that absolute layer change while preserving intrinsic color, material, graphics, and text."
            )
        summary = json.dumps({"operation": operation_type, "target_color": target_color, "target_layer": target_layer}, ensure_ascii=False)
        return common + "\n\n" + specific, operation_type == "height", target_layer, summary


class BadgeHeightPatch:
    RETURN_TYPES = ("MASK", "IMAGE", "MASK", "IMAGE", "STRING")
    RETURN_NAMES = ("patched_height", "patched_height_image", "patched_foreground_mask", "change_preview", "difference_report")
    FUNCTION = "patch"
    CATEGORY = "DAELab/Badge"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "current_height": ("MASK",),
                "current_foreground_mask": ("MASK",),
                "edit_mask": ("MASK",),
                "apply_patch": ("BOOLEAN", {"default": False}),
                "target_layer": ("BADGE_HEIGHT_LAYER",),
            }
        }

    def patch(self, current_height, current_foreground_mask, edit_mask, apply_patch, target_layer):
        height = _mask_float(current_height, "current_height")
        foreground = _broadcast_batch(_mask_float(current_foreground_mask), height.shape[0], "current_foreground_mask")
        mask = _broadcast_batch(_mask_float(edit_mask), height.shape[0], "edit_mask")
        if height.shape != foreground.shape or height.shape != mask.shape:
            raise ValueError("height, foreground, and edit mask must have identical dimensions and batch.")
        _binary_check(mask, "edit_mask")
        _binary_check(foreground, "current_foreground_mask")
        if not apply_patch:
            patched_height = height.clone()
            patched_foreground = foreground.clone()
            action = "pass_through_non_height_operation"
        else:
            target = float(_LAYERS[target_layer])
            patched_height = mask * target + (1.0 - mask) * height
            if target == 0.0:
                patched_foreground = foreground * (1.0 - mask)
            else:
                patched_foreground = torch.maximum(foreground, mask)
            action = "cut_out" if target == 0.0 else "absolute_layer_replace"
        outside = 1.0 - mask
        height_outside_max = float(((patched_height - height).abs() * outside).max().item())
        foreground_outside_max = float(((patched_foreground - foreground).abs() * outside).max().item())
        if height_outside_max != 0.0 or foreground_outside_max != 0.0:
            raise RuntimeError("Height patch violated the zero-difference outside-mask contract.")
        changed = torch.maximum((patched_height - height).abs(), (patched_foreground - foreground).abs())
        preview = torch.stack([mask, changed, patched_foreground], dim=-1)
        report = {
            "action": action,
            "target_layer": target_layer,
            "outside_height_max_abs_diff": height_outside_max,
            "outside_foreground_max_abs_diff": foreground_outside_max,
            "changed_pixels": int((changed > 0).sum().item()),
        }
        return patched_height, _mask_image(patched_height), patched_foreground, preview, json.dumps(report, ensure_ascii=False)


class BadgeDeterministicComposite:
    RETURN_TYPES = ("IMAGE", "FLOAT", "FLOAT", "IMAGE", "STRING")
    RETURN_NAMES = ("edited_master", "outside_max_diff", "outside_mean_diff", "boundary_diagnostic", "report")
    FUNCTION = "composite"
    CATEGORY = "DAELab/Badge"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"previous_master": ("IMAGE",), "edit_candidate": ("IMAGE",), "edit_mask": ("MASK",)}}

    def composite(self, previous_master, edit_candidate, edit_mask):
        previous = _image_float(previous_master, "previous_master")
        candidate = _image_float(edit_candidate, "edit_candidate")
        if previous.shape != candidate.shape:
            raise ValueError("previous master and edit candidate must have identical batch, canvas, and channels.")
        mask = _broadcast_batch(_mask_float(edit_mask), previous.shape[0], "edit_mask")
        if mask.shape[1:3] != previous.shape[1:3]:
            raise ValueError("edit mask must match the image canvas exactly.")
        _binary_check(mask, "edit_mask")
        alpha = mask.unsqueeze(-1)
        edited = alpha * candidate + (1.0 - alpha) * previous
        outside_difference = (edited - previous).abs() * (1.0 - alpha)
        outside_max = float(outside_difference.max().item())
        outside_count = max(1.0, float((1.0 - alpha).sum().item()) * previous.shape[-1])
        outside_mean = float(outside_difference.sum().item() / outside_count)
        if outside_max != 0.0:
            raise RuntimeError("Deterministic composite violated the zero-difference outside-mask contract.")
        boundary = cv2.morphologyEx(
            (mask[0].detach().cpu().numpy() > 0.5).astype(np.uint8),
            cv2.MORPH_GRADIENT,
            np.ones((3, 3), np.uint8),
        )
        diagnostic = _overlay(edited, torch.from_numpy(boundary).to(mask.device).unsqueeze(0), color=(1.0, 0.9, 0.0), opacity=0.8)
        report = json.dumps({"outside_max_diff": outside_max, "outside_mean_diff": outside_mean, "mask_polarity": "white_is_edited"})
        return edited, outside_max, outside_mean, diagnostic, report


class BadgePresentationPromptBuilder:
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build"
    CATEGORY = "DAELab/Badge/Prompt"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"presentation_direction": ("STRING", {"default": "Premium studio product photograph", "multiline": True})}}

    def build(self, presentation_direction):
        prompt = (
            "Image 1 is the completed registered badge master. Convert it into a final presentation render only now. "
            "Preserve the badge design, exact visible text, colors, material regions, outline, internal structure, and "
            "front-to-back height relationships. Do not add or remove structure and do not change the logo meaning. "
            "You may add physically plausible studio key/fill/rim lighting, metal edge highlights, material reflections, "
            "contact shadow, ambient occlusion, premium background, depth of field, macro framing, and a slight final "
            "perspective. This image is a presentation result and is not reused as a design-coordinate edit source.\n\n"
            f"Art direction: {str(presentation_direction).strip()}"
        )
        return (prompt,)


def _safe_state_target(output_root, filename_prefix):
    raw_parts = [part for part in re.split(r"[\\/]", str(filename_prefix or "Badge_8_2/state")) if part not in {"", ".", ".."}]
    safe_parts = [re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", part) for part in raw_parts]
    if not safe_parts:
        safe_parts = ["Badge_8_2", "state"]
    folder = Path(output_root).joinpath(*safe_parts[:-1])
    folder.mkdir(parents=True, exist_ok=True)
    base = safe_parts[-1]
    return folder / f"{base}_{time.strftime('%Y%m%d_%H%M%S')}.badge_state"


def _write_npy(archive, name, tensor):
    buffer = io.BytesIO()
    np.save(buffer, tensor.detach().cpu().numpy().astype(np.float32), allow_pickle=False)
    archive.writestr(name, buffer.getvalue())


def _read_npy(archive, name):
    with archive.open(name) as handle:
        return torch.from_numpy(np.load(io.BytesIO(handle.read()), allow_pickle=False)).float()


class BadgeEditStateSave:
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("state_path", "report")
    FUNCTION = "save"
    CATEGORY = "DAELab/Badge/State"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "current_master": ("IMAGE",),
                "normalized_flat_image": ("IMAGE",),
                "current_foreground_mask": ("MASK",),
                "height_enabled": ("BOOLEAN", {"default": True}),
                "registration_info": ("STRING", {"default": ""}),
                "current_prompt": ("STRING", {"default": "", "multiline": True}),
                "enabled": ("BOOLEAN", {"default": False}),
                "filename_prefix": ("STRING", {"default": "Badge_8_2/state"}),
            },
            "optional": {"current_height": ("MASK",)},
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO"},
        }

    def save(
        self,
        current_master,
        normalized_flat_image,
        current_foreground_mask,
        height_enabled,
        registration_info,
        current_prompt,
        enabled,
        filename_prefix,
        current_height=None,
        extra_pnginfo=None,
    ):
        if not enabled:
            return "", "State save disabled; no file written."
        if height_enabled and current_height is None:
            raise ValueError("height_enabled is true, so current_height must be saved.")
        import folder_paths

        target = _safe_state_target(folder_paths.get_output_directory(), filename_prefix)
        workflow = extra_pnginfo.get("workflow", {}) if isinstance(extra_pnginfo, dict) else {}
        color_configs = []
        color_config_properties = {
            "DAELabMultiColorMask": "multi_color_mask_config",
            "DAELabMultiColorMaskV1": "multi_color_mask_v1_config",
        }
        for node in workflow.get("nodes", []) if isinstance(workflow, dict) else []:
            node_type = node.get("type") if isinstance(node, dict) else None
            property_name = color_config_properties.get(node_type)
            if property_name:
                color_configs.append(
                    {
                        "node_id": node.get("id"),
                        "node_type": node_type,
                        "config": (node.get("properties") or {}).get(property_name),
                    }
                )
        metadata = {
            "version": 1,
            "height_enabled": bool(height_enabled),
            "registration_info": str(registration_info),
            "current_prompt": str(current_prompt),
            "color_group_configs": color_configs,
        }
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
            _write_npy(archive, "current_master.npy", _image_float(current_master))
            _write_npy(archive, "normalized_flat_image.npy", _image_float(normalized_flat_image))
            _write_npy(archive, "current_foreground_mask.npy", _mask_float(current_foreground_mask))
            if current_height is not None:
                _write_npy(archive, "current_height.npy", _mask_float(current_height))
        report = f"Saved complete badge edit state: {target}"
        return str(target), report


class BadgeEditStateLoad:
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "MASK", "BOOLEAN", "STRING")
    RETURN_NAMES = ("current_master", "normalized_flat_image", "current_height", "current_foreground_mask", "height_enabled", "metadata")
    FUNCTION = "load"
    CATEGORY = "DAELab/Badge/State"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"state_path": ("STRING", {"default": ""})}}

    def load(self, state_path):
        path = Path(str(state_path)).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"Badge state package does not exist: {path}")
        with zipfile.ZipFile(path, "r") as archive:
            metadata = json.loads(archive.read("metadata.json").decode("utf-8"))
            current_master = _read_npy(archive, "current_master.npy")
            normalized = _read_npy(archive, "normalized_flat_image.npy")
            foreground = _read_npy(archive, "current_foreground_mask.npy")
            if "current_height.npy" in archive.namelist():
                height = _read_npy(archive, "current_height.npy")
            else:
                height = torch.zeros_like(foreground)
        return current_master, normalized, height, foreground, bool(metadata.get("height_enabled")), json.dumps(metadata, ensure_ascii=False)


NODE_CLASS_MAPPINGS = {
    "BadgeDesignCanvas": BadgeDesignCanvas,
    "BadgeRenderPromptBuilder": BadgeRenderPromptBuilder,
    "BadgeMasterRegistration": BadgeMasterRegistration,
    "BadgeEditMaskValidator": BadgeEditMaskValidator,
    "BadgeLocalEditPromptBuilder": BadgeLocalEditPromptBuilder,
    "BadgeHeightPatch": BadgeHeightPatch,
    "BadgeDeterministicComposite": BadgeDeterministicComposite,
    "BadgePresentationPromptBuilder": BadgePresentationPromptBuilder,
    "BadgeEditStateSave": BadgeEditStateSave,
    "BadgeEditStateLoad": BadgeEditStateLoad,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BadgeDesignCanvas": "Badge Design Canvas (DAELab)",
    "BadgeRenderPromptBuilder": "Badge Render Prompt Builder (DAELab)",
    "BadgeMasterRegistration": "Badge Master Registration (DAELab)",
    "BadgeEditMaskValidator": "Badge Edit Mask Validator (DAELab)",
    "BadgeLocalEditPromptBuilder": "Badge Local Edit Prompt Builder (DAELab)",
    "BadgeHeightPatch": "Badge Height Patch (DAELab)",
    "BadgeDeterministicComposite": "Badge Deterministic Composite (DAELab)",
    "BadgePresentationPromptBuilder": "Badge Presentation Prompt Builder (DAELab)",
    "BadgeEditStateSave": "Badge Edit State Save (DAELab)",
    "BadgeEditStateLoad": "Badge Edit State Load (DAELab)",
}
