"""Explicitly approved canvas result; execution never invokes an LLM."""
import json

class ApprovedLLMResult:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"applied_text": ("STRING", {"multiline": True})},
                "optional": {"applied_rows": ("STRING", {"multiline": True})}}
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("结果", "逐行结果")
    FUNCTION = "output"
    CATEGORY = "DAELab/文本"
    def output(self, applied_text, applied_rows='', **kwargs):
        if not applied_text.strip():
            raise ValueError("LLM 优化结果尚未应用")
        if applied_rows:
            data = json.loads(applied_rows)
            rows = data.get('rows', [])
            if data.get('version') != 1 or data.get('ready') is not True or not rows:
                raise ValueError('LLM 逐行结果尚未应用')
            ids = [row.get('id') for row in rows]
            if not all(ids) or len(set(ids)) != len(ids) or any(not row.get('text', '').strip() for row in rows):
                raise ValueError('LLM 逐行结果缺少镜头 ID 或提示词')
        return (applied_text, applied_rows)
