"""Local, asynchronous table jobs. Browser disconnection does not repeat paid runs."""
import asyncio
import hashlib
import json
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit, parse_qs
from aiohttp import web
import folder_paths
from server import PromptServer
from .connection_api import local_request
from .node import local_media
from .runtime import atomic_json, digest_file, CLI, generation_failure_reason
from .recovery import recover_generation, is_network_error
from .media_snapshot import freeze_media
from .table_generation import ColumnBridge, compile_segments
from .table_local_video import LOCAL_MODEL, LocalVideo, LocalVideoFailure, LocalVideoPaused

_tasks = {}
_local_runs = {}
TABLE_CONCURRENCY = 32
_queue = asyncio.Semaphore(TABLE_CONCURRENCY)
_local_queue = asyncio.Semaphore(1)
_executions = {}
_submissions = asyncio.Lock()


def paths():
    root = Path(folder_paths.get_user_directory()) / 'daelab/libtv/table-jobs'
    root.mkdir(parents=True, exist_ok=True)
    return root, Path(folder_paths.get_output_directory())


def bridge(kind, model=None):
    if model == LOCAL_MODEL:
        if kind != 'video':
            raise ValueError('本地 H3 仅用于视频生成')
        return LocalVideo()
    root, output = paths()
    return ColumnBridge(root / 'bridge', output / 'daelab/libtv/table', kind)


def receipt_path(request_id):
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
        raise ValueError('Invalid request ID')
    return paths()[0] / (request_id + '.json')


def public(state):
    control = _local_runs.get(state['requestId'])
    if state.get('phase') == 'running' and control and control.pause_requested.is_set():
        state = dict(state, phase='pausing')
    # Older receipts stored a terminal CLI failure as needs_recovery. Correct
    # the public status without starting a worker or touching paid task identity.
    failure = generation_failure_reason(state.get('error', ''))
    if state.get('phase') == 'needs_recovery' and failure:
        state = dict(state, phase='failed', error='平台生成失败：' + failure)
    return {k: state[k] for k in ('requestId', 'phase', 'error', 'result', 'stage', 'progress',
                                  'taskId', 'detail', 'updatedAt') if k in state}


STAGE_NAMES = {'preparing': '准备任务', 'submitting': '提交平台', 'generating': '平台生成',
               'writing_back': '等待写回', 'verifying': '核对原任务', 'downloading': '下载结果'}


def interrupted(state):
    """Why a live-looking receipt has no worker, without implying a new submission."""
    stage, progress = state.get('stage'), state.get('progress')
    if stage == 'generating':
        where = f'平台生成 {progress}% 时' if isinstance(progress, int) else '平台生成时'
    elif stage in STAGE_NAMES:
        where = STAGE_NAMES[stage] + '时'
    else:
        where = ''
    return f'{where}任务已中断（服务重启或连接断开）；恢复原任务只查询，不重复提交'


def diagnose(error, record):
    """Final message for a failed execution, based on the persisted remote state."""
    message = '网络中断，自动恢复已超时；请恢复原任务' if is_network_error(error) else str(error).splitlines()[0][:240]
    reason = generation_failure_reason(error)
    failed = bool(reason)
    if record.exists():
        original = json.loads(record.read_text('utf-8'))
        remote = original.get('remote', {})
        task = remote.get('data', {}).get('taskInfo', {})
        if is_network_error(error) and original.get('phase') in ('preparing', 'prepared', 'prepare_uncertain'):
            message = '准备任务时网络中断，尚未启用生成；请恢复原任务'
        elif original.get('phase') == 'generated' and remote.get('data', {}).get('url'):
            message = '生成结果地址已保存；请恢复原任务继续写回或下载，不会重新生成'
        elif (original.get('sync_failed') or task.get('status') == 2) and not remote.get('data', {}).get('url'):
            code = next((t.upper() for t in ('econnreset', 'etimedout', 'eai_again', 'fetch failed')
                         if t in str(original.get('error', '')).lower()), '')
            message = ('平台已生成，但 CLI 写回 LibTV 画布失败' + (f'（{code}）' if code else '')
                       + '，结果地址未保存；已禁止自动重跑。请在 LibTV 画布确认该节点，或明确重新生成')
        elif original.get('phase') == 'submitted_or_uncertain' and 'Original task has no video yet' in str(error):
            if task.get('taskId') or remote.get('taskId'):
                message = (f"平台进度停在 {task.get('progressPercent', 0)}%，CLI 已退出无法继续跟踪；"
                           '恢复原任务只查询，不重复提交')
            else:
                message = '平台未登记该节点的生成任务；已禁止自动重跑，请确认后明确重新生成'
        reason = task.get('failedReason') or original.get('platform_failure') or reason
        if reason:
            failed = True
            message = '平台生成失败：' + str(reason)[:200]
    return message, failed


