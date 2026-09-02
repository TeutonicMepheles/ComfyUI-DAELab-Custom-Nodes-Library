import { normalizeColor } from "./multi_color_mask_model.mjs?v=20260827-1";
import { sha256Text } from "./badge_material_region_v1_model.mjs?v=20260901-1";

export const MAX_HEIGHT_GROUPS = 16;
export const BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME = "badge_height_layer_v1_panel";
export const HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME = "height_layer_config";
export const DEFAULT_HEIGHT_COLORS = Object.freeze(["#d0ad7d", "#d4e3e2", "#055652", "#26877f"]);
export const HEIGHT_LAYER_OPTIONS = Object.freeze([
    Object.freeze({ value: 0, label: "镂空（无实体）", height: 0.0, gray: 0 }),
    Object.freeze({ value: 1, label: "最低层", height: 0.2, gray: 51 }),
    Object.freeze({ value: 2, label: "次低层", height: 0.4, gray: 102 }),
    Object.freeze({ value: 3, label: "中间层", height: 0.6, gray: 153 }),
    Object.freeze({ value: 4, label: "次高层", height: 0.8, gray: 204 }),
    Object.freeze({ value: 5, label: "最高层", height: 1.0, gray: 255 }),
]);

export const V1_TOOLBAR_HEIGHT = 34;
export const V1_GROUP_HEIGHT = 66;
export const V1_PANEL_PADDING = 8;

let generatedIdCounter = 0;

function defaultIdFactory() {
    generatedIdCounter += 1;
    const randomPart = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
    return randomPart
        ? `height_${randomPart}`
        : `height_${Date.now().toString(36)}_${generatedIdCounter.toString(36)}`;
}

function asBoolean(value, fallback = true) {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off", ""].includes(normalized)) return false;
        return fallback;
    }
    if (value == null) return fallback;
    return Boolean(value);
}

function normalizeThreshold(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 30;
    return Math.max(0, Math.min(255, Math.round(number)));
}

function cleanGroupId(value) {
    return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function nextLegacyId(sourceIndex, usedIds) {
    let suffix = sourceIndex + 1;
    let candidate = `height_legacy_${suffix}`;
    while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `height_legacy_${suffix}`;
    }
    return candidate;
}

function uniqueGeneratedId(usedIds, idFactory = defaultIdFactory) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const candidate = cleanGroupId(idFactory());
        if (candidate && !usedIds.has(candidate)) return candidate;
    }
    let suffix = usedIds.size + 1;
    while (usedIds.has(`height_${suffix}`)) suffix += 1;
    return `height_${suffix}`;
}

export function normalizeHeightLayer(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.min(5, Math.round(value)));
    }
    const text = String(value ?? "").trim();
    if (!text) return 1;
    if (/cut\s*out|hollow|background|镂空|无实体/i.test(text)) return 0;
    const semanticIndex = HEIGHT_LAYER_OPTIONS.findIndex(({ label }) => text.includes(label));
    if (semanticIndex >= 0) return semanticIndex;
    const layerMatch = text.match(/layer[_\s-]*([0-5])/i);
    if (layerMatch) return Number(layerMatch[1]);
    const heightMatch = text.match(/(?:^|\b)h\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
    if (heightMatch) return Math.max(0, Math.min(5, Math.round(Number(heightMatch[1]) * 5)));
    const numeric = Number(text);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(5, Math.round(numeric))) : 1;
}

export function getHeightLayerOption(value) {
    return HEIGHT_LAYER_OPTIONS[normalizeHeightLayer(value)];
}

export function formatHeightLayerOption(value) {
    const option = getHeightLayerOption(value);
    return `${option.label} · H=${option.height.toFixed(1)} · ${option.gray}/255`;
}

export function createDefaultHeightGroup(index = 0, id = `height_legacy_${index + 1}`) {
    return {
        id,
        color: DEFAULT_HEIGHT_COLORS[index % DEFAULT_HEIGHT_COLORS.length],
        threshold: 30,
        layer: Math.min(5, index + 1),
    };
}

export function normalizeHeightConfig(value) {
    let source = value;
    if (typeof source === "string") {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) source = {};

    const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_HEIGHT_GROUPS) : [];
    const usedIds = new Set();
    const groups = [];
    rawGroups.forEach((rawGroup, sourceIndex) => {
        const group = rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)
            ? rawGroup
            : {};
        if (Object.hasOwn(group, "enabled") && !asBoolean(group.enabled, true)) return;
        const fallback = createDefaultHeightGroup(sourceIndex);
        let id = cleanGroupId(group.id);
        if (!id || usedIds.has(id)) id = nextLegacyId(sourceIndex, usedIds);
        usedIds.add(id);
        groups.push({
            id,
            color: normalizeColor(group.color, fallback.color),
            threshold: normalizeThreshold(group.threshold),
            layer: normalizeHeightLayer(group.layer ?? fallback.layer),
        });
    });
    if (!groups.length) groups.push(createDefaultHeightGroup());
    return { version: 1, groups };
}

export function encodeHeightConfig(value) {
    return JSON.stringify(normalizeHeightConfig(value));
}

export function heightLayerConfigDigest(value) {
    return sha256Text(encodeHeightConfig(value));
}

export function validateHeightLayerConfigSnapshot({
    draft,
    propertyValue,
    widgetValue,
    queueValue,
    invalidHex = [],
}) {
    const invalid = Array.from(invalidHex || []).filter(Boolean);
    if (invalid.length) {
        return { ok: false, encoded: null, digest: null, mismatches: ["invalid_hex"], invalidHex: invalid };
    }
    const encoded = encodeHeightConfig(draft);
    const sources = { property: propertyValue, widget: widgetValue, queue: queueValue };
    const mismatches = Object.entries(sources)
        .filter(([, candidate]) => candidate !== encoded)
        .map(([source]) => source);
    return {
        ok: mismatches.length === 0,
        encoded,
        digest: heightLayerConfigDigest(draft),
        mismatches,
        invalidHex: [],
    };
}

