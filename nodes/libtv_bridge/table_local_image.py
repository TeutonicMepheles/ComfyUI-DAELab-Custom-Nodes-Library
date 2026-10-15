"""Installed Qwen 2.1 Turbo preset. Never substitutes a cloud provider."""
import math
import secrets

import folder_paths
import nodes
from .table_local_execution import LocalExecution

LOCAL_IMAGE_MODEL = 'Qwen-Image-2.1 Turbo（本地）'
MODEL_FILES = {
    'diffusion_models': 'qwen_image_2.1_turbo_int8_convrot.safetensors',
    'text_encoders': 'Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf',
    'mmproj': 'mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf',
    'vae': 'qwen_image_2.1_vae_bf16.safetensors',
}
SETTINGS = {
    'width': dict(type='integer', displayName='宽度', default=1024, min=256, max=2048, step=32),
    'height': dict(type='integer', displayName='高度', default=1024, min=256, max=2048, step=32),
    'seed': dict(type='integer', displayName='种子（-1 为随机）', default=-1, min=-1, max=9007199254740991),
}
REQUIRED_NODES = ('UNETLoader', 'CLIPLoaderGGUF', 'TextEncodeQwenImage21', 'QwenImage21Cache',
                  'VAELoader', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage')


class LocalImage(LocalExecution):
    cache_folder = 'table-local-qwen'

    def check_models(self):
        for category, filename in MODEL_FILES.items():
            if not folder_paths.get_full_path('text_encoders' if category == 'mmproj' else category, filename):
                raise ValueError('本地模型文件缺失：' + filename)
        missing = [name for name in REQUIRED_NODES if name not in nodes.NODE_CLASS_MAPPINGS]
        if missing:
            raise ValueError('当前 ComfyUI 尚未加载节点，请重启并检查安装：' + '、'.join(missing))

    def capabilities(self, model):
        if model != LOCAL_IMAGE_MODEL:
            raise ValueError('不支持的本地模型')
        self.check_models()
        props = {key: dict(value) for key, value in SETTINGS.items()}
        props['modeType'] = dict(items={'text2image': [0, 0]})
        return dict(model=model, kind='image', local=True, schema=dict(properties=props,
                    config=dict(strictModes=True, settings=['width', 'height'], advancedSettings=['seed'])))

    def validate_request(self, schema, mode, prompt, settings, media):
        if mode != 'text2image' or media:
            raise ValueError('本地 Qwen 当前预设仅支持文生图；请移除素材 @ 引用或切回文生图')
        if not prompt.strip():
            raise ValueError('提示词为空')
        for key, value in settings.items():
            spec = SETTINGS.get(key)
            if not spec:
                raise ValueError('本地 Qwen 不支持参数：' + key)
            if (type(value) not in (int, float) or not math.isfinite(value) or value != int(value)
                    or not spec['min'] <= value <= spec['max']
                    or key in ('width', 'height') and value % 32):
                raise ValueError(key + ' 参数无效；宽高须为 256–2048 范围内的 32 倍数')
        if settings.get('width', 1024) * settings.get('height', 1024) > 2097152:
            raise ValueError('当前本地预设最多支持 2097152 像素，请降低宽度或高度')
        self.check_models()

    def build_prompt(self, text, settings, media, key):
        self.validate_request(None, 'text2image', text, settings, media)
        values = {name: settings.get(name, spec['default']) for name, spec in SETTINGS.items()}
        seed = secrets.randbits(53) if values['seed'] == -1 else int(values['seed'])
        def node(kind, **inputs):
            return dict(class_type=kind, inputs=inputs)
        return {
            'model': node('UNETLoader', unet_name=MODEL_FILES['diffusion_models'], weight_dtype='default'),
            'clip': node('CLIPLoaderGGUF', clip_name=MODEL_FILES['text_encoders'], type='qwen_image'),
            'condition': node('TextEncodeQwenImage21', clip=['clip', 0], prompt=str(text),
                              negative_prompt='', resolution=1024, images={}),
            'vae': node('VAELoader', vae_name=MODEL_FILES['vae']),
            'latent': node('EmptyLatentImage', width=int(values['width']), height=int(values['height']), batch_size=1),
            'cache': node('QwenImage21Cache', model=['model', 0], device='auto', dtype='default'),
            'sample': node('KSampler', seed=seed, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=1,
                           model=['cache', 0], positive=['condition', 0], negative=['condition', 1], latent_image=['latent', 0]),
            'decode': node('VAEDecode', samples=['sample', 0], vae=['vae', 0]),
            'save': node('SaveImage', images=['decode', 0], filename_prefix='daelab/table-local-qwen/' + key),
        }
