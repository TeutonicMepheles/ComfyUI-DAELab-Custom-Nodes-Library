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

REFERENCE_COLOR_LOCK = (
    "严格继承 Image 1 参考图中目标区域每个局部位置已有的固有色、综合色相、饱和度、"
    "基础明度关系和颜色分区；不得读取或采用所选材质名称、材质缩略图或目录数据中的"
    "任何颜色信息；所选材质只提供基材类型、金属度、反射、粗糙度和微观表面纹理，"
    "允许在原有光照下产生物理合理的局部高光、反射与明暗变化，但不得造成综合色相"
    "偏移或重新配色"
)

LEGACY_DEFAULT_BASE_PROMPT = (
    "仅修改 Image 1 中红色覆盖标记的目标区域；红色仅是编辑区域指示色，"
    "必须在输出中完全移除，不能成为最终材质颜色。"
)
DEFAULT_BASE_PROMPT = ""
MATERIAL_REGION_V1_CONFIG_PROPERTY = "badge_material_region_v1_config"
MATERIAL_REGION_PROMPT_CONFIG_INPUT = "material_region_config"
DEFAULT_REGION_MATERIAL_ID = "transparent_lacquer"
DEFAULT_COLOR_POLICY = "preserve"
MATERIAL_INTRINSIC_COLOR_POLICY = "material_intrinsic"
MAX_MATERIAL_REGION_GROUPS = 16
DEFAULT_MATERIAL_STRENGTH = 1.0
MIN_MATERIAL_STRENGTH = 0.25
MAX_MATERIAL_STRENGTH = 1.5
DEFAULT_REGION_COLORS = ("#d0ad7d", "#d4e3e2", "#055652", "#26877f")
_HEX_COLOR = re.compile(r"^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_SAFE_GROUP_ID = re.compile(r"[^a-zA-Z0-9_-]")
_REGION_DIAGNOSTIC_COLORS = (
    (0.91, 0.25, 0.25),
    (0.24, 0.65, 0.96),
    (0.34, 0.82, 0.48),
    (0.96, 0.71, 0.22),
    (0.72, 0.43, 0.94),
    (0.16, 0.82, 0.78),
    (0.95, 0.42, 0.72),
    (0.64, 0.76, 0.23),
)

FALLBACK_MATERIALS = {
    "dark_brushed_bronze": {
        "label": "深色拉丝古铜",
        "thumbnail": "dark_brushed_bronze.png",
        "semantic": (
            "金属基材具有细密纵向拉丝和轻微不规则的各向异性纹理，"
            "中高金属反射与中等偏低粗糙度；只改变表面反射和微观纹理，"
            "保留参考图已有的局部明暗层次"
        ),
        "application": (
            "拉丝方向应顺应目标区域的局部曲面和结构走向，反射、高光与阴影必须继承"
            "原徽章的光源方向、曲率、浮雕起伏和环境照明"
        ),
        "avoid": "不要生成锈蚀、明显刮伤、过度镜面反射或材质球形状",
    },
    "light_speckled_enamel": {
        "label": "浅灰细砂珐琅",
        "thumbnail": "glossy_enamel.png",
        "semantic": (
            "玻璃质珐琅釉面中均匀分布极细密的矿物状微颗粒，表面平整圆润并具有"
            "连续釉层，高光清晰柔和、反射强度中高、整体低粗糙度，同时保留"
            "细颗粒带来的轻微视觉砂感；颗粒只改变微观起伏与反射分布"
        ),
        "application": (
            "颗粒尺寸必须细小并与徽章尺度协调，均匀嵌入珐琅釉层而不是浮在表面；"
            "高光、反射和明暗渐变必须服从原徽章的局部曲率、浮雕结构和环境照明"
        ),
        "avoid": (
            "不要生成石材孔洞、粗颗粒水磨石、金属拉丝、橘皮纹、裂纹、气泡、"
            "材质球轮廓或预览图中的棚拍窗格高光"
        ),
    },
    "baked_enamel": {
        "label": "烤漆",
        "thumbnail": "baked_enamel.png",
        "semantic": (
            "不透明烘烤固化漆面，涂层均匀饱满、遮盖力强，表面平整致密，"
            "具有受控的中等高光和轻微圆润釉感，不呈现金属颗粒"
        ),
        "application": (
            "只应用烘烤固化漆面的遮盖力、表面致密度与釉感；"
            "明暗变化只来自原徽章曲率、浮雕、光源和环境反射"
        ),
        "avoid": "不要生成透明涂层、金属拉丝、闪粉颗粒、橘皮、流挂、气泡或塑料感",
    },
    "transparent_lacquer": {
        "label": "透明漆",
        "thumbnail": "transparent_lacquer.png",
        "semantic": (
            "透明清漆层允许下方基材、纹理和既有明暗透过，表面形成薄而连续的"
            "清漆高光，通透且不浑浊；只增加透明涂层的光学响应"
        ),
        "application": (
            "保留下方结构、纹理和金属反射，只应用薄而连续的透明清漆质感，"
            "不得把区域处理成不透明塑料"
        ),
        "avoid": "不要生成磨砂雾面、强遮盖涂层、果冻厚块、液滴或气泡",
    },
    "satin_gold": {
        "label": "亚金",
        "thumbnail": "satin_gold.png",
        "preview_keep_color": True,
        "intrinsic_color_hex": "#c8a86b",
        "semantic": (
            "亚光缎面金属表面，金属度高、反射柔和而宽、粗糙度中等，"
            "细腻均匀的微磨砂纹理抑制清晰镜面倒影，同时保留真实金属高光"
        ),
        "application": "保持真实金属响应，并让柔和反射服从原有光照和浮雕结构",
        "avoid": "不要生成亮面镜面、塑料感、氧化锈蚀、明显拉丝或金属箔褶皱",
    },
    "satin_silver": {
        "label": "亚银",
        "thumbnail": "satin_silver.png",
        "preview_keep_color": True,
        "intrinsic_color_hex": "#c7cbd0",
        "semantic": (
            "亚光缎面金属表面，金属度高、反射柔和而宽，具有均匀细密的"
            "微磨砂纹理和中等粗糙度，抑制清晰镜面倒影"
        ),
        "application": "保持真实金属响应，并让柔和反射严格继承原有曲率和照明",
        "avoid": "不要生成镜面效果、塑料感、粗砂喷涂、明显拉丝、锈蚀或氧化膜",
    },
    "glitter": {
        "label": "闪粉",
        "thumbnail": "glitter.png",
        "semantic": (
            "透明或半透明树脂层中均匀悬浮大量极细闪粉颗粒，颗粒尺度与徽章协调，"
            "只通过方向随机、密度均匀且克制的多点反射产生闪烁，不覆盖底层图案"
        ),
        "application": "闪光必须响应原场景光源，不能覆盖文字边缘或改变图形轮廓",
        "avoid": "不要生成大亮片、纸屑、粗颗粒砂石、星形装饰、噪点贴图或溢出目标区域的闪光",
    },
    "rhinestone": {
        "label": "水钻",
        "thumbnail": "rhinestone.png",
        "semantic": (
            "规则排列并牢固镶嵌的小尺寸多面切割晶体，晶体通透、折射清晰，"
            "具有锐利但受控的点状高光和细小镶嵌底座；晶体只折射参考图"
            "已有的局部视觉信息"
        ),
        "application": (
            "水钻尺寸、数量和排列必须服从目标区域边界与徽章尺度，"
            "形成贴合原浮雕表面的连续镶嵌区域"
        ),
        "avoid": "不要生成散落宝石、超大珠宝、珍珠、金属铆钉、随机缺口或越出目标轮廓的晶体",
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


def material_prompt_field(material: dict, field: str) -> str:
    return clean_text(material.get(field))


def material_application(material: dict) -> str:
    return material_prompt_field(material, "application")


def build_material_semantics(material: dict) -> str:
    parts = [REFERENCE_COLOR_LOCK]
    for key in ("semantic", "application", "avoid"):
        text = material_prompt_field(material, key)
        if text:
            parts.append(text)
    return "；".join(parts) + "。"


def build_material_prompt(
    material: dict,
    base_prompt: object = DEFAULT_BASE_PROMPT,
    additional_details: object = "",
) -> tuple[str, str]:
    base = normalize_base_prompt(base_prompt)
    semantic = material_prompt_field(material, "semantic")
    application = material_prompt_field(material, "application")
    avoid = material_prompt_field(material, "avoid")
    additional = clean_text(additional_details)

    sections = [
        f"编辑目标：\n{base}。" if base else "",
        f"材质语义：\n{semantic}。" if semantic else "",
        f"参考图颜色锁定：\n{REFERENCE_COLOR_LOCK}。",
        (
            "材质应用：\n"
            "只把上述材质的基材类型、金属度、反射特征、粗糙度和微观表面纹理"
            "应用到目标区域；不要复制预览图中的物体轮廓、背景、构图或棚拍高光。"
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
        (
            "禁止：\n"
            "不得重新设计、重绘、移动、放大、缩小或扭曲任何图形和文字；"
            "不得添加新文字、Logo、装饰、边框、水印或其他物体；"
            + (f"{avoid}。" if avoid else "不得添加与目标材质无关的表面效果。")
        ),
    ]
    prompt = "\n\n".join(section for section in sections if section)
    return prompt, build_material_semantics(material)


def load_material_preview(material: dict) -> torch.Tensor:
    filename = Path(str(material.get("thumbnail") or "")).name
    image_path = MATERIAL_THUMB_DIR / filename
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source)
            if material.get("preview_keep_color"):
                image = image.convert("RGB")
            else:
                image = ImageOps.grayscale(image).convert("RGB")
    except (OSError, ValueError):
        image = Image.new("RGB", (256, 256), (128, 128, 128))
    array = np.asarray(image, dtype=np.float32) / 255.0
    return torch.from_numpy(np.array(array, copy=True)).unsqueeze(0).float()


def _normalize_region_color(value: object, fallback: str) -> str:
    text = str(value or "").strip()
    if not _HEX_COLOR.fullmatch(text):
        return fallback
    digits = text.lstrip("#")
    if len(digits) == 3:
        digits = "".join(character * 2 for character in digits)
    return f"#{digits.lower()}"


def _normalize_region_threshold(value: object) -> int:
    try:
        threshold = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        threshold = 30
    return min(255, max(0, threshold))


def _normalize_region_revision(value: object) -> int:
    try:
        revision = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        revision = 0
    return min(2147483647, max(0, revision))


def _normalize_color_policy(material: dict, value: object) -> str:
    if (
        str(value or "").strip() == MATERIAL_INTRINSIC_COLOR_POLICY
        and _HEX_COLOR.fullmatch(str(material.get("intrinsic_color_hex") or "").strip())
    ):
        return MATERIAL_INTRINSIC_COLOR_POLICY
    return DEFAULT_COLOR_POLICY


def _normalize_region_material_id(
    materials: dict[str, dict],
    value: object,
    fallback: str = DEFAULT_REGION_MATERIAL_ID,
) -> str:
    text = str(value or "").strip()
    if text in materials:
        return text
    for material_id, material in materials.items():
        if str(material.get("label") or "").strip() == text:
            return material_id
    if fallback in materials:
        return fallback
    return next(iter(materials), DEFAULT_REGION_MATERIAL_ID)


def _default_material_region_group(index: int = 0) -> dict:
    return {
        "id": f"material_legacy_{index + 1}",
        "color": DEFAULT_REGION_COLORS[index % len(DEFAULT_REGION_COLORS)],
        "threshold": 30,
        "material_id": DEFAULT_REGION_MATERIAL_ID,
        "color_policy": DEFAULT_COLOR_POLICY,
        "material_strength": DEFAULT_MATERIAL_STRENGTH,
        "reroll_revision": 0,
    }


def _normalize_material_strength(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = DEFAULT_MATERIAL_STRENGTH
    if not np.isfinite(number):
        number = DEFAULT_MATERIAL_STRENGTH
    normalized = round(max(MIN_MATERIAL_STRENGTH, min(MAX_MATERIAL_STRENGTH, number)), 2)
    return int(normalized) if normalized.is_integer() else normalized


def normalize_material_region_config(value: object, materials: dict[str, dict] | None = None) -> dict:
    materials = materials or load_materials()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            value = None
    source = value if isinstance(value, dict) else {}
    default_material_id = _normalize_region_material_id(
        materials,
        source.get("default_material_id"),
    )
    raw_groups = source.get("groups") if isinstance(source.get("groups"), list) else []
    groups = []
    used_ids = set()
    for index, raw_group in enumerate(raw_groups[:MAX_MATERIAL_REGION_GROUPS]):
        group = raw_group if isinstance(raw_group, dict) else {}
        enabled = group.get("enabled", True)
        if isinstance(enabled, str):
            enabled = enabled.strip().lower() not in {"", "0", "false", "no", "off"}
        if not enabled:
            continue
        fallback = _default_material_region_group(index)
        group_id = _SAFE_GROUP_ID.sub("", str(group.get("id") or ""))[:80]
        if not group_id or group_id in used_ids:
            group_id = fallback["id"]
            suffix = index + 1
            while group_id in used_ids:
                suffix += 1
                group_id = f"material_legacy_{suffix}"
        used_ids.add(group_id)
        material_id = _normalize_region_material_id(
            materials,
            group.get("material_id"),
            default_material_id,
        )
        groups.append(
            {
                "id": group_id,
                "color": _normalize_region_color(group.get("color"), fallback["color"]),
                "threshold": _normalize_region_threshold(group.get("threshold")),
                "material_id": material_id,
                "color_policy": _normalize_color_policy(materials[material_id], group.get("color_policy")),
                "material_strength": _normalize_material_strength(group.get("material_strength")),
                "reroll_revision": _normalize_region_revision(group.get("reroll_revision")),
            }
        )
    if not groups:
        groups.append(_default_material_region_group())
    return {
        "version": 2,
        "revision": _normalize_region_revision(source.get("revision")),
        "default_material_id": default_material_id,
        "groups": groups,
    }


def encode_material_region_config(value: object, materials: dict[str, dict] | None = None) -> str:
    config = normalize_material_region_config(value, materials)
    return json.dumps(config, ensure_ascii=False, separators=(",", ":"))


def material_region_config_digest(value: object, materials: dict[str, dict] | None = None) -> str:
    return hashlib.sha256(encode_material_region_config(value, materials).encode("utf-8")).hexdigest()


def _get_material_region_config(unique_id=None, extra_pnginfo=None) -> dict:
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
    value = None
    for node in nodes:
        if isinstance(node, dict) and str(node.get("id")) == str(unique_id):
            properties = node.get("properties", {})
            if isinstance(properties, dict):
                value = properties.get(MATERIAL_REGION_V1_CONFIG_PROPERTY)
            break
    return normalize_material_region_config(value)


def _resolve_material_region_config(
    material_region_config="",
    unique_id=None,
    extra_pnginfo=None,
) -> dict:
    if material_region_config is not None and str(material_region_config).strip():
        return normalize_material_region_config(material_region_config)
    return _get_material_region_config(unique_id, extra_pnginfo)


def _validate_region_images(images: torch.Tensor) -> tuple[torch.Tensor, float]:
    if not isinstance(images, torch.Tensor):
        raise TypeError("images must be a torch.Tensor in ComfyUI IMAGE format [B, H, W, C].")
    if images.ndim != 4 or images.shape[-1] not in (3, 4):
        raise ValueError(f"images must have shape [B, H, W, 3 or 4]; received {tuple(images.shape)}.")
    if min(images.shape[:3]) < 1 or not images.is_floating_point():
        raise ValueError("images must have non-empty floating-point dimensions.")
    if not torch.isfinite(images).all().item():
        raise ValueError("images contains NaN or infinite pixel values.")
    rgb = images[..., :3]
    minimum, maximum = rgb.amin().item(), rgb.amax().item()
    if minimum < 0.0 or maximum > 255.0:
        raise ValueError(f"images pixel values must be in [0, 1] or [0, 255]; received [{minimum}, {maximum}].")
    return rgb, maximum


def _normalize_foreground_mask(
    foreground_mask: torch.Tensor | None,
    images: torch.Tensor,
) -> tuple[torch.Tensor, str]:
    shape = images.shape[:3]
    if foreground_mask is None:
        if images.shape[-1] == 4:
            alpha = images[..., 3].to(dtype=torch.float32)
            if alpha.amax().item() > 1.0:
                alpha = alpha / 255.0
            return alpha > 0.0, "image_alpha"
        return torch.ones(shape, dtype=torch.bool, device=images.device), "full_canvas"

    mask = foreground_mask
    if not isinstance(mask, torch.Tensor):
        raise TypeError("foreground_mask must be a torch.Tensor.")
    if mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if mask.ndim != 3:
        raise ValueError(f"foreground_mask must have shape [B, H, W]; received {tuple(mask.shape)}.")
    if mask.shape[1:] != shape[1:]:
        raise ValueError("foreground_mask and images must share the same canvas dimensions.")
    if mask.shape[0] == 1 and shape[0] > 1:
        mask = mask.expand(shape[0], -1, -1)
    if mask.shape[0] != shape[0]:
        raise ValueError("foreground_mask batch must be 1 or match the image batch.")
    mask = mask.to(device=images.device, dtype=torch.float32)
    if not torch.isfinite(mask).all().item():
        raise ValueError("foreground_mask contains NaN or infinite values.")
    return mask > 0.5, "foreground_mask"


def _parse_region_color(value: str, device) -> torch.Tensor:
    normalized = _normalize_region_color(value, "#000000")
    channels = [int(normalized[index:index + 2], 16) / 255.0 for index in (1, 3, 5)]
    return torch.tensor(channels, dtype=torch.float32, device=device)


def _material_color_rule(material_id: str, color_policy: str = DEFAULT_COLOR_POLICY) -> str:
    material = load_materials().get(material_id, {})
    intrinsic = _normalize_region_color(material.get("intrinsic_color_hex"), "#000000")
    if color_policy == MATERIAL_INTRINSIC_COLOR_POLICY and material.get("intrinsic_color_hex"):
        return (
            f"Use the catalog-declared intrinsic material color {intrinsic} as the chroma target for this region. "
            "This explicit per-region material exception must not recolor adjacent regions."
        )
    return (
        "Change surface response only. Strictly preserve the region's intrinsic color from Image 2, "
        "including its hue, saturation, and base-value relationship."
    )


def build_material_region_semantics(assignment: dict, materials: dict[str, dict] | None = None) -> str:
    materials = materials or load_materials()
    default_id = _normalize_region_material_id(materials, assignment.get("default_material_id"))
    default_material = materials[default_id]
    sections = [
        (
            "MATERIAL IMAGE ROLE\n"
            "Image 1 is the neutral grayscale height-stage relief proof and the sole authority for macro relief, "
            "front-to-back ordering, silhouette, visible text, artwork layout, proportions, and element positions. "
            "Its gray values and neutral shading describe geometry only; they are not output colors or material cues. "
            "Edit Image 1 in place; do not reconstruct the badge from scratch. Image 2 is the original flat badge "
            "artwork and the sole authority for intrinsic colors, source-color regions, and exact region boundaries. "
            "The hexadecimal values below are source-region selectors for Image 2 only. They are not output colors "
            "and must never be interpreted as recoloring instructions."
        ),
        (
            "MATERIAL–GEOMETRY SEPARATION\n"
            "A material assignment controls optical response and material-scale surface structure only; it must not "
            "create, remove, raise, lower, bevel, or reshape the badge's macro relief. Image 1 remains the sole "
            "authority for nominal height, edge transitions, and front-to-back ordering. Material-specific microstructure explicitly "
            "required below, such as embedded fine glitter or small crystals, may exist only within the assigned "
            "region and must conform to the existing relief envelope without creating a new badge-level height tier. "
            "Preserve Image 1's highest-level outer rim, contour strokes, text outlines, and metal separator-line "
            "network exactly; no material may flatten, lower, swell, interrupt, or cover that raised structure. "
            "Where materials differ but the encoded height is the same, keep a crisp visual material boundary "
            "on one continuous nominal support surface. Do not add a macro ridge, groove, gap, bevel, or height step "
            "unless Image 2 explicitly specifies one. Within each connected region that shares one material and one "
            "encoded height, keep the underlying support surface continuous and free of unintended seams, facets, "
            "or panel breaks."
        ),
        (
            "DEFAULT MATERIAL\n"
            "Apply transparent clear lacquer to every badge-foreground region not matched by a regional rule. "
            f"{material_prompt_field(default_material, 'semantic')}；"
            f"{material_prompt_field(default_material, 'application')}；"
            f"{_material_color_rule(default_id, DEFAULT_COLOR_POLICY)}"
        ),
    ]
    matched_groups = [group for group in assignment.get("groups", []) if int(group.get("matched_pixels", 0)) > 0]
    if matched_groups:
        lines = []
        for index, group in enumerate(matched_groups, 1):
            material_id = _normalize_region_material_id(materials, group.get("material_id"), default_id)
            material = materials[material_id]
            lines.append(
                f"{index}. For every complete connected source-color region in Image 2 selected by "
                f"{group['color']} with matching tolerance {group['threshold']}/255, apply this surface specification: "
                f"{material_prompt_field(material, 'semantic')}; "
                f"{material_prompt_field(material, 'application')}; "
                f"{_material_color_rule(material_id, group.get('color_policy', DEFAULT_COLOR_POLICY))} "
                f"Avoid: {material_prompt_field(material, 'avoid')}."
            )
        sections.append("REGIONAL MATERIAL ASSIGNMENTS\n" + "\n".join(lines))
    else:
        sections.append(
            "REGIONAL MATERIAL ASSIGNMENTS\n"
            "No configured regional rule matched foreground pixels. Apply only the default clear lacquer."
        )
    sections.append(
        "BOUNDARY AND PRESERVATION LOCK\n"
        "Confine every material exactly to its selected Image 2 source-region boundary. Do not cross adjacent colors, "
        "visible text, linework, cutouts, or the outer silhouette. Preserve Image 1's macro relief, exact visible text, "
        "proportions, positions, front-facing camera, and composition. Do not retain Image 1's neutral gray as a final "
        "surface color. Preserve Image 2's artwork and intrinsic colors except where one regional rule explicitly "
        "selects the catalog-declared material_intrinsic color policy."
    )
    return "\n\n".join(sections)


def _make_material_region_outputs(
    images: torch.Tensor,
    config: dict,
    foreground_mask: torch.Tensor | None = None,
) -> tuple[dict, torch.Tensor, torch.Tensor, str, dict, torch.Tensor]:
    materials = load_materials()
    config = normalize_material_region_config(config, materials)
    rgb, maximum = _validate_region_images(images)
    working = rgb.to(dtype=torch.float32)
    if maximum > 1.0:
        working = working / 255.0
    foreground, foreground_source = _normalize_foreground_mask(foreground_mask, images)
    shape = images.shape[:3]
    assigned = torch.full(shape, -1, dtype=torch.int16, device=images.device)
    best_distance = torch.full(shape, float("inf"), dtype=torch.float32, device=images.device)
    candidate_count = torch.zeros(shape, dtype=torch.int16, device=images.device)

    for index, group in enumerate(config["groups"]):
        color = _parse_region_color(group["color"], images.device)
        distance = torch.linalg.vector_norm(working - color, dim=-1)
        within = foreground & (distance <= group["threshold"] / 255.0)
        candidate_count += within.to(dtype=torch.int16)
        selected = within & (distance < best_distance)
        assigned = torch.where(selected, torch.full_like(assigned, index), assigned)
        best_distance = torch.where(selected, distance, best_distance)

    configured_mask = assigned >= 0
    default_mask = foreground & ~configured_mask
    diagnostic = torch.zeros((*shape, 3), dtype=torch.float32, device=images.device)
    gray = working.mean(dim=-1, keepdim=True).expand(-1, -1, -1, 3)
    diagnostic = torch.where(foreground.unsqueeze(-1), gray * 0.55, diagnostic)

    groups = []
    region_masks = []
    for index, group in enumerate(config["groups"]):
        mask = assigned == index
        region_masks.append(mask.to(dtype=torch.float32))
        color = torch.tensor(
            _REGION_DIAGNOSTIC_COLORS[index % len(_REGION_DIAGNOSTIC_COLORS)],
            dtype=torch.float32,
            device=images.device,
        )
        diagnostic = torch.where(mask.unsqueeze(-1), color, diagnostic)
        material_id = _normalize_region_material_id(materials, group["material_id"], config["default_material_id"])
        groups.append(
            {
                **group,
                "material_id": material_id,
                "material_label": clean_text(materials[material_id].get("label") or material_id),
                "matched_pixels": int(mask.sum().item()),
                "mask_batch_start": index * images.shape[0],
                "mask_batch_count": images.shape[0],
            }
        )

    foreground_pixels = int(foreground.sum().item())
    configured_pixels = int(configured_mask.sum().item())
    default_pixels = int(default_mask.sum().item())
    overlap_pixels = int((candidate_count > 1).sum().item())
    default_id = config["default_material_id"]
    assignment = {
        "version": 2,
        "config_revision": config["revision"],
        "config_digest": material_region_config_digest(config, materials),
        "default_material_id": default_id,
        "default_material_label": clean_text(materials[default_id].get("label") or default_id),
        "foreground_source": foreground_source,
        "groups": groups,
        "foreground_pixels": foreground_pixels,
        "configured_pixels": configured_pixels,
        "default_pixels": default_pixels,
        "overlap_pixels": overlap_pixels,
        "excluded_pixels": int((~foreground).sum().item()),
        "total_pixels": int(foreground.numel()),
    }
    missing = [f"{group['color']}→{group['material_label']}" for group in groups if group["matched_pixels"] == 0]
    applied_config = encode_material_region_config(config, materials)
    report = (
        f"Default material: {assignment['default_material_label']}\n"
        f"Foreground source: {foreground_source}\n"
        f"Configured groups: {len(groups)}\n"
        f"Configured pixels: {configured_pixels}\n"
        f"Default-material pixels: {default_pixels}\n"
        f"Overlapping candidate pixels: {overlap_pixels}\n"
        f"Configured but empty: {', '.join(missing) if missing else 'none'}\n"
        f"Config revision: {config['revision']}\n"
        f"Config SHA-256: {assignment['config_digest']}\n"
        f"Applied config: {applied_config}"
    )
    region_mask_batch = torch.cat(region_masks, dim=0) if region_masks else torch.zeros(
        (0, images.shape[1], images.shape[2]), dtype=torch.float32, device=images.device
    )
    region_set = {
        "version": 1,
        "applied_config": config,
        "config_revision": config["revision"],
        "config_digest": assignment["config_digest"],
        "assignment": assignment,
        "region_masks": region_masks,
        "region_mask_batch": region_mask_batch,
    }
    return (
        assignment,
        diagnostic.clamp_(0.0, 1.0),
        default_mask.to(dtype=torch.float32),
        report,
        region_set,
        region_mask_batch,
    )


def make_material_region_assignment(
    images: torch.Tensor,
    config: dict,
    foreground_mask: torch.Tensor | None = None,
) -> tuple[dict, torch.Tensor, torch.Tensor, str]:
    return _make_material_region_outputs(images, config, foreground_mask)[:4]


class DAELabBadgeMaterialRegionV1:
    """Map flat-design source colors to per-region badge material semantics."""

    RETURN_TYPES = (
        "STRING",
        "BADGE_MATERIAL_ASSIGNMENT",
        "IMAGE",
        "MASK",
        "STRING",
        "STRING",
        "INT",
        "STRING",
        "BADGE_MATERIAL_REGION_SET",
        "MASK",
    )
    RETURN_NAMES = (
        "material_semantics",
        "material_assignment",
        "diagnostic_preview",
        "default_material_mask",
        "validation_report",
        "applied_config",
        "config_revision",
        "config_digest",
        "material_region_set",
        "region_mask_batch",
    )
    FUNCTION = "build"
    CATEGORY = "DAELab/Badge/Material"
    DESCRIPTION = (
        "Map source colors in the flat badge design to materials. Source colors locate regions only; "
        "unconfigured foreground defaults to transparent clear lacquer."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"images": ("IMAGE",)},
            "optional": {
                "foreground_mask": ("MASK",),
                MATERIAL_REGION_PROMPT_CONFIG_INPUT: (
                    "STRING",
                    {"default": "", "multiline": False},
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    @classmethod
    def IS_CHANGED(
        cls,
        images,
        foreground_mask=None,
        material_region_config="",
        unique_id=None,
        extra_pnginfo=None,
    ):
        del images, foreground_mask
        config = _resolve_material_region_config(
            material_region_config,
            unique_id,
            extra_pnginfo,
        )
        digest = hashlib.sha256(encode_material_region_config(config).encode("utf-8"))
        try:
            digest.update(MATERIAL_FILE.read_bytes())
        except OSError:
            digest.update(json.dumps(FALLBACK_MATERIALS, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()

    def build(
        self,
        images,
        foreground_mask=None,
        material_region_config="",
        unique_id=None,
        extra_pnginfo=None,
    ):
        config = _resolve_material_region_config(
            material_region_config,
            unique_id,
            extra_pnginfo,
        )
        assignment, diagnostic, default_mask, report, region_set, region_mask_batch = _make_material_region_outputs(
            images,
            config,
            foreground_mask,
        )
        semantics = build_material_region_semantics(assignment)
        applied_config = encode_material_region_config(config)
        digest = material_region_config_digest(config)
        return (
            semantics,
            assignment,
            diagnostic,
            default_mask,
            report,
            applied_config,
            config["revision"],
            digest,
            region_set,
            region_mask_batch,
        )


class GPTImage2MaterialPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        materials = load_materials()
        labels = material_labels(materials)
        return {
            "required": {
                "material_id": (labels, {"default": labels[0]}),
                "base_prompt": (
                    "STRING",
                    {"default": DEFAULT_BASE_PROMPT, "multiline": True},
                ),
                "additional_details": (
                    "STRING",
                    {"default": "", "multiline": True},
                ),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("prompt", "material_semantics", "preview_image")
    FUNCTION = "execute"
    CATEGORY = "GPT-Image/Prompt"
    DESCRIPTION = (
        "Select a badge material and build a deterministic GPT Image 2 edit "
        "prompt. The material changes only physical surface properties, while "
        "Image 1 reference colors remain locked. The grayscale local preview is "
        "not sent to the API by this node."
    )

    def execute(
        self,
        material_id,
        base_prompt=DEFAULT_BASE_PROMPT,
        additional_details="",
    ):
        _, material = resolve_material(load_materials(), material_id)
        prompt, semantics = build_material_prompt(
            material,
            base_prompt=base_prompt,
            additional_details=additional_details,
        )
        return prompt, semantics, load_material_preview(material)

    @classmethod
    def IS_CHANGED(
        cls,
        material_id,
        base_prompt=DEFAULT_BASE_PROMPT,
        additional_details="",
    ):
        digest = hashlib.sha256()
        digest.update(str(material_id).encode("utf-8"))
        digest.update(normalize_base_prompt(base_prompt).encode("utf-8"))
        digest.update(str(additional_details).encode("utf-8"))
        try:
            digest.update(MATERIAL_FILE.read_bytes())
        except OSError:
            digest.update(json.dumps(FALLBACK_MATERIALS, sort_keys=True).encode("utf-8"))
        _, material = resolve_material(load_materials(), material_id)
        thumbnail = MATERIAL_THUMB_DIR / Path(
            str(material.get("thumbnail") or "")
        ).name
        try:
            digest.update(thumbnail.read_bytes())
        except OSError:
            digest.update(b"missing-neutral-material-preview")
        return digest.hexdigest()


NODE_CLASS_MAPPINGS = {
    "GPTImage2MaterialPrompt": GPTImage2MaterialPrompt,
    "DAELabBadgeMaterialRegionV1": DAELabBadgeMaterialRegionV1,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GPTImage2MaterialPrompt": "GPT Image 2 材质提示词",
    "DAELabBadgeMaterialRegionV1": "Badge Material Region V1 (DAELab)",
}
