"""Badge 8.7 preset color semantics, independent of saved UI color policies."""
def material_config(config):
    result = dict(config or {})
    material = result.get('material_id', 'baked_enamel')
    result['color_policy'] = 'material_intrinsic' if material in ('satin_gold', 'satin_silver', '亚金', '亚银') else 'preserve'
    return result