def check_result(state):
    """Completed receipts must still point to an available local result."""
    if state.get('phase') != 'complete':
        return state
    query = parse_qs(urlsplit(state.get('result', {}).get('url', '')).query)
    root = paths()[1].resolve()
    file = (root / query.get('subfolder', [''])[0] / query.get('filename', [''])[0]).resolve()
    if (query.get('type') != ['output'] or not file.is_relative_to(root)
            or not file.is_file()
            or state.get('resultHash') and digest_file(file) != state['resultHash']):
        if state['input']['config']['model'] == LOCAL_MODEL:
            return dict(state, phase='failed', error='本地视频缺失或已变化，请重新生成')
        return dict(state, phase='needs_recovery', error='本地结果缺失或已变化，请恢复任务重新下载')
    return state


def prepare(item):
    request_id, data = item['requestId'], item['input']
    path = receipt_path(request_id)
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    if path.exists():
        state = json.loads(path.read_text('utf-8'))
        if state['fingerprint'] != fingerprint:
            raise ValueError('任务输入已变化；请恢复原输入，或明确重新生成')
        return reuse_completed_input(check_result(state))
    # Workflow undo can remove a browser receipt. Reuse the last identical input
    # unless the user explicitly requested replacement of an existing result.
    lookup = paths()[0] / ('input-' + fingerprint + '.json')
    if lookup.exists() and not item.get('forceNew', False):
        original_id = json.loads(lookup.read_text('utf-8'))['requestId']
        original = json.loads(receipt_path(original_id).read_text('utf-8'))
        if original['fingerprint'] != fingerprint:
            raise ValueError('任务索引与快照不一致，已阻止重新提交')
        state = dict(original, requestId=request_id,
                     executionId=original.get('executionId', original_id))
        atomic_json(path, state)
        return check_result(state)
    cfg = data['config']
    transport = bridge(cfg['kind'], cfg['model'])
    if cfg['model'] != LOCAL_MODEL and not data.get('project', '').strip():
        raise ValueError('请选择 LibTV 目标画布')
    assets = data.get('assets', [])
    if len(assets) > 32:
        raise ValueError('Too many reference assets')
    media = [local_media(a['url']) for a in assets]
    for m in media:
        m['sha256'] = digest_file(m['path'])
    prompt = compile_segments(data['segments'], media)
    caps = transport.capabilities(cfg['model'])
    transport.validate_request(caps['schema'], cfg.get('mode', ''), prompt, cfg.get('settings', {}), media)
    media = freeze_media(transport, data['project'], request_id, media)
    state = dict(requestId=request_id, fingerprint=fingerprint, input=data, media=media, phase='waiting')
    atomic_json(path, state)
    atomic_json(lookup, {'requestId': request_id})
    return state


def reuse_completed_input(state):
    """Explicit recovery from an older workflow may reuse a newer identical result.

    Never replace a completed result or redirect a live paid execution. Preserve
    the browser request ID and record which execution actually owns the file.
    """
    if state.get('phase') not in ('needs_recovery', 'stopped', 'failed', 'needs_input'):
        return state
    lookup = paths()[0] / ('input-' + state['fingerprint'] + '.json')
    if not lookup.exists():
        return state
    latest_id = json.loads(lookup.read_text('utf-8')).get('requestId')
    if not latest_id or latest_id == state['requestId']:
        return state
    latest_path = receipt_path(latest_id)
    if not latest_path.exists():
        return state
    latest = check_result(json.loads(latest_path.read_text('utf-8')))
    if latest.get('fingerprint') != state['fingerprint'] or latest.get('phase') != 'complete':
        return state
    recovered = dict(latest, requestId=state['requestId'],
                     executionId=latest.get('executionId', latest_id))
    atomic_json(receipt_path(state['requestId']), recovered)
    return recovered


