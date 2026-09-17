"""8.7 execution adapter. No changes to the 8.6 node contracts.

Source-space selections are transformed with the same contain transform as their
image. Every model call explicitly carries quality, dimensions and n=1.
"""
import hashlib
import json
import math
from pathlib import Path
from threading import Lock

import numpy as np
import torch
from PIL import Image, ImageOps

from ..gpt_image2_material_prompt.node import load_materials, resolve_material
from .prompts import build_prompt, material_details, masked_prompt, semantic_prompt, studio_prompt, material_strength_prompt, color_exception
from .prompt_assembler import describe, join, render, ui_text, legacy_uploaded_reference

_PREVIEWS = {}
IMAGE_MODEL = 'gpt-image-2.5-sunburst'
IMAGE_MODELS = ('gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2')
_LOCK = Lock()

def selected_model(request):
    model = request.get('model', IMAGE_MODEL)
    if model not in IMAGE_MODELS:
        raise ValueError(ui_text('backend.error_001'))
    return model



def dimensions(request):
    w, h = request.get('width', 1024), request.get('height', 1024)
    if any(type(x) is not int or not 0 < x <= 3840 or x % 16 for x in (w, h)):
        raise ValueError(ui_text('backend.error_002'))
    if max(w, h) / min(w, h) > 3 or not 655360 <= w*h <= 8294400:
        raise ValueError(ui_text('backend.error_003'))
    return w, h


def load_source(selection):
    import folder_paths
    if isinstance(selection, dict):
        kind = selection.get('type', 'input')
        name = str(selection.get('filename', ''))
        folder = str(selection.get('subfolder', ''))
        base = {'input': folder_paths.get_input_directory(), 'output': folder_paths.get_output_directory(), 'temp': folder_paths.get_temp_directory()}.get(kind)
        if base is None:
            raise ValueError(ui_text('backend.error_010'))
        path = Path(base) / folder / name
    else:
        name = str(selection or '')
        path = Path(folder_paths.get_annotated_filepath(name))
    roots = [Path(p).resolve() for p in (folder_paths.get_input_directory(), folder_paths.get_output_directory(), folder_paths.get_temp_directory())]
    resolved = path.resolve()
    if not selection or not any(resolved.is_relative_to(p) for p in roots) or not resolved.is_file():
        raise ValueError(ui_text('backend.error_004'))
    with Image.open(resolved) as image:
        image = ImageOps.exif_transpose(image).convert('RGBA')
        if image.width * image.height > 40000000:
            raise ValueError(ui_text('backend.error_011'))
        return np.asarray(image).copy()


