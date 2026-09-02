import { normalizeColor } from "./multi_color_mask_model.mjs?v=20260827-1";

export const BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME = "badge_material_region_v1_panel";
export const MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME = "material_region_config";
export const DEFAULT_REGION_MATERIAL_ID = "transparent_lacquer";
export const DEFAULT_COLOR_POLICY = "preserve";
export const MATERIAL_INTRINSIC_COLOR_POLICY = "material_intrinsic";
export const DEFAULT_MATERIAL_STRENGTH = 1;
export const MIN_MATERIAL_STRENGTH = 0.25;
export const MAX_MATERIAL_STRENGTH = 1.5;
export const INTRINSIC_COLOR_MATERIAL_IDS = Object.freeze(["satin_gold", "satin_silver"]);
export const DEFAULT_REGION_COLORS = Object.freeze(["#d0ad7d", "#d4e3e2", "#055652", "#26877f"]);
export const MAX_MATERIAL_REGION_GROUPS = 16;
export const MATERIAL_REGION_TOOLBAR_HEIGHT = 34;
export const MATERIAL_REGION_GROUP_HEIGHT = 92;
export const MATERIAL_REGION_PANEL_PADDING = 8;

let generatedIdCounter = 0;

function defaultIdFactory() {
    generatedIdCounter += 1;
    const randomPart = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
    return randomPart
        ? `material_${randomPart}`
        : `material_${Date.now().toString(36)}_${generatedIdCounter.toString(36)}`;
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

function normalizeRevision(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(2147483647, Math.round(number)));
}

export function normalizeMaterialStrength(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_MATERIAL_STRENGTH;
    return Math.round(
        Math.max(MIN_MATERIAL_STRENGTH, Math.min(MAX_MATERIAL_STRENGTH, number)) * 100,
    ) / 100;
}

function normalizeColorPolicy(value, materialId = "") {
    return value === MATERIAL_INTRINSIC_COLOR_POLICY
        && INTRINSIC_COLOR_MATERIAL_IDS.includes(materialId)
        ? MATERIAL_INTRINSIC_COLOR_POLICY
        : DEFAULT_COLOR_POLICY;
}

function cleanGroupId(value) {
    return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

export function normalizeMaterialRegionId(value, fallback = DEFAULT_REGION_MATERIAL_ID) {
    const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    return normalized || fallback;
}

function nextLegacyId(sourceIndex, usedIds) {
    let suffix = sourceIndex + 1;
    let candidate = `material_legacy_${suffix}`;
    while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `material_legacy_${suffix}`;
    }
    return candidate;
}

function uniqueGeneratedId(usedIds, idFactory = defaultIdFactory) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const candidate = cleanGroupId(idFactory());
        if (candidate && !usedIds.has(candidate)) return candidate;
    }
    let suffix = usedIds.size + 1;
    while (usedIds.has(`material_${suffix}`)) suffix += 1;
    return `material_${suffix}`;
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

export function createDefaultMaterialRegionGroup(index = 0, id = `material_legacy_${index + 1}`) {
    return {
        id,
        color: DEFAULT_REGION_COLORS[index % DEFAULT_REGION_COLORS.length],
        threshold: 30,
        material_id: DEFAULT_REGION_MATERIAL_ID,
        color_policy: DEFAULT_COLOR_POLICY,
        material_strength: DEFAULT_MATERIAL_STRENGTH,
        reroll_revision: 0,
    };
}

export function normalizeMaterialRegionConfig(value) {
    const source = parseSource(value);
    const rawGroups = Array.isArray(source.groups)
        ? source.groups.slice(0, MAX_MATERIAL_REGION_GROUPS)
        : [];
    const defaultMaterialId = normalizeMaterialRegionId(source.default_material_id);
    const usedIds = new Set();
    const groups = [];

    rawGroups.forEach((rawGroup, sourceIndex) => {
        const group = rawGroup && typeof rawGroup === "object" && !Array.isArray(rawGroup)
            ? rawGroup
            : {};
        if (Object.hasOwn(group, "enabled") && !asBoolean(group.enabled, true)) return;
        const fallback = createDefaultMaterialRegionGroup(sourceIndex);
        let id = cleanGroupId(group.id);
        if (!id || usedIds.has(id)) id = nextLegacyId(sourceIndex, usedIds);
        usedIds.add(id);
        const materialId = normalizeMaterialRegionId(group.material_id, defaultMaterialId);
        groups.push({
            id,
            color: normalizeColor(group.color, fallback.color),
            threshold: normalizeThreshold(group.threshold),
            material_id: materialId,
            color_policy: normalizeColorPolicy(group.color_policy, materialId),
            material_strength: normalizeMaterialStrength(group.material_strength),
            reroll_revision: normalizeRevision(group.reroll_revision),
        });
    });
    if (!groups.length) groups.push(createDefaultMaterialRegionGroup());
    return {
        version: 2,
        revision: normalizeRevision(source.revision),
        default_material_id: defaultMaterialId,
        groups,
    };
}

