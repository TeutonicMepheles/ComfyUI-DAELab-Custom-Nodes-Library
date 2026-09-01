import { normalizeColor } from "./multi_color_mask_model.mjs";

export const MATERIAL_PANEL_WIDGET_NAME = "material_thumbnail_dom_selector";
export const MATERIAL_COLOR_PICKER_WIDGET_NAME = "material_color_picker";
export const DEFAULT_MATERIAL_COLOR = "auto";
export const DEFAULT_USE_COLOR = true;
export const LEGACY_DEFAULT_MATERIAL_BASE_PROMPT = (
    "仅修改 Image 1 中红色覆盖标记的目标区域；红色仅是编辑区域指示色，" +
    "必须在输出中完全移除，不能成为最终材质颜色。"
);
export const MATERIAL_LAYOUT_COLUMNS = 4;
export const MATERIAL_LAYOUT_GAP = 8;
export const MATERIAL_LAYOUT_MAX_CARD_SIZE = 120;
export const MATERIAL_LAYOUT_HORIZONTAL_INSET = 24;
export const MATERIAL_LAYOUT_VERTICAL_PADDING = 12;
export const MATERIAL_VIEWPORT_MAX_SIZE = 320;
export const MATERIAL_VIEWPORT_GAP = 12;
export const MATERIAL_MIN_NODE_WIDTH = 460;
export const MATERIAL_FALLBACK_NODE_HEIGHT = 880;
const VALID_HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

export function getMaterialThumbnailLayout(width = MATERIAL_MIN_NODE_WIDTH, count = 8) {
    const resolvedWidth = Number.isFinite(Number(width))
        ? Math.max(Number(width), MATERIAL_MIN_NODE_WIDTH)
        : MATERIAL_MIN_NODE_WIDTH;
    const resolvedCount = Math.max(1, Math.trunc(Number(count)) || 1);
    const rowCount = Math.ceil(resolvedCount / MATERIAL_LAYOUT_COLUMNS);
    const availableWidth = Math.max(
        0,
        resolvedWidth
            - MATERIAL_LAYOUT_HORIZONTAL_INSET
            - MATERIAL_LAYOUT_GAP * (MATERIAL_LAYOUT_COLUMNS - 1)
    );
    const cardSize = Math.min(
        MATERIAL_LAYOUT_MAX_CARD_SIZE,
        availableWidth / MATERIAL_LAYOUT_COLUMNS
    );
    return {
        cardSize,
        columns: MATERIAL_LAYOUT_COLUMNS,
        height: MATERIAL_LAYOUT_VERTICAL_PADDING
            + rowCount * cardSize
            + Math.max(0, rowCount - 1) * MATERIAL_LAYOUT_GAP,
        rows: rowCount,
    };
}

export function getMaterialSelectorLayout(width = MATERIAL_MIN_NODE_WIDTH, count = 8) {
    const resolvedWidth = Number.isFinite(Number(width))
        ? Math.max(Number(width), MATERIAL_MIN_NODE_WIDTH)
        : MATERIAL_MIN_NODE_WIDTH;
    const thumbnailLayout = getMaterialThumbnailLayout(resolvedWidth, count);
    const viewportSize = Math.min(
        MATERIAL_VIEWPORT_MAX_SIZE,
        Math.max(0, resolvedWidth - MATERIAL_LAYOUT_HORIZONTAL_INSET)
    );
    return {
        ...thumbnailLayout,
        height: thumbnailLayout.height + viewportSize + MATERIAL_VIEWPORT_GAP,
        thumbnailHeight: thumbnailLayout.height,
        viewportSize,
    };
}

function applyNodeSize(node, size) {
    if (typeof node?.setSize === "function") node.setSize(size);
    else if (node) node.size = size;
}

export function fitMaterialPromptNodeToContent(node) {
    if (!node) return null;
    const currentWidth = Number(node.size?.[0]);
    const width = Math.max(
        MATERIAL_MIN_NODE_WIDTH,
        Number.isFinite(currentWidth) ? currentWidth : 0
    );

    // Modern ComfyUI distributes surplus node height across `auto` widget rows.
    // Resetting height before computeSize makes it measure the widgets' minimum
    // content height instead of feeding the restored workflow height back in.
    applyNodeSize(node, [width, 1]);
    node.arrange?.();
    const computedHeight = Number(node.computeSize?.()?.[1]);
    const height = Number.isFinite(computedHeight) && computedHeight > 1
        ? computedHeight
        : MATERIAL_FALLBACK_NODE_HEIGHT;
    applyNodeSize(node, [width, height]);
    return [width, height];
}

