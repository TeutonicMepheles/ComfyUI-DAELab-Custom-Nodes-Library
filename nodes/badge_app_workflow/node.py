from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from threading import Lock

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

try:  # Direct unit tests intentionally run without importing the ComfyUI server.
    from comfy_api.latest import io as comfy_io
    from comfy_execution.graph_utils import GraphBuilder
except ModuleNotFoundError:  # pragma: no cover - fallback classes keep imports testable.
    comfy_io = None
    GraphBuilder = None


CANVAS_SIZE = 1024
MAP_PROMPT_VERSION = "badge-color-id-map-v1"
DEFAULT_MAP_PROMPT = """Edit Image 1 into a flat Color ID Map for masking only.

Preserve the exact canvas, composition, geometry, topology, object positions,
outlines, separator lines, text glyphs, spacing and every small detail. Treat
lighting, reflections, gradients, texture and antialiasing as appearance, not as
new regions. Do not merge, split, add, remove, move or redraw a region.

Replace every existing closed region with one uniform opaque palette color. Use
only: #000000, #FF1744, #00E5FF, #FFEA00, #76FF03, #D500F9, #FF9100,
#2979FF, #1DE9B6, #AA00FF, #C6FF00, #FF3D00, #00B0FF, #64FFDA,
#E040FB, #7C4DFF. Reserve #000000 for the existing background and genuine
holes. Adjacent regions must use clearly different colors. Return only the map:
no legend, labels, watermark, shading, texture, glow, depth or new outlines."""

_CONFIRMATION_LOCK = Lock()
_CONFIRMATION_STATE: dict[str, dict[str, object]] = {}


def _image_float(image, name="image", *, keep_alpha=False):
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError(f"{name} must use ComfyUI IMAGE shape [B,H,W,C].")
    valid_channels = (3, 4) if keep_alpha else (3, 4)
    if image.shape[-1] not in valid_channels or min(image.shape[:3]) < 1:
        raise ValueError(f"{name} must be a non-empty RGB or RGBA image.")
    if not image.is_floating_point() or not torch.isfinite(image).all().item():
        raise ValueError(f"{name} must contain finite floating-point pixels.")
    value = image.to(dtype=torch.float32)
    minimum, maximum = float(value.amin().item()), float(value.amax().item())
    if minimum < 0.0 or maximum > 255.0:
        raise ValueError(f"{name} values must be in [0,1] or [0,255].")
    if maximum > 1.0:
        value = value / 255.0
    if keep_alpha:
        return value.clamp(0.0, 1.0)
    return value[..., :3].clamp(0.0, 1.0)


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


def _canonical_uint8(image):
    value = _image_float(image)
    return torch.round(value.detach().cpu() * 255.0).to(torch.uint8).contiguous()


def image_digest(image):
    value = _canonical_uint8(image)
    digest = hashlib.sha256()
    digest.update(str(tuple(value.shape)).encode("ascii"))
    digest.update(value.numpy().tobytes())
    return digest.hexdigest()


def mask_digest(mask):
    value = torch.round(_mask_float(mask).detach().cpu() * 255.0).to(torch.uint8).contiguous()
    digest = hashlib.sha256()
    digest.update(str(tuple(value.shape)).encode("ascii"))
    digest.update(value.numpy().tobytes())
    return digest.hexdigest()


