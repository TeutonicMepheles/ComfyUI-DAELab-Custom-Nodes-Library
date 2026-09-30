import math

from comfy_api.latest import io


MIN_RELIEF_LEVEL = 0
MAX_RELIEF_LEVEL = 5
DEFAULT_RELIEF_LEVEL = 2

RELIEF_LEVELS = {
    0: {
        "label": "完全平面",
        "description": (
            "Make the badge face completely planar: zero elevation difference "
            "between existing artwork regions, with no relief sidewalls or relief bevels."
        ),
    },
    1: {
        "label": "微浮雕",
        "description": (
            "Apply extremely shallow micro-relief with barely perceptible Z-axis "
            "elevation and only hairline relief sidewalls."
        ),
    },
    2: {
        "label": "浅浮雕",
        "description": (
            "Apply shallow bas-relief with restrained elevation separation, minimal "
            "sidewalls, and subtle edge transitions."
        ),
    },
    3: {
        "label": "中浮雕",
        "description": (
            "Apply moderate bas-relief with clearly visible elevation separation, "
            "controlled sidewalls, and restrained rounded relief bevels."
        ),
    },
    4: {
        "label": "深浮雕",
        "description": (
            "Apply pronounced high-relief with substantial Z-axis separation and "
            "clearly readable depth while preserving every original 2D boundary."
        ),
    },
    5: {
        "label": "高浮雕",
        "description": (
            "Apply strong sculpted high-relief using the maximum plausible elevation "
            "for a manufacturable badge, without changing any silhouette, contour, or artwork."
        ),
    },
}


def normalize_relief_level(value):
    """Normalize persisted or externally connected values to the supported range."""
    try:
        numeric = float(value)
        level = math.floor(numeric + 0.5) if math.isfinite(numeric) else DEFAULT_RELIEF_LEVEL
    except (TypeError, ValueError, OverflowError):
        level = DEFAULT_RELIEF_LEVEL
    return max(MIN_RELIEF_LEVEL, min(MAX_RELIEF_LEVEL, level))


def build_relief_prompt(relief_level):
    level = normalize_relief_level(relief_level)
    spec = RELIEF_LEVELS[level]

    return f"""TASK
Edit Image 1 by changing ONLY the physical surface-relief height of the existing badge.

TARGET RELIEF — LEVEL {level}: {spec["label"]}
{spec["description"]}

IMMUTABLE DESIGN CONSTRAINTS
Treat the existing badge artwork as a completely locked two-dimensional design layer.

- Preserve the exact existing material identity and surface finish, including reflectivity, roughness, polish, grain, and texture.
- Preserve all text verbatim. Keep the exact font, glyph outlines, stroke widths, letter spacing, size, alignment, and position.
- Preserve every original base color and color boundary exactly. Do not change hue, saturation, brightness, opacity, or color grading.
- Preserve every graphic shape, icon, line, pattern, contour, proportion, spacing, and layout exactly.
- Preserve the badge's outer silhouette, dimensions, camera angle, perspective, framing, background, global exposure, white balance, and light direction.

GEOMETRY RULE
Modify only the Z-axis elevation of the existing surface regions, perpendicular to the badge face.
Do not move, expand, shrink, warp, redraw, reinterpret, replace, add, or remove anything in the X/Y image plane.
Any relief sidewall or bevel must remain strictly inside the original shape boundaries and must not alter line widths, glyph contours, graphic edges, or color regions.

LIGHTING RULE
Keep the original material properties and base colors unchanged.
Recalculate only the localized highlights, self-shadows, and ambient occlusion strictly required by the new relief geometry.
Do not simulate relief by changing global contrast, sharpness, saturation, exposure, or depth of field.

This is exclusively a surface height-field edit. It is not a redesign, material change, recoloring, typography change, graphic change, perspective change, overall badge-thickness change, scene-depth change, or camera depth-of-field effect."""


class BadgeReliefPrompt(io.ComfyNode):
    """Compile a discrete badge relief level into a geometry-only edit prompt."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BadgeReliefPrompt",
            display_name="徽章浮雕强度 / Badge Relief",
            category="DAELab/OpenAI",
            description=(
                "Generate a strict image-edit prompt that changes only badge surface relief "
                "while locking material, text, colors, graphics, and composition."
            ),
            search_aliases=[
                "badge relief",
                "badge depth",
                "surface relief",
                "徽章浮雕",
                "浮雕强度",
            ],
            inputs=[
                io.Int.Input(
                    "relief_level",
                    default=DEFAULT_RELIEF_LEVEL,
                    min=MIN_RELIEF_LEVEL,
                    max=MAX_RELIEF_LEVEL,
                    step=1,
                    tooltip="0 完全平面；1 微浮雕；2 浅浮雕；3 中浮雕；4 深浮雕；5 高浮雕。",
                ),
            ],
            outputs=[io.String.Output(display_name="prompt")],
        )

    @classmethod
    def execute(cls, relief_level=DEFAULT_RELIEF_LEVEL):
        return io.NodeOutput(build_relief_prompt(relief_level))


NODE_CLASS_MAPPINGS = {
    "BadgeReliefPrompt": BadgeReliefPrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BadgeReliefPrompt": "徽章浮雕强度 / Badge Relief",
}
