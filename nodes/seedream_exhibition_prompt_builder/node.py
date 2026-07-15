import json
import re
from pathlib import Path

from comfy_api.latest import io


ROOT_DIR = Path(__file__).resolve().parents[2]
STYLE_FILE = ROOT_DIR / "web" / "styles.json"

FALLBACK_STYLES = {
    "aerospace": {
        "label": "航天科技",
        "subject": "航天科技展厅",
        "primary_color": "#567DF0",
        "secondary_color": "#D0D5DD",
        "prompt": "以深蓝宇宙空间为背景，使用精密仪器线条、轨道线条和数据可视化图形构成画面，呈现未来科技感与高级海报质感",
    }
}

TONE_PROMPTS = {
    "标准": "画面光线自然柔和，对比度适中，色彩还原准确，构图均衡稳定",
    "明亮": "画面采用高调光线，整体明亮通透，色彩明快干净，适当增加留白与空间感",
    "稳重": "画面光线沉稳克制，对比度偏低，色彩饱和度低，以深色与中性色为主，风格正式可信赖",
    "高级": "画面使用柔和定向光，配色克制典雅，强调材质细节与空间层次，视觉质感突出",
    "活泼": "画面光线明亮饱满，色彩饱和度高，对比鲜明，构图富有动感与节奏感",
}

DEFAULT_BASE_PROMPT = "生成写实展厅效果图，并在环境中添加与风格匹配的适当陈列与装饰物。"
DEFAULT_ADDITIONAL_DETAILS = "地面材质采用高抛光水磨石，含PVC，墙面材质采用乳胶漆，包含不锈钢、铝材的装饰材质与灯带，顶面采用流线型连续灯带系统。"


def load_styles():
    try:
        with STYLE_FILE.open("r", encoding="utf-8") as f:
            styles = json.load(f)
        if isinstance(styles, dict) and styles:
            return styles
    except Exception:
        pass
    return FALLBACK_STYLES


def style_labels(styles):
    labels = []
    used = set()
    for style_id, style in styles.items():
        label = str(style.get("label") or style_id).strip() or style_id
        if label in used:
            label = style_id
        labels.append(label)
        used.add(label)
    return labels or list(FALLBACK_STYLES.keys())


def resolve_style(styles, style_value):
    if style_value in styles:
        return style_value, styles[style_value]
    for style_id, style in styles.items():
        if str(style.get("label") or "").strip() == str(style_value).strip():
            return style_id, style
    fallback_id, fallback_style = next(iter(styles.items()), ("aerospace", FALLBACK_STYLES["aerospace"]))
    return fallback_id, fallback_style


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


def hex_to_rgb(hex_value):
    value = normalize_hex(hex_value, "#000000").lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def rgb_to_hsl(red, green, blue):
    r, g, b = red / 255, green / 255, blue / 255
    max_channel = max(r, g, b)
    min_channel = min(r, g, b)
    lightness = (max_channel + min_channel) / 2

    if max_channel == min_channel:
        return 0, 0, lightness

    delta = max_channel - min_channel
    saturation = delta / (2 - max_channel - min_channel) if lightness > 0.5 else delta / (max_channel + min_channel)
    if max_channel == r:
        hue = ((g - b) / delta + (6 if g < b else 0)) / 6
    elif max_channel == g:
        hue = ((b - r) / delta + 2) / 6
    else:
        hue = ((r - g) / delta + 4) / 6
    return hue * 360, saturation, lightness


def gray_color_name(lightness, role):
    if lightness >= 0.92:
        return "冷白色"
    if lightness >= 0.72:
        return "浅灰过渡色" if role == "secondary" else "浅灰色"
    if lightness >= 0.38:
        return "中性灰"
    return "深灰边界色" if role == "secondary" else "深灰色"


def describe_color_semantic(hex_value, role):
    red, green, blue = hex_to_rgb(hex_value)
    hue, saturation, lightness = rgb_to_hsl(red, green, blue)

    if lightness <= 0.04:
        return "深黑色"
    if saturation <= 0.1:
        return gray_color_name(lightness, role)
    if saturation <= 0.24:
        if 180 <= hue < 260:
            return "低饱和蓝灰色"
        if 80 <= hue < 170:
            return "低饱和灰绿色"
        if hue < 40 or hue >= 340:
            return "低饱和暖灰红色"
        return "低饱和中性色"

    if hue < 15 or hue >= 345:
        return "主题红" if saturation >= 0.72 and lightness >= 0.45 else "稳重红色"
    if hue < 40:
        return "暖橙色"
    if hue < 72:
        return "金色点缀" if saturation >= 0.45 else "柔和暖黄色"
    if hue < 150:
        return "活力绿" if saturation >= 0.5 else "柔和绿色"
    if hue < 200:
        return "冷光青蓝" if saturation >= 0.45 else "柔和青色"
    if hue < 250:
        if lightness >= 0.62:
            return "明亮科技蓝"
        if saturation >= 0.65:
            return "高饱和科技蓝"
        return "科技蓝"
    if hue < 290:
        return "科技紫" if lightness >= 0.42 else "深紫色"
    if hue < 345:
        return "品红色点缀"
    return "自然色"


