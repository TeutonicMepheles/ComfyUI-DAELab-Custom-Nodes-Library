from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps


ROOT_DIR = Path(__file__).resolve().parents[2]
MATERIAL_FILE = ROOT_DIR / "web" / "materials.json"
MATERIAL_THUMB_DIR = ROOT_DIR / "web" / "material_thumbs"
DEFAULT_MATERIAL_COLOR = "auto"
DEFAULT_USE_COLOR = True
FALLBACK_COLOR = "#6B3F24"
_HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{6})$")

REFERENCE_COLOR_LOCK = (
    "严格继承 Image 1 参考图中目标区域每个局部位置已有的固有色、综合色相、饱和度、"
    "基础明度关系和颜色分区；不得读取或采用所选材质名称、材质缩略图、目录默认色或"
    "隐藏颜色值中的任何颜色信息；所选材质只提供基材类型、金属度、反射、粗糙度和"
    "微观表面纹理，允许在原有光照下产生物理合理的局部高光、反射与明暗变化，"
    "但不得造成综合色相偏移或重新配色"
)

LEGACY_DEFAULT_BASE_PROMPT = (
    "仅修改 Image 1 中红色覆盖标记的目标区域；红色仅是编辑区域指示色，"
    "必须在输出中完全移除，不能成为最终材质颜色。"
)
DEFAULT_BASE_PROMPT = ""

