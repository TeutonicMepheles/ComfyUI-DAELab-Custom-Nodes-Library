"""Badge 8.7 region masks; reuse the 8.8 execution engine without changing its defaults."""
import math
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
    if request.get('stage') != 'local' or request.get('selection') != 'color':
        raise ValueError('Region materials require local color selection.')
    groups = [material_config(group) for group in validate_groups(request.get('local_regions'))]
    # Reuse target fitting, palette handling and map/source validation unchanged.
    prepared = legacy.prepare({**request, 'edit_mode': 'semantic', 'prompt': '局部区域材质',
                               'colors': {'groups': [{'color': '#808080', 'threshold': 255}]}})
    target = legacy.load_source(request['image'])
    source = legacy.load_source(request['color_map']) if request.get('use_map') else target
    rgb = source[..., :3].astype(np.float64)
    assigned = np.full(rgb.shape[:2], -1)
    best = np.full(rgb.shape[:2], np.inf)
    matched = np.zeros(rgb.shape[:2], dtype=np.uint8)
    for index, group in enumerate(groups):
        distance = np.full(rgb.shape[:2], np.inf)
        for sample in [group['color'], *group.get('samples', [])]:
            color = np.array([int(sample[i:i+2], 16) for i in (1, 3, 5)])
            distance = np.minimum(distance, np.sum((rgb - color) ** 2, axis=-1))
        match = (target[..., 3] > 127) & (distance <= group.get('threshold', 30) ** 2)
        if group.get('invert'):
            match = (target[..., 3] > 127) & ~(distance <= group.get('threshold', 30) ** 2)
            distance = np.where(match, 0, np.inf)
        matched += match
        hit = match & (distance < best)
        assigned[hit], best[hit] = index, distance[hit]
    if request['local_regions'].get('overlap_policy') == 'error' and np.any(matched > 1):
        raise ValueError(f'区域存在 {int((matched > 1).sum())} 个重叠像素，请调整取样色或阈值后再生成。')
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



class Badge87RegionExecutor(BadgeApp88V1):
    workflow_version = '8.7'

    def prepare_regions(self, request):
        return prepare(request)

    def generation_model(self, request):
        return legacy.selected_model(request)

    def bind_region_mask(self, inputs, mask, config):
        if config.get('color_policy') != 'material_intrinsic':
            return super().bind_region_mask(inputs, mask, config)
        # The tested alpha-mask route returned black holes for metal recoloring.
        # Supply an opaque locator image; exact compositing still uses the same MASK.
        inputs['model.images.image_2'] = mask.unsqueeze(-1).repeat(1, 1, 1, 3)
        base = inputs['model.images.image_1']
        material = legacy.load_materials()[config['material_id']]
        color = material['intrinsic_color_hex']
        target = torch.tensor([int(color[i:i+2], 16)/255 for i in (1,3,5)], device=base.device, dtype=base.dtype)
        luminance = base.mean(dim=-1)
        shading = torch.ones_like(luminance)
        for batch in range(base.shape[0]):
            selected = mask[batch] > .5
            if selected.any():
                shading[batch] = (luminance[batch] / luminance[batch][selected].median().clamp_min(.05)).clamp(.8, 1.15)
        guide = (target * shading.unsqueeze(-1)).clamp(0, 1)
        inputs['model.images.image_1'] = torch.where(mask.unsqueeze(-1) > .5, guide, base)
        inputs['prompt'] = (
            '图1已在待修改区域预设目标金属底色，请在这些位置生成真实平整的缎面金属反射。'
            '图2是独立的黑白区域定位图，不是材质参考。'
            '只修改图2白色位置在图1对应的区域，黑色位置保持图1不变。'
            '白色区域必须填充为目标金属本色，不是删除或镂空，不能填黑。'
            '表面平整洁净，以宽柔高光表现缎面金属，不增加可见拉丝、细线、颗粒、噪点。\n'
            + inputs['prompt'])

    def mask_transport(self, config):
        return 'opaque_locator_image' if config.get('color_policy') == 'material_intrinsic' else 'alpha_mask'

    def finish_reference(self, prepared):
        # The target already contains its approved colors. A second image generation
        # after masked material editing can redraw the texture and selected geometry.
        # Keep the optical color constraint and exact mask composite instead.
        return None

    def constraint_options(self):
        return {"preserve_base_lightness": True}