def _json_digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_effect_canvas(image, canvas_size=CANVAS_SIZE):
    source = _image_float(image, "effect_image", keep_alpha=True)
    if source.shape[0] != 1:
        raise ValueError("Route 2 requires exactly one uploaded effect image.")
    height, width = source.shape[1:3]
    target = int(canvas_size)
    if target < 64:
        raise ValueError("canvas_size must be at least 64.")
    scale = min(target / width, target / height)
    resized_width = max(1, min(target, int(round(width * scale))))
    resized_height = max(1, min(target, int(round(height * scale))))
    channels_first = source.permute(0, 3, 1, 2)
    resized = F.interpolate(
        channels_first,
        size=(resized_height, resized_width),
        mode="bicubic",
        align_corners=False,
    ).permute(0, 2, 3, 1).clamp(0.0, 1.0)
    top = (target - resized_height) // 2
    left = (target - resized_width) // 2
    rgb = torch.ones((1, target, target, 3), dtype=resized.dtype, device=resized.device)
    rgb[:, top:top + resized_height, left:left + resized_width] = resized[..., :3]
    support = torch.zeros((1, target, target), dtype=resized.dtype, device=resized.device)
    if resized.shape[-1] == 4:
        alpha = resized[..., 3]
        support[:, top:top + resized_height, left:left + resized_width] = (alpha > 0.5).to(resized.dtype)
        region = rgb[:, top:top + resized_height, left:left + resized_width]
        rgb[:, top:top + resized_height, left:left + resized_width] = (
            region * alpha.unsqueeze(-1) + (1.0 - alpha.unsqueeze(-1))
        )
        alpha_policy = "source_alpha"
    else:
        support[:, top:top + resized_height, left:left + resized_width] = 1.0
        alpha_policy = "valid_letterbox_content"
    report = {
        "status": "ready",
        "source_canvas": [height, width],
        "canonical_canvas": [target, target],
        "resized_canvas": [resized_height, resized_width],
        "offset": [top, left],
        "scale": scale,
        "fit_policy": "contain_white_letterbox_no_crop",
        "support_policy": alpha_policy,
        "master_digest": image_digest(rgb),
    }
    return rgb.contiguous(), support.contiguous(), json.dumps(report, ensure_ascii=False, separators=(",", ":"))


def _validate_canonical_route(master, reference, support, route_name):
    master_value = _image_float(master, f"{route_name}_master")
    reference_value = _image_float(reference, f"{route_name}_reference")
    support_value = (_mask_float(support, f"{route_name}_support") > 0.5).to(master_value.dtype)
    if master_value.shape[0] != 1:
        raise ValueError(f"{route_name} requires exactly one master image.")
    if tuple(master_value.shape) != tuple(reference_value.shape):
        raise ValueError(f"{route_name} master and direct selection reference must share one canvas.")
    if tuple(support_value.shape) != tuple(master_value.shape[:3]):
        raise ValueError(f"{route_name} support mask must match the master canvas.")
    if tuple(master_value.shape[1:3]) != (CANVAS_SIZE, CANVAS_SIZE):
        raise ValueError(f"{route_name} must be normalized to {CANVAS_SIZE}x{CANVAS_SIZE}.")
    return master_value, reference_value, support_value


def build_action_digest(edit_mode, selected_prompt, material_id=""):
    return _json_digest({
        "edit_mode": str(edit_mode),
        "material_id": str(material_id or ""),
        "prompt": str(selected_prompt or "").strip(),
    })


def resolve_edit_action(
    semantic_mode,
    material_mode,
    requested_apply,
    semantic_prompt=None,
    material_prompt=None,
    material_id=None,
):
    """Resolve the selected action even while apply is off for snapshot preview."""
    valid = bool(semantic_mode) != bool(material_mode)
    if not valid:
        edit_mode, prompt, reason = "invalid", "", "invalid_edit_mode"
    elif semantic_mode:
        edit_mode, prompt, reason = "semantic", str(semantic_prompt or "").strip(), "semantic"
    else:
        edit_mode, prompt, reason = "material", str(material_prompt or "").strip(), "material"
    effective = bool(requested_apply and valid and prompt)
    if valid and not requested_apply:
        reason = "not_requested"
    action = build_action_digest(edit_mode, prompt, material_id or "")
    status = json.dumps({
        "state": "ready" if effective else "blocked",
        "reason": reason if prompt or not effective else "empty_prompt",
        "edit_mode": edit_mode,
        "effective_request": effective,
    }, ensure_ascii=False, separators=(",", ":"))
    return prompt, edit_mode, effective, action, status


def _workflow_picker_config(extra_pnginfo, picker_node_id, fallback=""):
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
    for node in nodes:
        if not isinstance(node, dict) or str(node.get("id")) != str(picker_node_id):
            continue
        properties = node.get("properties") if isinstance(node.get("properties"), dict) else {}
        for name in ("multi_color_mask_v1_config", "multi_color_mask_config"):
            if properties.get(name):
                return str(properties[name])
    return str(fallback or "")