FALLBACK_MATERIALS = {
    "dark_brushed_bronze": {
        "label": "深色拉丝古铜",
        "thumbnail": "dark_brushed_bronze.png",
        "preview_color": "#6B3F24",
        "semantic": (
            "深暖棕铜与古铜色金属基材，细密纵向拉丝和轻微不规则的各向异性纹理，"
            "中高金属反射，中等偏低粗糙度，暖金铜色高光与深棕近黑阴影，"
            "保留真实而克制的细微色差"
        ),
        "semantic_without_color": (
            "金属基材具有细密纵向拉丝和轻微不规则的各向异性纹理，"
            "中高金属反射与中等偏低粗糙度；只改变表面反射和微观纹理，"
            "保留参考图已有的局部明暗层次"
        ),
        "application": (
            "拉丝方向应顺应目标区域的局部曲面和结构走向，反射、高光与阴影必须继承"
            "原徽章的光源方向、曲率、浮雕起伏和环境照明"
        ),
        "application_without_color": (
            "拉丝方向应顺应目标区域的局部曲面和结构走向，反射、高光与阴影必须继承"
            "原徽章的光源方向、曲率、浮雕起伏和环境照明"
        ),
        "avoid": "不要生成绿色铜锈、明显刮伤、镜面镀铬效果或材质球形状",
        "avoid_without_color": "不要生成锈蚀、明显刮伤、过度镜面反射或材质球形状",
    },
    "light_speckled_enamel": {
        "label": "浅灰细砂珐琅",
        "thumbnail": "glossy_enamel.png",
        "preview_color": "#C7C7C5",
        "semantic": (
            "浅灰偏白的玻璃质珐琅釉面，均匀分布极细密的深灰与黑色矿物颗粒，"
            "表面平整圆润并具有连续透明釉层，高光清晰柔和，反射强度中高，"
            "整体低粗糙度，同时保留细颗粒带来的轻微视觉砂感"
        ),
        "semantic_without_color": (
            "玻璃质珐琅釉面中均匀分布极细密的矿物状微颗粒，表面平整圆润并具有"
            "连续釉层，高光清晰柔和、反射强度中高、整体低粗糙度，同时保留"
            "细颗粒带来的轻微视觉砂感；颗粒只改变微观起伏与反射分布"
        ),
        "application": (
            "颗粒尺寸必须细小并与徽章尺度协调，均匀嵌入珐琅釉层而不是浮在表面；"
            "高光、反射和明暗渐变必须服从原徽章的局部曲率、浮雕结构和环境照明"
        ),
        "application_without_color": (
            "颗粒尺寸必须细小并与徽章尺度协调，均匀嵌入珐琅釉层而不是浮在表面；"
            "高光、反射和明暗渐变必须服从原徽章的局部曲率、浮雕结构和环境照明"
        ),
        "avoid": (
            "不要生成石材孔洞、粗颗粒水磨石、金属拉丝、橘皮纹、裂纹、气泡、"
            "材质球轮廓或预览图中的棚拍窗格高光"
        ),
        "avoid_without_color": (
            "不要生成石材孔洞、粗颗粒水磨石、金属拉丝、橘皮纹、裂纹、气泡、"
            "材质球轮廓或预览图中的棚拍窗格高光"
        ),
    },
    "baked_enamel": {
        "label": "烤漆",
        "thumbnail": "baked_enamel.png",
        "preview_color": "#C62828",
        "semantic": (
            "不透明烘烤固化彩色漆面，色层均匀饱满、遮盖力强，表面平整致密，"
            "具有受控的中等高光和轻微圆润釉感，不呈现金属颗粒"
        ),
        "semantic_without_color": (
            "不透明烘烤固化漆面，涂层均匀饱满、遮盖力强，表面平整致密，"
            "具有受控的中等高光和轻微圆润釉感，不呈现金属颗粒"
        ),
        "application": (
            "目标色作为漆层的稳定基准色；明暗变化只来自原徽章曲率、浮雕、光源和环境反射"
        ),
        "application_without_color": (
            "只应用烘烤固化漆面的遮盖力、表面致密度与釉感；"
            "明暗变化只来自原徽章曲率、浮雕、光源和环境反射"
        ),
        "avoid": "不要生成透明色层、金属拉丝、闪粉颗粒、橘皮、流挂、气泡或塑料感",
        "avoid_without_color": "不要生成透明涂层、金属拉丝、闪粉颗粒、橘皮、流挂、气泡或塑料感",
    },
    "transparent_lacquer": {
        "label": "透明漆",
        "thumbnail": "transparent_lacquer.png",
        "preview_color": "#169C98",
        "semantic": (
            "带明确色相的透明彩色漆层，允许下方金属底材、纹理和明暗透过，"
            "表面形成薄而连续的清漆高光，通透但不乳白、不浑浊"
        ),
        "semantic_without_color": (
            "透明清漆层允许下方基材、纹理和既有明暗透过，表面形成薄而连续的"
            "清漆高光，通透且不浑浊；只增加透明涂层的光学响应"
        ),
        "application": (
            "目标色作为透明漆的透射与吸收色，不得把区域处理成同色不透明塑料；"
            "保留下方结构和金属反射，只施加自然的彩色滤光"
        ),
        "application_without_color": (
            "保留下方结构、纹理和金属反射，只应用薄而连续的透明清漆质感，"
            "不得把区域处理成不透明塑料"
        ),
        "avoid": "不要生成磨砂雾面、乳白遮盖、果冻厚块、液滴、气泡或无色玻璃",
        "avoid_without_color": "不要生成磨砂雾面、强遮盖涂层、果冻厚块、液滴或气泡",
    },
    "satin_gold": {
        "label": "亚金",
        "thumbnail": "satin_gold.png",
        "preview_color": "#C6A15B",
        "semantic": (
            "亚光缎面金色金属表面，金属度高、反射柔和而宽，粗糙度中等，"
            "细腻均匀的微磨砂纹理抑制镜面倒影，同时保留温暖金属高光"
        ),
        "semantic_without_color": (
            "亚光缎面金属表面，金属度高、反射柔和而宽、粗糙度中等，"
            "细腻均匀的微磨砂纹理抑制清晰镜面倒影，同时保留真实金属高光"
        ),
        "application": (
            "目标色作为金属镀层色调；保持真实金属响应，并让柔和反射服从原有光照和浮雕结构"
        ),
        "application_without_color": (
            "保持真实金属响应，并让柔和反射服从原有光照和浮雕结构"
        ),
        "avoid": "不要生成亮面镜面黄金、黄色塑料、古铜氧化、明显拉丝或金箔褶皱",
        "avoid_without_color": "不要生成亮面镜面、塑料感、氧化锈蚀、明显拉丝或金属箔褶皱",
    },
    "satin_silver": {
        "label": "亚银",
        "thumbnail": "satin_silver.png",
        "preview_color": "#BFC3C8",
        "semantic": (
            "亚光缎面银色金属表面，金属度高、冷中性银灰色调，反射柔和而宽，"
            "具有均匀细密的微磨砂纹理和中等粗糙度"
        ),
        "semantic_without_color": (
            "亚光缎面金属表面，金属度高、反射柔和而宽，具有均匀细密的"
            "微磨砂纹理和中等粗糙度，抑制清晰镜面倒影"
        ),
        "application": (
            "目标色作为银色金属的综合色调；保留冷调金属高光，并严格继承原有曲率和照明"
        ),
        "application_without_color": (
            "保持真实金属响应，并让柔和反射严格继承原有曲率和照明"
        ),
        "avoid": "不要生成镜面铬、白色塑料、粗砂喷涂、明显拉丝、锈蚀或彩虹氧化膜",
        "avoid_without_color": "不要生成镜面效果、塑料感、粗砂喷涂、明显拉丝、锈蚀或氧化膜",
    },
    "glitter": {
        "label": "闪粉",
        "thumbnail": "glitter.png",
        "preview_color": "#C94FA7",
        "semantic": (
            "透明或半透明树脂漆层中均匀悬浮大量极细闪粉颗粒，颗粒尺度与徽章协调，"
            "在目标底色上产生方向随机、密度均匀且克制的多点闪烁"
        ),
        "semantic_without_color": (
            "透明或半透明树脂层中均匀悬浮大量极细闪粉颗粒，颗粒尺度与徽章协调，"
            "只通过方向随机、密度均匀且克制的多点反射产生闪烁，不覆盖底层图案"
        ),
        "application": (
            "目标色同时控制树脂底色和闪粉综合色调；闪光必须响应原场景光源，"
            "不能覆盖文字边缘或改变图形轮廓"
        ),
        "application_without_color": (
            "闪光必须响应原场景光源，不能覆盖文字边缘或改变图形轮廓"
        ),
        "avoid": "不要生成大亮片、纸屑、粗颗粒砂石、星形装饰、噪点贴图或溢出目标区域的闪光",
        "avoid_without_color": "不要生成大亮片、纸屑、粗颗粒砂石、星形装饰、噪点贴图或溢出目标区域的闪光",
    },
    "rhinestone": {
        "label": "水钻",
        "thumbnail": "rhinestone.png",
        "preview_color": "#D9F3FF",
        "semantic": (
            "规则排列并牢固镶嵌的小尺寸多面切割水钻，晶体通透、折射清晰，"
            "具有锐利但受控的点状高光和细小镶嵌底座"
        ),
        "semantic_without_color": (
            "规则排列并牢固镶嵌的小尺寸多面切割晶体，晶体通透、折射清晰，"
            "具有锐利但受控的点状高光和细小镶嵌底座；晶体只折射参考图"
            "已有的局部视觉信息"
        ),
        "application": (
            "目标色作为晶体色调；水钻尺寸、数量和排列必须服从目标区域边界与徽章尺度，"
            "形成贴合原浮雕表面的连续镶嵌区域"
        ),
        "application_without_color": (
            "水钻尺寸、数量和排列必须服从目标区域边界与徽章尺度，"
            "形成贴合原浮雕表面的连续镶嵌区域"
        ),
        "avoid": "不要生成散落宝石、超大珠宝、珍珠、金属铆钉、随机缺口或越出目标轮廓的晶体",
        "avoid_without_color": "不要生成散落宝石、超大珠宝、珍珠、金属铆钉、随机缺口或越出目标轮廓的晶体",
    },
}


