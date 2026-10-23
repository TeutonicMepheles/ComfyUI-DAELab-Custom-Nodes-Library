"""Seedance through registered Comfy Partner nodes, with transient account auth."""
import secrets
from pathlib import Path

import folder_paths
import nodes
from .table_local_execution import LocalExecution

MODEL = 'Seedance 2.5'
MODELS = ('Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini', MODEL, 'Minimax H3')
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

    def __init__(self, auth=None, model=MODEL):
        super().__init__()
        self.auth = auth or {}
        self.model = model
        self.mode = None

    def sensitive_data(self):
        if self.auth.get('token'):
            return {'auth_token_comfy_org': self.auth['token']}
        if self.auth.get('key'):
            return {'api_key_comfy_org': self.auth['key']}
        raise ValueError('请登录 ComfyUI 账号后继续；未提交生成')

    def specs(self):
        props = {key: dict(value) for key, value in SETTINGS.items()}
        if self.model != MODEL:
            props['duration']['max'] = 15
        if self.model in ('Seedance 2.0 Fast', 'Seedance 2.0 Mini'):
            props['resolution']['enum'] = ['480p', '720p']
        elif self.model == 'Seedance 2.0':
            props['resolution']['enum'] = ['480p', '720p', '1080p', '4k']
        elif self.model == 'Minimax H3':
            props['resolution'].update(enum=['768P', '2K'], default='768P')
            props.pop('enableSound')
        return props

    def node_type(self, mode):
        prefix = 'MinimaxHailuo03' if self.model == 'Minimax H3' else 'ByteDance2'
        suffix = 'ReferenceNode' if self.model == 'Minimax H3' else 'ReferenceNodeV2'
        return prefix + ('TextToVideoNode' if mode == 'text2video' else
                         'FirstLastFrameNode' if mode in ('singleImage2video', 'frames2video') else suffix)

    def capabilities(self, model):
        if model not in MODELS or model != self.model:
            raise ValueError('不支持的 Comfy 模型；请重新选择，未使用 LibTV')
        for name in (self.node_type('text2video'), self.node_type('frames2video'), 'LoadImage', 'SaveVideo'):
            if name not in nodes.NODE_CLASS_MAPPINGS:
                raise ValueError('当前 ComfyUI 未加载原生节点：' + name)
        props = self.specs()
        modes = {mode: [count, count] for mode, count in MODES.items()}
        if self.node_type('mixed2video') in nodes.NODE_CLASS_MAPPINGS:
            modes.update(image2video=[1, 9], mixed2video=[1, 15])
        props['modeType'] = dict(items=modes)
        basic = ['resolution', 'duration'] + (['enableSound'] if 'enableSound' in props else [])
        return dict(model=model, kind='video', provider='comfy', schema=dict(properties=props,
            config=dict(strictModes=True, settings={mode: [*basic, *(['ratio'] if mode not in ('singleImage2video', 'frames2video') else [])]
                                  for mode in modes}, advancedSettings=['seed'])))

    def validate_request(self, schema, mode, prompt, settings, media):
        caps = self.capabilities(self.model)
        limits = caps['schema']['properties']['modeType']['items'].get(mode)
        if not limits or not limits[0] <= len(media) <= limits[1]:
            raise ValueError('Comfy 视频参考数量与生成方式不匹配，请检查首尾帧或参考素材')
        if mode != 'mixed2video' and any(m['kind'] != 'image' for m in media):
            raise ValueError('此生成方式只接收图片参考')
        for kind, maximum in (('image', 9), ('video', 3), ('audio', 3)):
            if sum(m['kind'] == kind for m in media) > maximum:
                raise ValueError('参考素材过多：' + kind)
        if any(m['kind'] == 'audio' for m in media) and not any(m['kind'] in ('image', 'video') for m in media):
            raise ValueError('音频参考需要同时提供图片或视频')
        if not str(prompt).strip():
            raise ValueError('提示词不能为空')
        props = self.specs()
        for key, value in settings.items():
            if key in {'search_enabled', 'autoCompliance'} and type(value) is int and value == 0:
                continue
            spec = props.get(key)
            if not spec or ('enum' in spec and value not in spec['enum']):
                raise ValueError('Comfy 模型不支持此参数：' + key + '；请重新选择参数')
            if spec['type'] == 'integer' and (type(value) is not int or not spec['min'] <= value <= spec['max']):
                raise ValueError('Comfy 模型参数超出范围：' + key)
        if self.model == 'Minimax H3' and mode == 'text2video' and settings.get('ratio') == 'adaptive':
            raise ValueError('文生视频需要明确画幅比例')
        self.mode = mode

    def generate(self, project, request_id, model, mode, prompt, settings, media):
        self.validate_request(None, mode, prompt, settings, media)
        return super().generate(project, request_id, model, mode, prompt, settings, media)

    def build_prompt(self, text, settings, media, key):
        values = {name: settings.get(name, spec['default']) for name, spec in self.specs().items()}
        mode = self.mode or ('frames2video' if len(media) == 2 else 'singleImage2video' if media else 'text2video')
        frames = mode in ('singleImage2video', 'frames2video')
        # Keep reference identity/order; frame tags bind sockets, reference tags name media.
        for span in reversed(getattr(text, 'reference_spans', [])):
            replacement = '' if frames else f"{span['kind'].title()} {span['index']}"
            text = text[:span['start']] + replacement + text[span['end']:]
        inputs = {'model': 'MiniMax H3' if self.model == 'Minimax H3' else self.model,
                  'model.prompt': str(text).strip(), 'model.resolution': values['resolution'],
                  'model.duration': values['duration'],
                  'seed': secrets.randbelow(2147483648) if values['seed'] == -1 else values['seed'],
                  'watermark': False}
        if 'enableSound' in values:
            inputs['model.generate_audio'] = values['enableSound'] == 'on'
        if self.model == MODEL:
            inputs['model.output_format'] = 'mp4'
            if mode in ('image2video', 'mixed2video'):
                inputs['model.task_type'] = 'reference'
        if not frames or self.model.startswith('Seedance 2.0'):
            inputs['model.ratio'] = 'adaptive' if frames else values['ratio']
        graph, counts = {}, {}
        root = Path(folder_paths.get_input_directory()).resolve()
        for index, item in enumerate(media):
            kind = item['kind']
            counts[kind] = counts.get(kind, 0) + 1
            file = Path(item['path']).resolve().relative_to(root).as_posix()
            name = ('first_frame' if index == 0 else 'last_frame') if frames else f'{kind}_{counts[kind]}'
            loader, field = {'image': ('LoadImage', 'image'), 'video': ('LoadVideo', 'file'), 'audio': ('LoadAudio', 'audio')}[kind]
            graph[name] = dict(class_type=loader, inputs={field: file})
            port = name if frames else f'model.reference_{kind}s.{kind}_{counts[kind]}'
            inputs[port] = [name, 0]
        graph['seedance'] = dict(class_type=self.node_type(mode), inputs=inputs)
        graph['save'] = dict(class_type='SaveVideo', inputs=dict(video=['seedance', 0],
            filename_prefix='DAELab/table-comfy-seedance/' + key, format='mp4', **{'format.codec': 'auto'}))
        return graph
