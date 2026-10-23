"""Explicit Comfy image models; never infer a model from a LibTV brand name."""
from pathlib import Path
import folder_paths
import nodes
from .table_comfy_video import ComfyVideo

MODELS = {'GPT Image 2': 'gpt-image-2', 'GPT Image 2.5 Flare': 'gpt-image-2.5-flare',
          'GPT Image 2.5 Sunburst': 'gpt-image-2.5-sunburst'}


class ComfyImage(ComfyVideo):
    cache_folder = 'table-comfy-image'

    def specs(self):
        return {
            'size': dict(type='string', displayName='尺寸', enum=['auto', '1024x1024', '1024x1536', '1536x1024',
                '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840'], default='1024x1024'),
            'quality': dict(type='string', displayName='质量', enum=['low', 'medium', 'high'], default='low'),
            'background': dict(type='string', displayName='背景', enum=['auto', 'opaque'] +
                ([] if self.model == 'GPT Image 2' else ['transparent']), default='auto'),
        }

    def capabilities(self, model):
        if model != self.model or model not in MODELS:
            raise ValueError('请选择明确的 Comfy 图片模型；Lib Image 已停用')
        for name in ('OpenAIGPTImageNodeV2', 'LoadImage', 'SaveImage'):
            if name not in nodes.NODE_CLASS_MAPPINGS:
                raise ValueError('当前 ComfyUI 未加载原生节点：' + name)
        props = self.specs()
        props['modeType'] = dict(items={'text2image': [0, 0], 'image2image': [1, 16]})
        return dict(model=model, kind='image', provider='comfy', schema=dict(properties=props,
                    config=dict(strictModes=True, settings=['size', 'quality', 'background'])))

    def validate_request(self, schema, mode, prompt, settings, media):
        self.capabilities(self.model)
        if mode not in ('text2image', 'image2image') or (mode == 'text2image' and media) or (
                mode == 'image2image' and not 1 <= len(media) <= 16) or any(m['kind'] != 'image' for m in media):
            raise ValueError('Comfy 图片生成只接收最多 16 张图片参考，请检查生成方式')
        if not str(prompt).strip():
            raise ValueError('提示词不能为空')
        for key, value in settings.items():
            if key not in self.specs() or value not in self.specs()[key]['enum']:
                raise ValueError('Comfy 图片模型不支持此参数：' + key + '；请重新选择参数')

    def build_prompt(self, text, settings, media, key):
        for span in reversed(getattr(text, 'reference_spans', [])):
            text = text[:span['start']] + f"Image {span['index']}" + text[span['end']:]
        inputs = {'model': MODELS[self.model], 'prompt': str(text).strip(), 'n': 1, 'seed': 0,
                  'model.custom_width': 1024, 'model.custom_height': 1024}
        inputs.update({'model.' + name: settings.get(name, spec['default']) for name, spec in self.specs().items()})
        graph = {}
        root = Path(folder_paths.get_input_directory()).resolve()
        for i, item in enumerate(media, 1):
            name = 'image_' + str(i)
            graph[name] = dict(class_type='LoadImage', inputs=dict(image=Path(item['path']).resolve().relative_to(root).as_posix()))
            inputs['model.images.' + name] = [name, 0]
        graph['image'] = dict(class_type='OpenAIGPTImageNodeV2', inputs=inputs)
        graph['save'] = dict(class_type='SaveImage', inputs=dict(images=['image', 0], filename_prefix='DAELab/table-comfy-image/' + key))
        return graph