def execute(state):
    data, request_id = state['input'], state['requestId']
    cfg = data['config']
    lock = threading.Lock()

    def mark(stage=None, **info):
        # Called from the worker, CLI stderr and progress-watcher threads.
        with lock:
            now = int(time.time() * 1000)
            timeline = state.setdefault('timeline', [])
            if stage and stage != state.get('stage'):
                timeline.append(dict(stage=stage, at=now))
            if stage:
                state['stage'] = stage
            progress = info.get('progress')
            if isinstance(progress, (int, float)) and int(progress) != state.get('progress'):
                state['progress'] = int(progress)
                timeline.append(dict(stage=state.get('stage'), at=now, progress=int(progress),
                                     source=info.get('source')))
            state['timeline'] = timeline[-60:]
            if info.get('taskId'):
                state['taskId'] = info['taskId']
            if info.get('detail'):
                state['detail'] = info['detail']
            elif 'detail' in info:
                state.pop('detail', None)
            state['updatedAt'] = now
            atomic_json(receipt_path(request_id), state)
    try:
        state['phase'] = 'running'
        for transient in ('error', 'detail', 'progress'):
            state.pop(transient, None)
        atomic_json(receipt_path(request_id), state)
        transport = _local_runs[request_id] if cfg['model'] == LOCAL_MODEL else bridge(cfg['kind'], cfg['model'])
        transport.report = lambda stage, **info: mark(stage, detail=None, **info)
        execution_id = state.get('executionId', request_id)
        key = hashlib.sha256((data['project'] + '\n' + execution_id).encode()).hexdigest()[:24]
        record = transport.cache / (key + '.json')
        def progress(message):
            state['phase'] = 'running'
            mark(detail=message)
        def generate_original():
            saved = json.loads(receipt_path(request_id).read_text('utf-8'))
            if saved.get('phase') == 'stopped':
                raise RuntimeError('任务已停止自动恢复，请恢复原任务')
            return transport.generate(
            data['project'], execution_id, cfg['model'], cfg.get('mode', ''),
            compile_segments(data['segments'], state['media']), cfg.get('settings', {}), state['media'])
        result = generate_original() if cfg['model'] == LOCAL_MODEL else recover_generation(generate_original, record, progress)
        transport.report = None
        file = Path(result['file'])
        subfolder = file.parent.relative_to(paths()[1]).as_posix()
        with lock:
            for transient in ('error', 'errorDetail', 'detail'):
                state.pop(transient, None)
            state.update(phase='complete', resultHash=digest_file(file), result=dict(kind=cfg['kind'], name=file.name,
                url='/view?' + urlencode(dict(filename=file.name, subfolder=subfolder, type='output'))))
            state.setdefault('timeline', []).append(dict(stage='complete', at=int(time.time() * 1000)))
    except LocalVideoPaused:
        with lock:
            for transient in ('error', 'errorDetail', 'detail', 'progress'):
                state.pop(transient, None)
            state['phase'] = 'paused'
    except Exception as error:
        execution_id = state.get('executionId', request_id)
        key = hashlib.sha256((data['project'] + '\n' + execution_id).encode()).hexdigest()[:24]
        if cfg['model'] == LOCAL_MODEL:
            message, failed = str(error).splitlines()[0][:500], isinstance(error, (LocalVideoFailure, ValueError))
        else:
            message, failed = diagnose(error, bridge(cfg['kind']).cache / (key + '.json'))
        with lock:
            state.pop('detail', None)
            state.update(phase='failed' if failed else 'needs_recovery', errorDetail=str(error)[-2000:], error=message)
    with lock:
        saved = json.loads(receipt_path(request_id).read_text('utf-8'))
        if saved.get('phase') == 'stopped':
            state['phase'] = 'stopped'
        state['updatedAt'] = int(time.time() * 1000)
        atomic_json(receipt_path(request_id), state)
    return state['phase'] == 'complete'


