from __future__ import annotations

import json
import math

import cv2
import numpy as np
import torch
import torch.nn.functional as F


VIVID_PALETTE = (
    "#FF1744",
    "#00E5FF",
    "#FFEA00",
    "#76FF03",
    "#D500F9",
    "#FF9100",
    "#2979FF",
    "#F50057",
    "#1DE9B6",
    "#AA00FF",
    "#C6FF00",
    "#FF3D00",
    "#00B0FF",
    "#FFD600",
    "#64FFDA",
    "#E040FB",
    "#7C4DFF",
    "#00C853",
    "#FF6D00",
    "#6200EA",
    "#00BFA5",
    "#C51162",
    "#AEEA00",
    "#0091EA",
    "#DD2C00",
    "#304FFE",
    "#00E676",
    "#FF4081",
    "#651FFF",
    "#FFAB00",
    "#18FFFF",
    "#B2FF59",
)


def _image_float(image, name):
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or image.shape[-1] < 3:
        raise ValueError(f"{name} must use ComfyUI IMAGE shape [B,H,W,C].")
    if not image.is_floating_point():
        image = image.float()
    if not torch.isfinite(image).all().item():
        raise ValueError(f"{name} contains non-finite values.")
    return image[..., :3].to(dtype=torch.float32).clamp(0.0, 1.0)


def _mask_float(mask, name):
    if not isinstance(mask, torch.Tensor):
        raise ValueError(f"{name} must be a torch tensor.")
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    elif mask.ndim == 4 and mask.shape[1] == 1:
        mask = mask[:, 0]
    if mask.ndim != 3:
        raise ValueError(f"{name} must use ComfyUI MASK shape [B,H,W].")
    if not mask.is_floating_point():
        mask = mask.float()
    if not torch.isfinite(mask).all().item():
        raise ValueError(f"{name} contains non-finite values.")
    return mask.to(dtype=torch.float32).clamp(0.0, 1.0)


def _broadcast(value, batch, name):
    if value.shape[0] == batch:
        return value
    if value.shape[0] == 1:
        return value.expand(batch, *value.shape[1:])
    raise ValueError(f"{name} batch must be 1 or match target_image batch {batch}.")


def _resize_image(image, height, width):
    if image.shape[1:3] == (height, width):
        return image
    return F.interpolate(
        image.permute(0, 3, 1, 2),
        size=(height, width),
        mode="bilinear",
        align_corners=False,
    ).permute(0, 2, 3, 1).contiguous()


def _resize_mask(mask, height, width):
    if mask.shape[1:] == (height, width):
        return mask
    return F.interpolate(mask.unsqueeze(1), size=(height, width), mode="nearest-exact")[:, 0]


