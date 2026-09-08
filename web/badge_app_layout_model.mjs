import {
    getSelectedInputEntries,
    resolveNode,
} from "./app_mode_bypass_model.mjs";
import {
    normalizeImageSelection,
} from "./app_mode_load_image_preview_model.mjs";

export const BADGE_APP_LAYOUT_PROPERTY = "daelabAppLayoutV1";
export const BADGE_APP_LAYOUT_VERSION = 1;
export const BADGE_APP_LAYOUT_ACTIVE_ATTRIBUTE = "data-daelab-app-layout-active";
export const BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE = "data-daelab-app-layout-hidden";
export const BADGE_APP_LAYOUT_TAB_IDS = Object.freeze([
    "control",
    "build",
    "local",
    "studio",
]);

function fail(error) {
    return { ok: false, error };
}

function text(value) {
    return String(value ?? "").trim();
}

function stringArray(value) {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : null;
}

function sameSet(left, right) {
    return left.length === right.length && new Set(left).size === left.length
        && left.every((value) => right.includes(value));
}

function parseHierarchyItems(node) {
    const source = node?.daelabBooleanHierarchyV1?.getState?.()
        ?? node?._booleanHierarchyItems
        ?? node?.properties?.boolean_list_items
        ?? node?.widgets_values_named?.config_json
        ?? node?.widgets_values?.[0]
        ?? [];
    if (Array.isArray(source)) return source;
    try {
        const parsed = JSON.parse(source || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function readHierarchyState(node) {
    return parseHierarchyItems(node).map((item) => ({
        ...item,
        id: text(item?.id),
        value: Boolean(item?.value),
        parent_id: text(item?.parent_id) || null,
        requires_ids: stringArray(item?.requires_ids) || [],
    }));
}

function validateItemId(itemIds, value, context) {
    const itemId = text(value);
    if (!itemId || !itemIds.has(itemId)) {
        throw new Error(`${context} references unknown hierarchy item: ${itemId || "<empty>"}`);
    }
    return itemId;
}

function normalizeQuickControl(raw, tabId, itemIds) {
    const id = text(raw?.id);
    const label = text(raw?.label);
    const kind = text(raw?.kind);
    if (!id || !label || !["toggle", "choice"].includes(kind)) {
        throw new Error(`Tab ${tabId} contains an invalid quick control.`);
    }
    if (kind === "toggle") {
        return {
            id,
            label,
            kind,
            itemId: validateItemId(itemIds, raw.itemId, `Quick control ${id}`),
        };
    }
    if (!Array.isArray(raw.items) || raw.items.length < 2) {
        throw new Error(`Choice quick control ${id} needs at least two items.`);
    }
    const items = raw.items.map((item) => ({
        itemId: validateItemId(itemIds, item?.itemId, `Quick control ${id}`),
        label: text(item?.label),
    }));
    if (items.some((item) => !item.label) || new Set(items.map((item) => item.itemId)).size !== items.length) {
        throw new Error(`Choice quick control ${id} has invalid choices.`);
    }
    return { id, label, kind, items };
}

function normalizeReferenceSource(raw, tabById, linearKeySet, itemIds, graph) {
    const id = text(raw?.id);
    const tabId = text(raw?.tabId);
    const kind = text(raw?.kind);
    const title = text(raw?.title);
    const nodeId = text(raw?.nodeId);
    if (!id || !tabById.has(tabId) || !title || !nodeId || !resolveNode(graph, nodeId)) {
        throw new Error(`Reference source ${id || "<unknown>"} has invalid identity or node.`);
    }
    if (!["inputWidget", "executionOutput"].includes(kind)) {
        throw new Error(`Reference source ${id} has an invalid kind.`);
    }

    const focusInputKeys = stringArray(raw.focusInputKeys) || [];
    if (focusInputKeys.some((key) => !linearKeySet.has(key) || !tabById.get(tabId).inputKeys.includes(key))) {
        throw new Error(`Reference source ${id} has an invalid focus input key.`);
    }

    const source = { id, tabId, kind, title, nodeId, focusInputKeys };
    if (raw.visibleWhen) {
        source.visibleWhen = {
            itemId: validateItemId(itemIds, raw.visibleWhen.itemId, `Reference source ${id}`),
            value: raw.visibleWhen.value !== false,
        };
    }
    if (kind === "inputWidget") {
        source.widgetName = text(raw.widgetName);
        source.inputKey = text(raw.inputKey);
        if (!source.widgetName || !linearKeySet.has(source.inputKey)) {
            throw new Error(`Input reference source ${id} has an invalid widget or input key.`);
        }
        const entry = getSelectedInputEntries(graph).find((candidate) => candidate.key === source.inputKey);
        if (!entry || text(entry.nodeId) !== nodeId || entry.widgetName !== source.widgetName) {
            throw new Error(`Input reference source ${id} does not match its linear input.`);
        }
    } else {
        source.outputField = text(raw.outputField);
        if (!source.outputField) {
            throw new Error(`Execution reference source ${id} has no output field.`);
        }
    }
    return source;
}

export function normalizeBadgeAppLayout(graph) {
    const raw = graph?.extra?.[BADGE_APP_LAYOUT_PROPERTY];
    if (!raw) return fail("Workflow has no DAELab App layout configuration.");
    if (raw.version !== BADGE_APP_LAYOUT_VERSION) return fail("Unsupported DAELab App layout version.");

    try {
        const linearKeys = getSelectedInputEntries(graph).map((entry) => entry.key);
        const declaredInputKeys = stringArray(raw.inputKeys);
        if (!declaredInputKeys || !sameSet(declaredInputKeys, linearKeys)) {
            return fail("Layout inputKeys do not exactly match linearData.inputs.");
        }

        if (!Array.isArray(raw.tabs) || raw.tabs.length !== BADGE_APP_LAYOUT_TAB_IDS.length) {
            return fail("Layout must define exactly four tabs.");
        }
        const tabs = raw.tabs.map((tab) => ({
            id: text(tab?.id),
            title: text(tab?.title),
            inputKeys: stringArray(tab?.inputKeys),
            enabledItemId: text(tab?.enabledItemId) || null,
        }));
        if (
            tabs.some((tab) => !tab.title || !tab.inputKeys)
            || !sameSet(tabs.map((tab) => tab.id), BADGE_APP_LAYOUT_TAB_IDS)
        ) {
            return fail("Layout tabs have invalid IDs, titles, or input keys.");
        }
        const assignedKeys = tabs.flatMap((tab) => tab.inputKeys);
        if (!sameSet(assignedKeys, linearKeys)) {
            return fail("Every App Mode input must belong to exactly one tab.");
        }
        const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
        const defaultTab = text(raw.defaultTab);
        if (defaultTab !== "control") return fail("The default tab must be control.");

        const stateNodeId = text(raw.stateSource?.nodeId);
        const stateInterface = text(raw.stateSource?.interface);
        const stateNode = resolveNode(graph, stateNodeId);
        if (!stateNode || stateNode.type !== "BooleanListHierarchy" || stateInterface !== "daelabBooleanHierarchyV1") {
            return fail("Layout stateSource is invalid.");
        }
        const itemIds = new Set(readHierarchyState(stateNode).map((item) => item.id));
        for (const tab of tabs) {
            if (tab.enabledItemId) {
                tab.enabledItemId = validateItemId(itemIds, tab.enabledItemId, `Tab ${tab.id}`);
            }
        }

        const quickControls = {};
        for (const tabId of BADGE_APP_LAYOUT_TAB_IDS) {
            const controls = raw.quickControls?.[tabId] ?? [];
            if (!Array.isArray(controls)) return fail(`Quick controls for ${tabId} must be an array.`);
            quickControls[tabId] = controls.map((control) => normalizeQuickControl(control, tabId, itemIds));
        }

        const polygonChange = raw.polygonChange;
        const polygonNodeId = text(polygonChange?.nodeId);
        const polygonNode = resolveNode(graph, polygonNodeId);
        if (!polygonNode || !["DAELAB.PolygonMaskV1", "DAELAB.BadgeSelectionMaskV1"].includes(polygonNode.type)) {
            return fail("polygonChange references an invalid DAELab Polygon Mask node.");
        }
        const polygonSelectionItemId = validateItemId(
            itemIds,
            polygonChange?.selectionItemId,
            "polygonChange selectionItemId",
        );
        const polygonApplyItemId = validateItemId(
            itemIds,
            polygonChange?.applyItemId,
            "polygonChange applyItemId",
        );

        if (!Array.isArray(raw.referenceSources)) return fail("referenceSources must be an array.");
        const linearKeySet = new Set(linearKeys);
        const referenceSources = raw.referenceSources.map(
            (source) => normalizeReferenceSource(source, tabById, linearKeySet, itemIds, graph)
        );
        if (new Set(referenceSources.map((source) => source.id)).size !== referenceSources.length) {
            return fail("Reference source IDs must be unique.");
        }

        return {
            ok: true,
            layout: {
                version: BADGE_APP_LAYOUT_VERSION,
                defaultTab,
                stateSource: { nodeId: stateNodeId, interface: stateInterface },
                stateNode,
                inputKeys: declaredInputKeys,
                tabs,
                tabById,
                quickControls,
                polygonChange: {
                    nodeId: polygonNodeId,
                    selectionItemId: polygonSelectionItemId,
                    applyItemId: polygonApplyItemId,
                },
                referenceSources,
                signature: JSON.stringify(raw),
            },
        };
    } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }
}

export function itemValue(state, itemId) {
    return Boolean(state?.find((item) => item.id === itemId)?.value);
}

export function getTabAvailability(layout, state) {
    return new Map(layout.tabs.map((tab) => [
        tab.id,
        !tab.enabledItemId || itemValue(state, tab.enabledItemId),
    ]));
}

export function resolveActiveTab(layout, requestedTabId, state) {
    const requested = layout.tabById.has(requestedTabId) ? requestedTabId : layout.defaultTab;
    return getTabAvailability(layout, state).get(requested) ? requested : layout.defaultTab;
}

export function isItemInteractive(state, itemId) {
    const byId = new Map((state || []).map((item) => [item.id, item]));
    const item = byId.get(itemId);
    if (!item) return false;
    const visited = new Set([itemId]);
    let current = item;
    while (current.parent_id) {
        const parent = byId.get(current.parent_id);
        if (!parent || visited.has(parent.id) || !parent.value) return false;
        visited.add(parent.id);
        current = parent;
    }
    return (item.requires_ids || []).every((requiredId) => byId.get(requiredId)?.value);
}

export function getQuickControlState(control, state) {
    const choices = control.kind === "choice"
        ? control.items
        : [{ itemId: control.itemId, label: itemValue(state, control.itemId) ? "已开启" : "已关闭" }];
    return {
        ...control,
        choices: choices.map((choice) => ({
            ...choice,
            value: itemValue(state, choice.itemId),
            interactive: isItemInteractive(state, choice.itemId),
        })),
    };
}

export function getVisibleReferenceSources(
    layout,
    tabId,
    state,
    focusInputKey = null,
    expandedInputKey = null,
) {
    let expandedAssigned = false;
    return layout.referenceSources
        .filter((source) => source.tabId === tabId)
        .filter((source) => !source.visibleWhen
            || itemValue(state, source.visibleWhen.itemId) === source.visibleWhen.value)
        .map((source) => {
            const expanded = !expandedAssigned
                && Boolean(expandedInputKey && source.focusInputKeys.includes(expandedInputKey));
            if (expanded) expandedAssigned = true;
            return {
                ...source,
                emphasized: Boolean(focusInputKey && source.focusInputKeys.includes(focusInputKey)),
                expanded,
            };
        });
}

export function normalizeExecutionOutputImages(output, outputField = "images") {
    const images = output?.[outputField];
    if (!Array.isArray(images)) return [];
    return images.map(normalizeImageSelection).filter(Boolean);
}

export function createExecutionReferenceCache() {
    const outputs = new Map();
    let generation = 0;
    let sequence = 0;
    return {
        capture(nodeId, output) {
            sequence += 1;
            const entry = {
                output: output || {},
                token: `${generation}-${sequence}`,
            };
            outputs.set(String(nodeId), entry);
            return entry;
        },
        clear() {
            outputs.clear();
            generation += 1;
            sequence = 0;
        },
        get(nodeId) {
            return outputs.get(String(nodeId)) || null;
        },
        get size() {
            return outputs.size;
        },
    };
}

export function getHierarchyStateSignature(state) {
    return (state || []).map((item) => `${item.id}:${item.value ? 1 : 0}`).join("|");
}

export function shouldResetApplyForPolygonChange(layout, graph, detail, state) {
    const policy = layout?.polygonChange;
    return Boolean(
        policy
        && detail?.graph === graph
        && String(detail?.nodeId ?? "") === String(policy.nodeId)
        && itemValue(state, policy.selectionItemId)
    );
}