export function syncHeightLayerPromptConfigWidget(
    node,
    widget,
    value,
    { notify = true } = {},
) {
    const encoded = encodeHeightConfig(value);
    if (!widget || typeof widget !== "object") return encoded;
    const previous = widget.value;
    widget.value = encoded;
    if (notify && previous !== encoded) {
        node?.onWidgetChanged?.(widget.name, encoded, previous, widget);
    }
    return encoded;
}

export function bindHeightLayerPromptConfigQueueSync(node, widget, getValue) {
    if (!widget || typeof getValue !== "function") return null;
    const sync = () => syncHeightLayerPromptConfigWidget(
        node,
        widget,
        getValue(),
        { notify: false },
    );
    if (widget._badgeHeightLayerV1QueueSyncBound) return sync;
    const originalBeforeQueued = widget.beforeQueued;
    widget.beforeQueued = function () {
        const result = originalBeforeQueued?.apply(this, arguments);
        sync();
        return result;
    };
    widget.serializeValue = sync;
    widget._badgeHeightLayerV1QueueSyncBound = true;
    return sync;
}

export function resolveSelectedHeightGroupId(value, selectedId = null) {
    const config = normalizeHeightConfig(value);
    const cleanSelectedId = cleanGroupId(selectedId);
    return config.groups.some(({ id }) => id === cleanSelectedId)
        ? cleanSelectedId
        : config.groups[0].id;
}

export function addHeightGroupAfter(value, selectedId = null, idFactory = defaultIdFactory) {
    const config = normalizeHeightConfig(value);
    if (config.groups.length >= MAX_HEIGHT_GROUPS) {
        return { config, selectedId: resolveSelectedHeightGroupId(config, selectedId), addedId: null };
    }
    const selectedIndex = config.groups.findIndex(({ id }) => id === selectedId);
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : config.groups.length;
    const usedIds = new Set(config.groups.map(({ id }) => id));
    const addedId = uniqueGeneratedId(usedIds, idFactory);
    const group = createDefaultHeightGroup(insertionIndex, addedId);
    config.groups.splice(insertionIndex, 0, group);
    return { config, selectedId: addedId, addedId };
}

export function removeSelectedHeightGroup(value, selectedId = null) {
    const config = normalizeHeightConfig(value);
    const resolvedId = resolveSelectedHeightGroupId(config, selectedId);
    if (config.groups.length <= 1) {
        return { config, selectedId: resolvedId, removedId: null };
    }
    const removedIndex = config.groups.findIndex(({ id }) => id === resolvedId);
    const [removed] = config.groups.splice(removedIndex, 1);
    const nextSelection = config.groups[Math.min(removedIndex, config.groups.length - 1)].id;
    return { config, selectedId: nextSelection, removedId: removed.id };
}

export function updateHeightGroup(value, groupId, patch) {
    const config = normalizeHeightConfig(value);
    const index = config.groups.findIndex(({ id }) => id === groupId);
    if (index < 0) return config;
    const next = patch && typeof patch === "object" ? patch : {};
    config.groups[index] = {
        ...config.groups[index],
        ...(Object.hasOwn(next, "color") ? { color: normalizeColor(next.color, config.groups[index].color) } : {}),
        ...(Object.hasOwn(next, "threshold") ? { threshold: normalizeThreshold(next.threshold) } : {}),
        ...(Object.hasOwn(next, "layer") ? { layer: normalizeHeightLayer(next.layer) } : {}),
    };
    return config;
}

export function getBadgeHeightLayerV1PanelHeight(groupCount) {
    const count = Math.max(1, Math.min(MAX_HEIGHT_GROUPS, Math.round(Number(groupCount) || 1)));
    return V1_PANEL_PADDING + V1_TOOLBAR_HEIGHT + count * V1_GROUP_HEIGHT + V1_PANEL_PADDING;
}

function isManagedV1Input(name) {
    return name === BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME
        || name === HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME
        || /^(?:enabled|color|threshold|layer)_\d+$/.test(String(name));
}

export function collapseBadgeHeightLayerV1Inputs(sourceInputs, nodeId) {
    if (!Array.isArray(sourceInputs)) return { inputs: sourceInputs, changed: false };
    const retained = [];
    let panelEntry = null;
    let changed = false;
    for (const entry of sourceInputs) {
        const belongsToNode = Array.isArray(entry) && String(entry[0]) === String(nodeId);
        if (!belongsToNode || !isManagedV1Input(entry[1])) {
            retained.push(entry);
            continue;
        }
        if (!panelEntry) {
            panelEntry = entry[1] === BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME
                ? entry
                : [entry[0], BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME, ...entry.slice(2)];
        }
        if (entry[1] !== BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME || panelEntry !== entry) changed = true;
    }
    if (!panelEntry) return { inputs: sourceInputs, changed: false };
    const insertionIndex = sourceInputs.findIndex((entry) => (
        Array.isArray(entry) && String(entry[0]) === String(nodeId) && isManagedV1Input(entry[1])
    ));
    retained.splice(Math.min(insertionIndex, retained.length), 0, panelEntry);
    const identical = retained.length === sourceInputs.length
        && retained.every((entry, index) => entry === sourceInputs[index]);
    return { inputs: identical ? sourceInputs : retained, changed: changed || !identical };
}
