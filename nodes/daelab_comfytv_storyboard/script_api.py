"""DAELab-owned ScriptParser endpoints. No generation, no hidden AI requests."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile
from urllib.parse import urlencode

from aiohttp import web
import folder_paths
from server import PromptServer
from .script_document import MAX_DOCUMENT_SIZE, parse_docx, normalize_inventory
from .script_ai import read_config, classify


def cache_directory():
    directory = Path(folder_paths.get_temp_directory()) / 'DAELAB' / 'script-parser'
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(data)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_images(inventory, blobs):
    from PIL import Image, UnidentifiedImageError
    directory = Path(folder_paths.get_input_directory()) / 'DAELAB' / 'script-parser'
    for aid, asset in inventory['assets'].items():
        try:
            with Image.open(io.BytesIO(blobs[aid])) as image:
                if image.width * image.height > 40_000_000:
                    raise ValueError('图片超过 4000 万像素')
                image.load()
                output = io.BytesIO()
                image.save(output, format='PNG')
            name = aid + '.png'
            target = directory / name
            data = output.getvalue()
            if not target.is_file() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(data).digest():
                atomic_write(target, data)
            asset.update(url='/view?' + urlencode(dict(filename=name, subfolder='DAELAB/script-parser', type='input')),
                         filename=name, subfolder='DAELAB/script-parser', type='input', kind='image')
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            asset['error'] = f'图片无法准备：{type(exc).__name__}，请替换或明确排除此图片'
    return inventory


def import_document(payload, filename):
    inventory, blobs = parse_docx(payload, filename)
    prepare_images(inventory, blobs)
    path = cache_directory() / (inventory['document_id'] + '.json')
    atomic_write(path, json.dumps(inventory, ensure_ascii=False).encode('utf-8'))
    return inventory


def read_inventory(document_id):
    if not isinstance(document_id, str) or not re.fullmatch('[0-9a-f]{64}', document_id):
        raise ValueError('文档标识无效')
    path = cache_directory() / (document_id + '.json')
    if not path.is_file():
        raise ValueError('临时草稿已清理，请重新上传原件')
    return json.loads(path.read_text(encoding='utf-8'))


async def json_body(request):
    body = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        body.extend(chunk)
        if len(body) > 8 * 1024 * 1024:
            raise ValueError('请求超过 8 MiB')
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError('需要 JSON 对象')
    return value


@PromptServer.instance.routes.post('/daelab/script-parser/document')
async def script_document(request):
    try:
        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != 'file' or not part.filename:
            raise ValueError('请选择 DOCX 文件')
        payload = bytearray()
        while chunk := await part.read_chunk(65536):
            payload.extend(chunk)
            if len(payload) > MAX_DOCUMENT_SIZE:
                raise ValueError('文档超过 20 MiB')
        result = await asyncio.to_thread(import_document, bytes(payload), Path(part.filename).name)
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, ParseError, BadZipFile) as exc:
        return web.json_response({'error': str(exc)}, status=400)


@PromptServer.instance.routes.post('/daelab/script-parser/normalize')
async def script_normalize(request):
    try:
        body = await json_body(request)
        inventory = body.get('inventory')
        if inventory is None:
            inventory = await asyncio.to_thread(read_inventory, body.get('document_id'))
        elif not isinstance(inventory, dict) or inventory.get('document_id') != body.get('document_id'):
            raise ValueError('保存的文档来源不匹配')
        result = await asyncio.to_thread(normalize_inventory, inventory, body.get('choices'))
        result['assets'] = inventory['assets']
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        return web.json_response({'error': str(exc)}, status=400)


def ai_config():
    return read_config(Path(folder_paths.get_user_directory()) / 'default' / 'DAELAB' / 'script-parser-ai.json')


@PromptServer.instance.routes.get('/daelab/script-parser/ai-status')
async def script_ai_status(request):
    try:
        config = ai_config()
        return web.json_response({'configured': config is not None, 'model': config['model'] if config else ''})
    except (ValueError, OSError, TypeError):
        return web.json_response({'configured': False, 'error': '服务端 AI 配置无效，可继续手工映射'})


@PromptServer.instance.routes.post('/daelab/script-parser/classify')
async def script_classify(request):
    try:
        body = await json_body(request)
        inventory = await asyncio.to_thread(read_inventory, body.get('document_id'))
        choices = body.get('choices')
        normalize_inventory(inventory, choices)  # Validate sources before transmission.
        result = await classify(inventory, choices, ai_config())
        return web.json_response({'choices': result})
    except (ValueError, TypeError, KeyError, OSError) as exc:
        return web.json_response({'error': str(exc)}, status=400)