def load_materials() -> dict[str, dict]:
    try:
        with MATERIAL_FILE.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if isinstance(value, dict) and value:
            valid = {
                str(material_id): material
                for material_id, material in value.items()
                if isinstance(material, dict)
            }
            if valid:
                return valid
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass
    return FALLBACK_MATERIALS


def material_labels(materials: dict[str, dict]) -> list[str]:
    labels = []
    used = set()
    for material_id, material in materials.items():
        label = str(material.get("label") or material_id).strip() or material_id
        if label in used:
            label = material_id
        labels.append(label)
        used.add(label)
    return labels or ["深色拉丝古铜"]


def resolve_material(
    materials: dict[str, dict], material_value: object
) -> tuple[str, dict]:
    value = str(material_value or "").strip()
    if value in materials:
        return value, materials[value]
    for material_id, material in materials.items():
        if str(material.get("label") or "").strip() == value:
            return material_id, material
    return next(
        iter(materials.items()),
        ("dark_brushed_bronze", FALLBACK_MATERIALS["dark_brushed_bronze"]),
    )


def clean_text(value: object) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text).strip().rstrip("，,；;。 ")


def normalize_base_prompt(value: object) -> str:
    text = clean_text(value)
    if text == clean_text(LEGACY_DEFAULT_BASE_PROMPT):
        return ""
    return text


