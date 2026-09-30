"""Save a reusable auxiliary image without publishing a gallery image output."""


class Badge87AuxiliaryImage:
    RETURN_TYPES = ()
    FUNCTION = 'save'
    OUTPUT_NODE = True
    CATEGORY = 'DAELab/Badge'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',)},
                'hidden': {'prompt':'PROMPT', 'extra_pnginfo':'EXTRA_PNGINFO'}}

    def save(self, images, prompt=None, extra_pnginfo=None):
        from nodes import SaveImage
        result = SaveImage().save_images(images, 'Badge87/auxiliary/color_map', prompt, extra_pnginfo)
        return {'ui': {'badge87_auxiliary_images': result['ui']['images']}}


NODE_CLASS_MAPPINGS = {'DAELAB.Badge87AuxiliaryImageV1': Badge87AuxiliaryImage}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.Badge87AuxiliaryImageV1': 'Badge 8.7 Auxiliary Image (DAELab)'}