def _largest_components(binary):
    binary = (binary > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count <= 1:
        return binary
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(areas.max())
    minimum = max(12, int(round(largest * 0.0015)))
    keep = np.flatnonzero(areas >= minimum) + 1
    return np.isin(labels, keep).astype(np.uint8)


def _extract_border_foreground(rgb, threshold):
    height, width = rgb.shape[:2]
    border = max(2, int(round(min(height, width) * 0.025)))
    border_pixels = np.concatenate((
        rgb[:border].reshape(-1, 3),
        rgb[-border:].reshape(-1, 3),
        rgb[:, :border].reshape(-1, 3),
        rgb[:, -border:].reshape(-1, 3),
    ))
    background = np.median(border_pixels, axis=0)
    distance = np.linalg.norm(rgb - background[None, None, :], axis=2) * 255.0
    binary = (distance >= max(1.0, float(threshold))).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
    return _largest_components(binary), background


def _centroid(mask):
    ys, xs = np.nonzero(mask > 0)
    if not len(xs):
        raise ValueError("foreground mask is empty.")
    return float(xs.mean()), float(ys.mean())


def _iou(first, second):
    first = first > 0
    second = second > 0
    union = np.logical_or(first, second).sum()
    return float(np.logical_and(first, second).sum() / union) if union else 1.0


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


def _similarity_matrix(source, target, max_rotation, max_scale_delta):
    source_center = _centroid(source)
    target_center = _centroid(target)
    source_area = max(1, int((source > 0).sum()))
    target_area = max(1, int((target > 0).sum()))
    lower = 1.0 - float(max_scale_delta)
    upper = 1.0 + float(max_scale_delta)
    base_scale = float(np.clip(math.sqrt(target_area / source_area), lower, upper))
    height, width = target.shape
    best = None
    for angle in np.linspace(-float(max_rotation), float(max_rotation), 17):
        for offset in np.linspace(-float(max_scale_delta), float(max_scale_delta), 17):
            scale = float(np.clip(base_scale + offset, lower, upper))
            matrix = cv2.getRotationMatrix2D(source_center, float(angle), scale)
            matrix[0, 2] += target_center[0] - source_center[0]
            matrix[1, 2] += target_center[1] - source_center[1]
            warped = cv2.warpAffine(
                source,
                matrix,
                (width, height),
                flags=cv2.INTER_NEAREST,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )
            score = _iou(warped, target)
            if best is None or score > best[0]:
                best = (score, matrix)
    return best[1].astype(np.float32), float(best[0])


def _warp(array, matrix, width, height, interpolation):
    return cv2.warpAffine(
        array,
        matrix,
        (width, height),
        flags=interpolation,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )


def _refine_foreground(raw_target, aligned_source, snap_radius):
    radius = max(0, int(snap_radius))
    if radius == 0:
        return (raw_target > 0).astype(np.uint8)
    diameter = radius * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
    outer = cv2.dilate((aligned_source > 0).astype(np.uint8), kernel, iterations=1)
    inner = cv2.erode((aligned_source > 0).astype(np.uint8), kernel, iterations=1)
    refined = np.logical_or(np.logical_and(raw_target > 0, outer > 0), inner > 0)
    return _largest_components(refined.astype(np.uint8))


def _deterministic_color_labels(source_rgb, foreground, region_count, smoothing_px):
    foreground = foreground > 0
    if not foreground.any():
        raise ValueError("source_foreground_mask is empty.")
    lab = cv2.cvtColor(
        np.clip(source_rgb * 255.0, 0, 255).astype(np.uint8),
        cv2.COLOR_RGB2LAB,
    ).astype(np.float32)
    pixels = lab[foreground]
    maximum_samples = 65536
    if len(pixels) > maximum_samples:
        indices = np.linspace(0, len(pixels) - 1, maximum_samples, dtype=np.int64)
        sample = pixels[indices]
    else:
        sample = pixels
    unique = np.unique(np.round(sample / 3.0).astype(np.int16), axis=0)
    count = max(1, min(int(region_count), len(unique), len(sample), len(VIVID_PALETTE)))

    mean = sample.mean(axis=0)
    first = int(np.argmin(((sample - mean) ** 2).sum(axis=1)))
    centers = [sample[first].copy()]
    for _ in range(1, count):
        distance = np.min(
            np.stack([((sample - center) ** 2).sum(axis=1) for center in centers], axis=1),
            axis=1,
        )
        centers.append(sample[int(np.argmax(distance))].copy())
    centers = np.stack(centers).astype(np.float32)

    for _ in range(24):
        assignment = np.argmin(
            ((sample[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2),
            axis=1,
        )
        updated = centers.copy()
        for cluster in range(count):
            selected = sample[assignment == cluster]
            if len(selected):
                updated[cluster] = selected.mean(axis=0)
        if float(np.abs(updated - centers).max()) < 0.05:
            centers = updated
            break
        centers = updated

    pixels_full = lab[foreground]
    assignment_full = np.empty(len(pixels_full), dtype=np.int32)
    chunk = 131072
    for start in range(0, len(pixels_full), chunk):
        values = pixels_full[start:start + chunk]
        assignment_full[start:start + chunk] = np.argmin(
            ((values[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2),
            axis=1,
        )
    cluster_counts = np.bincount(assignment_full, minlength=count)
    order = np.argsort(-cluster_counts, kind="stable")
    remap = np.zeros(count, dtype=np.int32)
    remap[order] = np.arange(1, count + 1, dtype=np.int32)
    labels = np.zeros(foreground.shape, dtype=np.int32)
    labels[foreground] = remap[assignment_full]
    centers = centers[order]

    radius = max(0, int(smoothing_px))
    if radius > 0 and count > 1:
        kernel = radius * 2 + 1
        votes = np.stack([
            cv2.boxFilter(
                (labels == label).astype(np.float32),
                cv2.CV_32F,
                (kernel, kernel),
                normalize=False,
                borderType=cv2.BORDER_REPLICATE,
            )
            for label in range(1, count + 1)
        ])
        labels[foreground] = np.argmax(votes[:, foreground], axis=0) + 1
    return labels, centers


def _split_disconnected_regions(labels, cluster_count, minimum_pixels, maximum_regions=16):
    components = []
    by_cluster = {}
    for cluster in range(1, int(cluster_count) + 1):
        count, component_labels, stats, _ = cv2.connectedComponentsWithStats(
            (labels == cluster).astype(np.uint8),
            8,
        )
        cluster_components = []
        for component in range(1, count):
            area = int(stats[component, cv2.CC_STAT_AREA])
            item = (area, cluster, component_labels == component)
            components.append(item)
            cluster_components.append(item)
        if cluster_components:
            by_cluster[cluster] = max(cluster_components, key=lambda item: item[0])

    selected = list(by_cluster.values())
    selected_ids = {id(item) for item in selected}
    extras = sorted(
        (
            item for item in components
            if id(item) not in selected_ids and item[0] >= int(minimum_pixels)
        ),
        key=lambda item: (-item[0], item[1]),
    )
    selected.extend(extras[:max(0, int(maximum_regions) - len(selected))])
    selected = selected[:int(maximum_regions)]
    output = np.zeros(labels.shape, dtype=np.int32)
    region_clusters = []
    primary_region = {}
    for region_id, (_, cluster, component_mask) in enumerate(selected, start=1):
        output[component_mask] = region_id
        region_clusters.append(cluster - 1)
        primary_region.setdefault(cluster, region_id)
    for cluster, region_id in primary_region.items():
        output[(labels == cluster) & (output == 0)] = region_id
    return output, region_clusters


def _snap_color_labels(labels, target_rgb, target_foreground, seed_inset_px, tolerance_px):
    foreground = target_foreground > 0
    if not foreground.any() or int(labels.max()) < 1:
        return np.where(foreground, labels, 0).astype(np.int32)
    markers = np.zeros(labels.shape, dtype=np.int32)
    markers[~foreground] = 1
    radius = max(1, int(seed_inset_px))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    for label in range(1, int(labels.max()) + 1):
        region = ((labels == label) & foreground).astype(np.uint8)
        if not region.any():
            continue
        seed = cv2.erode(region, kernel, iterations=1)
        if not seed.any():
            seed = region
        markers[seed > 0] = label + 1
    target_u8 = np.clip(target_rgb * 255.0, 0, 255).astype(np.uint8)
    target_u8 = cv2.GaussianBlur(target_u8, (5, 5), 0)
    watershed = cv2.watershed(cv2.cvtColor(target_u8, cv2.COLOR_RGB2BGR), markers.copy())
    snapped = labels.copy()
    tolerance = max(0, int(tolerance_px))
    if tolerance == 0:
        snapped[~foreground] = 0
        return snapped.astype(np.int32)
    source_edges = np.zeros(labels.shape, dtype=np.uint8)
    vertical = labels[:, 1:] != labels[:, :-1]
    horizontal = labels[1:, :] != labels[:-1, :]
    source_edges[:, 1:] |= vertical
    source_edges[:, :-1] |= vertical
    source_edges[1:, :] |= horizontal
    source_edges[:-1, :] |= horizontal
    kernel_size = tolerance * 2 + 1
    boundary_band = cv2.dilate(
        source_edges,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
        iterations=1,
    ) > 0
    assigned = (watershed > 1) & foreground & boundary_band
    snapped[assigned] = watershed[assigned] - 1
    snapped[~foreground] = 0
    return snapped.astype(np.int32)


def _palette_rgb(index):
    value = VIVID_PALETTE[index]
    return np.array([int(value[offset:offset + 2], 16) for offset in (1, 3, 5)], np.float32) / 255.0


def _color_region_map(labels):
    output = np.zeros((*labels.shape, 3), dtype=np.float32)
    for label in range(1, int(labels.max()) + 1):
        output[labels == label] = _palette_rgb(label - 1)
    return output


def _overlay(target, foreground, aligned_source_foreground, region):
    image = target.copy()
    region_bool = region > 0
    image[region_bool] = image[region_bool] * 0.52 + np.array([0.95, 0.08, 0.12], np.float32) * 0.48
    kernel = np.ones((3, 3), np.uint8)
    target_edge = cv2.morphologyEx(foreground.astype(np.uint8), cv2.MORPH_GRADIENT, kernel) > 0
    source_edge = cv2.morphologyEx(aligned_source_foreground.astype(np.uint8), cv2.MORPH_GRADIENT, kernel) > 0
    image[source_edge] = np.array([0.0, 0.85, 1.0], np.float32)
    image[target_edge] = np.array([0.15, 1.0, 0.2], np.float32)
    return np.clip(image, 0.0, 1.0)


class BadgeRenderSpaceMaskAlignV1:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source_image": ("IMAGE",),
                "target_image": ("IMAGE",),
                "source_foreground_mask": ("MASK",),
                "source_region_mask": ("MASK",),
                "extraction_mode": (["auto_border", "source_prior_only"],),
                "background_threshold": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 128.0, "step": 1.0}),
                "max_rotation": ("FLOAT", {"default": 8.0, "min": 0.0, "max": 30.0, "step": 0.5}),
                "max_scale_delta": ("FLOAT", {"default": 0.20, "min": 0.0, "max": 0.50, "step": 0.01}),
                "snap_radius": ("INT", {"default": 6, "min": 0, "max": 32, "step": 1}),
                "region_inset_px": ("INT", {"default": 0, "min": 0, "max": 16, "step": 1}),
                "minimum_iou": ("FLOAT", {"default": 0.70, "min": 0.0, "max": 1.0, "step": 0.01}),
                "color_region_count": ("INT", {"default": 12, "min": 2, "max": 32, "step": 1}),
                "color_smoothing_px": ("INT", {"default": 2, "min": 0, "max": 8, "step": 1}),
                "snap_region_boundaries": ("BOOLEAN", {"default": True}),
                "split_disconnected_regions": ("BOOLEAN", {"default": False}),
                "minimum_color_region_pixels": ("INT", {"default": 256, "min": 1, "max": 65536, "step": 1}),
                "region_boundary_tolerance_px": ("INT", {"default": 3, "min": 0, "max": 32, "step": 1}),
                "maximum_color_regions": ("INT", {"default": 32, "min": 2, "max": 32, "step": 1}),
                "id_map_basis": (["target_appearance", "source_palette"],),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "IMAGE", "IMAGE", "IMAGE", "STRING", "IMAGE", "STRING", "IMAGE")
    RETURN_NAMES = (
        "target_foreground_mask",
        "aligned_region_mask",
        "aligned_source_image",
        "alignment_overlay",
        "confidence_preview",
        "report",
        "color_region_map",
        "palette_report",
        "source_color_region_map",
    )
    FUNCTION = "align"
    CATEGORY = "DAELab/Badge/Mask"
    DESCRIPTION = (
        "Extract the foreground in a generated badge image, register source masks into that render-space, "
        "preserve source same-color identity in a high-contrast ID map, and expose alignment diagnostics. "
        "This V1 uses deterministic similarity registration."
    )

    def align(
        self,
        source_image,
        target_image,
        source_foreground_mask,
        source_region_mask,
        extraction_mode="auto_border",
        background_threshold=24.0,
        max_rotation=8.0,
        max_scale_delta=0.20,
        snap_radius=6,
        region_inset_px=0,
        minimum_iou=0.70,
        color_region_count=12,
        color_smoothing_px=2,
        snap_region_boundaries=True,
        split_disconnected_regions=False,
        minimum_color_region_pixels=256,
        region_boundary_tolerance_px=3,
        maximum_color_regions=32,
        id_map_basis="target_appearance",
    ):
        target = _image_float(target_image, "target_image")
        source = _broadcast(_image_float(source_image, "source_image"), target.shape[0], "source_image")
        source_foreground = _broadcast(
            _mask_float(source_foreground_mask, "source_foreground_mask"),
            target.shape[0],
            "source_foreground_mask",
        )
        source_region = _broadcast(
            _mask_float(source_region_mask, "source_region_mask"),
            target.shape[0],
            "source_region_mask",
        )
        height, width = target.shape[1:3]
        source = _resize_image(source, height, width)
        source_foreground = (_resize_mask(source_foreground, height, width) > 0.5).float()
        source_region = (_resize_mask(source_region, height, width) > 0.5).float()

        output_foregrounds = []
        output_regions = []
        output_sources = []
        overlays = []
        confidences = []
        reports = []
        color_region_maps = []
        palette_reports = []
        source_color_region_maps = []
        for index in range(target.shape[0]):
            target_np = target[index].detach().cpu().numpy()
            source_np = source[index].detach().cpu().numpy()
            source_fg_np = source_foreground[index].detach().cpu().numpy().astype(np.uint8)
            source_region_np = source_region[index].detach().cpu().numpy().astype(np.uint8)
            if not source_fg_np.any():
                raise ValueError("source_foreground_mask is empty.")

            raw_target, background = _extract_border_foreground(target_np, background_threshold)
            fraction = float(raw_target.mean())
            fallback = extraction_mode == "source_prior_only" or fraction < 0.01 or fraction > 0.90
            if fallback:
                raw_target = source_fg_np.copy()
            matrix, candidate_iou = _similarity_matrix(
                source_fg_np,
                raw_target,
                max_rotation,
                max_scale_delta,
            )
            aligned_fg = _warp(source_fg_np, matrix, width, height, cv2.INTER_NEAREST) > 0
            aligned_source = _warp(source_np, matrix, width, height, cv2.INTER_LINEAR)
            if fallback:
                target_fg = aligned_fg.astype(np.uint8)
            else:
                target_fg = _refine_foreground(raw_target, aligned_fg, snap_radius)

            aligned_region = _warp(source_region_np, matrix, width, height, cv2.INTER_NEAREST) > 0
            aligned_region &= target_fg > 0
            inset = max(0, int(region_inset_px))
            if inset > 0 and aligned_region.any():
                diameter = inset * 2 + 1
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
                aligned_region = cv2.erode(aligned_region.astype(np.uint8), kernel, iterations=1) > 0

            source_labels, source_centers = _deterministic_color_labels(
                source_np,
                source_fg_np,
                color_region_count,
                color_smoothing_px,
            )
            source_color_map = _color_region_map(source_labels)
            if str(id_map_basis) == "target_appearance":
                aligned_labels, map_centers = _deterministic_color_labels(
                    target_np,
                    target_fg,
                    color_region_count,
                    color_smoothing_px,
                )
                region_cluster_indices = list(range(len(map_centers)))
                color_region_policy = "target_appearance_global_color_clusters_with_source_geometry"
            else:
                map_centers = source_centers
                if bool(split_disconnected_regions):
                    source_labels, region_cluster_indices = _split_disconnected_regions(
                        source_labels,
                        len(source_centers),
                        minimum_color_region_pixels,
                        min(int(maximum_color_regions), len(VIVID_PALETTE)),
                    )
                    source_color_map = _color_region_map(source_labels)
                else:
                    region_cluster_indices = list(range(len(source_centers)))
                aligned_labels = _warp(source_labels, matrix, width, height, cv2.INTER_NEAREST).astype(np.int32)
                aligned_labels[target_fg <= 0] = 0
                if bool(snap_region_boundaries):
                    aligned_labels = _snap_color_labels(
                        aligned_labels,
                        target_np,
                        target_fg,
                        max(1, int(color_smoothing_px)),
                        region_boundary_tolerance_px,
                    )
                color_region_policy = "source_color_identity_warped_to_target_with_constrained_boundary_snap"
            color_map = _color_region_map(aligned_labels)
            palette_entries = []
            for label in range(1, int(aligned_labels.max()) + 1):
                cluster_index = region_cluster_indices[label - 1]
                center_lab = np.clip(map_centers[cluster_index], 0, 255).astype(np.uint8).reshape(1, 1, 3)
                center_rgb = cv2.cvtColor(center_lab, cv2.COLOR_LAB2RGB)[0, 0]
                palette_entries.append({
                    "region": label,
                    "color": VIVID_PALETTE[label - 1],
                    "pixels": int((aligned_labels == label).sum()),
                    "color_cluster": int(cluster_index + 1),
                    "cluster_rgb": [int(value) for value in center_rgb],
                })

            observed_iou = _iou(aligned_fg, target_fg)
            boundary_error = _boundary_error(aligned_fg, target_fg)
            agreement = (aligned_fg == (target_fg > 0)).astype(np.float32)
            confidence = agreement * np.logical_or(aligned_fg, target_fg > 0).astype(np.float32)
            confidence_rgb = np.stack((1.0 - confidence, confidence, np.zeros_like(confidence)), axis=-1)
            valid = bool(candidate_iou >= float(minimum_iou) and not fallback)
            report = {
                "version": 1,
                "method": "deterministic_similarity_plus_foreground_snap",
                "extraction_mode": str(extraction_mode),
                "extraction_fallback": bool(fallback),
                "canvas": [int(width), int(height)],
                "background_rgb": [round(float(value), 6) for value in background],
                "raw_target_foreground_fraction": fraction,
                "candidate_iou": candidate_iou,
                "observed_iou_after_snap": observed_iou,
                "boundary_error_px": boundary_error,
                "minimum_iou": float(minimum_iou),
                "valid": valid,
                "transform_source_resized_to_target": [[float(value) for value in row] for row in matrix],
                "source_region_pixels": int(source_region_np.sum()),
                "aligned_region_pixels": int(aligned_region.sum()),
                "region_inset_px": inset,
                "mask_polarity": "white_is_selected",
                "color_region_count": len(palette_entries),
                "color_region_policy": color_region_policy,
                "id_map_basis": str(id_map_basis),
                "snap_region_boundaries": bool(snap_region_boundaries),
                "region_boundary_tolerance_px": int(region_boundary_tolerance_px),
                "split_disconnected_regions": bool(split_disconnected_regions),
                "minimum_color_region_pixels": int(minimum_color_region_pixels),
                "maximum_color_regions": int(maximum_color_regions),
                "overlay_legend": {
                    "red_fill": "aligned region",
                    "cyan_edge": "warped source foreground",
                    "green_edge": "extracted target foreground",
                },
            }
            reports.append(report)
            palette_reports.append({
                "background": "#000000",
                "exact_color_match_recommended": True,
                "regions": palette_entries,
            })
            output_foregrounds.append(torch.from_numpy(target_fg.astype(np.float32)))
            output_regions.append(torch.from_numpy(aligned_region.astype(np.float32)))
            output_sources.append(torch.from_numpy(aligned_source.astype(np.float32)))
            overlays.append(torch.from_numpy(_overlay(target_np, target_fg, aligned_fg, aligned_region)))
            confidences.append(torch.from_numpy(confidence_rgb.astype(np.float32)))
            color_region_maps.append(torch.from_numpy(color_map.astype(np.float32)))
            source_color_region_maps.append(torch.from_numpy(source_color_map.astype(np.float32)))

        device = target.device
        dtype = target.dtype
        return (
            torch.stack(output_foregrounds).to(device=device, dtype=dtype),
            torch.stack(output_regions).to(device=device, dtype=dtype),
            torch.stack(output_sources).to(device=device, dtype=dtype),
            torch.stack(overlays).to(device=device, dtype=dtype),
            torch.stack(confidences).to(device=device, dtype=dtype),
            json.dumps(reports[0] if len(reports) == 1 else reports, ensure_ascii=False, separators=(",", ":")),
            torch.stack(color_region_maps).to(device=device, dtype=dtype),
            json.dumps(
                palette_reports[0] if len(palette_reports) == 1 else palette_reports,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            torch.stack(source_color_region_maps).to(device=device, dtype=dtype),
        )


NODE_CLASS_MAPPINGS = {
    "DAELAB.BadgeRenderSpaceMaskAlignV1": BadgeRenderSpaceMaskAlignV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.BadgeRenderSpaceMaskAlignV1": "Badge Render-Space Mask Align V1 (DAELab)",
}
