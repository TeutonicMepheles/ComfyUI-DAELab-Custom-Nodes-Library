"""Local-only Ollama transport and a shared native-queue admission gate."""
import asyncio
from contextlib import asynccontextmanager
import base64
import io
import json
from pathlib import Path
import aiohttp
from aiohttp import web
from PIL import Image, ImageOps

MODEL = 'qwen3.5:9b-q4_K_M'
BASE = 'http://127.0.0.1:11434'
_server = None
_active = False
_quarantined = False


def lock_path():
    import folder_paths
    return Path(folder_paths.base_path) / 'user/local-qwen35-9b/gpu-admission.lock'


@asynccontextmanager
async def admission():
    """Cross-process, nonblocking admission for native submit and LLM inference."""
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open('a+b')
    if path.stat().st_size == 0:
        handle.write(b'0'); handle.flush()
    handle.seek(0)
    try:
        if __import__('os').name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise ValueError('本地模型正在使用显卡，请稍后重试（并发 1）') from None
    try:
        yield
    finally:
        handle.close()


async def request(path, payload=None, timeout=600):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout), trust_env=False) as session:
        async with session.request('GET' if payload is None else 'POST', BASE + path, json=payload) as response:
            if response.status != 200:
                raise ValueError('本地 Qwen 服务请求失败，请检查模型部署；未自动重试')
            return await response.json()


async def ensure_unloaded():
    global _quarantined
    try:
        await request('/api/generate', {'model': MODEL, 'keep_alive': 0}, timeout=60)
        for _ in range(60):
            if not (await request('/api/ps', timeout=5)).get('models'):
                _quarantined = False
                lock_path().with_suffix('.quarantine').unlink(missing_ok=True)
                return
            await asyncio.sleep(1)
    except Exception:
        pass
    _quarantined = True
    lock_path().with_suffix('.quarantine').touch()
    raise ValueError('无法确认本地模型已卸载，生图提交已暂时锁定；请恢复 Ollama 服务后重试')


@web.middleware
async def gpu_middleware(req, handler):
    global _quarantined
    if req.method != 'POST' or req.path not in ('/prompt', '/api/prompt'):
        return await handler(req)
    try:
        async with admission():
            if _quarantined or lock_path().with_suffix('.quarantine').exists():
                await ensure_unloaded()
            return await handler(req)
    except ValueError as error:
        return web.json_response({'error': {'type': 'local_llm_busy', 'message': str(error)}, 'node_errors': {}}, status=409)


def image_payload(data_url):
    with Image.open(io.BytesIO(base64.b64decode(data_url.split(',', 1)[1]))) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((1024, 1024))
        output = io.BytesIO(); image.save(output, format='JPEG', quality=90)
    return base64.b64encode(output.getvalue()).decode()


async def _generate(text, instructions, image):
    global _active
    async with admission():
        if _quarantined or lock_path().with_suffix('.quarantine').exists():
            await ensure_unloaded()
        if _server is None:
            raise ValueError('本地 Qwen 调度器尚未初始化')
        running, pending = _server.prompt_queue.get_current_queue()
        if running or pending:
            raise ValueError('分镜或其他生图任务正在运行，请完成后再使用本地 Qwen；未提交模型请求')
        # Other ComfyUI instances must also respect the production queue.
        if getattr(_server, 'port', 8000) != 8000:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5), trust_env=False) as session:
                async with session.get('http://127.0.0.1:8000/queue') as response:
                    queue = await response.json()
                    if queue['queue_running'] or queue['queue_pending']:
                        raise ValueError('主服务正在生图，请完成后重试')
        _active = True
        lock_path().with_suffix('.quarantine').touch()
        try:
            import comfy.model_management as mm
            mm.unload_all_models(); mm.soft_empty_cache()
            body = {'model': MODEL, 'system': instructions, 'prompt': text,
                    'stream': False, 'think': False, 'keep_alive': 0,
                    'options': {'num_ctx': 8192, 'num_predict': 768, 'temperature': 0.4}}
            if image:
                body['images'] = [image_payload(image)]
            try:
                result = await request('/api/generate', body)
            except (aiohttp.ClientError, asyncio.TimeoutError):
                raise ValueError('本地 Qwen 连接失败或超时，结果未知；未自动重试') from None
            output = result.get('response', '')
            if not result.get('done') or result.get('done_reason') != 'stop' or not output.strip():
                raise ValueError('本地 Qwen 结果未完整生成，未应用；请显式重新生成')
            return {'result': output, 'model': MODEL, 'provider': 'qwen',
                    'usage': {key: result.get(key) for key in ('prompt_eval_count', 'eval_count', 'total_duration')}}
        finally:
            try:
                await ensure_unloaded()
            finally:
                _active = False


async def generate(text, instructions, image=''):
    # A disconnected browser cannot release GPU admission while inference is alive.
    task = asyncio.create_task(_generate(text, instructions, image))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        finally:
            raise


def install(server):
    global _server
    _server = server
    if gpu_middleware not in server.app.middlewares:
        server.app.middlewares.append(gpu_middleware)