def selection_snapshot_token(
    pre_edit_master,
    selection_reference,
    route_id,
    map_mode,
    map_cache_key,
    picker_config,
    edit_mode,
    action_digest,
    candidate_mask,
    selection_mode,
):
    mode = str(selection_mode or "").strip().lower()
    color_mode = mode == "color"
    return _json_digest({
        "pre_edit_master_digest": image_digest(pre_edit_master),
        "selection_reference_digest": image_digest(selection_reference),
        "candidate_mask_digest": mask_digest(candidate_mask),
        "selection_mode": mode,
        "route_id": str(route_id),
        "color_id_map_mode": bool(map_mode) if color_mode else False,
        "color_id_map_cache_key": str(map_cache_key or "") if color_mode else "",
        "picker_config_digest": hashlib.sha256(
            (str(picker_config or "") if color_mode else "").encode("utf-8")
        ).hexdigest(),
        "edit_mode": str(edit_mode),
        "action_payload_digest": str(action_digest),
    })


def local_mask_lazy_inputs(selection_color, selection_polygon, **values):
    """Return only the inputs needed by the selected local-mask branch."""
    if bool(selection_color) == bool(selection_polygon):
        return []
    prefix = "color" if bool(selection_color) else "polygon"
    return [
        name
        for name in (f"{prefix}_reference", f"{prefix}_mask")
        if values.get(name) is None
    ]


def resolve_local_mask_selection(
    selection_color,
    selection_polygon,
    color_reference=None,
    color_mask=None,
    polygon_reference=None,
    polygon_mask=None,
):
    if bool(selection_color) == bool(selection_polygon):
        raise ValueError("Select exactly one badge local mask mode.")
    mode = "color" if bool(selection_color) else "polygon"
    reference = color_reference if mode == "color" else polygon_reference
    mask = color_mask if mode == "color" else polygon_mask
    if reference is None or mask is None:
        raise ValueError(f"The selected {mode} mask branch is unavailable.")
    reference_value = _image_float(reference, f"{mode}_reference")
    mask_value = _mask_float(mask, f"{mode}_mask")
    if tuple(reference_value.shape[:3]) != tuple(mask_value.shape):
        raise ValueError(f"The selected {mode} reference and mask must share one canvas.")
    status = json.dumps({
        "state": "ready",
        "selection_mode": mode,
        "selected_mask_digest": mask_digest(mask_value),
        "unselected_branch_resolved": False,
    }, ensure_ascii=False, separators=(",", ":"))
    return reference_value, mask_value, mode, status


def _selection_overlay(image, mask):
    base = _image_float(image)
    alpha = (_mask_float(mask) > 0.5).to(base.dtype).unsqueeze(-1)
    red = torch.zeros_like(base)
    red[..., 0] = 1.0
    return (base * (1.0 - alpha * 0.45) + red * alpha * 0.45).clamp(0.0, 1.0)


def _cache_root():
    try:
        import folder_paths

        output_root = Path(folder_paths.get_output_directory())
    except (ImportError, AttributeError):  # Direct tests and portable tooling.
        output_root = Path(os.environ.get("DAELAB_TEST_OUTPUT_DIR", Path.cwd() / ".daelab-test-output"))
    path = output_root / "DAELab" / ".cache" / "badge_color_id_map"
    path.mkdir(parents=True, exist_ok=True)
    return path


def color_id_map_cache_key(master_image, prompt, quality, seed, map_revision):
    normalized_prompt = str(prompt or DEFAULT_MAP_PROMPT).strip()
    return _json_digest({
        "master_digest": image_digest(master_image),
        "prompt_version": MAP_PROMPT_VERSION,
        "prompt": normalized_prompt,
        "model": "gpt-image-2",
        "size": f"{CANVAS_SIZE}x{CANVAS_SIZE}",
        "background": "opaque",
        "quality": str(quality),
        "seed": int(seed),
        "map_revision": int(map_revision),
    })


def _cache_path(cache_key):
    key = str(cache_key or "")
    if len(key) != 64 or any(character not in "0123456789abcdef" for character in key):
        raise ValueError("Invalid Color ID Map cache key.")
    return _cache_root() / f"{key}.png"


