"""Explicitly approved canvas result; execution never invokes an LLM."""
class ApprovedLLMResult:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"applied_text": ("STRING", {"multiline": True})}}
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("结果",)
    FUNCTION = "output"
    CATEGORY = "DAELab/文本"
    def output(self, applied_text, **kwargs):
        if not applied_text.strip():
            raise ValueError("LLM 优化结果尚未应用")
        return (applied_text,)
