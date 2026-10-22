"""Seedance through registered Comfy Partner nodes, with transient account auth."""
import secrets
from pathlib import Path

import folder_paths
import nodes
from .table_local_execution import LocalExecution

MODEL = 'Seedance 2.5'
MODES = {'text2video': 0, 'singleImage2video': 1, 'frames2video': 2}
SETTINGS = {
    'resolution': dict(type='string', displayName='分辨率', enum=['480p', '720p', '1080p'], default='480p'),
    'ratio': dict(type='string', displayName='比例', enum=['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], default='16:9'),
    'duration': dict(type='integer', displayName='时长（秒）', min=4, max=30, step=1, default=4),
    'enableSound': dict(type='string', displayName='声音', enum=['off', 'on'], default='off'),
    'seed': dict(type='integer', displayName='种子（-1 为随机）', min=-1, max=2147483647, default=-1),
}


class ComfyVideo(LocalExecution):
    cache_folder = 'table-comfy-seedance'
    queued_stage = 'submitting'
    running_stage = 'generating'

    def __init__(self, auth=None):
        super().__init__()
        self.auth = auth or {}

    def sensitive_data(self):
        if self.auth.get('token'):
            return {'auth_token_comfy_org': self.auth['token']}
        if self.auth.get('key'):
            return {'api_key_comfy_org': self.auth['key']}
        raise ValueError('请登录 ComfyUI 账号后继续；未提交生成')

    def capabilities(self, model):
        if model != MODEL:
            raise ValueError('不支持的 Comfy 模型')
        for name in ('ByteDance2TextToVideoNode', 'ByteDance2FirstLastFrameNode', 'LoadImage', 'SaveVideo'):
            if name not in nodes.NODE_CLASS_MAPPINGS:
                raise ValueError('当前 ComfyUI 未加载原生节点：' + name)
        props = {key: dict(value) for key, value in SETTINGS.items()}
        props['modeType'] = dict(items={mode: [count, count] for mode, count in MODES.items()})
        return dict(model=model, kind='video', provider='comfy', schema=dict(properties=props,
            config=dict(settings={mode: ['resolution', *(['ratio'] if mode == 'text2video' else []),
                                         'duration', 'enableSound'] for mode in MODES}, advancedSettings=['seed'])))

    def validate_request(self, schema, mode, prompt, settings, media):
        self.capabilities(MODEL)
        if mode not in MODES or len(media) != MODES[mode] or any(m['kind'] != 'image' for m in media):
            raise ValueError('Comfy Seedance 支持文生视频、单首帧或首尾帧；请检查参考图片数量')
        if not str(prompt).strip():
            raise ValueError('提示词不能为空')
        # Old LibTV workflows used these disabled flags. Never silently enable
        # unsupported paid features when switching provider.
        legacy_disabled = {'search_enabled', 'autoCompliance'}
        for key, value in settings.items():
            if key in legacy_disabled and type(value) is int and value == 0:
                continue
            spec = SETTINGS.get(key)
            if not spec or ('enum' in spec and value not in spec['enum']):
                raise ValueError('Comfy Seedance 不支持此参数：' + key)
            if spec['type'] == 'integer' and (type(value) is not int or not spec['min'] <= value <= spec['max']):
                raise ValueError('Comfy Seedance 参数超出范围：' + key)

    def build_prompt(self, text, settings, media, key):
        values = {name: settings.get(name, spec['default']) for name, spec in SETTINGS.items()}
        # Frame bindings are sockets, not literal @image markers in the prompt.
        for span in reversed(getattr(text, 'reference_spans', [])):
            text = text[:span['start']] + text[span['end']:]
        inputs = {'model': MODEL, 'model.prompt': str(text).strip(), 'model.resolution': values['resolution'],
                  'model.duration': values['duration'], 'model.generate_audio': values['enableSound'] == 'on',
                  'model.output_format': 'mp4', 'seed': secrets.randbelow(2147483648) if values['seed'] == -1 else values['seed'],
                  'watermark': False}
        graph = {}
        root = Path(folder_paths.get_input_directory()).resolve()
        for index, item in enumerate(media):
            image = Path(item['path']).resolve().relative_to(root).as_posix()
            name = 'first_frame' if index == 0 else 'last_frame'
            graph[name] = dict(class_type='LoadImage', inputs=dict(image=image))
            inputs[name] = [name, 0]
        if not media:
            inputs['model.ratio'] = values['ratio']
        graph['seedance'] = dict(class_type='ByteDance2FirstLastFrameNode' if media else 'ByteDance2TextToVideoNode', inputs=inputs)
        graph['save'] = dict(class_type='SaveVideo', inputs=dict(video=['seedance', 0],
            filename_prefix='DAELab/table-comfy-seedance/' + key, format='mp4', **{'format.codec': 'auto'}))
        return graph