def load_cached_map(cache_key):
    path = _cache_path(cache_key)
    if not path.is_file():
        return None
    with Image.open(path) as source:
        array = np.asarray(source.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(array.copy()).unsqueeze(0)


def store_cached_map(image, cache_key):
    value = _canonical_uint8(image)
    if value.shape[0] != 1 or tuple(value.shape[1:3]) != (CANVAS_SIZE, CANVAS_SIZE):
        raise ValueError(f"Color ID Map must be one {CANVAS_SIZE}x{CANVAS_SIZE} image.")
    path = _cache_path(cache_key)
    temporary = path.with_suffix(".tmp.png")
    Image.fromarray(value[0].numpy(), mode="RGB").save(temporary, format="PNG", optimize=False)
    os.replace(temporary, path)
    return path


class BadgeRoute2CanvasV1:
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("canonical_master", "direct_selection_reference", "edit_support_mask", "status")
    FUNCTION = "normalize"
    CATEGORY = "DAELab/Badge/App"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"effect_image": ("IMAGE",)}}

    def normalize(self, effect_image):
        master, support, status = normalize_effect_canvas(effect_image)
        return master, master.clone(), support, status


class BadgeColorIdMapCacheStoreV1:
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("color_id_map", "cache_key", "status")
    FUNCTION = "store"
    CATEGORY = "DAELab/Badge/App/Internal"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"generated_map": ("IMAGE",), "cache_key": ("STRING", {"forceInput": True})}}

    @classmethod
    def IS_CHANGED(cls, generated_map, cache_key):
        del generated_map
        return str(cache_key)

    def store(self, generated_map, cache_key):
        path = store_cached_map(generated_map, cache_key)
        status = json.dumps({
            "state": "ready",
            "cache": "stored",
            "cache_key": str(cache_key),
            "path": str(path),
        }, ensure_ascii=False, separators=(",", ":"))
        return _image_float(generated_map), str(cache_key), status