export function encodeMaterialRegionConfig(value) {
    return JSON.stringify(normalizeMaterialRegionConfig(value));
}

// Synchronous SHA-256 keeps serialization and queue validation deterministic. WebCrypto is
// intentionally not used here because ComfyUI's serializeValue hook is synchronous.
export function sha256Text(value) {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    const words = [];
    const bitLength = bytes.length * 8;
    for (const byte of bytes) words.push(byte);
    words.push(0x80);
    while ((words.length % 64) !== 56) words.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) words.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) words.push((low >>> shift) & 0xff);

    const constants = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const rotate = (number, bits) => (number >>> bits) | (number << (32 - bits));
    const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for (let offset = 0; offset < words.length; offset += 64) {
        const schedule = new Uint32Array(64);
        for (let index = 0; index < 16; index += 1) {
            const start = offset + index * 4;
            schedule[index] = (
                (words[start] << 24) | (words[start + 1] << 16)
                | (words[start + 2] << 8) | words[start + 3]
            ) >>> 0;
        }
        for (let index = 16; index < 64; index += 1) {
            const first = schedule[index - 15];
            const second = schedule[index - 2];
            const sigma0 = rotate(first, 7) ^ rotate(first, 18) ^ (first >>> 3);
            const sigma1 = rotate(second, 17) ^ rotate(second, 19) ^ (second >>> 10);
            schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
        }
        let [a,b,c,d,e,f,g,h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choice + constants[index] + schedule[index]) >>> 0;
            const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g; g = f; f = e; e = (d + temporary1) >>> 0;
            d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
        }
        hash[0]=(hash[0]+a)>>>0; hash[1]=(hash[1]+b)>>>0;
        hash[2]=(hash[2]+c)>>>0; hash[3]=(hash[3]+d)>>>0;
        hash[4]=(hash[4]+e)>>>0; hash[5]=(hash[5]+f)>>>0;
        hash[6]=(hash[6]+g)>>>0; hash[7]=(hash[7]+h)>>>0;
    }
    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function materialRegionConfigDigest(value) {
    return sha256Text(encodeMaterialRegionConfig(value));
}

export function advanceMaterialRegionConfig(value, patch = null) {
    const config = normalizeMaterialRegionConfig(value);
    const next = typeof patch === "function" ? patch(config) ?? config : config;
    const normalized = normalizeMaterialRegionConfig(next);
    normalized.revision = normalizeRevision(config.revision + 1);
    return normalized;
}

export function rerollSelectedMaterialRegion(value, groupId) {
    return advanceMaterialRegionConfig(value, (config) => {
        const group = config.groups.find(({ id }) => id === groupId);
        if (group) group.reroll_revision = normalizeRevision(group.reroll_revision + 1);
        return config;
    });
}

