import {
    COMBINED_OUTPUT,
    DEFAULT_COLORS,
    normalizeColor,
} from "./multi_color_mask_model.mjs?v=20260827-1";

export { COMBINED_OUTPUT };
export const MAX_MASK_V1_GROUPS = 16;
export const MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME = "multi_color_mask_v1_panel";
export const MASK_V1_TOOLBAR_HEIGHT = 34;
export const MASK_V1_GROUP_HEIGHT = 66;
export const MASK_V1_PANEL_PADDING = 8;

let generatedIdCounter = 0;

function defaultIdFactory() {
    generatedIdCounter += 1;
    const randomPart = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
    return randomPart
        ? `mask_${randomPart}`
        : `mask_${Date.now().toString(36)}_${generatedIdCounter.toString(36)}`;
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
    let candidate = `mask_legacy_${suffix}`;
    while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `mask_legacy_${suffix}`;
    }
    return candidate;
}

function uniqueGeneratedId(usedIds, idFactory = defaultIdFactory) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const candidate = cleanGroupId(idFactory());
        if (candidate && !usedIds.has(candidate)) return candidate;
    }
    let suffix = usedIds.size + 1;
    while (usedIds.has(`mask_${suffix}`)) suffix += 1;
    return `mask_${suffix}`;
}

function parseSource(value) {
    let source = value;
    if (typeof source === "string") {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }
    return source && typeof source === "object" && !Array.isArray(source) ? source : {};
}

function requestedOutputIndex(output) {
    const match = String(output ?? "").trim().toLowerCase().match(/^mask_(\d+)$/);
    return match ? Number(match[1]) - 1 : -1;
}

export function createDefaultMaskGroup(index = 0, id = `mask_legacy_${index + 1}`) {
    return {
        id,
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        threshold: 30,
        invert: false,
    };
}

export function normalizeMaskV1Config(value) {
    const source = parseSource(value);
    const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_MASK_V1_GROUPS) : [];
    const requestedIndex = requestedOutputIndex(source.output);
    const usedIds = new Set();
    const groups = [];
    let requestedGroupId = null;

    rawGroups.forEach((rawGroup, sourceIndex) => {
        const group = rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)
            ? rawGroup
            : {};
        if (Object.hasOwn(group, "enabled") && !asBoolean(group.enabled, true)) return;
        const fallback = createDefaultMaskGroup(sourceIndex);
        let id = cleanGroupId(group.id);
        if (!id || usedIds.has(id)) id = nextLegacyId(sourceIndex, usedIds);
        usedIds.add(id);
        groups.push({
            id,
            color: normalizeColor(group.color, fallback.color),
            threshold: normalizeThreshold(group.threshold),
            invert: asBoolean(group.invert, false),
        });
        if (sourceIndex === requestedIndex) requestedGroupId = id;
    });
    if (!groups.length) groups.push(createDefaultMaskGroup());

    const requestedGroupIndex = groups.findIndex(({ id }) => id === requestedGroupId);
    return {
        version: 1,
        groups,
        output: requestedGroupIndex >= 0 ? `mask_${requestedGroupIndex + 1}` : COMBINED_OUTPUT,
    };
}

export function encodeMaskV1Config(value) {
    return JSON.stringify(normalizeMaskV1Config(value));
}

export function resolveSelectedMaskGroupId(value, selectedId = null) {
    const config = normalizeMaskV1Config(value);
    const cleanSelectedId = cleanGroupId(selectedId);
    return config.groups.some(({ id }) => id === cleanSelectedId)
        ? cleanSelectedId
        : config.groups[0].id;
}

export function getMaskOutputGroupId(value) {
    const config = normalizeMaskV1Config(value);
    const index = requestedOutputIndex(config.output);
    return index >= 0 ? config.groups[index]?.id ?? null : null;
}

function remapOutput(config, groupId) {
    const index = config.groups.findIndex(({ id }) => id === groupId);
    config.output = index >= 0 ? `mask_${index + 1}` : COMBINED_OUTPUT;
    return config;
}

