export const MAX_MASK_GROUPS = 16;
export const COMBINED_OUTPUT = "combined_mask";
export const DEFAULT_COLORS = Object.freeze(["#0000ff", "#00ff00", "#ff0000", "#ffffff"]);

const VALID_COLOR = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

export function normalizeColor(value, fallback = "#000000") {
    const text = typeof value === "string" ? value.trim() : "";
    if (!VALID_COLOR.test(text)) return fallback;

    let digits = text.replace(/^#/, "");
    if (digits.length === 3) digits = [...digits].map((character) => character.repeat(2)).join("");
    return `#${digits.toLowerCase()}`;
}

export function commitColorWidgetValue(widget, node, value, onChange) {
    if (!widget || typeof widget !== "object") return normalizeColor(value);

    const previousValue = widget.value;
    const normalized = normalizeColor(value, normalizeColor(previousValue));
    widget.value = normalized;
    node?.onWidgetChanged?.(widget.name, normalized, previousValue, widget);
    onChange?.(normalized);
    if (node?.graph && Number.isFinite(Number(node.graph._version))) {
        node.graph._version += 1;
    }
    node?.setDirtyCanvas?.(true, true);
    node?.graph?.setDirtyCanvas?.(true, true);
    widget.triggerDraw?.();
    return normalized;
}

export function createDefaultGroup(index = 0) {
    return {
        enabled: true,
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        threshold: 30,
        invert: false,
    };
}

function normalizeThreshold(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 30;
    return Math.max(0, Math.min(255, Math.round(number)));
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

    const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_MASK_GROUPS) : [];
    const groups = rawGroups.map((rawGroup, index) => {
        const fallback = createDefaultGroup(index);
        const group = rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)
            ? rawGroup
            : {};
        return {
            enabled: asBoolean(group.enabled, fallback.enabled),
            color: normalizeColor(group.color, fallback.color),
            threshold: normalizeThreshold(group.threshold),
            invert: asBoolean(group.invert, fallback.invert),
        };
    });
    if (!groups.length) groups.push(createDefaultGroup());

    const output = String(source.output ?? COMBINED_OUTPUT).trim().toLowerCase();
    const choices = outputChoices(groups.length);
    return {
        version: 1,
        groups,
        output: choices.includes(output) ? output : COMBINED_OUTPUT,
    };
}

export function encodeConfig(value) {
    return JSON.stringify(normalizeConfig(value));
}

export function outputChoices(groupCount) {
    const count = Math.max(1, Math.min(MAX_MASK_GROUPS, Number(groupCount) || 1));
    return [COMBINED_OUTPUT, ...Array.from({ length: count }, (_, index) => `mask_${index + 1}`)];
}

export function addGroup(value) {
    const config = normalizeConfig(value);
    if (config.groups.length < MAX_MASK_GROUPS) {
        config.groups.push(createDefaultGroup(config.groups.length));
    }
    return config;
}

export function removeLastGroup(value) {
    const config = normalizeConfig(value);
    if (config.groups.length > 1) config.groups.pop();
    if (!outputChoices(config.groups.length).includes(config.output)) config.output = COMBINED_OUTPUT;
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