def contain(array, size, mask=False, fill=255):
    image = Image.fromarray(array.astype(np.uint8))
    image = ImageOps.contain(image, size, Image.Resampling.NEAREST if mask else Image.Resampling.LANCZOS)
    canvas = Image.new(image.mode, size, (fill,)*len(image.getbands()) if image.mode != 'L' else fill)
    canvas.paste(image, ((size[0]-image.width)//2, (size[1]-image.height)//2))
    return np.asarray(canvas).copy()


def tensor(array):
    return torch.from_numpy(np.ascontiguousarray(array)).float().unsqueeze(0) / 255


def matches(rgb, config, height=False):
    """Mirror previewPixels: inclusive RGB distance, nearest match, stable ties."""
    groups = config.get('groups', [])
    if not isinstance(groups, list) or len(groups) > 256:
        raise ValueError(ui_text('backend.error_005'))
    selected = str(config.get('output', ''))
    if selected.startswith('mask_') and selected[5:].isdigit():
        i = int(selected[5:])-1
        groups = groups[i:i+1]
    result = np.full(rgb.shape[:2], config.get('fallbackGray', 0) if height else 0, np.uint8)
    best = np.full(rgb.shape[:2], np.inf)
    for group in groups:
        color = str(group['color']).lstrip('#')
        if len(color) != 6:
            raise ValueError(ui_text('backend.error_012'))
        channels = np.array([int(color[i:i+2], 16) for i in (0, 2, 4)])
        distance = np.sum((rgb.astype(np.float64)-channels)**2, axis=-1)
        threshold = max(0, float(group.get('threshold', 0)))**2
        hit = distance > threshold if group.get('invert') else distance <= threshold
        choose = hit & (distance < best)
        best[choose] = distance[choose]
        result[choose] = group.get('gray', 0) if height else 255
    return result


def height_config(board, fixed_endpoints=False):
    count = board.get('count', 6)
    if type(count) is not int or not (1 if fixed_endpoints else 2) <= count <= (5 if fixed_endpoints else 6):
        if fixed_endpoints:
            raise ValueError(ui_text('backend.error_013'))
        raise ValueError(ui_text('backend.error_006'))
    def gray(tier):
        if type(tier) is not int or not 0 <= tier <= count:
            raise ValueError(ui_text('backend.error_014'))
        if not tier:
            return 0
        if fixed_endpoints and tier == count:
            return 255
        value = board.get('alphas', {}).get(str(tier), tier*255/count)
        return math.floor(min(10, max(1, math.floor(float(value)*10/255+.5)))*255/10+.5)
    return {'fallbackGray': gray(board.get('fallback', 1)), 'groups': [{**g, 'gray': gray(g.get('tier', 0))} for g in board.get('groups', [])]}


def material_prompt(config):
    material_id, material = resolve_material(load_materials(), config.get('material_id', 'baked_enamel'))
    return material_details(material_id, material, config)


def prepare(request):
    from .material_policy import material_config
    request['material'] = material_config(request.get('material'))
    if request.get('regions'):
        request['regions'] = {**request['regions'], 'groups': [material_config(g) for g in request['regions'].get('groups', [])]}
    selected_model(request)
    refined = request.get('interaction_revision') == 2
    if refined:
        request.pop('color_reference', None)
    if refined and request.get('stage') == 'local':
        source = load_source(request.get('image'))
        request.update(width=source.shape[1], height=source.shape[0])
    size = dimensions(request)
    stage = request.get('stage')
    if stage not in ('build', 'local', 'studio', 'effect', 'color_map'):
        raise ValueError(ui_text('backend.error_007'))
    if request.get('quality', 'low') not in ('low', 'medium', 'high') or type(request.get('count', 1)) is not int or not 1 <= request.get('count', 1) <= 8:
        raise ValueError(ui_text('backend.error_008'))
    base_prompt = str(request.get('prompt', '')).strip()
    color_reference = None
    if not refined and request.get('color_reference'):
        palette = load_source(request['color_reference'])
        opacity = palette[..., 3:4].astype(float)/255
        palette_rgb = np.floor(palette[..., :3]*opacity+255*(1-opacity)+.5).astype(np.uint8)
        color_reference = tensor(contain(palette_rgb, size))
    if stage == 'build' and (request.get('prompt_only') is True or ('prompt_only' not in request and not request.get('image'))):
        if not base_prompt:
            raise ValueError(ui_text('backend.error_015'))
        return {'base': None, 'prompt': build_prompt(base_prompt, text_only=True), 'regions': [], 'color_reference': color_reference}
    if stage == 'build' and not request.get('image'):
        raise ValueError(ui_text('backend.error_009'))
    source = load_source(request.get('image'))
    rgb, alpha = source[..., :3], source[..., 3]
    if stage == 'color_map':
        working = np.floor(rgb.astype(float)*(alpha[..., None]/255)+255*(1-alpha[..., None]/255)+.5).astype(np.uint8)
        fitted = ImageOps.contain(Image.fromarray(working), (1024, 1024)).size
        return {'base': tensor(contain(working, (1024, 1024))), 'source_size': (source.shape[1], source.shape[0]), 'fitted': fitted, 'regions': []}
    support = alpha.copy()
    background = request.get('background')
    if stage == 'build' and background is not None:
        support = np.minimum(support, 255-matches(rgb, background))
    # White background, not a stretched image. Alpha remains a support mask.
    working = np.floor(rgb.astype(float)*(support[..., None]/255) + 255*(1-support[..., None]/255)+.5).astype(np.uint8)
    result = {'base': tensor(contain(working, size)), 'support': tensor(contain(support, size, True, 0)), 'regions': [], 'prompt': base_prompt}
    if stage == 'build':
        result['prompt'] = build_prompt(base_prompt, material_prompt(request.get('material', {})))
        if request.get('height_board') is not None:
            height_source = load_source(request.get('height_image'))
            if refined and request['height_board'].get('count', 6) > 5:
                raise ValueError(ui_text('backend.error_017'))
            config = height_config(request['height_board'], fixed_endpoints=refined)
            height = matches(height_source[..., :3], config, True)
            result['height'] = tensor(np.repeat(contain(height, size, True, 0)[..., None], 3, -1))
            result['prompt'] = build_prompt(base_prompt, material_prompt(request.get('material', {})), height=json.dumps(config, separators=(',', ':')))
        region_config = None if refined else request.get('regions')
        if region_config:
            # Assign overlaps once, with the same nearest-color policy as the material node.
            assigned = np.full(rgb.shape[:2], -1)
            best = np.full(rgb.shape[:2], np.inf)
            groups = region_config.get('groups', [])
            for i, group in enumerate(groups):
                color = group['color'].lstrip('#')
                channels = np.array([int(color[j:j+2], 16) for j in (0,2,4)])
                distance = np.sum((rgb.astype(float)-channels)**2, axis=-1)
                choose = (support > 0) & (distance <= float(group.get('threshold', 0))**2) & (distance < best)
                assigned[choose], best[choose] = i, distance[choose]
            for i, group in enumerate(groups):
                mask = tensor(contain((assigned == i).astype(np.uint8)*255, size, True, 0))
                if int((mask > .5).sum()) < 16:
                    continue
                prompt = masked_prompt(material_prompt(group))
                prompt = material_strength_prompt(prompt, group.get('material_strength', 1))
                result['regions'].append((mask, prompt, group))
    elif stage == 'local':
        if request.get('selection') == 'color':
            selection_rgb = rgb
            if request.get('use_map'):
                if request.get('color_map_source') != request.get('image') or not request.get('color_map'):
                    raise ValueError(ui_text('backend.error_026'))
                selection_rgb = load_source(request['color_map'])[..., :3]
                if selection_rgb.shape != rgb.shape:
                    raise ValueError(ui_text('backend.error_027'))
            mask = matches(selection_rgb, request.get('colors', {}))
        elif request.get('selection') == 'polygon':
            # Reuse the production polygon + brush node, including normalized strokes.
            from ..polygon_mask.node import DAELabBadgeSelectionMaskV1
            selection_node = DAELabBadgeSelectionMaskV1.PREPARE_CLASS_CLONE(None)
            value = selection_node.execute(tensor(rgb), polygon_data=json.dumps(request.get('polygon', {})))
            mask = np.floor(value.result[1][0].numpy()*255+.5).astype(np.uint8)
        else:
            raise ValueError(ui_text('backend.error_023'))
        mask = ((mask > 127) & (alpha > 127)).astype(np.uint8)*255
        result['mask'] = tensor(contain(mask, size, True, 0))
        if int((result['mask'] > .5).sum()) < 16:
            raise ValueError(ui_text('backend.error_018'))
        if request.get('edit_mode') == 'material':
            config = request.get('material', {})
            result['prompt'] = masked_prompt(material_prompt(config))
        elif request.get('edit_mode') != 'semantic' or not base_prompt:
            raise ValueError(ui_text('backend.error_024'))
        else:
            result['prompt'] = semantic_prompt(base_prompt)
    elif stage == 'studio':
        if not base_prompt:
            raise ValueError(ui_text('backend.error_025'))
        result['prompt'] = studio_prompt(base_prompt)
    if color_reference is not None:
        result['color_reference'] = color_reference
    if color_reference is None and stage in ('local', 'studio') and request.get('original_image'):
        original = load_source(request['original_image'])
        original_support = original[..., 3].copy()
        original_background = request.get('original_background')
        if original_background is not None:
            original_support = np.minimum(original_support, 255-matches(original[..., :3], original_background))
        original_alpha = original_support[..., None]/255
        original_rgb = np.floor(original[..., :3].astype(float)*original_alpha+255*(1-original_alpha)+.5).astype(np.uint8)
        result['original'] = tensor(contain(original_rgb, size))
    return result


class BadgeApp87V1:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'request_json': ('STRING', {'default': '{}', 'multiline': True})}}

    OUTPUT_NODE = True
    RETURN_TYPES = ('IMAGE', 'STRING')
    RETURN_NAMES = ('image', 'report')
    FUNCTION = 'execute'
    CATEGORY = 'DAELab/Badge/App'

    @classmethod
    def IS_CHANGED(cls, request_json):
        # File bytes and the server-side preview ledger must be inspected each time.
        return float('nan')

    def execute(self, request_json):
        request = json.loads(request_json)
        if request.get('edit_mode') == 'region_materials':
            from .region_materials import Badge87RegionExecutor
            return Badge87RegionExecutor().execute(request_json)
        from comfy_execution.graph_utils import GraphBuilder
        prepared = prepare(request)
        stage = request['stage']
        count = request.get('count', 1)
        model = selected_model(request)
        report = {'stage': stage, 'model': model, 'quality': request.get('quality', 'low'), 'count': count, 'size': dimensions(request), 'region_calls': len(prepared['regions'])*count}
        if stage == 'local':
            report['effective_prompt'] = prepared['prompt']
            report['material_processing'] = 'preserve_optics' if request.get('edit_mode') == 'material' else 'composite_only'
        if stage == 'color_map':
            DEFAULT_MAP_PROMPT = render('tasks/color_map')
            report['prompt_calls'] = [{'call': 'color_map', **describe(DEFAULT_MAP_PROMPT)}]
            graph = GraphBuilder()
            mapped = graph.node('DAELAB.BadgeColorIdMapV1', enabled=True,
                master_image=prepared['base'], map_prompt=DEFAULT_MAP_PROMPT,
                quality=request.get('quality', 'low'), seed=6, map_revision=int(request.get('map_revision', 0)), model=model)
            w, h = prepared['fitted']
            crop = graph.node('ImageCrop', image=mapped.out(0), width=w, height=h, x=(1024-w)//2, y=(1024-h)//2)
            sw, sh = prepared['source_size']
            output = graph.node('ImageScale', image=crop.out(0), upscale_method='nearest-exact', width=sw, height=sh, crop='disabled')
            return {'result': (output.out(0), json.dumps(report)), 'expand': graph.finalize(), 'ui': {'badge87_report': [report]}}
        if stage == 'local':
            digest_request = {k: v for k, v in request.items() if k not in ('apply', 'nonce', 'preview_token')}
            digest = hashlib.sha256(json.dumps(digest_request, sort_keys=True).encode())
            for key in ('base', 'mask', 'original', 'color_reference'):
                if prepared.get(key) is not None:
                    digest.update(prepared[key].numpy().tobytes())
            token = digest.hexdigest()
            session = str(request.get('session', ''))
            if not session:
                raise ValueError(ui_text('backend.error_019'))
            with _LOCK:
                if not request.get('apply'):
                    if len(_PREVIEWS) > 512:
                        _PREVIEWS.clear()
                    _PREVIEWS[session] = token
                elif _PREVIEWS.get(session) != token or request.get('preview_token') != token:
                    raise ValueError(ui_text('backend.error_028'))
            report.update(preview_token=token, selected_pixels=int((prepared['mask'] > .5).sum()))
            if not request.get('apply'):
                overlay = prepared['base'].clone()
                tint = torch.tensor([.08, .86, .71]).view(1,1,1,3)
                overlay = torch.where(prepared['mask'][..., None] > .5, overlay*.55+tint*.45, overlay)
                return {'result': (overlay, json.dumps(report)), 'ui': {'badge87_report': [report]}}
        if stage == 'effect':
            return {'result': (prepared['base'], json.dumps(report)), 'ui': {'badge87_report': [report]}}
        from .prompts import original_color_prompt
        graph = GraphBuilder()
        w, h = dimensions(request)
        # The upstream widgets impose min=1024, although execution accepts
        # official custom sizes with shorter edges. Feed validated INT links
        # through the existing primitive node without changing upstream schema.
        model_dimensions = {
            axis: graph.node('PrimitiveInt', id=f'output_{axis}', value=value).out(0)
            if value < 1024 else value
            for axis, value in (('width', w), ('height', h))
        }
        def generate(name, prompt, base=None, mask=None, height=None, seed_offset=0, n=1, original=None):
            inputs = {'prompt': prompt, 'model': model, 'model.size': f'{w}x{h}' if (w,h) in ((1024,1024),(1024,1536),(1536,1024),(2048,2048),(2048,1152),(1152,2048)) else 'Custom', 'model.custom_width': model_dimensions['width'], 'model.custom_height': model_dimensions['height'], 'model.background': 'opaque', 'model.quality': request.get('quality', 'low'), 'n': 1, 'seed': (int(request.get('seed', 0))+seed_offset) % 2147483647}
            inputs['n'] = n
            if base is not None:
                inputs['model.images.image_1'] = base
            if height is not None:
                inputs['model.images.image_2'] = height
            if original is not None:
                if request.get('color_reference'):
                    inputs['prompt'] = legacy_uploaded_reference(inputs['prompt'])
                index = 3 if height is not None else 2 if base is not None else 1
                inputs[f'model.images.image_{index}'] = original
                inputs['prompt'] = join(inputs['prompt'], original_color_prompt(index, custom=request.get('color_reference') is not None, reference_only=base is None))
            if mask is not None:
                inputs['model.mask'] = mask
            report.setdefault('prompt_calls', []).append({'call': name, **describe(inputs['prompt'])})
            inputs['prompt'] = str(inputs['prompt'])
            return graph.node('OpenAIGPTImageNodeV2', id=name, **inputs).out(0)
        from .prompts import color_finish_prompt
        # Masked calls use one image. Color references belong to the unmasked finish.
        initial_prompt = prepared['prompt']
        palette = prepared.get('color_reference')
        studio_reference = palette if palette is not None else prepared.get('original')
        if stage == 'studio' and studio_reference is not None:
            initial_prompt = color_finish_prompt(request.get('prompt', ''), custom=palette is not None)
        batch = generate('generate', initial_prompt, prepared['base'], prepared.get('mask'), prepared.get('height'), n=count, original=studio_reference if stage == 'studio' else palette if stage == 'build' else None)
        def constrain(name, base, candidate, mask, config, flat=None, preserve_optics=False):
            material_id, material = resolve_material(load_materials(), config.get('material_id', 'baked_enamel'))
            height = prepared.get('height') if flat is None else None
            height_mask = height[..., 0] if height is not None else torch.zeros_like(prepared['support'])
            return graph.node('BadgeMaterialConstraintV1', id=name,
                base_image=base, candidate_image=candidate, flat_image=prepared['base'] if flat is None else flat,
                height_map=height_mask, region_mask=mask,
                color_policy=config.get('color_policy', 'preserve'),
                intrinsic_color_hex=material.get('intrinsic_color_hex', '#808080'),
                mean_chroma_limit=.02, p95_chroma_limit=.05,
                median_low_frequency_lightness_limit=.03, high_frequency_strength=1.,
                material_id=material_id,
                material_strength=float(config.get('material_strength', 1)),
                mid_frequency_strength=1., minimum_visible_mean=0., minimum_visible_p95=0.,
                pattern_seed=int(config.get('reroll_revision', 0)), deterministic_fallback=True,
                preserve_optics=preserve_optics).out(0)
        output = None
        for variant in range(count):
            current = batch if count == 1 else graph.node('ImageFromBatch', id=f'variant_{variant}', image=batch, batch_index=variant, length=1).out(0)
            if stage == 'local':
                if request.get('edit_mode') == 'material':
                    current = constrain(f'local_material_constraint_{variant}', prepared['base'], current, prepared['mask'], request.get('material', {}), preserve_optics=True)
                current = graph.node('BadgeDeterministicComposite', id=f'local_composite_{variant}', previous_master=prepared['base'], edit_candidate=current, edit_mask=prepared['mask']).out(0)
            for index, (mask, prompt, config) in enumerate(prepared['regions']):
                reroll = int(config.get('reroll_revision', 0))
                key = f'{variant}_{index}'
                # Use the prepared color mask unchanged for GPT and compositing.
                # Source image and mask already share the same contain transform.
                candidate = generate(f'material_{key}', prompt, current, mask, seed_offset=variant*1000+index+1+reroll)
                candidate = constrain(f'material_constraint_{key}', current, candidate, mask, config, prepared['base'])
                current = graph.node('BadgeDeterministicComposite', id=f'material_composite_{key}', previous_master=current, edit_candidate=candidate, edit_mask=mask).out(0)
            reference = prepared.get('original') if stage == 'local' else prepared.get('base') if stage == 'build' and not request.get('prompt_only') else None
            if palette is not None and stage in ('build', 'local'):
                reference = palette
            if reference is not None:
                exceptions = []
                configs = [request.get('material', {})] + [config for _, _, config in prepared['regions']]
                for config in configs:
                    if config.get('color_policy') == 'material_intrinsic':
                        _, material = resolve_material(load_materials(), config.get('material_id', 'baked_enamel'))
                        exceptions.append(color_exception(config, material))
                finish = color_finish_prompt(request.get('prompt', '') if stage != 'local' or request.get('edit_mode') == 'semantic' else '', local=stage == 'local', exceptions='；'.join(exceptions), custom=palette is not None)
                current = generate(f'color_finish_{variant}', finish, current, original=reference, seed_offset=100000+variant)
                report['color_finish_prompt'] = finish+'\n\n'+original_color_prompt(2, custom=palette is not None)
                if stage == 'local':
                    current = graph.node('BadgeDeterministicComposite', id=f'color_finish_composite_{variant}', previous_master=prepared['base'], edit_candidate=current, edit_mask=prepared['mask']).out(0)
            output = current if output is None else graph.node('ImageBatch', id=f'collect_{variant}', image1=output, image2=current).out(0)
        return {'result': (output, json.dumps(report)), 'expand': graph.finalize(), 'ui': {'badge87_report': [report]}}


class BadgeApp87RegionAlignV1:
    """Reuse render-space registration and boundary snapping for material masks."""
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'source_image': ('IMAGE',), 'target_image': ('IMAGE',), 'source_mask': ('MASK',)}}

    RETURN_TYPES = ('MASK', 'IMAGE', 'STRING')
    RETURN_NAMES = ('target_mask', 'color_reference', 'alignment_report')
    FUNCTION = 'align'
    CATEGORY = 'DAELab/Badge/App'

    def align(self, source_image, target_image, source_mask):
        import cv2
        from ..badge_render_space_mask.node import _extract_border_foreground, _similarity_matrix, _warp, _snap_color_labels
        source_image, target_image = source_image[..., :3], target_image[..., :3]
        if source_image.shape != target_image.shape or source_mask.shape != source_image.shape[:3]:
            raise ValueError(ui_text('backend.error_016'))
        masks, references, reports = [], [], []
        for source, target, mask in zip(source_image, target_image, source_mask):
            src, dst = source.detach().cpu().numpy(), target.detach().cpu().numpy()
            selected = mask.detach().cpu().numpy() > .5
            height, width = selected.shape
            source_fg, _ = _extract_border_foreground(src, 24)
            target_fg, _ = _extract_border_foreground(dst, 24)
            if not source_fg.any() or not target_fg.any():
                raise ValueError(ui_text('backend.error_020'))
            # A round silhouette cannot identify rotation; fitting it can rotate
            # inner regions arbitrarily. Preserve the supplied upright layout.
            matrix, iou = _similarity_matrix(source_fg, target_fg, 0, .35)
            if iou < .65:
                raise ValueError(ui_text('backend.error_021'))
            aligned = _warp(selected.astype(np.uint8), matrix, width, height, cv2.INTER_NEAREST) > 0
            aligned &= target_fg > 0
            labels = target_fg.astype(np.int32)
            labels[aligned] = 2
            # Seeds must be farther inside than the allowed boundary correction,
            # otherwise misplaced edge pixels become immutable watershed seeds.
            snapped = _snap_color_labels(labels, dst, target_fg, 32, 32) == 2
            if int(snapped.sum()) < 16:
                raise ValueError(ui_text('backend.error_022'))
            reference = dst.copy()
            # The selected source color remains authoritative for preserve-color.
            reference[snapped] = np.median(src[selected], axis=0)
            masks.append(torch.from_numpy(snapped.astype(np.float32)))
            references.append(torch.from_numpy(reference))
            reports.append({'iou': float(iou), 'source_pixels': int(selected.sum()), 'target_pixels': int(snapped.sum())})
        return torch.stack(masks), torch.stack(references), json.dumps(reports)


NODE_CLASS_MAPPINGS = {
    'DAELAB.BadgeApp87V1': BadgeApp87V1,
    'DAELAB.BadgeApp87RegionAlignV1': BadgeApp87RegionAlignV1,
}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.BadgeApp87V1': 'Badge 8.7 Stage Execution (DAELab)', 'DAELAB.BadgeApp87RegionAlignV1': 'Badge 8.7 Material Mask Alignment (DAELab)'}
