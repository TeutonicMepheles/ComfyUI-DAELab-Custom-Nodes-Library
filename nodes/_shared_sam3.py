import importlib
import json
import sys
import types
from pathlib import Path

import numpy as np
import torch
from PIL import Image


_SAM3_PACKAGE_ALIAS = "_daelab_external_comfyui_sam3_nodes"


def _find_sam3_nodes_dir():
    custom_nodes_dir = Path(__file__).resolve().parents[2]
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