def normalize_material_color(value: object, fallback: str = FALLBACK_COLOR) -> str:
    text = str(value or "").strip()
    match = _HEX_COLOR.fullmatch(text)
    if not match:
        fallback_match = _HEX_COLOR.fullmatch(str(fallback or FALLBACK_COLOR).strip())
        digits = fallback_match.group(1) if fallback_match else FALLBACK_COLOR[1:]
    else:
        digits = match.group(1)
    return f"#{digits.upper()}"


def resolve_material_color(material: dict, value: object) -> str:
    text = str(value or "").strip().lower()
    fallback = material.get("default_color") or material.get("preview_color") or FALLBACK_COLOR
    if text in {"", "auto", "default"}:
        return normalize_material_color(fallback)
    return normalize_material_color(value, fallback)


def color_semantics(material_color: str) -> str:
    normalized = normalize_material_color(material_color)
    channels = tuple(int(normalized[index:index + 2], 16) for index in (1, 3, 5))
    return (
        f"目标基准色为 {normalized}（sRGB {channels[0]}, {channels[1]}, {channels[2]}）"
    )


def is_material_color_enabled(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"", "0", "false", "no", "off"}
    return bool(value)


def material_prompt_field(
    material: dict,
    field: str,
    use_color: object = DEFAULT_USE_COLOR,
) -> str:
    if is_material_color_enabled(use_color):
        return clean_text(material.get(field))
    return clean_text(material.get(f"{field}_without_color"))


def material_application(material: dict, use_color: object = DEFAULT_USE_COLOR) -> str:
    return material_prompt_field(material, "application", use_color)


def build_material_semantics(
    material: dict,
    material_color: object = DEFAULT_MATERIAL_COLOR,
    use_color: object = DEFAULT_USE_COLOR,
) -> str:
    color_enabled = is_material_color_enabled(use_color)
    parts = []
    if color_enabled:
        parts.append(color_semantics(resolve_material_color(material, material_color)))
    else:
        parts.append(REFERENCE_COLOR_LOCK)
    for key in ("semantic", "application", "avoid"):
        text = material_prompt_field(material, key, color_enabled)
        if text:
            parts.append(text)
    return "；".join(parts) + ("。" if parts else "")


