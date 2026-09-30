"""Read-only local prompt endpoint shared by generic tables and storyboards."""
import asyncio
import json
from aiohttp import web
from server import PromptServer
from .prompt_service import parse_request


@PromptServer.instance.routes.post('/daelab/storyboard/parse-prompts')
async def parse_prompts(request):
    from ..libtv_bridge.node import local_media
    try:
        body = bytearray()
        async for chunk in request.content.iter_chunked(65536):
            body.extend(chunk)
            if len(body) > 8 * 1024 * 1024:
                raise ValueError('解析请求超过 8 MB')
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError('需要 JSON 对象')
        result = await asyncio.to_thread(parse_request, payload, local_media)
        return web.json_response(result)
    except (ValueError, TypeError, KeyError) as exc:
        return web.json_response({'error': str(exc)}, status=400)
