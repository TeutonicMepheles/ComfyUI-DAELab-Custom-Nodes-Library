"""Local H3 column jobs use ComfyUI's existing loaders, sampler and queue."""
import math
import secrets
from pathlib import Path

import folder_paths
import nodes
from .runtime import digest_file
from .table_local_execution import (LocalExecution, LocalExecutionFailure as LocalVideoFailure,
                                    LocalExecutionPaused as LocalVideoPaused)

LOCAL_MODEL = 'MiniMax H3 FL（本地）'
MODEL_FILES = {
    'diffusion_models': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'text_encoders': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'video_vae': 'minimax_h3_video_vae_int8_convrot.safetensors',
    'audio_vae': 'minimax_h3_audio_vae_fp32.safetensors',
    'loras': 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
}
MODEL_ALTERNATIVES = {
    'diffusion_models': ('MiniMax-H3_FL2VA-NVFP4.safetensors',),
    'video_vae': ('minimax_h3_video_vae_fp16.safetensors',),
}


def installed_model_files():
    """Prefer the existing stack; allow installed FL2VA quantizations only."""
    result = dict(MODEL_FILES)
    for key, alternatives in MODEL_ALTERNATIVES.items():
        category = 'vae' if key.endswith('_vae') else key
        for filename in (MODEL_FILES[key], *alternatives):
            if folder_paths.get_full_path(category, filename):
                result[key] = filename
                break
    return result
MODES = {'text2video': 0, 'singleImage2video': 1, 'frames2video': 2}
SETTINGS = {
    'width': dict(type='integer', displayName='宽度', default=768, min=32, max=nodes.MAX_RESOLUTION, step=32),
    'height': dict(type='integer', displayName='高度', default=448, min=32, max=nodes.MAX_RESOLUTION, step=32),
    'duration': dict(type='number', displayName='时长（秒）', default=2, min=0.2, max=15),
    'turbo': dict(type='boolean', displayName='启用 8 步加速', default=True),
    'seed': dict(type='integer', displayName='种子（-1 为随机）', default=-1, min=-1, max=9007199254740991),
}


class LocalVideo(LocalExecution):
    cache_folder = 'table-local-h3'

    def check_models(self, turbo):
        for key, filename in installed_model_files().items():
            if key == 'loras' and not turbo:
                continue
            category = 'vae' if key.endswith('_vae') else key
            if not folder_paths.get_full_path(category, filename):
                raise ValueError('本地模型文件缺失：' + filename)
        if 'MiniMaxH3ImageToVideo' not in nodes.NODE_CLASS_MAPPINGS:
            raise ValueError('当前 ComfyUI 尚未加载 MiniMax H3 节点，请重启 ComfyUI')

    def capabilities(self, model):
        if model != LOCAL_MODEL:
            raise ValueError('不支持的本地模型')
        self.check_models(False)
        props = {key: dict(value) for key, value in SETTINGS.items()}
        props['turbo']['default'] = bool(folder_paths.get_full_path('loras', MODEL_FILES['loras']))
        props['modeType'] = dict(items={mode: [count, count] for mode, count in MODES.items()})
        return dict(model=model, kind='video', local=True, schema=dict(properties=props,
                    config=dict(settings=['width', 'height', 'duration', 'turbo'], advancedSettings=['seed'])))

    def validate_request(self, schema, mode, prompt, settings, media):
        if mode not in MODES:
            raise ValueError('本地 FL 支持文生视频、首帧或首尾帧生成')
        if any(item['kind'] != 'image' for item in media):
            raise ValueError('本地 FL 只支持图片首尾帧，不能输入视频或音频参考')
        if len(media) != MODES[mode]:
            raise ValueError(f'当前生成方式需要 {MODES[mode]} 张图片，请调整提示词中的 @ 引用')
        if not prompt.strip():
            raise ValueError('提示词为空')
        for key, value in settings.items():
            spec = SETTINGS.get(key)
            if not spec:
                raise ValueError('本地模型不支持参数：' + key)
            if spec['type'] == 'boolean':
                if type(value) is not bool:
                    raise ValueError(key + ' 必须是开关值')
            elif (type(value) not in (int, float) or not math.isfinite(value)
                  or spec['type'] == 'integer' and value != int(value)
                  or not spec['min'] <= value <= spec['max']):
                raise ValueError(key + ' 参数无效')
        self.check_models(settings.get('turbo', True))

    def build_prompt(self, text, settings, media, key):
        model_files = installed_model_files()
        values = {name: settings.get(name, spec['default']) for name, spec in SETTINGS.items()}
        seed = secrets.randbits(53) if values['seed'] == -1 else int(values['seed'])
        length = max(5, round(values['duration'] * 24))
        length += (5 - length % 17) % 17
        # Replace only structured references; literal user text is preserved.
        for span in reversed(text.reference_spans):
            text = text[:span['start']] + f"<Picture {span['index']}>" + text[span['end']:]
        def node(kind, **inputs):
            return dict(class_type=kind, inputs=inputs)
        graph = {
            'model': node('UNETLoader', unet_name=model_files['diffusion_models'], weight_dtype='default'),
            'clip': node('CLIPLoader', clip_name=model_files['text_encoders'], type='minimax', device='default'),
            'video_vae': node('VAELoader', vae_name=model_files['video_vae']),
            'audio_vae': node('VAELoader', vae_name=model_files['audio_vae']),
            'condition': node('MiniMaxH3ImageToVideo', clip=['clip', 0], vae=['video_vae', 0], prompt=str(text),
                              width=int(values['width']), height=int(values['height']), length=length),
            'noise': node('RandomNoise', noise_seed=seed),
            'guider': node('BasicGuider', model=['turbo' if values['turbo'] else 'model', 0], conditioning=['condition', 0]),
            'sampler': node('KSamplerSelect', sampler_name='res_multistep'),
            'schedule': node('BasicScheduler', model=['model', 0], scheduler='simple', steps=8 if values['turbo'] else 20, denoise=1.0),
            'sample': node('SamplerCustomAdvanced', noise=['noise', 0], guider=['guider', 0], sampler=['sampler', 0],
                           sigmas=['schedule', 0], latent_image=['condition', 1]),
            'decode_video': node('VAEDecodeTiled', samples=['sample', 0], vae=['video_vae', 0],
                                 tile_size=512, overlap=64, temporal_size=16, temporal_overlap=4),
            'decode_audio': node('VAEDecodeAudio', samples=['sample', 0], vae=['audio_vae', 0]),
            'video': node('CreateVideo', images=['decode_video', 0], audio=['decode_audio', 0], fps=24.0),
            'save': node('SaveVideo', video=['video', 0], filename_prefix='daelab/table-local-h3/' + key,
                         format='mp4', **{'format.codec': 'auto'}),
        }
        if values['turbo']:
            graph['turbo'] = node('LoraLoaderModelOnly', model=['model', 0], lora_name=MODEL_FILES['loras'], strength_model=1.0)
        input_root = Path(folder_paths.get_input_directory()).resolve()
        for index, item in enumerate(media):
            file = Path(item['path']).resolve()
            if not file.is_relative_to(self.cache.resolve()) or digest_file(file) != item['sha256']:
                raise ValueError('本地参考素材快照已变化，请重新生成')
            name = 'first_frame' if index == 0 else 'last_frame'
            graph[name] = node('LoadImage', image=file.relative_to(input_root).as_posix())
            graph['condition']['inputs'][name] = [name, 0]
        return graph
