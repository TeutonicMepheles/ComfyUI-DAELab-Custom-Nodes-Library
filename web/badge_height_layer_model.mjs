import { normalizeColor } from "./multi_color_mask_model.mjs";


export const MAX_COLOR_GROUPS = 16;
export const DEFAULT_COLORS = Object.freeze(["#d0ad7d", "#d4e3e2", "#055652", "#26877f"]);
export const LAYER_LABELS = Object.freeze([
    "Cut Out (0.0)",
    "Layer 1 (0.2)",
    "Layer 2 (0.4)",
    "Layer 3 (0.6)",
    "Layer 4 (0.8)",
    "Layer 5 (1.0)",
]);

function asBoolean(value, fallback = false) {
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

export function normalizeLayer(value) {
    if (typeof value === "string" && /cut\s*out|hollow|background/i.test(value)) return 0;
    const match = String(value ?? "").match(/(?:layer[_\s-]*)?([0-5])/i);
    if (!match) return 1;
    return Math.max(0, Math.min(5, Number(match[1])));
}

export function layerWidgetValue(value) {
    return LAYER_LABELS[normalizeLayer(value)];
}

export function createDefaultGroup(index = 0) {
    return {
        enabled: true,
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        threshold: 30,
        layer: Math.min(5, index + 1),
    };
}

export function normalizeConfig(value) {
    let source = value;
    if (typeof source === "string") {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) source = {};

    const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_COLOR_GROUPS) : [];
    const groups = rawGroups.map((rawGroup, index) => {
        const fallback = createDefaultGroup(index);
        const group = rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)
            ? rawGroup
            : {};
        return {
            enabled: asBoolean(group.enabled, fallback.enabled),
            color: normalizeColor(group.color, fallback.color),
            threshold: normalizeThreshold(group.threshold),
            layer: normalizeLayer(group.layer ?? fallback.layer),
        };
    });
    if (!groups.length) groups.push(createDefaultGroup());
    return { version: 1, groups };
}

export function encodeConfig(value) {
    return JSON.stringify(normalizeConfig(value));
}

export function addGroup(value) {
    const config = normalizeConfig(value);
    if (config.groups.length < MAX_COLOR_GROUPS) {
        config.groups.push(createDefaultGroup(config.groups.length));
    }
    return config;
}

export function removeLastGroup(value) {
    const config = normalizeConfig(value);
    if (config.groups.length > 1) config.groups.pop();
    return config;
}

export function updateGroup(value, index, patch) {
    const config = normalizeConfig(value);
    if (!config.groups[index]) return config;
    config.groups[index] = {
        ...config.groups[index],
        ...(patch && typeof patch === "object" ? patch : {}),
    };
    return normalizeConfig(config);
}
