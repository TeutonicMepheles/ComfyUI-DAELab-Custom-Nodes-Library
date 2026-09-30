"""Local, asynchronous table jobs. Browser disconnection does not repeat paid runs."""
import asyncio
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlencode, urlsplit, parse_qs
from aiohttp import web
import folder_paths
from server import PromptServer
from .connection_api import local_request
from .node import local_media
from .runtime import atomic_json, digest_file, CLI
from .recovery import recover_generation, is_network_error
from .media_snapshot import freeze_media
from .table_generation import ColumnBridge, compile_segments

_tasks = {}
TABLE_CONCURRENCY = 32
_queue = asyncio.Semaphore(TABLE_CONCURRENCY)
_executions = {}
_submissions = asyncio.Lock()


def paths():
    root = Path(folder_paths.get_user_directory()) / 'daelab/libtv/table-jobs'
    root.mkdir(parents=True, exist_ok=True)
    return root, Path(folder_paths.get_output_directory())


def bridge(kind):
    root, output = paths()
    return ColumnBridge(root / 'bridge', output / 'daelab/libtv/table', kind)


def receipt_path(request_id):
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
        raise ValueError('Invalid request ID')
    return paths()[0] / (request_id + '.json')


def public(state):
    return {k: state[k] for k in ('requestId', 'phase', 'error', 'result') if k in state}


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
        return check_result(state)
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
    transport = bridge(cfg['kind'])
    if not data.get('project', '').strip():
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


def execute(state):
    data, request_id = state['input'], state['requestId']
    cfg = data['config']
    try:
        state['phase'] = 'running'
        state.pop('error', None)
        atomic_json(receipt_path(request_id), state)
        transport = bridge(cfg['kind'])
        execution_id = state.get('executionId', request_id)
        key = hashlib.sha256((data['project'] + '\n' + execution_id).encode()).hexdigest()[:24]
        record = transport.cache / (key + '.json')
        def progress(message):
            state.update(phase='running', error=message)
            atomic_json(receipt_path(request_id), state)
        def generate_original():
            saved = json.loads(receipt_path(request_id).read_text('utf-8'))
            if saved.get('phase') == 'stopped':
                raise RuntimeError('任务已停止自动恢复，请恢复原任务')
            return transport.generate(
            data['project'], execution_id, cfg['model'], cfg.get('mode', ''),
            compile_segments(data['segments'], state['media']), cfg.get('settings', {}), state['media'])
        result = recover_generation(generate_original, record, progress)
        state.pop('error', None)
        state.pop('errorDetail', None)
        file = Path(result['file'])
        subfolder = file.parent.relative_to(paths()[1]).as_posix()
        state.update(phase='complete', resultHash=digest_file(file), result=dict(kind=cfg['kind'], name=file.name,
            url='/view?' + urlencode(dict(filename=file.name, subfolder=subfolder, type='output'))))
    except Exception as error:
        state.update(phase='needs_recovery', errorDetail=str(error),
                     error='网络中断，自动恢复已超时；请恢复原任务' if is_network_error(error) else str(error).splitlines()[0][:240])
        execution_id = state.get('executionId', request_id)
        key = hashlib.sha256((data['project'] + '\n' + execution_id).encode()).hexdigest()[:24]
        record = bridge(cfg['kind']).cache / (key + '.json')
        if record.exists():
            remote = json.loads(record.read_text('utf-8')).get('remote', {})
            if remote.get('data', {}).get('taskInfo', {}).get('failedReason'):
                state['phase'] = 'failed'
    saved = json.loads(receipt_path(request_id).read_text('utf-8'))
    if saved.get('phase') == 'stopped':
        state['phase'] = 'stopped'
    atomic_json(receipt_path(request_id), state)
    return state['phase'] == 'complete'


async def run_batch(states):
    async def run_one(state):
        # Restored browser receipts may share the same paid execution identity.
        key = (state['input']['project'], state.get('executionId', state['requestId']))
        entry = _executions.setdefault(key, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0], _queue:
                saved = json.loads(receipt_path(state['requestId']).read_text('utf-8'))
                if saved['phase'] == 'stopped':
                    return
                # No await between the stop check and marking the job running.
                state['phase'] = 'running'
                atomic_json(receipt_path(state['requestId']), state)
                await asyncio.to_thread(execute, state)
        finally:
            entry[1] -= 1
            if not entry[1]:
                _executions.pop(key, None)
            _tasks.pop(state['requestId'], None)
    await asyncio.gather(*(run_one(state) for state in states))


async def submit(items):
    async with _submissions:
        states = [await asyncio.to_thread(prepare, item) for item in items]
        pending = [s for s in states if s['phase'] != 'complete' and s['requestId'] not in _tasks]
        if pending:
            for state in pending:
                state['phase'] = 'waiting'
                state.pop('error', None)
                atomic_json(receipt_path(state['requestId']), state)
            task = asyncio.create_task(run_batch(pending))
            for state in pending:
                _tasks[state['requestId']] = task
        return {'jobs': [public(s) for s in states]}


async def handle(request):
    if not local_request(request):
        return web.json_response({'error': '请通过本机 localhost 使用 LibTV'}, status=403)
    try:
        action = request.match_info['action']
        if action == 'capabilities' and request.method == 'GET':
            kind, model = request.query['kind'], request.query['model']
            transport = bridge(kind)
            transport.cli = CLI(timeout=25)
            result = await asyncio.to_thread(transport.capabilities, model)
        elif action in ('status', 'stop') and request.method == 'POST':
            ids = (await request.json())['requestIds']
            if not isinstance(ids, list) or len(ids) > 500:
                raise ValueError('Invalid task list')
            result = {'jobs': []}
            for request_id in ids:
                path = receipt_path(request_id)
                if path.exists():
                    state = json.loads(path.read_text('utf-8'))
                    if action == 'stop' and state['phase'] == 'waiting':
                        state['phase'] = 'stopped'
                        atomic_json(path, state)
                    state = await asyncio.to_thread(check_result, state)
                    if state['phase'] in ('running', 'waiting') and request_id not in _tasks:
                        state = dict(state, phase='needs_recovery', error='任务已暂停，请恢复原任务')
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
