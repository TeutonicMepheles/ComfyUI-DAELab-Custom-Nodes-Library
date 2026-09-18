"""Opt-in 8.8 local material lists. Existing 8.7 execution is left unchanged."""
import hashlib
import json
import math
import re
from threading import Lock

import numpy as np
import torch

from ..badge_app_87 import node as legacy
from ..badge_app_87.prompts import color_finish_prompt, original_color_prompt

_PREVIEWS = {}
_LOCK = Lock()


def validate_groups(config):
    groups = config.get('groups') if isinstance(config, dict) else None
    if not isinstance(groups, list) or not 1 <= len(groups) <= 16:
        raise ValueError('Add 1–16 local material regions.')
    ids = set()
    catalog = legacy.load_materials()
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError('Invalid local material region.')
        group_id = group.get('id')
        if not isinstance(group_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', group_id) or group_id in ids:
            raise ValueError('Local material regions need unique stable IDs.')
        ids.add(group_id)
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', str(group.get('color', ''))):
            raise ValueError('Invalid local region color.')
        for key, default, minimum, maximum in [('threshold', 30, 0, 255), ('material_strength', 1, .25, 1.5)]:
            value = group.get(key, default)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
                raise ValueError(f'Invalid region {key}.')
        revision = group.get('reroll_revision', 0)
        if type(revision) is not int or not 0 <= revision <= 2147483647:
            raise ValueError('Invalid region reroll revision.')
        material = group.get('material_id')
        if material not in catalog:
            raise ValueError('Unknown local material.')
        policy = group.get('color_policy', 'preserve')
        if policy not in ('preserve', 'material_intrinsic') or (policy == 'material_intrinsic' and material not in ('satin_gold', 'satin_silver')):
            raise ValueError('Unsupported local material color policy.')
    return groups


def prepare(request):
    if request.get('stage') != 'local' or request.get('selection') != 'color':
        raise ValueError('Region materials require local color selection.')
    groups = validate_groups(request.get('local_regions'))
    # Reuse target fitting, palette handling and map/source validation unchanged.
    prepared = legacy.prepare({**request, 'edit_mode': 'semantic', 'prompt': '局部区域材质',
                               'colors': {'groups': [{'color': g['color'], 'threshold': g.get('threshold', 30)} for g in groups]}})
    target = legacy.load_source(request['image'])
    source = legacy.load_source(request['color_map']) if request.get('use_map') else target
    rgb = source[..., :3].astype(np.float64)
    assigned = np.full(rgb.shape[:2], -1)
    best = np.full(rgb.shape[:2], np.inf)
    for index, group in enumerate(groups):
        color = np.array([int(group['color'][i:i+2], 16) for i in (1, 3, 5)])
        distance = np.sum((rgb - color) ** 2, axis=-1)
        hit = (target[..., 3] > 127) & (distance <= group.get('threshold', 30) ** 2) & (distance < best)
        assigned[hit], best[hit] = index, distance[hit]
    regions = []
    for index, group in enumerate(groups):
        mask = legacy.tensor(legacy.contain((assigned == index).astype(np.uint8) * 255, legacy.dimensions(request), True, 0))
        if int((mask > .5).sum()) < 16:
            raise ValueError(f'Region {index + 1} ({group["id"]}) is empty or below 16 pixels; adjust its color or tolerance.')
        prompt = legacy.masked_prompt(legacy.material_prompt(group))
        prompt += f'\n材质表现强度：{group.get("material_strength", 1)*100:.0f}%。'
        regions.append((mask, prompt, group))
    prepared['regions'] = regions
    prepared['mask'] = torch.stack([mask for mask, _, _ in regions]).amax(dim=0)
    return prepared


class BadgeApp88V1(legacy.BadgeApp87V1):
    workflow_version = '8.8'

    def prepare_regions(self, request):
        return prepare(request)

    def generation_model(self, request):
        return 'gpt-image-2'

    def constraint_options(self):
        return {}

    def bind_region_mask(self, inputs, mask, config):
        inputs['model.mask'] = mask

    def mask_transport(self, config):
        return 'alpha_mask'

    def finish_reference(self, prepared):
        reference = prepared.get('color_reference')
        return reference if reference is not None else prepared.get('original')

    def geometry_report(self, prepared):
        return {}

    def geometry_fingerprint(self, prepared):
        return ''

    def composite_region(self, graph, key, prepared, current, candidate, mask, config):
        return graph.node('BadgeDeterministicComposite', id=f'composite_{key}',
                          previous_master=current, edit_candidate=candidate, edit_mask=mask).out(0)

    def execute(self, request_json):
        request = json.loads(request_json)
        if request.get('workflow_version') != self.workflow_version:
            raise ValueError('Badge 8.8 execution requires its workflow marker.')
        if request.get('edit_mode') != 'region_materials' and not (self.workflow_version == '8.7' and request.get('edit_mode') == 'material'):
            return super().execute(request_json)
        prepared = self.prepare_regions(request)
        count = request.get('count', 1)
        reference = self.finish_reference(prepared)
        report = {'stage': 'local', 'workflow_version': self.workflow_version, 'count': count,
                  'quality': request.get('quality', 'low'), 'size': legacy.dimensions(request),
                  'region_calls': len(prepared['regions']) * count,
                  'model_calls': (len(prepared['regions']) + int(reference is not None)) * count,
                  'material_processing': 'preserve_optics',
                  'model': self.generation_model(request), 'color_finish_applied': reference is not None,
                  'regions': [{'id': config['id'], 'selected_pixels': int((mask > .5).sum()),
                               'effective_prompt': prompt, 'material_id': config['material_id'],
                               'material_strength': config.get('material_strength', 1),
                               'mask_connected': self.mask_transport(config) == 'alpha_mask',
                               'selection_transport': self.mask_transport(config)}
                              for mask, prompt, config in prepared['regions']]}
        report.update(self.geometry_report(prepared))
        digest = hashlib.sha256(json.dumps({k: v for k, v in request.items() if k not in ('apply', 'nonce', 'preview_token')}, sort_keys=True).encode())
        for key in ('base', 'mask', 'original', 'color_reference'):
            if prepared.get(key) is not None:
                digest.update(prepared[key].numpy().tobytes())
        # A map may change region ownership while keeping the union identical.
        for mask, _, _ in prepared['regions']:
            digest.update(mask.numpy().tobytes())
        digest.update(self.geometry_fingerprint(prepared).encode())
        token = digest.hexdigest()
        session = request.get('session')
        if not isinstance(session, str) or not session:
            raise ValueError('Missing selection session.')
        with _LOCK:
            if not request.get('apply'):
                if len(_PREVIEWS) > 512:
                    _PREVIEWS.clear()
                _PREVIEWS[session] = token
            elif request.get('preview_token') != token or _PREVIEWS.get(session) != token:
                raise ValueError('Selection changed or server restarted. Preview again before applying.')
        report.update(preview_token=token, selected_pixels=int((prepared['mask'] > .5).sum()))
        ui = {'badge87_report': [report], 'badge88_report': [report]}
        if not request.get('apply'):
            tint = torch.tensor([.08, .86, .71]).view(1, 1, 1, 3)
            overlay = torch.where(prepared['mask'][..., None] > .5, prepared['base'] * .55 + tint * .45, prepared['base'])
            return {'result': (overlay, json.dumps(report)), 'ui': ui}

        from comfy_execution.graph_utils import GraphBuilder
        graph = GraphBuilder()
        w, h = legacy.dimensions(request)

        model_dimensions = {axis: graph.node('PrimitiveInt', id=f'output_{axis}', value=value).out(0) if self.workflow_version == '8.7' and value < 1024 else value
                            for axis,value in (('width',w),('height',h))}

        def generate(name, prompt, base, seed_offset, mask=None, palette=None, config=None):
            inputs = {'prompt': prompt, 'model': self.generation_model(request),
                      'model.size': f'{w}x{h}' if (w, h) in ((1024, 1024), (1024, 1536), (1536, 1024), (2048, 2048), (2048, 1152), (1152, 2048)) else 'Custom',
                      'model.custom_width': model_dimensions['width'], 'model.custom_height': model_dimensions['height'], 'model.background': 'opaque',
                      'model.quality': request.get('quality', 'low'), 'n': 1,
                      'seed': (int(request.get('seed', 0)) + seed_offset) % 2147483647,
                      'model.images.image_1': base}
            if mask is not None:
                self.bind_region_mask(inputs, mask, config or {})
            if palette is not None:
                inputs['model.images.image_2'] = palette
                inputs['prompt'] += '\n\n' + original_color_prompt(2, custom=request.get('color_reference') is not None)
            if self.workflow_version == '8.7':
                inputs['prompt'] = legacy.join(inputs['prompt'], legacy.render('constraints/local_noise_convergence'))
                report.setdefault('prompt_calls', []).append({'call':name, **legacy.describe(inputs['prompt'])})
                if len(prepared['regions']) == 1:
                    report['effective_prompt'] = str(inputs['prompt'])
            return graph.node('OpenAIGPTImageNodeV2', id=name, **inputs).out(0)

        output = None
        for variant in range(count):
            current = prepared['base']
            for index, (mask, prompt, config) in enumerate(prepared['regions']):
                key = f'{variant}_{config["id"]}'
                candidate = generate(f'material_{key}', prompt, current, variant*1000 + index + 1 + config.get('reroll_revision', 0), mask=mask, config=config)
                material_id, material = legacy.resolve_material(legacy.load_materials(), config['material_id'])
                candidate = graph.node('BadgeMaterialConstraintV1', id=f'constraint_{key}',
                    base_image=current, candidate_image=candidate, flat_image=prepared['base'],
                    height_map=torch.zeros_like(prepared['support']), region_mask=mask,
                    color_policy=config.get('color_policy', 'preserve'), intrinsic_color_hex=material.get('intrinsic_color_hex', '#808080'),
                    mean_chroma_limit=.02, p95_chroma_limit=.05, median_low_frequency_lightness_limit=.03,
                    high_frequency_strength=1., material_id=material_id, material_strength=config.get('material_strength', 1),
                    mid_frequency_strength=1., minimum_visible_mean=0., minimum_visible_p95=0.,
                    pattern_seed=config.get('reroll_revision', 0), deterministic_fallback=True, preserve_optics=True, **self.constraint_options()).out(0)
                current = self.composite_region(graph,key,prepared,current,candidate,mask,config)
            if reference is not None:
                exceptions = '；'.join(f'已应用的{legacy.load_materials()[g["material_id"]].get("label", g["material_id"])}材质保留其材质本色' for _, _, g in prepared['regions'] if g.get('color_policy') == 'material_intrinsic')
                finish = color_finish_prompt(local=True, exceptions=exceptions)
                current = generate(f'color_finish_{variant}', finish, current, 100000 + variant, palette=reference)
                report['color_finish_prompt'] = finish
            # Always enforce the union against the original target, including after color finishing.
            current = graph.node('BadgeDeterministicComposite', id=f'final_composite_{variant}',
                previous_master=prepared['base'], edit_candidate=current, edit_mask=prepared['mask']).out(0)
            output = current if output is None else graph.node('ImageBatch', id=f'collect_{variant}', image1=output, image2=current).out(0)
        return {'result': (output, json.dumps(report)), 'expand': graph.finalize(), 'ui': ui}


NODE_CLASS_MAPPINGS = {'DAELAB.BadgeApp88V1': BadgeApp88V1}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.BadgeApp88V1': 'Badge 8.8 Stage Execution (DAELab)'}
