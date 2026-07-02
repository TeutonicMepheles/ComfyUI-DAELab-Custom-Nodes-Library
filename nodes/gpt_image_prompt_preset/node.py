import json
import re
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
STYLE_FILE = ROOT_DIR / "web" / "styles.json"


FALLBACK_STYLES = {
    "aerospace": {
        "label": "航天科技",
        "prompt": "航天科技视觉风格，未来感，深空元素，精密仪器线条，科技海报质感",
    }
}


TONE_PROMPTS = {
    "标准": "整体视觉清晰完整，构图稳定，适合高质量图像生成",
    "明亮": "整体明亮通透，色彩干净，画面轻盈有呼吸感",
    "稳重": "整体稳重克制，层次清晰，画面可信赖且正式",
    "高级": "整体高级精致，细节克制，视觉质感强",
    "活泼": "整体活泼积极，节奏轻快，视觉更有亲和力",
}


COLOR_NAMES = {
    "#ffffff": "白色",
    "#000000": "黑色",
    "#1e5bff": "蓝色",
    "#e60012": "红色",
    "#00a86b": "绿色",
    "#f5c542": "金色",
    "#7b3ff2": "紫色",
}


def load_styles():
    try:
        with STYLE_FILE.open("r", encoding="utf-8") as f:
            styles = json.load(f)
        if isinstance(styles, dict) and styles:
            return styles
    except Exception:
        pass
    return FALLBACK_STYLES


def normalize_hex(value, default):
    if not isinstance(value, str):
        if isinstance(value, (tuple, list)) and len(value) >= 3:
            try:
                channels = [max(0, min(255, int(value[i]))) for i in range(3)]
                return "#{:02X}{:02X}{:02X}".format(*channels)
            except (TypeError, ValueError):
                return default
        return default
    value = value.strip()
    if len(value) == 7 and value.startswith("#"):
        try:
            int(value[1:], 16)
            return value.upper()
        except ValueError:
            return default
    rgb_match = re.fullmatch(r"\(?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?", value)
    if rgb_match:
        channels = [max(0, min(255, int(channel))) for channel in rgb_match.groups()]
        return "#{:02X}{:02X}{:02X}".format(*channels)
    return default


def describe_color(hex_value):
    normalized = hex_value.lower()
    name = COLOR_NAMES.get(normalized)
    if name:
        return f"{hex_value}（{name}）"
    return hex_value


class GPTImageStylePromptPreset:
    @classmethod
    def INPUT_TYPES(cls):
        styles = load_styles()
        style_ids = list(styles.keys()) or list(FALLBACK_STYLES.keys())
        return {
            "required": {
                "subject": ("STRING", {
                    "default": "未来城市宣传海报",
                    "multiline": True,
                }),
                "style_id": (style_ids, {
                    "default": style_ids[0],
                }),
                "tone": (list(TONE_PROMPTS.keys()), {
                    "default": "标准",
                }),
                "primary_color": ("COLOR", {
                    "default": "#1E5BFF",
                }),
                "secondary_color": ("COLOR", {
                    "default": "#FFFFFF",
                }),
                "custom_append": ("STRING", {
                    "default": "",
                    "multiline": True,
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build_prompt"
    CATEGORY = "GPT-Image/Prompt"

    def build_prompt(
        self,
        subject,
        style_id,
        tone,
        primary_color,
        secondary_color,
        custom_append,
    ):
        styles = load_styles()
        style = styles.get(style_id) or next(iter(styles.values()), FALLBACK_STYLES["aerospace"])
        style_label = style.get("label", style_id)
        style_prompt = style.get("prompt", "")
        primary = normalize_hex(primary_color, "#1E5BFF")
        secondary = normalize_hex(secondary_color, "#FFFFFF")

        parts = [
            str(subject).strip() or "图像生成主题",
            f"{style_label}风格：{style_prompt}",
            f"主色调为 {describe_color(primary)}，辅色为 {describe_color(secondary)}，整体配色统一，视觉层次清晰",
            TONE_PROMPTS.get(tone, TONE_PROMPTS["标准"]),
        ]

        if custom_append and str(custom_append).strip():
            parts.append(str(custom_append).strip())

        prompt = "，".join(part.rstrip("，。 ") for part in parts if part) + "。"
        return (prompt,)


NODE_CLASS_MAPPINGS = {
    "GPTImageStylePromptPreset": GPTImageStylePromptPreset,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GPTImageStylePromptPreset": "GPT Image Style Prompt Preset",
}
