"""Stateless official DeepSeek transport. Never logs keys, bodies or exceptions."""
import os
import asyncio
import re
from pathlib import Path
import aiohttp
from .pricing import DEEPSEEK_RATES
from .transport import TransportError

ENDPOINT = 'https://api.deepseek.com/chat/completions'
USAGE_KEYS = ('prompt_tokens', 'completion_tokens', 'total_tokens',
              'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens')
_request_lock = asyncio.Lock()


ENV_FILE = Path(__file__).resolve().parents[2] / '.env'


def configured_key():
    """Read only this provider's key; process environment takes precedence.

    No interpolation, shell execution, logging, or global environment mutation.
    Read on demand so local key changes do not require another restart.
    """
    if 'DEEPSEEK_API_KEY' in os.environ:
        return os.environ['DEEPSEEK_API_KEY']
    try:
        if ENV_FILE.stat().st_size > 65536:
            return ''
        lines = ENV_FILE.read_text(encoding='utf-8-sig').splitlines()
    except (OSError, UnicodeError):
        return ''
    for line in lines:
        name, sep, value = line.strip().partition('=')
        if sep and name.strip() == 'DEEPSEEK_API_KEY':
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                return value[1:-1]
            return value.split(' #', 1)[0].strip()
    return ''


def key_configured():
    return bool(configured_key().strip())


def resolve_key(auth):
    key = (auth or {}).get('deepseekKey') or configured_key()
    if not isinstance(key, str) or not key.strip():
        raise ValueError('请在侧栏填写 DeepSeek API Key，或配置服务器 DEEPSEEK_API_KEY')
    key = key.strip()
    if len(key) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError('DeepSeek API Key 格式无效')
    return key


def safe_usage(value):
    if not isinstance(value, dict):
        return {}
    return {k: value[k] for k in USAGE_KEYS if type(value.get(k)) is int and 0 <= value[k] <= 10**9}


def request_body(snapshot, instructions):
    if snapshot['model'] not in DEEPSEEK_RATES:
        raise ValueError('DeepSeek 模型不受支持')
    content = snapshot['inputText']
    if snapshot.get('imageDataUrl'):
        content = [{'type': 'text', 'text': content},
                   {'type': 'image_url', 'image_url': {'url': snapshot['imageDataUrl']}}]
    return dict(model=snapshot['model'], messages=[{'role': 'system', 'content': instructions},
        {'role': 'user', 'content': content}], thinking={'type': 'disabled'},
        max_tokens=snapshot['maxOutputTokens'], stream=False)


def normalize_response(body):
    if not isinstance(body, dict):
        raise TransportError('DeepSeek 响应格式无效；提交结果未知，禁止自动重发')
    remote = body.get('id')
    if not isinstance(remote, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote):
        raise TransportError('DeepSeek 未返回有效任务 ID；提交结果未知，禁止自动重发')
    choices = body.get('choices')
    choice = choices[0] if isinstance(choices, list) and len(choices) == 1 and isinstance(choices[0], dict) else {}
    message = choice.get('message') if isinstance(choice.get('message'), dict) else {}
    text = message.get('content')
    complete = choice.get('finish_reason') == 'stop' and isinstance(text, str) and not message.get('tool_calls') and not message.get('refusal')
    return dict(id=remote, status='completed' if complete else 'incomplete', usage=safe_usage(body.get('usage')),
        output=[{'type': 'message', 'content': [{'type': 'output_text', 'text': text if isinstance(text, str) else ''}]}])


class DeepSeekTransport:
    async def create(self, snapshot, instructions, auth):
        async with _request_lock:
            return await self._create(snapshot, instructions, auth)

    async def _create(self, snapshot, instructions, auth):
        key = resolve_key(auth)
        payload = request_body(snapshot, instructions)
        try:
            # Fresh session, default verified TLS. No redirect or POST retry loop.
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120), trust_env=False) as session:
                async with session.post(ENDPOINT, headers={'Authorization': 'Bearer ' + key},
                        json=payload, allow_redirects=False) as response:
                    labels = {400: 'DeepSeek 请求参数不被支持，请检查所选模型',
                        401: 'DeepSeek API Key 无效或已过期', 402: 'DeepSeek 账户余额不足',
                        403: 'DeepSeek 账户无权使用此模型', 404: 'DeepSeek 模型不可用，请重新选择',
                        422: 'DeepSeek 请求参数无法处理', 429: 'DeepSeek 请求过于频繁，请稍后显式重试'}
                    if response.status in labels:
                        raise TransportError(labels[response.status], definitely_rejected=True)
                    if response.status != 200:
                        raise TransportError('DeepSeek 服务响应异常；提交结果未知，禁止自动重发')
                    body = await response.json()
            result = normalize_response(body)
            return result, {'source': 'DeepSeek usage; peak no-cache estimate, not actual bill',
                'provider': 'deepseek', 'currency': 'USD', 'method': 'POST', 'remoteResponseId': result['id']}
        except TransportError:
            raise
        except Exception as error:
            # Never expose HTTP bodies, exception URLs/headers, or the supplied key.
            category = ('超时' if isinstance(error, (asyncio.TimeoutError, TimeoutError)) else
                        'TLS 校验失败' if isinstance(error, aiohttp.ClientConnectorCertificateError) else
                        '响应类型不符' if isinstance(error, aiohttp.ContentTypeError) else
                        '网络连接错误' if isinstance(error, aiohttp.ClientError) else '响应解析错误')
            raise TransportError(f'DeepSeek {category}；提交结果未知，可能已产生费用，禁止自动重发') from None