export function validateMaterialRegionConfigSnapshot({
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
    const encoded = encodeMaterialRegionConfig(draft);
    const sources = { property: propertyValue, widget: widgetValue, queue: queueValue };
    const mismatches = Object.entries(sources)
        .filter(([, candidate]) => candidate !== encoded)
        .map(([source]) => source);
    return {
        ok: mismatches.length === 0,
        encoded,
        digest: materialRegionConfigDigest(draft),
        mismatches,
        invalidHex: [],
    };
}

export function syncMaterialRegionPromptConfigWidget(
    node,
    widget,
    value,
    { notify = true } = {},
) {
    const encoded = encodeMaterialRegionConfig(value);
    if (!widget || typeof widget !== "object") return encoded;
    const previous = widget.value;
    widget.value = encoded;
    if (notify && previous !== encoded) {
        node?.onWidgetChanged?.(widget.name, encoded, previous, widget);
    }
    return encoded;
}

export function bindMaterialRegionPromptConfigQueueSync(node, widget, getValue) {
    if (!widget || typeof getValue !== "function") return null;
    const sync = () => syncMaterialRegionPromptConfigWidget(
        node,
        widget,
        getValue(),
        { notify: false },
    );
    if (widget._badgeMaterialRegionV1QueueSyncBound) return sync;
    const originalBeforeQueued = widget.beforeQueued;
    widget.beforeQueued = function () {
        const result = originalBeforeQueued?.apply(this, arguments);
        sync();
        return result;
    };
    widget.serializeValue = sync;
    widget._badgeMaterialRegionV1QueueSyncBound = true;
    return sync;
}

export function resolveSelectedMaterialRegionId(value, selectedId = null) {
    const config = normalizeMaterialRegionConfig(value);
    const cleanSelectedId = cleanGroupId(selectedId);
    return config.groups.some(({ id }) => id === cleanSelectedId)
        ? cleanSelectedId
        : config.groups[0].id;
}

export function addMaterialRegionAfter(value, selectedId = null, idFactory = defaultIdFactory) {
    const config = normalizeMaterialRegionConfig(value);
    if (config.groups.length >= MAX_MATERIAL_REGION_GROUPS) {
        return {
            config,
            selectedId: resolveSelectedMaterialRegionId(config, selectedId),
            addedId: null,
        };
    }
    const selectedIndex = config.groups.findIndex(({ id }) => id === selectedId);
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : config.groups.length;
    const usedIds = new Set(config.groups.map(({ id }) => id));
    const addedId = uniqueGeneratedId(usedIds, idFactory);
    config.groups.splice(
        insertionIndex,
        0,
        createDefaultMaterialRegionGroup(insertionIndex, addedId),
    );
    return { config, selectedId: addedId, addedId };
}

export function removeSelectedMaterialRegion(value, selectedId = null) {
    const config = normalizeMaterialRegionConfig(value);
    const resolvedId = resolveSelectedMaterialRegionId(config, selectedId);
    if (config.groups.length <= 1) {
        return { config, selectedId: resolvedId, removedId: null };
    }
    const removedIndex = config.groups.findIndex(({ id }) => id === resolvedId);
    const [removed] = config.groups.splice(removedIndex, 1);
    const nextSelection = config.groups[Math.min(removedIndex, config.groups.length - 1)].id;
    return { config, selectedId: nextSelection, removedId: removed.id };
}

export function updateMaterialRegion(value, groupId, patch) {
    const config = normalizeMaterialRegionConfig(value);
    const index = config.groups.findIndex(({ id }) => id === groupId);
    if (index < 0) return config;
    const next = patch && typeof patch === "object" ? patch : {};
    config.groups[index] = {
        ...config.groups[index],
        ...(Object.hasOwn(next, "color")
            ? { color: normalizeColor(next.color, config.groups[index].color) }
            : {}),
        ...(Object.hasOwn(next, "threshold")
            ? { threshold: normalizeThreshold(next.threshold) }
            : {}),
        ...(Object.hasOwn(next, "material_id")
            ? { material_id: normalizeMaterialRegionId(next.material_id, config.default_material_id) }
            : {}),
        ...(Object.hasOwn(next, "color_policy")
            ? { color_policy: normalizeColorPolicy(next.color_policy, next.material_id ?? config.groups[index].material_id) }
            : {}),
        ...(Object.hasOwn(next, "material_strength")
            ? { material_strength: normalizeMaterialStrength(next.material_strength) }
            : {}),
        ...(Object.hasOwn(next, "reroll_revision")
            ? { reroll_revision: normalizeRevision(next.reroll_revision) }
            : {}),
    };
    return config;
}

export function getBadgeMaterialRegionV1PanelHeight(groupCount) {
    const count = Math.max(
        1,
        Math.min(MAX_MATERIAL_REGION_GROUPS, Math.round(Number(groupCount) || 1)),
    );
    return MATERIAL_REGION_PANEL_PADDING
        + MATERIAL_REGION_TOOLBAR_HEIGHT
        + count * MATERIAL_REGION_GROUP_HEIGHT
        + MATERIAL_REGION_PANEL_PADDING;
}

function isManagedMaterialRegionInput(name) {
    return name === BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME
        || name === MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME
        || /^(?:enabled|color|threshold|material_id|material_strength)_\d+$/.test(String(name));
}

export function collapseBadgeMaterialRegionV1Inputs(sourceInputs, nodeId) {
    if (!Array.isArray(sourceInputs)) return { inputs: sourceInputs, changed: false };
    const retained = [];
    let panelEntry = null;
    let changed = false;
    for (const entry of sourceInputs) {
        const belongsToNode = Array.isArray(entry) && String(entry[0]) === String(nodeId);
        if (!belongsToNode || !isManagedMaterialRegionInput(entry[1])) {
            retained.push(entry);
            continue;
        }
        if (!panelEntry) {
            panelEntry = entry[1] === BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME
                ? entry
                : [entry[0], BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME, ...entry.slice(2)];
        }
        if (entry[1] !== BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME || panelEntry !== entry) {
            changed = true;
        }
    }
    if (!panelEntry) return { inputs: sourceInputs, changed: false };
    const insertionIndex = sourceInputs.findIndex((entry) => (
        Array.isArray(entry)
        && String(entry[0]) === String(nodeId)
        && isManagedMaterialRegionInput(entry[1])
    ));
    retained.splice(Math.min(insertionIndex, retained.length), 0, panelEntry);
    const identical = retained.length === sourceInputs.length
        && retained.every((entry, index) => entry === sourceInputs[index]);
    return { inputs: identical ? sourceInputs : retained, changed: changed || !identical };
}
