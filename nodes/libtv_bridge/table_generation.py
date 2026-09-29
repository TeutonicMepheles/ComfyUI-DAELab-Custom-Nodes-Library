"""Column generation reuses Bridge's persisted submission and recovery protocol."""
import json
import re
from .runtime import Bridge, validate

REQUESTED = {'image': ('Image-2', 'Image-2.5'),
             'video': ('Seedance 2.0', 'Seedance 2.5', 'Minimax H3')}


class StructuredPrompt(str):
    def __new__(cls, text, spans):
        value = super().__new__(cls, text)
        value.reference_spans = spans
        return value


def compile_segments(segments, media):
    counts, numbered = {}, []
    for item in media:
        kind = item['kind']
        counts[kind] = counts.get(kind, 0) + 1
        numbered.append((kind, counts[kind]))
    text, spans = '', []
    for segment in segments:
        if segment.get('type') == 'text':
            if not isinstance(segment.get('text'), str):
                raise ValueError('Invalid prompt text')
            text += segment['text']
        elif segment.get('type') == 'asset':
            index = segment.get('index')
            if type(index) is not int or not 0 <= index < len(media):
                raise ValueError('Invalid column reference')
            kind, number = numbered[index]
            token = f'@{kind}_{number}'
            spans.append(dict(start=len(text), end=len(text)+len(token), kind=kind, index=number))
            text += token
        else:
            raise ValueError('Unsupported prompt segment')
    if not text.strip():
        raise ValueError('Prompt is empty')
    return StructuredPrompt(text, spans)


def setting_specs(schema, mode):
    props, config = schema.get('properties', {}), schema.get('config', {})
    specs = {}
    for bucket in ('settings', 'advancedSettings'):
        keys = config.get(bucket, [])
        if isinstance(keys, dict):
            keys = keys.get(mode, [])
        for key in keys:
            if key in props:
                specs[props[key].get('originalField', key)] = props[key]
    return specs


class ColumnBridge(Bridge):
    def __init__(self, cache, output, kind, cli=None):
        if kind not in REQUESTED:
            raise ValueError('Unsupported output kind')
        super().__init__(cache, output, cli)
        self.node_type = kind
        self.models = {name: Bridge.models.get(name, name) for name in REQUESTED[kind]}

    def model_info(self, model):
        if model not in self.models:
            raise ValueError('Unsupported model')
        matches = self.cli('model', 'search', '--type', self.node_type).get('matches', [])
        normalize = lambda text: re.sub(r'[\s_-]', '', text).lower()
        found = [m for m in matches if m.get('modelKey') == self.models[model]
                 or normalize(m.get('modelName', '')) == normalize(model)]
        if len(found) != 1:
            raise ValueError(f'{model} 当前不可用或无法唯一匹配；未替换模型，未提交生成')
        return found[0]

    def capabilities(self, model):
        info = self.model_info(model)
        schema = self.cli('model', info['modelKey'])['schema']
        return dict(model=model, kind=self.node_type, schema=schema)

    def validate_request(self, schema, mode, prompt, settings, media):
        if self.node_type == 'video':
            # Existing video checks cover references and required input modes.
            basic = dict(schema, config=dict(schema.get('config', {})))
            basic['config']['settings'] = list(schema.get('properties', {}))
            validate(basic, mode, prompt, settings, media)
        else:
            if any(m['kind'] != 'image' for m in media):
                raise ValueError('图片模型只接受图片参考')
            props = schema.get('properties', {})
            modes = props.get('modeType', {}).get('items', {})
            if modes:
                if mode not in modes:
                    raise ValueError('请选择模型支持的生成方式')
                lo, hi = modes[mode]
                if not lo <= len(media) <= hi:
                    raise ValueError(f'此方式需要 {lo}–{hi} 张参考图片')
            elif media:
                raise ValueError('模型未声明参考图能力，已阻止提交')
            maximum = props.get('prompt', {}).get('maxLength')
            if not prompt.strip() or maximum and len(prompt) > maximum:
                raise ValueError('提示词为空或超过模型长度限制')
        specs = setting_specs(schema, mode)
        for key, value in settings.items():
            spec = specs.get(key)
            if not spec:
                raise ValueError(f'模型不支持参数 {key}')
            choices = [v.get('value') if isinstance(v, dict) else v for v in spec.get('enum', [])]
            if choices and value not in choices:
                raise ValueError(f'{key} 参数无效')
            if spec.get('type') in ('number', 'integer'):
                if type(value) not in (int, float) or value < spec.get('min', float('-inf')) or value > spec.get('max', float('inf')):
                    raise ValueError(f'{key} 超出范围')
        count = schema.get('properties', {}).get('count', {})
        if count.get('min', 1) > 1:
            raise ValueError('模型不支持单个结果')

    def inspect_output(self, directory):
        if self.node_type == 'video':
            return super().inspect_output(directory)
        files = [p for p in directory.rglob('*') if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
        if len(files) != 1:
            raise RuntimeError('Expected exactly one downloaded image')
        from PIL import Image
        with Image.open(files[0]) as image:
            image.load()
            return files[0], image.width, image.height