class BadgeLocalSelectionGuardV1:
    RETURN_TYPES = ("MASK", "IMAGE", "BOOLEAN", "STRING", "STRING")
    RETURN_NAMES = ("validated_mask", "selection_overlay", "effective_apply", "snapshot_token", "status")
    FUNCTION = "validate"
    CATEGORY = "DAELab/Badge/App"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pre_edit_master": ("IMAGE",),
                "selection_reference": ("IMAGE",),
                "candidate_mask": ("MASK",),
                "edit_support_mask": ("MASK",),
                "requested_apply": ("BOOLEAN", {"default": False}),
                "confirmation_revision": ("INT", {"default": 0, "min": 0, "max": 2147483647}),
                "route_id": ("STRING", {"forceInput": True}),
                "map_mode": ("BOOLEAN", {"default": False}),
                "picker_node_id": ("STRING", {"default": ""}),
                "picker_config": ("STRING", {"default": "", "multiline": True}),
                "edit_mode": ("STRING", {"forceInput": True}),
                "action_digest": ("STRING", {"forceInput": True}),
                "selection_mode": ("STRING", {"forceInput": True}),
                "minimum_region_pixels": ("INT", {"default": 16, "min": 1, "max": 65536}),
            },
            "optional": {
                "map_cache_key": ("STRING", {"default": "", "forceInput": True}),
            },
            "hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    @classmethod
    def IS_CHANGED(
        cls,
        pre_edit_master,
        selection_reference,
        candidate_mask,
        edit_support_mask,
        requested_apply,
        confirmation_revision,
        route_id,
        map_mode,
        map_cache_key="",
        picker_node_id="",
        picker_config="",
        edit_mode="",
        action_digest="",
        minimum_region_pixels=16,
        selection_mode="color",
        unique_id=None,
        extra_pnginfo=None,
    ):
        applied_config = _workflow_picker_config(extra_pnginfo, picker_node_id, picker_config)
        return _json_digest({
            "pre_edit_master": image_digest(pre_edit_master),
            "selection_reference": image_digest(selection_reference),
            "candidate_mask": mask_digest(candidate_mask),
            "edit_support_mask": mask_digest(edit_support_mask),
            "requested_apply": bool(requested_apply),
            "confirmation_revision": int(confirmation_revision),
            "route_id": str(route_id),
            "map_mode": bool(map_mode),
            "map_cache_key": str(map_cache_key),
            "picker_config": applied_config,
            "edit_mode": str(edit_mode),
            "action_digest": str(action_digest),
            "selection_mode": str(selection_mode),
            "minimum_region_pixels": int(minimum_region_pixels),
            "unique_id": str(unique_id or ""),
        })

    def validate(
        self,
        pre_edit_master,
        selection_reference,
        candidate_mask,
        edit_support_mask,
        requested_apply,
        confirmation_revision,
        route_id,
        map_mode,
        map_cache_key="",
        picker_node_id="",
        picker_config="",
        edit_mode="",
        action_digest="",
        minimum_region_pixels=16,
        selection_mode="color",
        unique_id=None,
        extra_pnginfo=None,
    ):
        master = _image_float(pre_edit_master, "pre_edit_master")
        reference = _image_float(selection_reference, "selection_reference")
        mask = (_mask_float(candidate_mask, "candidate_mask") > 0.5).to(master.dtype)
        support = (_mask_float(edit_support_mask, "edit_support_mask") > 0.5).to(master.dtype)
        if master.shape != reference.shape or mask.shape != master.shape[:3] or support.shape != mask.shape:
            raise ValueError("Master, selection reference, candidate mask, and support mask must share one canvas.")
        applied_config = _workflow_picker_config(extra_pnginfo, picker_node_id, picker_config)
        token = selection_snapshot_token(
            master,
            reference,
            route_id,
            map_mode,
            map_cache_key,
            applied_config,
            edit_mode,
            action_digest,
            mask,
            selection_mode,
        )
        validated = mask * support
        selected_pixels = int(validated.sum().item())
        key = str(unique_id or "badge-local-selection-guard")
        revision = int(confirmation_revision)
        requested = bool(requested_apply)
        reason = "preview_ready"
        confirmed = False
        with _CONFIRMATION_LOCK:
            state = _CONFIRMATION_STATE.get(key)
            if state is None:
                _CONFIRMATION_STATE[key] = {
                    "observed_token": token,
                    "confirmed_token": None,
                    "revision": revision,
                }
                reason = "confirmation_required_after_restart" if requested else "preview_ready"
            else:
                previous_observed = str(state.get("observed_token") or "")
                previous_revision = int(state.get("revision") or 0)
                confirmed_token = str(state.get("confirmed_token") or "")
                if token != previous_observed:
                    state["observed_token"] = token
                    state["confirmed_token"] = None
                    state["revision"] = revision
                    reason = "snapshot_changed_confirmation_cleared"
                elif requested and revision > previous_revision:
                    state["confirmed_token"] = token
                    state["revision"] = revision
                    confirmed = True
                    reason = "confirmed_current_snapshot"
                elif requested and confirmed_token == token:
                    confirmed = True
                    reason = "confirmed_snapshot_reused"
                elif requested:
                    reason = "confirmation_revision_required"
                else:
                    state["revision"] = max(previous_revision, revision)
                    reason = "preview_ready"
        if selected_pixels == 0:
            reason = "empty_selection"
        elif selected_pixels < int(minimum_region_pixels):
            reason = "selection_below_threshold"
        valid_mode = str(edit_mode) in {"semantic", "material"}
        if requested and not valid_mode:
            reason = "invalid_edit_mode"
        effective = bool(
            requested
            and confirmed
            and valid_mode
            and selected_pixels >= int(minimum_region_pixels)
        )
        status = json.dumps({
            "state": "ready" if effective else "blocked",
            "reason": reason,
            "requested_apply": requested,
            "effective_apply": effective,
            "selected_pixels": selected_pixels,
            "minimum_region_pixels": int(minimum_region_pixels),
            "snapshot_token": token,
            "confirmation_revision": revision,
            "picker_config_digest": hashlib.sha256(applied_config.encode("utf-8")).hexdigest(),
            "selection_mode": str(selection_mode),
        }, ensure_ascii=False, separators=(",", ":"))
        return validated, _selection_overlay(reference, validated), effective, token, status


