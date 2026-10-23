"""Batch adapter for the same guarded local model used by the LLM node."""
import uuid
from . import local_qwen
from .transport import TransportError
from .pricing import MODEL_LIMITS, QWEN_MODEL


class QwenTransport:
    async def available(self):
        try:
            tags = await local_qwen.request('/api/tags', timeout=3)
            if any(m.get('name') == local_qwen.MODEL for m in tags.get('models', [])):
                return True, ''
            return False, '本地 Qwen 模型尚未安装，请检查 Ollama 模型部署'
        except Exception:
            return False, '无法连接本地 Qwen，请启动 Ollama 服务后重试'

    async def create(self, snapshot, instructions, auth):
        # Credentials never enter this local transport. Admission, queue checks,
        # disconnect shielding and GPU unloading are shared with the LLM node.
        try:
            result = await local_qwen.generate(snapshot['inputText'], instructions,
                context_tokens=MODEL_LIMITS[QWEN_MODEL]['contextTokens'], max_output_tokens=snapshot['maxOutputTokens'])
        except ValueError as error:
            raise TransportError(str(error), definitely_rejected=True) from None
        usage = result.get('usage', {})
        identifier = 'qwen_' + uuid.uuid4().hex
        return {
            'id': identifier, 'status': 'completed',
            'usage': {'prompt_tokens': usage.get('prompt_eval_count'),
                      'completion_tokens': usage.get('eval_count')},
            'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': result['result']}]}],
        }, {'provider': 'qwen', 'currency': 'local', 'method': 'POST', 'remoteResponseId': identifier}
