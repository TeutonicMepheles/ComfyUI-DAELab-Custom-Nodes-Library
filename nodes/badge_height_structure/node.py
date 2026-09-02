import json
import math

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


def _srgb_to_linear(rgb):
    return torch.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055).pow(2.4))


def _linear_to_srgb(rgb):
    return torch.where(
        rgb <= 0.0031308,
        12.92 * rgb,
        1.055 * torch.clamp(rgb, min=0.0).pow(1.0 / 2.4) - 0.055,
    )


def _rgb_to_oklab(rgb):
    linear = _srgb_to_linear(rgb.clamp(0.0, 1.0))
    red, green, blue = linear.unbind(-1)
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


def _gaussian_blur(value, radius):
    """Blur a [B,1,H,W] tensor with a finite separable Gaussian kernel."""
    height, width = value.shape[-2:]
    radius = min(max(0, int(radius)), (height - 1) // 2, (width - 1) // 2)
    if radius < 1:
        return value
    sigma = max(0.8, radius / 2.5)
    coordinates = torch.arange(-radius, radius + 1, device=value.device, dtype=value.dtype)
    kernel = torch.exp(-(coordinates * coordinates) / (2.0 * sigma * sigma))
    kernel = kernel / kernel.sum()
    horizontal = kernel.view(1, 1, 1, -1)
    vertical = kernel.view(1, 1, -1, 1)
    result = F.conv2d(F.pad(value, (radius, radius, 0, 0), mode="reflect"), horizontal)
    return F.conv2d(F.pad(result, (0, 0, radius, radius), mode="reflect"), vertical)


def _shift_single(value, dx, dy, fill_value):
    """Shift [H,W] or [H,W,C] without wraparound."""
    height, width = value.shape[:2]
    result = torch.full_like(value, float(fill_value))
    source_x0 = max(0, -int(dx))
    source_x1 = min(width, width - int(dx))
    source_y0 = max(0, -int(dy))
    source_y1 = min(height, height - int(dy))
    target_x0 = max(0, int(dx))
    target_y0 = max(0, int(dy))
    copy_width = source_x1 - source_x0
    copy_height = source_y1 - source_y0
    if copy_width > 0 and copy_height > 0:
        result[target_y0:target_y0 + copy_height, target_x0:target_x0 + copy_width] = value[
            source_y0:source_y1, source_x0:source_x1
        ]
    return result


def _edge_alignment_translation(candidate_light, target_edges, foreground, maximum_shift):
    shifts = []
    scores = []
    coverages = []
    maximum_shift = max(0, int(maximum_shift))
    for batch_index in range(candidate_light.shape[0]):
        gradient = _gradient_magnitude(candidate_light[batch_index:batch_index + 1])[0]
        support_values = gradient[foreground[batch_index]]
        if support_values.numel() == 0:
            shifts.append((0, 0))
            scores.append(0.0)
            coverages.append(0.0)
            continue
        scale = torch.quantile(support_values, 0.95).clamp_min(1e-5)
        normalized = (gradient / scale).clamp(0.0, 1.0)
        edge_threshold = torch.quantile(support_values, 0.78)
        candidate_edges = gradient >= edge_threshold
        target_y, target_x = torch.nonzero(target_edges[batch_index], as_tuple=True)
        if target_y.numel() == 0:
            shifts.append((0, 0))
            scores.append(1.0)
            coverages.append(1.0)
            continue
        if target_y.numel() > 24000:
            stride = max(1, target_y.numel() // 24000)
            target_y = target_y[::stride]
            target_x = target_x[::stride]

        best = (float("-inf"), 0.0, 0, 0)
        for dy in range(-maximum_shift, maximum_shift + 1):
            sample_y = target_y - dy
            valid_y = (sample_y >= 0) & (sample_y < candidate_light.shape[1])
            for dx in range(-maximum_shift, maximum_shift + 1):
                sample_x = target_x - dx
                valid = valid_y & (sample_x >= 0) & (sample_x < candidate_light.shape[2])
                if not bool(valid.any()):
                    continue
                values = normalized[sample_y[valid], sample_x[valid]]
                edge_values = candidate_edges[sample_y[valid], sample_x[valid]]
                score = float(values.mean().item())
                coverage = float(edge_values.float().mean().item())
                # Prefer the smallest translation when scores are effectively tied.
                ranking = score + coverage * 0.15 - (abs(dx) + abs(dy)) * 1e-5
                if ranking > best[0]:
                    best = (ranking, coverage, dx, dy)
        shifts.append((best[2], best[3]))
        scores.append(max(0.0, best[0]))
        coverages.append(best[1])
    return shifts, scores, coverages


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
        return None, str(error), False, None
    if candidate.shape[0] not in (1, batch):
        return None, f"candidate batch {candidate.shape[0]} cannot broadcast to batch {batch}.", False, None
    candidate = _broadcast(candidate, batch, "candidate_image")
    original_size = [int(candidate.shape[2]), int(candidate.shape[1])]
    resized = False
    if candidate.shape[1:3] != (height, width):
        candidate = _resize_image(candidate, height, width)
        resized = True
    if not bool(torch.isfinite(candidate).all()):
        return None, "candidate_image contains non-finite values.", resized, original_size
    return candidate.clamp(0.0, 1.0), "", resized, original_size


def _prepare_structure_inputs(flat_image, height_map, foreground_mask, enforce_1024, node_name):
    flat = _image_float(flat_image, "flat_image")
    height = _mask_float(height_map, "height_map")
    foreground = _mask_float(foreground_mask, "foreground_mask")
    batch = max(flat.shape[0], height.shape[0], foreground.shape[0])
    flat = _broadcast(flat, batch, "flat_image")
    height = _broadcast(height, batch, "height_map")
    foreground = _broadcast(foreground, batch, "foreground_mask")
    target_height, target_width = foreground.shape[1:]
    if enforce_1024 and (target_height, target_width) != (1024, 1024):
        raise ValueError(f"{node_name} requires a 1024x1024 foreground mask.")
    if flat.shape[1:3] != (target_height, target_width):
        if enforce_1024:
            raise ValueError("flat_image must match the 1024x1024 foreground mask.")
        flat = _resize_image(flat, target_height, target_width)
    if height.shape[1:] != (target_height, target_width):
        if enforce_1024:
            raise ValueError("height_map must match the 1024x1024 foreground mask.")
        height = _resize_mask(height, target_height, target_width)
    if not bool(torch.isfinite(flat).all()):
        raise ValueError("flat_image must contain only finite values.")
    if not bool(torch.isfinite(height).all()) or not bool(torch.isfinite(foreground).all()):
        raise ValueError("height_map and foreground_mask must contain only finite values.")
    legal_height = torch.round(height * 5.0) / 5.0
    if float((height - legal_height).abs().max().item()) > 1e-4:
        raise ValueError("height_map contains values outside {0,.2,.4,.6,.8,1}.")
    foreground = foreground > 0.5
    if not bool(foreground.any()):
        raise ValueError("foreground_mask must contain at least one foreground pixel.")
    return flat.clamp(0.0, 1.0), legal_height.clamp(0.0, 1.0), foreground


class BadgeReliefGeometryV1:
    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "MASK", "MASK", "STRING")
    RETURN_NAMES = (
        "relief_base",
        "relief_lightness",
        "normal_preview",
        "ambient_occlusion",
        "beveled_height",
        "report",
    )
    FUNCTION = "render"
    CATEGORY = "DAELab/Badge/Height"
    DESCRIPTION = (
        "Build a deterministic colored relief base from the legal six-level badge height map, "
        "including finite-width bevels, coherent normals, specular lift, and contact occlusion."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "foreground_mask": ("MASK",),
            "bevel_radius_px": ("INT", {"default": 7, "min": 1, "max": 24, "step": 1}),
            "relief_depth": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 3.0, "step": 0.05}),
            "normal_strength": ("FLOAT", {"default": 11.0, "min": 1.0, "max": 60.0, "step": 0.5}),
            "ambient": ("FLOAT", {"default": 0.72, "min": 0.3, "max": 1.0, "step": 0.01}),
            "key_strength": ("FLOAT", {"default": 0.34, "min": 0.0, "max": 1.0, "step": 0.01}),
            "specular_strength": ("FLOAT", {"default": 0.07, "min": 0.0, "max": 0.5, "step": 0.01}),
            "specular_power": ("FLOAT", {"default": 28.0, "min": 2.0, "max": 96.0, "step": 1.0}),
            "ao_strength": ("FLOAT", {"default": 0.10, "min": 0.0, "max": 0.5, "step": 0.01}),
            "ao_radius_px": ("INT", {"default": 10, "min": 1, "max": 32, "step": 1}),
            "light_azimuth_degrees": ("FLOAT", {"default": -135.0, "min": -180.0, "max": 180.0, "step": 1.0}),
            "light_elevation_degrees": ("FLOAT", {"default": 45.0, "min": 10.0, "max": 85.0, "step": 1.0}),
            "enforce_1024": ("BOOLEAN", {"default": True}),
        }}

    def render(
        self,
        flat_image,
        height_map,
        foreground_mask,
        bevel_radius_px=7,
        relief_depth=1.0,
        normal_strength=11.0,
        ambient=0.72,
        key_strength=0.34,
        specular_strength=0.07,
        specular_power=28.0,
        ao_strength=0.10,
        ao_radius_px=10,
        light_azimuth_degrees=-135.0,
        light_elevation_degrees=45.0,
        enforce_1024=True,
    ):
        flat, height, foreground = _prepare_structure_inputs(
            flat_image,
            height_map,
            foreground_mask,
            bool(enforce_1024),
            "Badge Relief Geometry V1",
        )
        batch, canvas_height, canvas_width, _ = flat.shape
        discrete_height = height * foreground.float()
        value = discrete_height.unsqueeze(1)
        beveled = _gaussian_blur(value, int(bevel_radius_px)).clamp(0.0, 1.0)

        dx = F.pad(beveled[:, :, :, 2:] - beveled[:, :, :, :-2], (1, 1, 0, 0), mode="replicate") * 0.5
        dy = F.pad(beveled[:, :, 2:, :] - beveled[:, :, :-2, :], (0, 0, 1, 1), mode="replicate") * 0.5
        slope_scale = float(normal_strength) * float(relief_depth)
        nx = -dx * slope_scale
        ny = -dy * slope_scale
        nz = torch.ones_like(nx)
        normal_length = torch.sqrt(nx * nx + ny * ny + nz * nz).clamp_min(1e-6)
        nx, ny, nz = nx / normal_length, ny / normal_length, nz / normal_length

        azimuth = math.radians(float(light_azimuth_degrees))
        elevation = math.radians(float(light_elevation_degrees))
        horizontal = math.cos(elevation)
        light = torch.tensor(
            (math.cos(azimuth) * horizontal, math.sin(azimuth) * horizontal, math.sin(elevation)),
            device=flat.device,
            dtype=flat.dtype,
        )
        light = light / torch.linalg.vector_norm(light).clamp_min(1e-6)
        diffuse = (nx * light[0] + ny * light[1] + nz * light[2]).clamp(0.0, 1.0)
        flat_diffuse = float(light[2].item())

        half_vector = light + torch.tensor((0.0, 0.0, 1.0), device=flat.device, dtype=flat.dtype)
        half_vector = half_vector / torch.linalg.vector_norm(half_vector).clamp_min(1e-6)
        normal_half = (nx * half_vector[0] + ny * half_vector[1] + nz * half_vector[2]).clamp(0.0, 1.0)
        flat_specular = float(half_vector[2].item()) ** float(specular_power)
        specular = (normal_half.pow(float(specular_power)) - flat_specular).clamp_min(0.0)

        ao_radius = max(1, int(ao_radius_px))
        local_high = F.max_pool2d(value, kernel_size=ao_radius * 2 + 1, stride=1, padding=ao_radius)
        occlusion = ((local_high - beveled).clamp_min(0.0) * 5.0).clamp(0.0, 1.0)
        occlusion = _gaussian_blur(occlusion, max(1, ao_radius // 3)).clamp(0.0, 1.0)

        flat_lab = _rgb_to_oklab(flat)
        ambient_offset = (float(ambient) - 0.72) * 0.30
        lighting_delta = (
            ambient_offset
            + float(key_strength) * (diffuse - flat_diffuse)
            + float(specular_strength) * specular
            - float(ao_strength) * occlusion
            + (beveled - 0.5) * 0.025 * float(relief_depth)
        )
        positive_headroom = ((0.98 - flat_lab[..., 0].unsqueeze(1)) / 0.30).clamp(0.20, 1.0)
        lighting_delta = torch.where(lighting_delta > 0.0, lighting_delta * positive_headroom, lighting_delta)
        target_lightness = (flat_lab[..., 0].unsqueeze(1) + lighting_delta).clamp(0.03, 0.98)
        relief_lab = torch.stack((target_lightness[:, 0], flat_lab[..., 1], flat_lab[..., 2]), dim=-1)
        relief = _oklab_to_rgb(relief_lab)
        foreground_image = foreground.unsqueeze(-1)
        relief = torch.where(foreground_image, relief, torch.ones_like(relief))
        target_lightness = torch.where(foreground.unsqueeze(1), target_lightness, torch.ones_like(target_lightness))

        height_edges = _scalar_edges(discrete_height, 0.05) | _binary_edges(foreground.float())
        bevel_band = _dilate(height_edges, int(bevel_radius_px)).float()
        normal_preview = torch.cat((nx, ny, nz), dim=1).permute(0, 2, 3, 1) * 0.5 + 0.5
        normal_preview = torch.where(foreground_image, normal_preview, torch.ones_like(normal_preview))
        report = {
            "version": 1,
            "canvas": [canvas_width, canvas_height],
            "height_levels": sorted(round(float(item), 1) for item in torch.unique(height).tolist()),
            "bevel_radius_px": int(bevel_radius_px),
            "relief_depth": float(relief_depth),
            "normal_strength": float(normal_strength),
            "ambient": float(ambient),
            "key_strength": float(key_strength),
            "specular_strength": float(specular_strength),
            "specular_power": float(specular_power),
            "ao_strength": float(ao_strength),
            "ao_radius_px": ao_radius,
            "light_azimuth_degrees": float(light_azimuth_degrees),
            "light_elevation_degrees": float(light_elevation_degrees),
            "bevel_pixels": int(bevel_band.sum().item()),
            "ao_max": float(occlusion.max().item()),
            "deterministic": True,
        }
        return (
            relief.clamp(0.0, 1.0),
            target_lightness[:, 0],
            normal_preview.clamp(0.0, 1.0),
            occlusion[:, 0] * foreground.float(),
            beveled[:, 0],
            json.dumps(report, sort_keys=True),
        )


class BadgeGPTStructureTransferV1:
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = (
        "fused_structure",
        "fused_lightness",
        "accepted",
        "aligned_candidate",
        "detail_preview",
        "report",
    )
    FUNCTION = "transfer"
    CATEGORY = "DAELab/Badge/Height"
    DESCRIPTION = (
        "Resize and register a GPT grayscale structure proof, transfer only bounded form/detail "
        "frequencies into the deterministic relief base, and preserve the flat artwork colors."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "candidate_image": ("IMAGE",),
            "geometry_base": ("IMAGE",),
            "flat_image": ("IMAGE",),
            "height_map": ("MASK",),
            "foreground_mask": ("MASK",),
            "form_strength": ("FLOAT", {"default": 0.40, "min": 0.0, "max": 1.0, "step": 0.01}),
            "detail_strength": ("FLOAT", {"default": 0.24, "min": 0.0, "max": 1.0, "step": 0.01}),
            "boundary_lock_px": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
            "maximum_translation_px": ("INT", {"default": 8, "min": 0, "max": 32, "step": 1}),
            "minimum_relief_contrast": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.005}),
            "minimum_edge_coverage": ("FLOAT", {"default": 0.24, "min": 0.0, "max": 1.0, "step": 0.01}),
            "enforce_1024": ("BOOLEAN", {"default": True}),
        }}

    def transfer(
        self,
        candidate_image,
        geometry_base,
        flat_image,
        height_map,
        foreground_mask,
        form_strength=0.40,
        detail_strength=0.24,
        boundary_lock_px=1,
        maximum_translation_px=8,
        minimum_relief_contrast=0.08,
        minimum_edge_coverage=0.24,
        enforce_1024=True,
    ):
        geometry = _image_float(geometry_base, "geometry_base")
        flat, height, foreground = _prepare_structure_inputs(
            flat_image,
            height_map,
            foreground_mask,
            bool(enforce_1024),
            "Badge GPT Structure Transfer V1",
        )
        batch, canvas_height, canvas_width, _ = flat.shape
        geometry = _broadcast(geometry, batch, "geometry_base")
        if geometry.shape[1:3] != (canvas_height, canvas_width):
            if enforce_1024:
                raise ValueError("geometry_base must match the 1024x1024 structure canvas.")
            geometry = _resize_image(geometry, canvas_height, canvas_width)
        if not bool(torch.isfinite(geometry).all()):
            raise ValueError("geometry_base must contain only finite values.")

        candidate, invalid_reason, candidate_resized, candidate_original_size = _prepare_candidate(
            candidate_image,
            batch,
            canvas_height,
            canvas_width,
            bool(enforce_1024),
        )
        target_edges = (
            _scalar_edges(height, 0.05)
            | (_color_edges(flat) & foreground)
            | _binary_edges(foreground.float())
        )
        boundary_lock = _dilate(target_edges, int(boundary_lock_px))
        candidate_valid = candidate is not None
        shifts = [(0, 0)] * batch
        alignment_scores = [0.0] * batch
        edge_coverages = [0.0] * batch
        relief_contrast = 0.0

        if candidate_valid:
            raw_candidate_light = _rgb_to_oklab(candidate)[..., 0]
            shifts, alignment_scores, edge_coverages = _edge_alignment_translation(
                raw_candidate_light,
                target_edges,
                foreground,
                int(maximum_translation_px),
            )
            aligned_items = [
                _shift_single(candidate[index], shifts[index][0], shifts[index][1], 1.0)
                for index in range(batch)
            ]
            aligned = torch.stack(aligned_items)
            aligned_light = _normalize_candidate_lightness(_rgb_to_oklab(aligned)[..., 0], foreground)
            relief_contrast = _quantile_range(aligned_light, foreground)
        else:
            aligned = torch.ones_like(geometry)
            aligned_light = torch.ones((batch, canvas_height, canvas_width), device=geometry.device, dtype=geometry.dtype)

        fallback_reason = invalid_reason
        if candidate_valid and relief_contrast < float(minimum_relief_contrast):
            fallback_reason = "candidate_relief_signal_too_weak"
        elif candidate_valid and min(edge_coverages) < float(minimum_edge_coverage):
            fallback_reason = "candidate_edge_alignment_too_weak"
        accepted = bool(candidate_valid and not fallback_reason)

        geometry_lab = _rgb_to_oklab(geometry)
        flat_lab = _rgb_to_oklab(flat)
        geometry_light = geometry_lab[..., 0].unsqueeze(1)
        signal = torch.zeros_like(geometry_light)
        if accepted:
            candidate_cf = aligned_light.unsqueeze(1)
            fine = _gaussian_blur(candidate_cf, 3)
            form = _gaussian_blur(candidate_cf, 10) - _gaussian_blur(candidate_cf, 48)
            medium = fine - _gaussian_blur(candidate_cf, 24)
            high = candidate_cf - fine
            signal = (
                float(form_strength) * form.clamp(-0.16, 0.16)
                + float(detail_strength) * (
                    medium.clamp(-0.12, 0.12) * 0.70
                    + high.clamp(-0.08, 0.08) * 0.30
                )
            ).clamp(-0.10, 0.10)
            allowed = (foreground & ~boundary_lock).unsqueeze(1).float()
            signal = signal * allowed
            fused_light = (geometry_light + signal).clamp(0.03, 0.98)
            fused_lab = torch.stack((fused_light[:, 0], flat_lab[..., 1], flat_lab[..., 2]), dim=-1)
            fused = _oklab_to_rgb(fused_lab)
            fused = torch.where(foreground.unsqueeze(-1), fused, geometry)
            locked_image = boundary_lock.unsqueeze(-1)
            fused = torch.where(locked_image, geometry, fused)
            output_source = "registered_gpt_detail_over_deterministic_relief"
        else:
            fused = geometry.clone()
            fused_light = geometry_light
            output_source = "deterministic_relief_fallback"

        detail_preview = (0.5 + signal[:, 0] * 4.0).clamp(0.0, 1.0).unsqueeze(-1).repeat(1, 1, 1, 3)
        outside_diff = (fused - geometry).abs() * (~foreground).unsqueeze(-1)
        locked_diff = (fused - geometry).abs() * boundary_lock.unsqueeze(-1)
        report = {
            "version": 1,
            "accepted": accepted,
            "output_source": output_source,
            "fallback_reason": fallback_reason or None,
            "candidate_valid": candidate_valid,
            "candidate_original_size": candidate_original_size,
            "candidate_resized": candidate_resized,
            "output_size": [canvas_width, canvas_height],
            "translations": [{"x": int(dx), "y": int(dy)} for dx, dy in shifts],
            "alignment_scores": alignment_scores,
            "edge_coverages": edge_coverages,
            "minimum_edge_coverage": float(minimum_edge_coverage),
            "relief_contrast": relief_contrast,
            "minimum_relief_contrast": float(minimum_relief_contrast),
            "form_strength": float(form_strength),
            "detail_strength": float(detail_strength),
            "boundary_lock_px": int(boundary_lock_px),
            "outside_max_abs_diff": float(outside_diff.max().item()) if outside_diff.numel() else 0.0,
            "locked_max_abs_diff": float(locked_diff.max().item()) if locked_diff.numel() else 0.0,
        }
        return (
            fused.clamp(0.0, 1.0),
            fused_light[:, 0],
            accepted,
            aligned.clamp(0.0, 1.0),
            detail_preview,
            json.dumps(report, sort_keys=True),
        )