if comfy_io is not None:
    class BadgeLazyImageSwitchV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeLazyImageSwitchV1",
                display_name="Badge Lazy Image Switch V1",
                category="DAELab/Badge/App",
                inputs=[
                    comfy_io.Boolean.Input("condition", default=False),
                    comfy_io.Image.Input("false_image", lazy=True, optional=True),
                    comfy_io.Image.Input("true_image", lazy=True, optional=True),
                ],
                outputs=[comfy_io.Image.Output("image"), comfy_io.String.Output("status")],
            )

        @classmethod
        def check_lazy_status(cls, condition, false_image=None, true_image=None):
            selected_name = "true_image" if bool(condition) else "false_image"
            selected_value = true_image if bool(condition) else false_image
            return [selected_name] if selected_value is None else []

        @classmethod
        def execute(cls, condition=False, false_image=None, true_image=None):
            selected = true_image if bool(condition) else false_image
            if selected is None:
                raise ValueError("The selected lazy image input is unavailable.")
            return comfy_io.NodeOutput(
                selected,
                json.dumps({"selected": "true_image" if condition else "false_image"}, separators=(",", ":")),
            )


    class BadgeEntryRouteV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeEntryRouteV1",
                display_name="Badge Entry Route V1",
                category="DAELab/Badge/App",
                inputs=[
                    comfy_io.Boolean.Input("route_flat_height", default=True),
                    comfy_io.Boolean.Input("route_effect", default=False),
                    comfy_io.Image.Input("route_1_master", lazy=True, optional=True),
                    comfy_io.Image.Input("route_1_reference", lazy=True, optional=True),
                    comfy_io.Mask.Input("route_1_support", lazy=True, optional=True),
                    comfy_io.Image.Input("route_2_master", lazy=True, optional=True),
                    comfy_io.Image.Input("route_2_reference", lazy=True, optional=True),
                    comfy_io.Mask.Input("route_2_support", lazy=True, optional=True),
                ],
                outputs=[
                    comfy_io.Image.Output("pre_edit_master"),
                    comfy_io.Image.Output("direct_selection_reference"),
                    comfy_io.Mask.Output("edit_support_mask"),
                    comfy_io.String.Output("route_id"),
                    comfy_io.String.Output("status"),
                ],
            )

        @classmethod
        def check_lazy_status(cls, route_flat_height, route_effect, **kwargs):
            if bool(route_flat_height) == bool(route_effect):
                return []
            prefix = "route_1" if route_flat_height else "route_2"
            names = [f"{prefix}_master", f"{prefix}_reference", f"{prefix}_support"]
            return [name for name in names if kwargs.get(name) is None]

        @classmethod
        def execute(cls, route_flat_height=True, route_effect=False, **kwargs):
            if bool(route_flat_height) == bool(route_effect):
                raise ValueError("Select exactly one badge entry route.")
            route_id = "flat_height" if route_flat_height else "effect"
            prefix = "route_1" if route_flat_height else "route_2"
            master, reference, support = _validate_canonical_route(
                kwargs.get(f"{prefix}_master"),
                kwargs.get(f"{prefix}_reference"),
                kwargs.get(f"{prefix}_support"),
                route_id,
            )
            status = json.dumps({
                "state": "ready",
                "route_id": route_id,
                "master_digest": image_digest(master),
                "unselected_route_resolved": False,
            }, ensure_ascii=False, separators=(",", ":"))
            return comfy_io.NodeOutput(master, reference, support, route_id, status)


    class BadgeLocalMaskRouteV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeLocalMaskRouteV1",
                display_name="Badge Local Mask Route V1",
                category="DAELab/Badge/App",
                inputs=[
                    comfy_io.Boolean.Input("selection_color", default=True),
                    comfy_io.Boolean.Input("selection_polygon", default=False),
                    comfy_io.Image.Input("color_reference", lazy=True, optional=True),
                    comfy_io.Mask.Input("color_mask", lazy=True, optional=True),
                    comfy_io.Image.Input("polygon_reference", lazy=True, optional=True),
                    comfy_io.Mask.Input("polygon_mask", lazy=True, optional=True),
                ],
                outputs=[
                    comfy_io.Image.Output("selection_reference"),
                    comfy_io.Mask.Output("candidate_mask"),
                    comfy_io.String.Output("selection_mode"),
                    comfy_io.String.Output("status"),
                ],
            )

        @classmethod
        def check_lazy_status(cls, selection_color, selection_polygon, **kwargs):
            return local_mask_lazy_inputs(selection_color, selection_polygon, **kwargs)

        @classmethod
        def execute(cls, selection_color=True, selection_polygon=False, **kwargs):
            return comfy_io.NodeOutput(*resolve_local_mask_selection(
                selection_color,
                selection_polygon,
                **kwargs,
            ))


    class BadgeEditPromptRouteV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeEditPromptRouteV1",
                display_name="Badge Edit Prompt Route V1",
                category="DAELab/Badge/App",
                inputs=[
                    comfy_io.Boolean.Input("semantic_mode", default=True),
                    comfy_io.Boolean.Input("material_mode", default=False),
                    comfy_io.Boolean.Input("requested_apply", default=False),
                    comfy_io.String.Input("semantic_prompt", default="Refine only the selected region.", multiline=True, lazy=True),
                    comfy_io.String.Input("material_prompt", default="", multiline=True, lazy=True),
                    comfy_io.String.Input("material_id", default="", lazy=True),
                ],
                outputs=[
                    comfy_io.String.Output("selected_prompt"),
                    comfy_io.String.Output("edit_mode"),
                    comfy_io.Boolean.Output("effective_request"),
                    comfy_io.String.Output("action_digest"),
                    comfy_io.String.Output("status"),
                ],
            )

        @classmethod
        def check_lazy_status(cls, semantic_mode, material_mode, requested_apply, semantic_prompt=None, material_prompt=None, material_id=None):
            del requested_apply
            if bool(semantic_mode) == bool(material_mode):
                return []
            if semantic_mode:
                return ["semantic_prompt"] if semantic_prompt is None else []
            missing = []
            if material_prompt is None:
                missing.append("material_prompt")
            if material_id is None:
                missing.append("material_id")
            return missing

        @classmethod
        def execute(cls, semantic_mode=True, material_mode=False, requested_apply=False, semantic_prompt=None, material_prompt=None, material_id=None):
            return comfy_io.NodeOutput(*resolve_edit_action(
                semantic_mode,
                material_mode,
                requested_apply,
                semantic_prompt,
                material_prompt,
                material_id,
            ))


    class BadgeColorIdMapV1(comfy_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return comfy_io.Schema(
                node_id="DAELAB.BadgeColorIdMapV1",
                display_name="Badge Color ID Map V1",
                category="DAELab/Badge/App",
                enable_expand=True,
                inputs=[
                    comfy_io.Boolean.Input("enabled", default=False),
                    comfy_io.Image.Input("master_image", lazy=True),
                    comfy_io.String.Input("map_prompt", default=DEFAULT_MAP_PROMPT, multiline=True),
                    comfy_io.Combo.Input("quality", options=["low", "medium", "high"], default="high"),
                    comfy_io.Int.Input("seed", default=6, min=0, max=2147483647),
                    comfy_io.Int.Input("map_revision", default=0, min=0, max=2147483647),
                ],
                outputs=[
                    comfy_io.Image.Output("color_id_map"),
                    comfy_io.String.Output("cache_key"),
                    comfy_io.String.Output("status"),
                ],
            )

        @classmethod
        def check_lazy_status(cls, enabled, master_image=None, **kwargs):
            del kwargs
            return ["master_image"] if bool(enabled) and master_image is None else []

        @classmethod
        def execute(cls, enabled=False, master_image=None, map_prompt=DEFAULT_MAP_PROMPT, quality="high", seed=6, map_revision=0):
            if not bool(enabled):
                placeholder = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
                return comfy_io.NodeOutput(
                    placeholder,
                    "",
                    json.dumps({"state": "not_generated", "reason": "disabled"}, separators=(",", ":")),
                )
            master = _image_float(master_image, "master_image")
            if tuple(master.shape) != (1, CANVAS_SIZE, CANVAS_SIZE, 3):
                raise ValueError(f"Color ID Map input must be one {CANVAS_SIZE}x{CANVAS_SIZE} RGB image.")
            key = color_id_map_cache_key(master, map_prompt, quality, seed, map_revision)
            cached = load_cached_map(key)
            if cached is not None:
                status = json.dumps({
                    "state": "ready",
                    "cache": "hit",
                    "cache_key": key,
                    "prompt_version": MAP_PROMPT_VERSION,
                }, ensure_ascii=False, separators=(",", ":"))
                return comfy_io.NodeOutput(cached.to(master.device), key, status)
            graph = GraphBuilder()
            gpt = graph.node(
                "OpenAIGPTImageNodeV2",
                id="badge_color_id_map_gpt",
                prompt=str(map_prompt or DEFAULT_MAP_PROMPT),
                model="gpt-image-2",
                **{
                    "model.size": f"{CANVAS_SIZE}x{CANVAS_SIZE}",
                    "model.custom_width": CANVAS_SIZE,
                    "model.custom_height": CANVAS_SIZE,
                    "model.background": "opaque",
                    "model.quality": str(quality),
                    "model.images.image_1": master_image,
                },
                n=1,
                seed=int(seed) + int(map_revision),
            )
            store = graph.node(
                "DAELAB.BadgeColorIdMapCacheStoreV1",
                id="badge_color_id_map_cache_store",
                generated_map=gpt.out(0),
                cache_key=key,
            )
            status = json.dumps({
                "state": "generating",
                "cache": "miss",
                "cache_key": key,
                "prompt_version": MAP_PROMPT_VERSION,
                "billable_api_request_on_cache_miss": True,
            }, ensure_ascii=False, separators=(",", ":"))
            return comfy_io.NodeOutput(store.out(0), key, status, expand=graph.finalize())

else:
    class _UnavailableV3Node:  # pragma: no cover
        @classmethod
        def define_schema(cls):
            return None

        @classmethod
        def execute(cls, *args, **kwargs):
            raise RuntimeError("ComfyUI V3 API is required for this badge App Mode node.")

    BadgeLazyImageSwitchV1 = _UnavailableV3Node
    BadgeEntryRouteV1 = _UnavailableV3Node
    BadgeLocalMaskRouteV1 = _UnavailableV3Node
    BadgeEditPromptRouteV1 = _UnavailableV3Node
    BadgeColorIdMapV1 = _UnavailableV3Node


NODE_CLASS_MAPPINGS = {
    "DAELAB.BadgeRoute2CanvasV1": BadgeRoute2CanvasV1,
    "DAELAB.BadgeEntryRouteV1": BadgeEntryRouteV1,
    "DAELAB.BadgeLocalMaskRouteV1": BadgeLocalMaskRouteV1,
    "DAELAB.BadgeEditPromptRouteV1": BadgeEditPromptRouteV1,
    "DAELAB.BadgeLazyImageSwitchV1": BadgeLazyImageSwitchV1,
    "DAELAB.BadgeColorIdMapV1": BadgeColorIdMapV1,
    "DAELAB.BadgeColorIdMapCacheStoreV1": BadgeColorIdMapCacheStoreV1,
    "DAELAB.BadgeLocalSelectionGuardV1": BadgeLocalSelectionGuardV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DAELAB.BadgeRoute2CanvasV1": "Badge Route 2 Canvas V1 (DAELab)",
    "DAELAB.BadgeEntryRouteV1": "Badge Entry Route V1 (DAELab)",
    "DAELAB.BadgeLocalMaskRouteV1": "Badge Local Mask Route V1 (DAELab)",
    "DAELAB.BadgeEditPromptRouteV1": "Badge Edit Prompt Route V1 (DAELab)",
    "DAELAB.BadgeLazyImageSwitchV1": "Badge Lazy Image Switch V1 (DAELab)",
    "DAELAB.BadgeColorIdMapV1": "Badge Color ID Map V1 (DAELab)",
    "DAELAB.BadgeColorIdMapCacheStoreV1": "Badge Color ID Map Cache Store V1 (DAELab)",
    "DAELAB.BadgeLocalSelectionGuardV1": "Badge Local Selection Guard V1 (DAELab)",
}
