"""Reconstruct a narrow inner edge without feeding old surface colour back in."""
import numpy as np
import torch
from scipy import ndimage as ndi


def _linear(rgb):
    return np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)


def _srgb(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= .0031308, rgb*12.92, 1.055*rgb**(1/2.4)-.055)


class Badge87BoundaryComposite:
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'composite'
    CATEGORY = 'DAELab/Badge'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {k: (kind,) for k,kind in (
            ('original','IMAGE'), ('previous_master','IMAGE'), ('edit_candidate','IMAGE'),
            ('edit_mask','MASK'), ('coverage','MASK'))}}

    def composite(self, original, previous_master, edit_candidate, edit_mask, coverage):
        if original.shape != previous_master.shape or original.shape != edit_candidate.shape:
            raise ValueError('Boundary images must have identical dimensions.')
        if edit_mask.shape != original.shape[:3] or coverage.shape != edit_mask.shape:
            raise ValueError('Boundary masks must match the image canvas.')
        if not torch.isfinite(coverage).all() or (coverage < 0).any() or (coverage > 1).any():
            raise ValueError('Invalid boundary coverage.')
        outputs = []
        for n in range(original.shape[0]):
            base = original[n].detach().cpu().numpy()
            prior = previous_master[n].detach().cpu().numpy()
            candidate = edit_candidate[n].detach().cpu().numpy()
            mask = edit_mask[n].detach().cpu().numpy() > .5
            alpha = coverage[n].detach().cpu().numpy().copy()
            result = candidate.copy()
            if mask.any() and (~mask).any():
                inside = ndi.distance_transform_edt(np.pad(mask,1))[1:-1,1:-1]
                core = inside >= 2
                if core.any():
                    dist, foreground = ndi.distance_transform_edt(~core, return_indices=True)
                    _, background = ndi.distance_transform_edt(mask, return_indices=True)
                    band = mask & (inside < 2) & (dist <= 3)
                    f0, b0, pixel = (_linear(x) for x in (base[tuple(foreground)],base[tuple(background)],base))
                    vector = f0-b0
                    denom = (vector*vector).sum(-1)
                    fraction = np.clip(((pixel-b0)*vector).sum(-1)/np.maximum(denom,1e-6),0,1)
                    residual = np.linalg.norm(pixel-(b0+fraction[...,None]*vector),axis=-1)
                    # Use observed mixed-pixel coverage only when colour-line evidence is good.
                    reliable = band & (denom > .025) & (residual < .035) & (fraction > .05)
                    alpha[reliable] = fraction[reliable]
                    alpha[~band & mask] = 1
                    # A missing/contaminated candidate edge is extended from the NEW interior.
                    # Only mixed pixels are rebuilt; sharp fully-covered pixels remain intact.
                    mixed = band & (alpha < .999)
                    new_foreground = _linear(candidate[tuple(foreground)])
                    new_background = _linear(prior[tuple(background)])
                    rebuilt = _srgb(alpha[...,None]*new_foreground+(1-alpha[...,None])*new_background)
                    result[mixed] = rebuilt[mixed]
            # Preserve the identity case and every protected pixel exactly.
            result[(candidate == base).all(-1)] = base[(candidate == base).all(-1)]
            result[~mask] = prior[~mask]
            outputs.append(torch.from_numpy(result))
        return (torch.stack(outputs).to(device=original.device,dtype=original.dtype),)


NODE_CLASS_MAPPINGS = {'DAELAB.Badge87BoundaryCompositeV1': Badge87BoundaryComposite}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.Badge87BoundaryCompositeV1': 'Badge 8.7 Boundary Composite (DAELab)'}
