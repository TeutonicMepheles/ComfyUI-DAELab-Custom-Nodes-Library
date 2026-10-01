"""Local H3 column jobs use ComfyUI's existing loaders, sampler and queue."""
import asyncio
import hashlib
import json
import math
import secrets
import threading
import time
import uuid
from pathlib import Path

import execution
import folder_paths
import nodes
from server import PromptServer
from .runtime import atomic_json, digest_file, job_lock

LOCAL_MODEL = 'MiniMax H3 FL（本地）'
MODEL_FILES = {
    'diffusion_models': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'text_encoders': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'video_vae': 'minimax_h3_video_vae_int8_convrot.safetensors',
    'audio_vae': 'minimax_h3_audio_vae_fp32.safetensors',
    'loras': 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
}
MODES = {'text2video': 0, 'singleImage2video': 1, 'frames2video': 2}
SETTINGS = {
    'width': dict(type='integer', displayName='宽度', default=768, min=32, max=nodes.MAX_RESOLUTION, step=32),
    'height': dict(type='integer', displayName='高度', default=448, min=32, max=nodes.MAX_RESOLUTION, step=32),
    'duration': dict(type='number', displayName='时长（秒）', default=2, min=0.2, max=15),
    'turbo': dict(type='boolean', displayName='启用 8 步加速', default=True),
    'seed': dict(type='integer', displayName='种子（-1 为随机）', default=-1, min=-1, max=9007199254740991),
}


class LocalVideoFailure(RuntimeError):
    pass


class LocalVideoPaused(RuntimeError):
    pass


class LocalVideo:
    def __init__(self):
        self.cache = Path(folder_paths.get_input_directory()) / 'daelab/table-local-h3'
        self.cache.mkdir(parents=True, exist_ok=True)
        self.report = None
        self.pause_requested = threading.Event()
        self.prompt_id = None

    def pause(self):
        self.pause_requested.set()
        if self.prompt_id:
            queue = PromptServer.instance.prompt_queue
            if not queue.delete_queue_item(lambda item: item[1] == self.prompt_id):
                queue.interrupt_if_running(self.prompt_id)

    def mark_paused(self, record, path):
        record['phase'] = 'paused'
        atomic_json(path, record)
        raise LocalVideoPaused('已暂停；继续时重新生成当前行')

    def check_models(self, turbo):
        for key, filename in MODEL_FILES.items():
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
            'model': node('UNETLoader', unet_name=MODEL_FILES['diffusion_models'], weight_dtype='default'),
            'clip': node('CLIPLoader', clip_name=MODEL_FILES['text_encoders'], type='minimax', device='default'),
            'video_vae': node('VAELoader', vae_name=MODEL_FILES['video_vae']),
            'audio_vae': node('VAELoader', vae_name=MODEL_FILES['audio_vae']),
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

    async def enqueue(self, graph, record, path):
        server = PromptServer.instance
        valid = await execution.validate_prompt(record['promptId'], graph, None)
        if not valid[0]:
            raise LocalVideoFailure('本地工作流无法执行：' + json.dumps(valid[3] or valid[1], ensure_ascii=False))
        if self.pause_requested.is_set():
            self.mark_paused(record, path)
        record['phase'] = 'queued'
        atomic_json(path, record)
        number = server.number
        server.number += 1
        server.prompt_queue.put((number, record['promptId'], graph, {'create_time': int(time.time() * 1000)}, valid[2], {}))

    def generate(self, project, request_id, model, mode, prompt, settings, media):
        key = hashlib.sha256((project + '\n' + request_id).encode()).hexdigest()[:24]
        path = self.cache / (key + '.json')
        with job_lock(self.cache / (key + '.lock')):
            record = json.loads(path.read_text('utf-8')) if path.exists() else None
            if record is None or record['phase'] == 'paused':
                graph = self.build_prompt(prompt, settings, media, key)
                record = dict(promptId=str(uuid.uuid4()), phase='preparing')
                self.prompt_id = record['promptId']
                atomic_json(path, record)
                asyncio.run_coroutine_threadsafe(self.enqueue(graph, record, path), PromptServer.instance.loop).result()
            if record.get('result'):
                if Path(record['result']['file']).is_file():
                    return record['result']
                raise LocalVideoFailure('本地视频文件已删除，请明确重新生成')
            queue, prompt_id = PromptServer.instance.prompt_queue, record['promptId']
            self.prompt_id = prompt_id
            if self.pause_requested.is_set():
                self.pause()
            while True:
                running, pending = queue.get_current_queue_volatile()
                history = queue.get_history(prompt_id).get(prompt_id)
                if history:
                    status = history.get('status', {})
                    if status.get('status_str') == 'error':
                        if self.pause_requested.is_set():
                            self.mark_paused(record, path)
                        errors = [data.get('exception_message', '任务已中断') for event, data in status.get('messages', []) if event in ('execution_error', 'execution_interrupted')]
                        raise LocalVideoFailure('本地生成失败：' + (errors[-1] if errors else '请查看 ComfyUI 执行日志'))
                    results = history.get('outputs', {}).get('save', {}).get('images', [])
                    if not results:
                        raise LocalVideoFailure('本地任务未生成视频文件')
                    result = results[0]
                    root = Path(folder_paths.get_output_directory()).resolve()
                    file = (root / result.get('subfolder', '') / result['filename']).resolve()
                    if result.get('type') != 'output' or not file.is_relative_to(root) or not file.is_file():
                        raise LocalVideoFailure('本地视频输出不可用')
                    record.update(phase='complete', result=dict(file=str(file)))
                    atomic_json(path, record)
                    return record['result']
                active = any(item[1] == prompt_id for item in running)
                if not active and not any(item[1] == prompt_id for item in pending):
                    if self.pause_requested.is_set():
                        self.mark_paused(record, path)
                    raise RuntimeError('原本地任务不在队列或历史中；未重复提交，请明确重新生成')
                self.report('local_generating' if active else 'local_queued', taskId=prompt_id)
                time.sleep(2)
