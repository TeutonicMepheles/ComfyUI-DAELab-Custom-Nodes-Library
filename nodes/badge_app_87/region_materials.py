"""Badge 8.7 region masks; reuse the 8.8 execution engine without changing its defaults."""
import math
import json
import re
import numpy as np
import torch
from . import node as legacy
from .material_policy import material_config
from ..badge_app_88.node import BadgeApp88V1

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
        samples = group.get('samples', [])
        if not isinstance(samples, list) or len(samples) > 15 or any(not re.fullmatch(r'#[0-9a-fA-F]{6}', str(c)) for c in samples):
            raise ValueError('Invalid local region samples.')
        if group.get('material_pending'):
            raise ValueError('Choose a material before executing this region.')
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
    from .region_geometry import color_seeds, resolve, definition
    from .prompts import material_strength_prompt
    if request.get('stage') != 'local':
        raise ValueError('Region materials require local selection.')
    single = request.get('edit_mode') == 'material'
    if single:
        config = dict(request.get('material', {}), id='manual', color='#808080')
        config['material_id'], _ = legacy.resolve_material(legacy.load_materials(), config.get('material_id','baked_enamel'))
        groups = [material_config(config)]
    else:
        groups = [material_config(group) for group in validate_groups(request.get('local_regions'))]
    target = legacy.load_source(request['image'])
    if request.get('interaction_revision') == 2:
        request.update(width=target.shape[1], height=target.shape[0])
    base_request = {**request, 'edit_mode':'semantic', 'prompt':legacy.render('tasks/region_prepare')}
    if not single:
        base_request['colors'] = {'groups':[{'color':'#808080','threshold':255}]}
    prepared = legacy.prepare(base_request)
    source = legacy.load_source(request['color_map']) if request.get('use_map') else target
    if request.get('selection') == 'polygon':
        # Existing brush/Polygon rasterizer owns explicit boundaries.
        seed_mask = prepared['mask'][0].numpy() > .5
        fitted = legacy.contain(target, legacy.dimensions(request), False, 0)
        geometry = resolve(fitted, np.where(seed_mask,0,-1).astype(np.int16),1,
                           request.get('region_geometry'), expand=False)
    else:
        seed_groups = request.get('colors', {}).get('groups', []) if single else groups
        assigned = color_seeds(source, target[...,3]>127, seed_groups,
                               'nearest' if single else request['local_regions'].get('overlap_policy','error'))
        if single:
            assigned[assigned >= 0] = 0
        geometry = resolve(target, assigned, len(groups), request.get('region_geometry'))
    regions, definitions = [], {}
    for index, group in enumerate(groups):
        region = geometry['regions'][index]
        mask = legacy.tensor(legacy.contain(region['mask'].astype(np.uint8)*255, legacy.dimensions(request), True, 0))
        if int((mask > .5).sum()) < 16:
            raise ValueError(f'Region {index+1} ({group["id"]}) is empty or below 16 pixels; adjust its color or tolerance.')
        # Coverage must be derived on the final canvas, never resized independently.
        fitted_definition = definition(mask[0].numpy() > .5)
        definitions[group['id']] = fitted_definition
        prompt = material_strength_prompt(legacy.masked_prompt(legacy.material_prompt(group)),group.get('material_strength',1))
        prompt = legacy.join(prompt,legacy.render('constraints/region_boundary'))
        if request.get('sampling_policy') == 'target_only':
            prompt = legacy.join(prompt, legacy.render('constraints/local_repair_88'))
        regions.append((mask, prompt, group))
    prepared['regions'] = regions
    prepared['mask'] = torch.stack([mask for mask,_,_ in regions]).amax(dim=0)
    prepared['manual_region'] = request.get('selection') == 'polygon'
    prepared['region_geometry'] = geometry
    prepared['region_definitions'] = definitions
    return prepared



class Badge87RegionExecutor(BadgeApp88V1):
    workflow_version = '8.7'

    def prepare_regions(self, request):
        return prepare(request)

    def generation_model(self, request):
        return legacy.selected_model(request)

    def bind_region_mask(self, inputs, mask, config, graph=None, name=None):
        if self.mask_transport(config) != 'opaque_locator_image':
            return super().bind_region_mask(inputs, mask, config)
        # Keep the original surface visible to the model. Alpha-mask generation
        # can return black holes and apply the requested appearance outside them.
        inputs['model.images.image_2'] = mask.unsqueeze(-1).repeat(1, 1, 1, 3)
        if config.get('color_policy') != 'material_intrinsic':
            inputs['prompt'] = legacy.join(legacy.render('references/region_locator'), inputs['prompt'])
            return
        base = inputs['model.images.image_1']
        color = legacy.load_materials()[config['material_id']]['intrinsic_color_hex']
        if graph is None:
            from .intrinsic_guide import Badge87IntrinsicGuide
            inputs['model.images.image_1'] = Badge87IntrinsicGuide().prepare(base, mask, color)[0]
        else:
            inputs['model.images.image_1'] = graph.node('DAELAB.Badge87IntrinsicGuideV1',
                id=f'{name}_intrinsic_guide', image=base, mask=mask, color=color).out(0)
        inputs['prompt'] = legacy.join(legacy.render('references/intrinsic_locator'), inputs['prompt'])


    def mask_transport(self, config):
        from .material_policy import generation_policy
        return generation_policy(config)['transport']

    def finish_reference(self, prepared):
        # The target already contains its approved colors. A second image generation
        # after masked material editing can redraw the texture and selected geometry.
        # Keep the optical color constraint and exact mask composite instead.
        return None

    def constraint_options(self, config=None):
        from .material_policy import generation_policy
        return generation_policy(config or {}).get('optical_constraints', {})

    def inspect_region(self, graph, key, request, config, base, raw, corrected, composite, mask):
        from .material_policy import generation_policy
        policy = {**generation_policy(config).get('validation', {}), 'material_id': config['material_id']}
        return graph.node('DAELAB.Badge87MaterialDiagnosticsV1', id=f'diagnostics_{key}',
                          base=base, raw=raw, corrected=corrected, composite=composite, mask=mask,
                          policy_json=json.dumps(policy), save_stages=request.get('diagnostics') is True).out(0)

    def geometry_report(self, prepared):
        g = prepared['region_geometry']
        return {'effective_prompt':str(prepared['regions'][0][1]), 'region_geometry': {'version':g['version'], 'fingerprint':g['fingerprint'],
                                   'regions':g['stats'], 'generation_context':'full_target_image',
                                   'mode':'manual' if prepared.get('manual_region') else 'bounded_structure_completion'}}

    def geometry_fingerprint(self, prepared):
        return prepared['region_geometry']['fingerprint']

    def composite_region(self, graph, key, prepared, current, candidate, mask, config):
        coverage = torch.from_numpy(prepared['region_definitions'][config['id']]['coverage']).unsqueeze(0)
        candidate = graph.node('DAELAB.Badge87BoundaryCompositeV1', id=f'boundary_{key}',
                              original=prepared['base'], previous_master=current, edit_candidate=candidate,
                              edit_mask=mask, coverage=coverage).out(0)
        return super().composite_region(graph,key,prepared,current,candidate,mask,config)
