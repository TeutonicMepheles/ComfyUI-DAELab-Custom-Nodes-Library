"""Native Comfy Partner transport with separated create/query and no POST retry."""
import json
import re
from types import SimpleNamespace


class TransportError(Exception):
    def __init__(self, message, *, definitely_rejected=False):
        super().__init__(message)
        self.definitely_rejected = definitely_rejected


def native_capabilities():
    try:
        import nodes
        from comfy_api_nodes.nodes_openai import SupportedOpenAIModel
        from comfy_api_nodes.apis.openai import OpenAICreateResponse, InputMessage, InputTextContent
        from comfy_api_nodes.util import request_logger
        registered = 'OpenAIChatNode' in nodes.NODE_CLASS_MAPPINGS
        fields = OpenAICreateResponse.model_fields
        redacted = request_logger._redact_headers({'Authorization': 'probe', 'X-API-KEY': 'probe'})
        developer = InputMessage(role='developer', content=[InputTextContent(text='capability-probe')])
        if not registered or not {'max_output_tokens', 'input'} <= fields.keys() or 'probe' in redacted.values():
            return []
        if developer.model_dump(exclude_none=True).get('role') != 'developer':
            return []
        return [v.value for v in SupportedOpenAIModel]
    except (ImportError, AttributeError, TypeError, ValueError):
        return []


def native_request(snapshot, instructions):
    from comfy_api_nodes.apis.openai import OpenAICreateResponse, InputMessage, InputTextContent
    return OpenAICreateResponse(model=snapshot['model'],
        input=[InputMessage(role='developer', content=[InputTextContent(text=instructions)]),
               InputMessage(role='user', content=[InputTextContent(text=snapshot['inputText'])])],
        max_output_tokens=snapshot['maxOutputTokens'], store=True, stream=False,
        previous_response_id=None, truncation='disabled')


def native_context(auth):
    from comfy_api_nodes.util._helpers import get_auth_header
    hidden = SimpleNamespace(auth_token_comfy_org=auth.get('token'), api_key_comfy_org=auth.get('key'),
                             unique_id='daelab-prompt-optimization', comfy_usage_source='comfyui-api')
    # Native credit memory is a WeakKeyDictionary keyed by execution class.
    context = type('PromptOptimizationExecution', (), {'hidden': hidden})
    if not get_auth_header(context):
        raise TransportError('请登录 ComfyUI 账号后继续', definitely_rejected=True)
    return context


class NativeTransport:
    async def _request(self, method, auth, *, payload=None, remote_id=None):
        from comfy_api_nodes.nodes_openai import RESPONSES_ENDPOINT
        from comfy_api_nodes.util.client import ApiEndpoint, sync_op_raw
        from comfy_api_nodes.util import request_logger
        redacted = request_logger._redact_headers({'Authorization': 'probe', 'X-API-KEY': 'probe'})
        if 'probe' in redacted.values():
            raise TransportError('当前原生传输不支持凭据日志脱敏，请更新 ComfyUI', definitely_rejected=True)
        context = native_context(auth)
        endpoint = RESPONSES_ENDPOINT
        if remote_id is not None:
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote_id):
                raise TransportError('远端任务 ID 无效', definitely_rejected=True)
            endpoint += '/' + remote_id
        captured = {}
        try:
            raw = await sync_op_raw(context, ApiEndpoint(path=endpoint, method=method), data=payload,
                as_binary=True, max_retries=0 if method == 'POST' else 2, max_retries_on_rate_limit=0,
                timeout=120, monitor_progress=False, final_label_on_success=None,
                response_header_validator=captured.update)
            data = json.loads(raw)
            return data, {'source': 'Comfy Partner X-Comfy-Credits-Used', 'remoteResponseId': data.get('id'),
                'method': method, 'creditsHeader': captured.get('x-comfy-credits-used'),
                'requestId': captured.get('x-request-id')}
        except TransportError:
            raise
        except Exception as error:
            # Native errors may contain arbitrary server text: expose only known
            # safe authentication/payment labels, never provider bodies or URLs.
            message = str(error)
            labels = {'Unauthorized:': '登录已过期，请重新登录', 'Payment Required:': 'ComfyUI 积分不足',
                      'Rate Limit Exceeded:': '请求过于频繁，请稍后显式重试',
                      'Too Many Requests:': '请求过于频繁，请稍后显式重试'}
            for prefix, label in labels.items():
                if message.startswith(prefix):
                    raise TransportError(label, definitely_rejected=True) from None
            raise TransportError('连接中断或原生服务失败；已有远端 ID 时仅查询，无 ID 时提交结果未知') from None

    async def create(self, snapshot, instructions, auth):
        return await self._request('POST', auth, payload=native_request(snapshot, instructions))

    async def query(self, remote_id, auth):
        return await self._request('GET', auth, remote_id=remote_id)