async def run_batch(states):
    async def run_one(state):
        # Restored browser receipts may share the same paid execution identity.
        key = (state['input']['project'], state.get('executionId', state['requestId']))
        entry = _executions.setdefault(key, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            budget = _local_queue if state['input']['config']['model'] == LOCAL_MODEL else _queue
            async with entry[0], budget:
                saved = json.loads(receipt_path(state['requestId']).read_text('utf-8'))
                if saved['phase'] in ('stopped', 'paused'):
                    return
                # Register local control before handing execution to the worker.
                if state['input']['config']['model'] == LOCAL_MODEL:
                    _local_runs[state['requestId']] = LocalVideo()
                state['phase'] = 'running'
                atomic_json(receipt_path(state['requestId']), state)
                await asyncio.to_thread(execute, state)
        except Exception as error:
            # A worker failure must not leave a live-looking receipt forever.
            saved = json.loads(receipt_path(state['requestId']).read_text('utf-8'))
            if saved.get('phase') not in ('complete', 'stopped', 'paused'):
                saved.update(phase='needs_recovery', error=str(error).splitlines()[0][:240])
                atomic_json(receipt_path(state['requestId']), saved)
        finally:
            entry[1] -= 1
            if not entry[1]:
                _executions.pop(key, None)
            _tasks.pop(state['requestId'], None)
            _local_runs.pop(state['requestId'], None)
    await asyncio.gather(*(run_one(state) for state in states))


async def submit(items):
    async with _submissions:
        states = [await asyncio.to_thread(prepare, item) for item in items]
        finishing = [_tasks[s['requestId']] for s in states if s['phase'] == 'paused' and s['requestId'] in _tasks]
        if finishing:
            await asyncio.gather(*finishing, return_exceptions=True)
        pending = [s for s in states if s['phase'] != 'complete' and s['requestId'] not in _tasks]
        if pending:
            now = int(time.time() * 1000)
            for state in pending:
                state['phase'] = 'waiting'
                state.pop('error', None)
                state['updatedAt'] = now
                state.setdefault('timeline', []).append(dict(stage='queued', at=now))
                atomic_json(receipt_path(state['requestId']), state)
            for state in pending:
                _tasks[state['requestId']] = asyncio.create_task(run_batch([state]))
        return {'jobs': [public(s) for s in states]}


async def pause_jobs(ids):
    async with _submissions:
        cancelled = []
        cloud_running = False
        for request_id in ids:
            path = receipt_path(request_id)
            if not path.exists():
                continue
            state = json.loads(path.read_text('utf-8'))
            if state['phase'] == 'waiting':
                state.update(phase='paused', updatedAt=int(time.time() * 1000))
                atomic_json(path, state)
                task = _tasks.get(request_id)
                if task:
                    task.cancel()
                    cancelled.append((request_id, task))
            elif state['phase'] == 'running':
                control = _local_runs.get(request_id)
                if control:
                    control.pause()
                elif request_id in _tasks:
                    cloud_running = True
        if cancelled:
            await asyncio.gather(*(task for _, task in cancelled), return_exceptions=True)
            for request_id, task in cancelled:
                if _tasks.get(request_id) is task:
                    _tasks.pop(request_id)
        return cloud_running


async def handle(request):
    if not local_request(request):
        return web.json_response({'error': '请通过本机 localhost 使用 LibTV'}, status=403)
    try:
        action = request.match_info['action']
        if action == 'capabilities' and request.method == 'GET':
            kind, model = request.query['kind'], request.query['model']
            transport = bridge(kind, model)
            if model != LOCAL_MODEL:
                transport.cli = CLI(timeout=25)
            result = await asyncio.to_thread(transport.capabilities, model)
        elif action in ('status', 'pause', 'stop') and request.method == 'POST':
            ids = (await request.json())['requestIds']
            if not isinstance(ids, list) or len(ids) > 500:
                raise ValueError('Invalid task list')
            result = {'jobs': []}
            for request_id in ids:
                receipt_path(request_id)
            if action == 'pause' and await pause_jobs(ids):
                result['notice'] = '已暂停等待中的任务；云端已提交的任务将继续完成'
            for request_id in ids:
                path = receipt_path(request_id)
                if path.exists():
                    state = json.loads(path.read_text('utf-8'))
                    if action == 'stop' and state['phase'] == 'waiting':
                        state['phase'] = 'stopped'
                        atomic_json(path, state)
                    state = await asyncio.to_thread(check_result, state)
                    if state['phase'] in ('running', 'waiting') and request_id not in _tasks:
                        state = await asyncio.to_thread(check_result, json.loads(path.read_text('utf-8')))
                        if state['phase'] in ('running', 'waiting') and request_id not in _tasks:
                            state = dict(state, phase='needs_recovery', error=interrupted(state))
                    result['jobs'].append(public(state))
                else:
                    result['jobs'].append(dict(requestId=request_id, phase='needs_recovery', error='任务尚未登记，请恢复提交'))
        elif action == 'submit' and request.method == 'POST':
            items = (await request.json())['jobs']
            if not isinstance(items, list) or not 1 <= len(items) <= 500:
                raise ValueError('请选择 1–500 行')
            if len({i['requestId'] for i in items}) != len(items):
                raise ValueError('Duplicate task IDs')
            # Preflight the entire batch before any remote write or paid command.
            result = await submit(items)
        else:
            return web.json_response({'error': 'Unknown action'}, status=404)
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except (ValueError, KeyError, TypeError, RuntimeError) as error:
        return web.json_response({'error': str(error)[-1500:], **({'submitted': False} if action == 'submit' else {})}, status=400)


PromptServer.instance.routes.get('/daelab/libtv/table/{action}')(handle)
PromptServer.instance.routes.post('/daelab/libtv/table/{action}')(handle)
