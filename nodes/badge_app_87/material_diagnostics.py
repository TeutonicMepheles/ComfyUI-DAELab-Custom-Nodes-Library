"""Observable local-edit stages; visibility checks are not semantic acceptance."""
import json
from pathlib import Path
import uuid

import numpy as np
import torch
from PIL import Image
from scipy import ndimage as ndi


def measurements(base, candidate, mask):
    delta = np.abs(candidate-base).max(-1)[mask]
    luminance = lambda x: x @ np.array([.2126, .7152, .0722], np.float32)
    light = luminance(candidate)
    base_light = luminance(base)
    weights = ndi.gaussian_filter(mask.astype(np.float32), 1.2)
    local = ndi.gaussian_filter(light*mask, 1.2)/np.maximum(weights, 1e-6)
    glints = mask & (light-base_light > .12) & (light-local > .04)
    return dict(visible_mean=float(delta.mean()), visible_p95=float(np.quantile(delta,.95)),
                changed_ratio=float((delta >= 2/255).mean()),
                added_highlight_fraction=float(glints.sum()/mask.sum()),
                lightness_shift=float(np.median((light-base_light)[mask])),
                outside_max=float(np.abs(candidate-base)[~mask].max()) if (~mask).any() else 0.)


class Badge87MaterialDiagnostics:
    RETURN_TYPES = ('IMAGE', 'STRING')
    FUNCTION = 'inspect'
    CATEGORY = 'DAELab/Badge'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {**{key: ('IMAGE',) for key in ('base','raw','corrected','composite')},
                             'mask': ('MASK',), 'policy_json': ('STRING', {'default':'{}'}),
                             'save_stages': ('BOOLEAN', {'default':False})}}

    def inspect(self, base, raw, corrected, composite, mask, policy_json='{}', save_stages=False):
        policy = json.loads(policy_json)
        from ..badge_strict_material.node import _image_float, _resize_image, _broadcast
        raw_shape = list(raw.shape)
        if not torch.isfinite(raw).all():
            raise ValueError('Invalid local material raw image.')
        original_raw = raw.detach().cpu().numpy()
        alpha = raw[...,3:4] if raw.shape[-1] == 4 else torch.ones_like(raw[...,:1])
        alpha = _broadcast(alpha,base.shape[0],'raw alpha')
        if alpha.shape[1:3] != base.shape[1:3]:
            alpha = _resize_image(alpha,base.shape[1],base.shape[2])
        alpha = alpha.detach().cpu().numpy()[...,0]
        raw = _broadcast(_image_float(raw, 'raw candidate'), base.shape[0], 'raw candidate')
        if raw.shape[1:3] != base.shape[1:3]:
            raw = _resize_image(raw, base.shape[1], base.shape[2])
        arrays = {key: value.detach().cpu().numpy() for key,value in
                  dict(base=base,raw=raw,corrected=corrected,composite=composite).items()}
        if any(value.shape != arrays['base'].shape or not np.isfinite(value).all() for value in arrays.values()):
            raise ValueError('Invalid local material stage image.')
        masks = mask.detach().cpu().numpy() > .5
        if masks.shape != arrays['base'].shape[:3] or not all(m.any() for m in masks):
            raise ValueError('Invalid local material diagnostic mask.')
        records = []
        for index, selected in enumerate(masks):
            stages = {key: measurements(arrays['base'][index],value[index],selected)
                      for key,value in arrays.items() if key != 'base'}
            final = stages['composite']
            checks = {key: final[key] >= policy.get('minimum_'+key,0.) for key in
                      ('visible_mean','visible_p95','added_highlight_fraction')}
            checks['outside_unchanged'] = final['outside_max'] == 0.
            reference = arrays['base'][index]
            raw_black = (arrays['raw'][index].max(-1) < .03) & (reference.max(-1) > .08)
            black_fraction = float(raw_black[selected].mean())
            transparent_fraction = float((alpha[index][selected] < .95).mean())
            stages['raw'].update(black_fraction=black_fraction, transparent_fraction=transparent_fraction)
            checks['no_black_holes'] = black_fraction <= policy.get('maximum_raw_black_fraction',1.)
            checks['opaque_surface'] = transparent_fraction <= policy.get('maximum_raw_transparent_fraction',1.)
            records.append(dict(stages=stages, checks=checks, visibility_passed=all(checks.values()),
                                material_appearance='requires_visual_review'))
        report = dict(material_id=policy.get('material_id'), raw_shape=raw_shape, samples=records)
        if save_stages:
            import folder_paths
            root = Path(folder_paths.get_output_directory())/'Badge87'/'diagnostics'/uuid.uuid4().hex
            root.mkdir(parents=True)
            for index, selected in enumerate(masks):
                for key,value in arrays.items():
                    Image.fromarray(np.clip(value[index]*255,0,255).astype(np.uint8)).save(root/f'{index}_{key}.png')
                Image.fromarray(np.clip(original_raw[min(index,len(original_raw)-1)]*255,0,255).astype(np.uint8)).save(root/f'{index}_model_original.png')
                Image.fromarray(selected.astype(np.uint8)*255).save(root/f'{index}_mask.png')
            report['directory'] = str(root)
            (root/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        if policy.get('enforce_visibility') and not all(r['visibility_passed'] for r in records):
            raise ValueError('局部材质效果未达到可见变化检查，请重新生成。' + (' 诊断：'+report['directory'] if save_stages else ''))
        return {'result': (composite,json.dumps(report)), 'ui': {'badge87_material_diagnostics':[report]}}


NODE_CLASS_MAPPINGS = {'DAELAB.Badge87MaterialDiagnosticsV1': Badge87MaterialDiagnostics}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.Badge87MaterialDiagnosticsV1': 'Badge 8.7 Material Diagnostics (DAELab)'}
