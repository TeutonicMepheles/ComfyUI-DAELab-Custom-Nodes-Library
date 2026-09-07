export const MATERIAL_PANEL_WIDGET_NAME = "material_thumbnail_dom_selector";
export const LEGACY_MATERIAL_COLOR_PICKER_WIDGET_NAME = "material_color_picker";
export const LEGACY_DEFAULT_MATERIAL_BASE_PROMPT = (
    "仅修改 Image 1 中红色覆盖标记的目标区域；红色仅是编辑区域指示色，" +
    "必须在输出中完全移除，不能成为最终材质颜色。"
);
export const MATERIAL_LAYOUT_GAP = 8;
export const MATERIAL_CAROUSEL_CARD_SIZE = 76;
export const MATERIAL_CAROUSEL_BUTTON_SIZE = 28;
export const MATERIAL_CAROUSEL_LABEL_HEIGHT = 22;
export const MATERIAL_LAYOUT_HORIZONTAL_INSET = 20;
export const MATERIAL_LAYOUT_VERTICAL_PADDING = 12;
export const MATERIAL_MIN_NODE_WIDTH = 460;
export const MATERIAL_FALLBACK_NODE_HEIGHT = 360;
export const LEGACY_MATERIAL_OUTPUT_NAME = "selected_color";

export function isLegacyMaterialOutput(output) {
    return [output?.name, output?.localized_name, output?.label]
        .some((name) => name === LEGACY_MATERIAL_OUTPUT_NAME);
}

export function getLegacyMaterialOutputIndexes(outputs) {
    const indexes = [];
    for (const [index, output] of (outputs || []).entries()) {
        if (isLegacyMaterialOutput(output)) indexes.push(index);
    }
    return indexes;
}

export function getCanonicalMaterialOutputs(outputs) {
    return (outputs || []).filter((output) => !isLegacyMaterialOutput(output));
}

export function getMaterialCarouselLayout(width = MATERIAL_MIN_NODE_WIDTH, count = 8) {
    const resolvedWidth = Number.isFinite(Number(width))
        ? Math.max(Number(width), MATERIAL_MIN_NODE_WIDTH)
        : MATERIAL_MIN_NODE_WIDTH;
    const resolvedCount = Math.max(1, Math.trunc(Number(count)) || 1);
    const availableWidth = Math.max(
        MATERIAL_CAROUSEL_CARD_SIZE,
        resolvedWidth
            - MATERIAL_LAYOUT_HORIZONTAL_INSET
            - MATERIAL_CAROUSEL_BUTTON_SIZE * 2
            - MATERIAL_LAYOUT_GAP * 2
    );
    return {
        cardSize: MATERIAL_CAROUSEL_CARD_SIZE,
        columns: Math.min(resolvedCount, Math.max(1, Math.floor(
            (availableWidth + MATERIAL_LAYOUT_GAP)
            / (MATERIAL_CAROUSEL_CARD_SIZE + MATERIAL_LAYOUT_GAP)
        ))),
        height: MATERIAL_LAYOUT_VERTICAL_PADDING
            + MATERIAL_CAROUSEL_LABEL_HEIGHT
            + MATERIAL_CAROUSEL_CARD_SIZE,
        rows: 1,
        scrollable: resolvedCount > 1,
        viewportWidth: availableWidth,
    };
}

export function getMaterialSelectorLayout(width = MATERIAL_MIN_NODE_WIDTH, count = 8) {
    return getMaterialCarouselLayout(width, count);
}

export function wrapMaterialIndex(index, count) {
    const length = Math.max(0, Math.trunc(Number(count)) || 0);
    if (!length) return -1;
    const numeric = Math.trunc(Number(index)) || 0;
    return ((numeric % length) + length) % length;
}

export function getMaterialCardSelectionState(entry, selectedId) {
    const id = String(entry?.id ?? "");
    const label = String(entry?.label || id);
    const selected = Boolean(id) && id === String(selectedId ?? "");
    return {
        selected,
        ariaLabel: selected ? `${label}，当前材质` : label,
        ariaSelected: String(selected),
        tabIndex: selected ? 0 : -1,
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

    applyNodeSize(node, [width, 1]);
    node.arrange?.();
    const computedHeight = Number(node.computeSize?.()?.[1]);
    const height = Number.isFinite(computedHeight) && computedHeight > 1
        ? computedHeight
        : MATERIAL_FALLBACK_NODE_HEIGHT;
    applyNodeSize(node, [width, height]);
    return [width, height];
}

export function normalizeMaterialBasePrompt(value) {
    const text = String(value ?? "");
    return text.trim() === LEGACY_DEFAULT_MATERIAL_BASE_PROMPT ? "" : text;
}

export const MATERIAL_WIDGET_SERIALIZATION_ORDER = Object.freeze([
    "material_id",
    "base_prompt",
    "additional_details",
]);

const MATERIAL_WIDGET_DISPLAY_ORDER = Object.freeze([
    MATERIAL_PANEL_WIDGET_NAME,
    "material_id",
    "base_prompt",
    "additional_details",
]);

export const MATERIAL_WIDGET_LABELS = Object.freeze({
    material_id: "材质",
    base_prompt: "编辑目标（可选）",
    additional_details: "补充要求",
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

function normalizeMigratedValues(values) {
    const normalized = values.slice(0, MATERIAL_WIDGET_SERIALIZATION_ORDER.length);
    normalized[1] = normalizeMaterialBasePrompt(normalized[1]);
    return normalized;
}

export function migrateMaterialWidgetValues(values) {
    if (!Array.isArray(values)) return null;

    // Current achromatic schema: material, edit target, additional details.
    if (values.length === 3) return normalizeMigratedValues(values);
    if (values.length === 4 && values[0] == null) {
        return normalizeMigratedValues(values.slice(1));
    }

    // Legacy color schema:
    // material, color, edit target, additional details[, enable color].
    if (values.length === 5) {
        return normalizeMigratedValues([values[0], values[2], values[3]]);
    }
    if (values.length === 6 && values[0] == null) {
        return normalizeMigratedValues([values[1], values[3], values[4]]);
    }
    if (values.length === 4) {
        return normalizeMigratedValues([values[0], values[2], values[3]]);
    }
    return null;
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