export function isAutomaticMaterialColor(value) {
    return !VALID_HEX_COLOR.test(String(value ?? "").trim());
}

export function resolveMaterialColor(catalog, materialId, value) {
    const fallback = normalizeColor(catalog?.[materialId]?.preview_color, "#6b3f24");
    return isAutomaticMaterialColor(value) ? fallback : normalizeColor(value, fallback);
}

export function isMaterialColorEnabled(value) {
    if (value == null) return DEFAULT_USE_COLOR;
    if (typeof value === "string") {
        return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
    }
    return Boolean(value);
}

export function normalizeMaterialBasePrompt(value) {
    const text = String(value ?? "");
    return text.trim() === LEGACY_DEFAULT_MATERIAL_BASE_PROMPT ? "" : text;
}

export const MATERIAL_WIDGET_SERIALIZATION_ORDER = Object.freeze([
    "material_id",
    "material_color",
    "base_prompt",
    "additional_details",
    "use_color",
]);

const MATERIAL_WIDGET_DISPLAY_ORDER = Object.freeze([
    MATERIAL_PANEL_WIDGET_NAME,
    "material_id",
    "use_color",
    MATERIAL_COLOR_PICKER_WIDGET_NAME,
    "material_color",
    "base_prompt",
    "additional_details",
]);

export const MATERIAL_WIDGET_LABELS = Object.freeze({
    material_id: "材质",
    material_color: "颜色",
    base_prompt: "编辑目标（可选）",
    additional_details: "补充要求",
    use_color: "启用颜色",
});

export function orderMaterialPromptWidgets(widgets) {
    const source = widgets || [];
    const byName = new Map(source.map((widget) => [widget.name, widget]));
    const ordered = MATERIAL_WIDGET_DISPLAY_ORDER
        .map((name) => byName.get(name))
        .filter(Boolean);
    const orderedSet = new Set(ordered);
    return [...ordered, ...source.filter((widget) => !orderedSet.has(widget))];
}

export function getCanonicalMaterialWidgetValues(widgets) {
    const byName = new Map((widgets || []).map((widget) => [widget.name, widget]));
    return MATERIAL_WIDGET_SERIALIZATION_ORDER.map(
        (name) => name === "base_prompt"
            ? normalizeMaterialBasePrompt(byName.get(name)?.value)
            : byName.get(name)?.value ?? null
    );
}

function normalizeMigratedMaterialWidgetValues(values) {
    const normalized = values.slice();
    const basePromptIndex = MATERIAL_WIDGET_SERIALIZATION_ORDER.indexOf("base_prompt");
    normalized[basePromptIndex] = normalizeMaterialBasePrompt(normalized[basePromptIndex]);
    return normalized;
}

export function migrateMaterialWidgetValues(values) {
    if (!Array.isArray(values)) return null;
    const expectedLength = MATERIAL_WIDGET_SERIALIZATION_ORDER.length;
    let migrated = null;
    if (values.length === expectedLength + 1 && values[0] == null) {
        migrated = values.slice(1);
    } else if (values.length === expectedLength && values[0] == null) {
        migrated = [...values.slice(1), DEFAULT_USE_COLOR];
    } else if (values.length === expectedLength) {
        migrated = values.slice();
    } else {
        const previousLength = expectedLength - 1;
        if (values.length === previousLength) {
            if (values[0] == null) {
                migrated = [
                    values[1],
                    DEFAULT_MATERIAL_COLOR,
                    ...values.slice(2),
                    DEFAULT_USE_COLOR,
                ];
            } else {
                migrated = [...values, DEFAULT_USE_COLOR];
            }
        } else {
            const legacyLength = previousLength - 1;
            if (values.length === legacyLength) {
                migrated = [
                    values[0],
                    DEFAULT_MATERIAL_COLOR,
                    ...values.slice(1),
                    DEFAULT_USE_COLOR,
                ];
            }
        }
    }
    return migrated ? normalizeMigratedMaterialWidgetValues(migrated) : null;
}

export function applyMaterialWidgetLabels(widgets) {
    let changed = false;
    for (const widget of widgets || []) {
        const label = MATERIAL_WIDGET_LABELS[widget?.name];
        if (!label || widget.label === label) continue;
        widget.label = label;
        changed = true;
    }
    return changed;
}