export function maskOutputChoices(value) {
    const config = normalizeMaskV1Config(value);
    return [COMBINED_OUTPUT, ...config.groups.map((_group, index) => `mask_${index + 1}`)];
}

export function formatMaskOutputChoice(value) {
    if (value === COMBINED_OUTPUT) return "合并全部颜色";
    const index = requestedOutputIndex(value);
    return index >= 0 ? `仅颜色 ${index + 1}` : "合并全部颜色";
}

export function setMaskOutput(value, output) {
    const config = normalizeMaskV1Config(value);
    config.output = maskOutputChoices(config).includes(output) ? output : COMBINED_OUTPUT;
    return config;
}

export function addMaskGroupAfter(value, selectedId = null, idFactory = defaultIdFactory) {
    const config = normalizeMaskV1Config(value);
    if (config.groups.length >= MAX_MASK_V1_GROUPS) {
        return { config, selectedId: resolveSelectedMaskGroupId(config, selectedId), addedId: null };
    }
    const outputGroupId = getMaskOutputGroupId(config);
    const selectedIndex = config.groups.findIndex(({ id }) => id === selectedId);
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : config.groups.length;
    const usedIds = new Set(config.groups.map(({ id }) => id));
    const addedId = uniqueGeneratedId(usedIds, idFactory);
    config.groups.splice(insertionIndex, 0, createDefaultMaskGroup(insertionIndex, addedId));
    remapOutput(config, outputGroupId);
    return { config, selectedId: addedId, addedId };
}

export function removeSelectedMaskGroup(value, selectedId = null) {
    const config = normalizeMaskV1Config(value);
    const resolvedId = resolveSelectedMaskGroupId(config, selectedId);
    if (config.groups.length <= 1) {
        return { config, selectedId: resolvedId, removedId: null };
    }
    const outputGroupId = getMaskOutputGroupId(config);
    const removedIndex = config.groups.findIndex(({ id }) => id === resolvedId);
    const [removed] = config.groups.splice(removedIndex, 1);
    remapOutput(config, outputGroupId === removed.id ? null : outputGroupId);
    const nextSelection = config.groups[Math.min(removedIndex, config.groups.length - 1)].id;
    return { config, selectedId: nextSelection, removedId: removed.id };
}

export function updateMaskGroup(value, groupId, patch) {
    const config = normalizeMaskV1Config(value);
    const index = config.groups.findIndex(({ id }) => id === groupId);
    if (index < 0) return config;
    const next = patch && typeof patch === "object" ? patch : {};
    config.groups[index] = {
        ...config.groups[index],
        ...(Object.hasOwn(next, "color") ? { color: normalizeColor(next.color, config.groups[index].color) } : {}),
        ...(Object.hasOwn(next, "threshold") ? { threshold: normalizeThreshold(next.threshold) } : {}),
        ...(Object.hasOwn(next, "invert") ? { invert: asBoolean(next.invert, config.groups[index].invert) } : {}),
    };
    return config;
}

export function getMultiColorMaskV1PanelHeight(groupCount) {
    const count = Math.max(1, Math.min(MAX_MASK_V1_GROUPS, Math.round(Number(groupCount) || 1)));
    return MASK_V1_PANEL_PADDING + MASK_V1_TOOLBAR_HEIGHT + count * MASK_V1_GROUP_HEIGHT + MASK_V1_PANEL_PADDING;
}

function isManagedV1Input(name) {
    return name === MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME
        || name === "output_mask"
        || /^(?:enabled|color|threshold|invert)_\d+$/.test(String(name));
}

export function collapseMultiColorMaskV1Inputs(sourceInputs, nodeId) {
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
            panelEntry = entry[1] === MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME
                ? entry
                : [entry[0], MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME, ...entry.slice(2)];
        }
        if (entry[1] !== MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME || panelEntry !== entry) changed = true;
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