def build_material_prompt(
    material: dict,
    material_color: object = DEFAULT_MATERIAL_COLOR,
    base_prompt: object = DEFAULT_BASE_PROMPT,
    additional_details: object = "",
    use_color: object = DEFAULT_USE_COLOR,
) -> tuple[str, str]:
    color_enabled = is_material_color_enabled(use_color)
    base = normalize_base_prompt(base_prompt)
    semantic = material_prompt_field(material, "semantic", color_enabled)
    application = material_prompt_field(material, "application", color_enabled)
    avoid = material_prompt_field(material, "avoid", color_enabled)
    additional = clean_text(additional_details)
    resolved_color = resolve_material_color(material, material_color) if color_enabled else ""
    target_color = color_semantics(resolved_color) if color_enabled else ""

    sections = [
        f"编辑目标：\n{base}。" if base else "",
        f"材质语义：\n{semantic}。" if semantic else "",
        (
            "颜色语义：\n"
            f"{target_color}。把该色作为目标区域在中性照明下的固有色或材质色调；"
            "允许因真实曲率、金属反射、透明透射、高光和阴影产生物理合理的局部明暗变化，"
            "但不得改成其他综合色相。"
        ) if color_enabled else "",
        (
            "参考图颜色锁定：\n"
            f"{REFERENCE_COLOR_LOCK}。"
        ) if not color_enabled else "",
        (
            "材质应用：\n"
            "只把上述材质的基材类型、金属度、反射特征、粗糙度和微观表面纹理"
            "应用到目标区域；不要复制预览图中的球体轮廓、背景、构图或棚拍高光。"
            + (f"{application}。" if application else "")
        ),
        f"补充要求：\n{additional}。" if additional else "",
        (
            "保持不变：\n"
            "严格保留原徽章的外轮廓、厚度、浮雕高度、边缘、文字内容与字形、"
            "图形形状、线条位置、比例、相机视角、透视和画面构图。"
            "目标区域以外的颜色、材质、明暗和所有像素内容保持不变。"
        ),
        (
            "融合要求：\n"
            "新材质必须服从原图现有的曲面、浮雕起伏、光源方向、环境反射、"
            "接触阴影和边缘过渡，呈现为真实制造并自然附着在徽章表面的材质，"
            "而不是平面贴图或独立物体。"
        ),
        "禁止：\n"
        "不得重新设计、重绘、移动、放大、缩小或扭曲任何图形和文字；"
        "不得添加新文字、Logo、装饰、边框、水印或其他物体；"
        + (
            f"{avoid}。"
            if avoid
            else "不得添加与目标材质无关的表面效果。"
        ),
    ]
    prompt = "\n\n".join(section for section in sections if section)
    return prompt, build_material_semantics(
        material,
        resolved_color,
        use_color=color_enabled,
    )


def _parse_preview_color(value: object) -> tuple[int, int, int]:
    text = str(value or "#6B3F24").strip()
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", text)
    if not match:
        return 107, 63, 36
    color = match.group(1)
    return tuple(int(color[index:index + 2], 16) for index in (0, 2, 4))


def _tint_preview(array: np.ndarray, material_color: str) -> np.ndarray:
    color = np.asarray(_parse_preview_color(material_color), dtype=np.float32) / 255.0
    luminance = (
        array[..., 0] * 0.2126
        + array[..., 1] * 0.7152
        + array[..., 2] * 0.0722
    )
    tint = color / max(float(color.max()), 0.15)
    tinted = luminance[..., None] * tint[None, None, :]
    highlight = np.clip((luminance - 0.72) / 0.28, 0.0, 1.0)[..., None] * 0.55
    return np.clip(tinted * (1.0 - highlight) + highlight, 0.0, 1.0)


