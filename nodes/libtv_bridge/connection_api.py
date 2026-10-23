import asyncio
import ipaddress
from urllib.parse import urlparse

from aiohttp import web
import folder_paths
from server import PromptServer

from .connection import Connection

_connection = None


def local_request(request):
    try:
        peer = ipaddress.ip_address(request.remote)
        if not peer.is_loopback:
            return False
    except (ValueError, TypeError):
        return False
    host = urlparse('http://' + request.host).hostname
    if host not in ('localhost', '127.0.0.1', '::1'):
        return False
    origin = request.headers.get('Origin')
    return (not origin or urlparse(origin).netloc == request.host) and request.headers.get('Sec-Fetch-Site') != 'cross-site'


async def handle(request):
    return web.json_response({'error': 'LibTV 通道已停用，请在 ComfyUI 中登录并使用账户积分生成'}, status=410)


PromptServer.instance.routes.get('/daelab/libtv/connection/{action}')(handle)
PromptServer.instance.routes.post('/daelab/libtv/connection/{action}')(handle)
