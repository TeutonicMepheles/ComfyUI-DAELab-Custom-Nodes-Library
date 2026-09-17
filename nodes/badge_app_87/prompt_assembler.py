"""Strict, single-pass text assembly. No image, workflow or model policy here."""
import hashlib
import json
import re
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[2] / 'content' / 'badge87'
PROMPTS = CONTENT / 'prompts'
VARIABLE = re.compile(r'\{\{([a-z][a-z0-9_]*)\}\}')


class PromptText(str):
    def __new__(cls, text, records=()):
        value = super().__new__(cls, text)
        value.records = tuple(records)
        return value


def join(*parts, separator='\n\n'):
    selected = [p for p in parts if str(p or '').strip()]
    return PromptText(separator.join(str(p).strip() for p in selected),
                      [r for p in selected for r in getattr(p, 'records', ())])


def manifest():
    return json.loads((PROMPTS / 'recipes.json').read_text(encoding='utf-8'))


def render(template_id, **values):
    path = (PROMPTS / (template_id + '.md')).resolve()
    if not path.is_relative_to(PROMPTS.resolve()):
        raise ValueError('Prompt template path escapes content directory.')
    source = path.read_text(encoding='utf-8')
    missing = set(VARIABLE.findall(source)) - values.keys()
    if missing:
        raise ValueError(f'Missing prompt variables for {template_id}: {sorted(missing)}')
    text = VARIABLE.sub(lambda m: str(values[m[1]]), source)
    nested = [r for name in VARIABLE.findall(source) for r in getattr(values[name], 'records', ())]
    return PromptText(text, [*nested, {'template': template_id, 'sha256': hashlib.sha256(source.encode('utf-8')).hexdigest()}])


def legacy_uploaded_reference(prompt):
    """Content-owned compatibility policy; retire only in a behavior-changing release."""
    source = (PROMPTS / 'compatibility/uploaded_reference.json').read_text(encoding='utf-8')
    mapping = json.loads(source)['replacements']
    pattern = re.compile('|'.join(re.escape(key) for key in mapping))
    return PromptText(pattern.sub(lambda match: mapping[match[0]], str(prompt)),
                      (*getattr(prompt, 'records', ()), {'compatibility': 'uploaded_reference',
                       'sha256': hashlib.sha256(source.encode()).hexdigest()}))


def assemble(recipe_id, values=None, *, flags=None, slots=None):
    values, flags, slots = values or {}, flags or {}, slots or {}
    config = manifest()
    pieces = []
    for item in config['recipes'][recipe_id]:
        if 'when' in item:
            if item['when'] not in flags:
                raise ValueError(f'Missing prompt condition: {item["when"]}')
            if not flags[item['when']]:
                continue
        pieces.append(slots[item['slot']] if 'slot' in item else render(item['template'], **values))
    text = join(*pieces)
    return PromptText(text, (*text.records, {'recipe': recipe_id, 'release': config['release'],
        'sha256': hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()}))


def describe(prompt):
    return {'release': manifest()['release'], 'components': list(getattr(prompt, 'records', ())),
            'sha256': hashlib.sha256(str(prompt).encode('utf-8')).hexdigest(), 'text': str(prompt)}


def ui_text(key):
    return json.loads((CONTENT / 'ui.zh-CN.json').read_text(encoding='utf-8'))['messages'][key]
