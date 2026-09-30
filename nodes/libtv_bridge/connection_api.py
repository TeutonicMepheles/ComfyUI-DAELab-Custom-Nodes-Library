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
    global _connection
    if not local_request(request):
        return web.json_response({'error': 'Open ComfyUI on this machine using localhost to manage LibTV connection.'}, status=403)
    if _connection is None:
        _connection = Connection(folder_paths.get_user_directory() + '/daelab/libtv/connection')
    action = request.match_info['action']
    try:
        if action == 'status' and request.method == 'GET':
            result = await asyncio.to_thread(_connection.status)
        elif action == 'login' and request.method == 'POST':
            result = await asyncio.to_thread(_connection.login)
        elif action == 'projects' and request.method == 'GET':
            page = int(request.query.get('page', '1'))
            if not 1 <= page <= 1000:
                raise ValueError()
            result = await asyncio.to_thread(_connection.projects, page)
        elif action == 'capabilities' and request.method == 'GET':
            result = await asyncio.to_thread(_connection.capabilities, request.query.get('model', ''))
        else:
            return web.json_response({'error': 'Unknown action'}, status=404)
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except Exception:
        return web.json_response({'error': 'LibTV connection request failed. Check local CLI installation, login and network; no generation was submitted.'}, status=400)


PromptServer.instance.routes.get('/daelab/libtv/connection/{action}')(handle)
PromptServer.instance.routes.post('/daelab/libtv/connection/{action}')(handle)