def load_material_preview(
    material: dict,
    material_color: object = DEFAULT_MATERIAL_COLOR,
    use_color: object = DEFAULT_USE_COLOR,
) -> torch.Tensor:
    color_enabled = is_material_color_enabled(use_color)
    resolved_color = resolve_material_color(material, material_color) if color_enabled else ""
    filename = Path(str(material.get("thumbnail") or "")).name
    image_path = MATERIAL_THUMB_DIR / filename
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            array = np.asarray(image, dtype=np.float32) / 255.0
            if color_enabled:
                array = _tint_preview(array, resolved_color)
    except (OSError, ValueError):
        color = _parse_preview_color(
            resolved_color or material.get("preview_color") or FALLBACK_COLOR
        )
        image = Image.new("RGB", (256, 256), color)
        array = np.asarray(image, dtype=np.float32) / 255.0
    return torch.from_numpy(np.array(array, copy=True)).unsqueeze(0).float()


class GPTImage2MaterialPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        materials = load_materials()
        labels = material_labels(materials)
        return {
            "required": {
                "material_id": (labels, {"default": labels[0]}),
                "material_color": (
                    "STRING",
                    {"default": DEFAULT_MATERIAL_COLOR},
                ),
                "base_prompt": (
                    "STRING",
                    {"default": DEFAULT_BASE_PROMPT, "multiline": True},
                ),
                "additional_details": (
                    "STRING",
                    {"default": "", "multiline": True},
                ),
                "use_color": (
                    "BOOLEAN",
                    {"default": DEFAULT_USE_COLOR},
                ),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("prompt", "material_semantics", "preview_image", "selected_color")
    FUNCTION = "execute"
    CATEGORY = "GPT-Image/Prompt"
    DESCRIPTION = (
        "Select a badge material and build a deterministic GPT Image 2 edit "
        "prompt. Custom color can be enabled explicitly; when disabled, the "
        "prompt locks Image 1 reference colors and applies only color-independent "
        "material properties. The local preview is not sent to the API by this node."
    )

    def execute(
        self,
        material_id,
        material_color=DEFAULT_MATERIAL_COLOR,
        base_prompt=DEFAULT_BASE_PROMPT,
        additional_details="",
        use_color=DEFAULT_USE_COLOR,
    ):
        _, material = resolve_material(load_materials(), material_id)
        color_enabled = is_material_color_enabled(use_color)
        resolved_color = (
            resolve_material_color(material, material_color)
            if color_enabled
            else ""
        )
        prompt, semantics = build_material_prompt(
            material,
            material_color=resolved_color,
            base_prompt=base_prompt,
            additional_details=additional_details,
            use_color=use_color,
        )
        preview = load_material_preview(
            material,
            resolved_color,
            use_color=color_enabled,
        )
        return prompt, semantics, preview, resolved_color

    @classmethod
    def IS_CHANGED(
        cls,
        material_id,
        material_color=DEFAULT_MATERIAL_COLOR,
        base_prompt=DEFAULT_BASE_PROMPT,
        additional_details="",
        use_color=DEFAULT_USE_COLOR,
    ):
        color_enabled = is_material_color_enabled(use_color)
        digest = hashlib.sha256()
        digest.update(str(material_id).encode("utf-8"))
        digest.update(str(material_color if color_enabled else "").encode("utf-8"))
        digest.update(normalize_base_prompt(base_prompt).encode("utf-8"))
        digest.update(str(additional_details).encode("utf-8"))
        digest.update(str(color_enabled).encode("utf-8"))
        try:
            digest.update(MATERIAL_FILE.read_bytes())
        except OSError:
            digest.update(json.dumps(FALLBACK_MATERIALS, sort_keys=True).encode("utf-8"))
        materials = load_materials()
        _, material = resolve_material(materials, material_id)
        thumbnail = MATERIAL_THUMB_DIR / Path(
            str(material.get("thumbnail") or "")
        ).name
        try:
            digest.update(thumbnail.read_bytes())
        except OSError:
            digest.update(str(material.get("preview_color") or "").encode("utf-8"))
        return digest.hexdigest()


NODE_CLASS_MAPPINGS = {
    "GPTImage2MaterialPrompt": GPTImage2MaterialPrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GPTImage2MaterialPrompt": "GPT Image 2 材质提示词",
}
