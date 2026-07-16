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
        "prompt": "采用精密构造线、轨道图形、数据可视化界面、线性照明和局部金属构件，形成克制专业的航天科技空间语言",
    },
    "business": {
        "label": "商务",
        "subject": "现代企业商务展厅",
        "primary_color": "#3A4A5C",
        "secondary_color": "#B8A99A",
        "prompt": "采用清晰的信息层级、模块化展陈界面、简洁几何构成和克制材质关系，形成现代专业的企业展示空间",
    },
    "party_building": {
        "label": "党建",
        "subject": "党建展厅",
        "primary_color": "#C33C3C",
        "secondary_color": "#D4A843",
        "prompt": "采用庄重有序的叙事轴线、层次清晰的主题展示墙和具有仪式感的空间构成，形成正式稳健的主题展陈语言",
    },
}

TONE_PROMPTS = {
    "标准": "采用自然柔和的光线，曝光准确，对比度适中，构图均衡稳定",
    "明亮": "采用明亮通透的高调光线，保持准确曝光和清晰空间层次，适当增强留白感",
    "稳重": "采用沉稳克制的定向光，降低明暗反差，保持空间秩序和正式氛围",
    "高级": "采用柔和定向光，强调材质细节、反射关系和空间层次，呈现精致专业的视觉质感",
    "活泼": "采用明亮饱满的光线，适度增强对比和构图节奏，保持空间清晰自然",
}

DEFAULT_BASE_PROMPT = "生成写实展厅效果图，并在环境中添加与风格匹配的适当陈列与装饰物。"
DEFAULT_ADDITIONAL_DETAILS = "地面以高抛光水磨石为主，结合局部PVC地材，墙面采用乳胶漆，搭配不锈钢、铝材和灯带装饰，顶面采用流线型连续灯带系统。"


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


def normalize_boolean(value, default=True):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    if value in (0, 1):
        return bool(value)
    return default


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
    return f"{text}。"


def color_rhythm_prompt(primary, secondary):
    return (
        "整体以低饱和中性色和浅色材质为基底。"
        f"{describe_color_semantic(primary, 'primary')}（{primary}）作为局部品牌强调色，"
        "用于信息展示面、屏幕内容、发光线条和导视系统；"
        f"{describe_color_semantic(secondary, 'secondary')}（{secondary}）用于过渡面、边界、留白和灯光层次。"
        "墙面通过中性留白、材质分割和明暗变化形成节奏"
    )


def normalize_paragraph(parts):
    paragraph = "".join(sentence(item) for item in parts if clean_fragment(item))
    paragraph = re.sub(r"。{2,}", "。", paragraph)
    paragraph = re.sub(r"，{2,}", "，", paragraph)
    return paragraph.strip()


def normalize_prompt_sections(sections):
    paragraphs = [normalize_paragraph(parts) for parts in sections]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


class SeedreamExhibitionPromptBuilder(io.ComfyNode):
    """Build a Seedream 5.0 Pro prompt for exhibition hall render workflows."""

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
                io.Color.Input("secondary_color", default="#D0D5DD", socketless=True),
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
        use_theme_template = normalize_boolean(use_theme_template)
        use_space_reference = normalize_boolean(use_space_reference)
        include_people_placeholder = normalize_boolean(include_people_placeholder)
        use_element_reference = normalize_boolean(use_element_reference)
        lock_edit_region = normalize_boolean(lock_edit_region)

        if not use_theme_template:
            raw_prompt = "" if base_prompt is None else base_prompt if isinstance(base_prompt, str) else str(base_prompt)
            return io.NodeOutput(raw_prompt)

        styles = load_styles()
        _, style = resolve_style(styles, style_id)
        style_label = clean_fragment(style.get("label", style_id))
        style_subject = clean_fragment(style.get("subject") or f"{style_label}主题展厅")
        style_prompt = clean_fragment(style.get("prompt"))
        primary_default = normalize_hex(style.get("primary_color"), "#567DF0")
        secondary_default = normalize_hex(style.get("secondary_color"), "#D0D5DD")
        primary = normalize_hex(primary_color, primary_default)
        secondary = normalize_hex(secondary_color, secondary_default)

        has_reference = use_space_reference or use_element_reference
        if has_reference:
            goal = f"基于参考图，将现有空间改造为{style_subject}，生成用于展厅设计方案呈现的写实室内建筑渲染效果图"
        else:
            goal = f"创建一张{style_subject}的写实室内建筑渲染效果图，用于展厅设计方案呈现"

        reference_parts = []

        if use_space_reference:
            reference_parts.append(
                "保持参考图中的墙体、顶面、地面、空间尺度、动线关系和核心建筑结构，保持原有相机机位、视角、透视关系和画面构图"
            )
            if include_people_placeholder:
                reference_parts.append("将参考图中的占位人物或示意人形替换为比例准确、姿态自然、正在参观展览的真实游客")

        if use_element_reference:
            if lock_edit_region:
                reference_parts.append("保留参考图中已有展陈物件的位置、比例和空间关系，使其与改造后的环境自然融合")
            else:
                reference_parts.append("将参考图中的展陈物件作为元素参考，在空间中合理放置并与环境自然融合")

        sections = [
            [goal],
            reference_parts,
            [style_prompt, clean_details(additional_details)],
            [color_rhythm_prompt(primary, secondary)],
            [
                TONE_PROMPTS.get(tone, TONE_PROMPTS["标准"]),
                "采用室内建筑摄影视角，表现真实材质反射，保持空间层次清晰、尺度合理，呈现高质量写实效果图质感",
            ],
        ]

        return io.NodeOutput(normalize_prompt_sections(sections))


NODE_CLASS_MAPPINGS = {
    "SeedreamExhibitionPromptBuilder": SeedreamExhibitionPromptBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SeedreamExhibitionPromptBuilder": "Seedream Exhibition Prompt Builder",
}