def clean_fragment(value):
    text = "" if value is None else str(value)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[。！？；，,\s]+$", "", text)
    return text


def clean_details(value):
    text = clean_fragment(value)
    if re.fullmatch(r"#?[0-9a-fA-F]{6}", text):
        return ""
    return text


def sentence(value):
    text = clean_fragment(value)
    if not text:
        return ""
    if text.endswith(("。", "！", "？")):
        return text
    return f"{text}。"


def color_rhythm_prompt(primary, secondary):
    return (
        "以低饱和中性色和浅色材质为基底。"
        f"主色调为{describe_color_semantic(primary, 'primary')}，用于局部信息面、屏幕内容、发光线条和导视强调，"
        f"辅色为{describe_color_semantic(secondary, 'secondary')}，用于留白、边界、过渡面和灯光层次。"
        "墙面色彩与材质层次自然变化，主色信息面之间穿插中性墙面、材质分割和留白，避免整墙连续色块"
    )


def normalize_prompt(sentences):
    prompt = "".join(sentence(item) for item in sentences if clean_fragment(item))
    prompt = re.sub(r"。{2,}", "。", prompt)
    prompt = re.sub(r"，{2,}", "，", prompt)
    prompt = re.sub(r"\s+", " ", prompt).strip()
    return prompt


class SeedreamExhibitionPromptBuilder(io.ComfyNode):
    """Build a Seedream 4.0/4.5 compliant structured prompt for exhibition hall render workflows."""

    @classmethod
    def define_schema(cls):
        styles = load_styles()
        labels = style_labels(styles)
        return io.Schema(
            node_id="SeedreamExhibitionPromptBuilder",
            display_name="Seedream Exhibition Prompt Builder",
            category="Seedream/Prompt",
            inputs=[
                io.Combo.Input("style_id", options=labels, default=labels[0] if labels else "航天科技"),
                io.Combo.Input("tone", options=list(TONE_PROMPTS.keys()), default="标准"),
                io.Color.Input("primary_color", default="#567DF0", socketless=True),
                io.Color.Input("secondary_color", default="#C33C3C", socketless=True),
                io.String.Input("base_prompt", default=DEFAULT_BASE_PROMPT, multiline=True),
                io.String.Input("additional_details", default=DEFAULT_ADDITIONAL_DETAILS, multiline=True),
                io.Boolean.Input("use_theme_template", default=True, optional=True),
                io.Boolean.Input("use_space_reference", default=True, optional=True),
                io.Boolean.Input("include_people_placeholder", default=True, optional=True),
                io.Boolean.Input("use_element_reference", default=True, optional=True),
                io.Boolean.Input("lock_edit_region", default=True, optional=True),
            ],
            outputs=[
                io.String.Output(display_name="prompt"),
            ],
        )

    @classmethod
    def execute(
        cls,
        style_id,
        tone,
        primary_color,
        secondary_color,
        base_prompt,
        additional_details,
        use_theme_template=True,
        use_space_reference=True,
        include_people_placeholder=True,
        use_element_reference=True,
        lock_edit_region=True,
    ):
        if not use_theme_template:
            return io.NodeOutput(clean_fragment(base_prompt))

        styles = load_styles()
        _, style = resolve_style(styles, style_id)
        style_label = clean_fragment(style.get("label", style_id))
        primary = normalize_hex(style.get("primary_color") or primary_color, "#567DF0")
        secondary = normalize_hex(style.get("secondary_color") or secondary_color, "#C33C3C")

        task_sentence = f"创建一张{style_label}风格的展厅写实渲染效果图，用于展厅设计方案呈现"

        sentences = [
            task_sentence,
            "",  # use_theme_template=True 时模板替代 base_prompt，False 时已 early return
        ]

        if use_space_reference:
            reference_parts = ["参考图作为空间布局和建筑结构依据，保持墙体、顶面、地面、动线关系和核心结构位置"]
            if include_people_placeholder:
                reference_parts.append("参考图中的占位人物或示意人形替换为自然站立、比例合理的真实游客，不保留占位符外观")
            sentences.append("；".join(reference_parts))

        if use_element_reference:
            if lock_edit_region:
                sentences.append("参考图中的物品或元素作为元素参考，保留原位置并与周围环境自然结合")
            else:
                sentences.append("参考图中的物品或元素作为元素参考，放置在合理位置并与周围环境自然结合")

        sentences.extend(
            [
                clean_details(additional_details),
                color_rhythm_prompt(primary, secondary),
                TONE_PROMPTS.get(tone, TONE_PROMPTS["标准"]),
                "保持现有空间结构和展陈元素，不额外添加未要求的主展品、视觉焦点或大型装置。室内建筑摄影视角，构图清晰，空间层次明确，整体克制、通透、有节奏",
            ]
        )

        return io.NodeOutput(normalize_prompt(sentences))


NODE_CLASS_MAPPINGS = {
    "SeedreamExhibitionPromptBuilder": SeedreamExhibitionPromptBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SeedreamExhibitionPromptBuilder": "Seedream Exhibition Prompt Builder",
}
