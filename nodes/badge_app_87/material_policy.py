"""Content-owned material policies. Never consumed by region geometry."""
import json
from .prompt_assembler import CONTENT

def generation_policy(config):
    catalog = json.loads((CONTENT / 'material_execution.json').read_text(encoding='utf-8'))
    material = config.get('material_id','baked_enamel')
    material = catalog.get('aliases',{}).get(material,material)
    return {**catalog['default'], **catalog['materials'].get(material,{})}

def material_config(config):
    result = dict(config or {})
    result['color_policy'] = generation_policy(result)['color_policy']
    return result
