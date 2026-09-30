"""Apply metal base colour after upstream graph links resolve to image tensors."""
import torch

class Badge87IntrinsicGuide:
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'prepare'
    CATEGORY = 'DAELab/Badge'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'image': ('IMAGE',), 'mask': ('MASK',),
                             'color': ('STRING', {'default': '#C0C0C0'})}}

    def prepare(self, image, mask, color):
        base = image
        mask = mask.to(device=base.device, dtype=base.dtype)
        target = torch.tensor([int(color[i:i+2], 16)/255 for i in (1,3,5)], device=base.device, dtype=base.dtype)
        luminance = base.mean(dim=-1)
        shading = torch.ones_like(luminance)
        for batch in range(base.shape[0]):
            selected = mask[batch] > .5
            if selected.any():
                shading[batch] = (luminance[batch] / luminance[batch][selected].median().clamp_min(.05)).clamp(.8, 1.15)
        guide = (target * shading.unsqueeze(-1)).clamp(0, 1)
        return (torch.where(mask.unsqueeze(-1) > .5, guide, base),)

NODE_CLASS_MAPPINGS = {'DAELAB.Badge87IntrinsicGuideV1': Badge87IntrinsicGuide}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.Badge87IntrinsicGuideV1': 'Badge 8.7 Intrinsic Color Guide (DAELab)'}
