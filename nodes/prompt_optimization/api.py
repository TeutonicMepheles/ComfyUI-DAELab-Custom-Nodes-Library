"""Local-only API. Credentials stay in transient request headers and workers."""
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web
from .service import Service

_service = None


def local_request(request):
    try:
        if not ipaddress.ip_address(request.remote).is_loopback:
            return False
        host = urlsplit('http://' + request.host).hostname
        origin = request.headers.get('Origin')
        return host in ('localhost', '127.0.0.1', '::1') and (not origin or urlsplit(origin).netloc == request.host) and request.headers.get('Sec-Fetch-Site') != 'cross-site'
    except (ValueError, TypeError):
        return False


async def handle(request):
    global _service
    if not local_request(request):
        return web.json_response({'contractVersion': 1, 'error': '请通过本机 localhost 使用提示词优化'}, status=403)
    if _service is None:
        import folder_paths
        _service = Service(Path(folder_paths.get_user_directory()) / 'daelab/prompt-optimization')
    action = request.match_info['action']
    allowed = {'capabilities', 'estimate', 'lease', 'submit', 'query', 'recover', 'permit', 'advance', 'stop', 'continue', 'skip'}
    if action not in allowed:
        return web.json_response({'contractVersion': 1, 'error': '未知操作'}, status=404)
    try:
        p = await request.json()
        if not isinstance(p, dict) or p.get('contractVersion') != 1:
            raise ValueError('契约版本不支持')
        auth = {'token': request.headers.get('Authorization', '').removeprefix('Bearer ').strip(),
                'key': request.headers.get('X-API-Key', '')}
        if action == 'advance':
            if not any(auth.values()):
                raise ValueError('请登录 ComfyUI 账号后开始优化')
            result = await _service.advance(p, auth)
        elif action in ('query', 'recover'):
            result = await _service.query(p, auth if any(auth.values()) else None)
        else:
            result = await getattr(_service, 'continue_batch' if action == 'continue' else action)(p)
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except ValueError as error:
        return web.json_response({'contractVersion': 1, 'error': str(error)}, status=409)
    except (KeyError, TypeError):
        return web.json_response({'contractVersion': 1, 'error': '请求字段不完整或格式无效'}, status=400)
    except Exception:
        return web.json_response({'contractVersion': 1, 'error': '服务暂不可用；已有任务可恢复查询，未自动重新提交'}, status=503)


def register_routes():
    from server import PromptServer
    if getattr(PromptServer, 'instance', None) is not None:
        PromptServer.instance.routes.post('/daelab/prompt-optimization/{action}')(handle)