class BadgeStructureConstraintV1:
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN", "STRING")
    RETURN_NAMES = ("structure_image", "structure_lightness", "accepted", "report")
    FUNCTION = "constrain"
    CATEGORY = "DAELab/Badge/Height"
    DESCRIPTION = (
        "Validate a global GPT-Image-2 grayscale relief proof, transfer only its lighting "
        "onto the flat artwork colors, preserve exact boundaries, and fall back safely."
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
        candidate, invalid_reason, candidate_resized, candidate_original_size = _prepare_candidate(
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
        edit_weight = (foreground & ~protected).to(dtype=torch.float32)
        if accepted:
            output_lightness = (
                neutral_fallback * (1.0 - edit_weight)
                + candidate_lightness * edit_weight
            ).clamp(0.0, 1.0)
            output_source = "gpt_structure_candidate"
        else:
            output_lightness = neutral_fallback
            output_source = "deterministic_height_fallback"

        if accepted and bool(enforce_grayscale):
            # GPT contributes only a normalized light/shadow ratio. Reapplying that
            # ratio to the immutable flat artwork keeps every region's original
            # hue/chroma available to the downstream material workflow.
            light_ratio = (candidate_lightness / NEUTRAL_STRUCTURE_LEVEL).clamp(0.45, 1.45)
            colorized_candidate = (flat * light_ratio.unsqueeze(-1)).clamp(0.0, 1.0)
            weight = edit_weight.unsqueeze(-1)
            structure_image = fallback * (1.0 - weight) + colorized_candidate * weight
        else:
            if accepted:
                weight = edit_weight.unsqueeze(-1)
                structure_image = fallback * (1.0 - weight) + candidate * weight
            else:
                structure_image = fallback

        outside = (~foreground).unsqueeze(-1)
        protected_support = protected.unsqueeze(-1)
        outside_diff = (structure_image - fallback).abs() * outside
        protected_diff = (structure_image - fallback).abs() * protected_support
        report = {
            "version": 1,
            "accepted": accepted,
            "output_source": output_source,
            "fallback_reason": fallback_reason or None,
            "candidate_valid": candidate_valid,
            "candidate_resized": candidate_resized,
            "candidate_original_size": candidate_original_size,
            "candidate_input_chroma_mean": candidate_chroma_mean,
            "grayscale_candidate_forced": bool(enforce_grayscale),
            "flat_color_restored": bool(accepted and enforce_grayscale),
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
    "DAELAB.BadgeReliefGeometryV1": BadgeReliefGeometryV1,
    "DAELAB.BadgeGPTStructureTransferV1": BadgeGPTStructureTransferV1,
    "DAELAB.BadgeStructureConstraintV1": BadgeStructureConstraintV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.BadgeReliefGeometryV1": "Badge Relief Geometry V1 (DAELab)",
    "DAELAB.BadgeGPTStructureTransferV1": "Badge GPT Structure Transfer V1 (DAELab)",
    "DAELAB.BadgeStructureConstraintV1": "Badge Structure Constraint V1 (DAELab)",
}
