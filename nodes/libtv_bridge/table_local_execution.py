"""Shared serial native-ComfyUI job lifecycle for local table adapters."""
import asyncio
import hashlib
import json
import threading
import time
import uuid
from pathlib import Path
import execution
import folder_paths
from server import PromptServer
from .runtime import atomic_json, job_lock

class LocalExecutionFailure(RuntimeError):
    pass

class LocalExecutionPaused(RuntimeError):
    pass

class LocalExecution:
    cache_folder = 'table-local'
    queued_stage = 'local_queued'
    running_stage = 'local_generating'
    def __init__(self):
        self.cache = Path(folder_paths.get_input_directory()) / ('daelab/' + self.cache_folder)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.report = None
        self.pause_requested = threading.Event()
        self.prompt_id = None

    def sensitive_data(self):
        return {}

    def pause(self):
        self.pause_requested.set()
        if self.prompt_id:
            queue = PromptServer.instance.prompt_queue
            if not queue.delete_queue_item(lambda item: item[1] == self.prompt_id):
                queue.interrupt_if_running(self.prompt_id)

    def mark_paused(self, record, path):
        record['phase'] = 'paused'
        atomic_json(path, record)
        raise LocalExecutionPaused('已暂停；继续时重新生成当前行')

    async def enqueue(self, graph, record, path):
        server = PromptServer.instance
        valid = await execution.validate_prompt(record['promptId'], graph, None)
        if not valid[0]:
            raise LocalExecutionFailure('本地工作流无法执行：' + json.dumps(valid[3] or valid[1], ensure_ascii=False))
        sensitive = self.sensitive_data()
        if self.pause_requested.is_set():
            self.mark_paused(record, path)
        from ..prompt_optimization.local_qwen import native_admission
        try:
            async with native_admission():
                # Quarantine recovery can await; honor pauses before enqueueing.
                if self.pause_requested.is_set():
                    self.mark_paused(record, path)
                record['phase'] = 'queued'
                atomic_json(path, record)
                number = server.number
                server.number += 1
                server.prompt_queue.put((number, record['promptId'], graph, {'create_time': int(time.time() * 1000)}, valid[2], sensitive))
        except ValueError as error:
            # No native task was submitted: keep explicit resume possible.
            record['phase'] = 'paused'
            atomic_json(path, record)
            raise LocalExecutionPaused(str(error)) from error

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
                raise LocalExecutionFailure('本地结果文件已删除，请明确重新生成')
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
                        raise LocalExecutionFailure('本地生成失败：' + (errors[-1] if errors else '请查看 ComfyUI 执行日志'))
                    results = history.get('outputs', {}).get('save', {}).get('images', [])
                    if not results:
                        raise LocalExecutionFailure('本地任务未生成结果文件')
                    result = results[0]
                    root = Path(folder_paths.get_output_directory()).resolve()
                    file = (root / result.get('subfolder', '') / result['filename']).resolve()
                    if result.get('type') != 'output' or not file.is_relative_to(root) or not file.is_file():
                        raise LocalExecutionFailure('本地结果输出不可用')
                    record.update(phase='complete', result=dict(file=str(file)))
                    atomic_json(path, record)
                    return record['result']
                active = any(item[1] == prompt_id for item in running)
                if not active and not any(item[1] == prompt_id for item in pending):
                    if self.pause_requested.is_set():
                        self.mark_paused(record, path)
                    raise RuntimeError('原本地任务不在队列或历史中；未重复提交，请明确重新生成')
                if self.report:
                    self.report(self.running_stage if active else self.queued_stage, taskId=prompt_id)
                time.sleep(2)
