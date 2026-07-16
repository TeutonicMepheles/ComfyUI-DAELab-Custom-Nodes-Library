export const MAX_BOOLEAN_OUTPUTS = 64;

let fallbackIdCounter = 0;

function defaultIdFactory() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    fallbackIdCounter += 1;
    return `boolean-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

function toBoolean(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

function cleanLabel(value, index) {
    const label = String(value ?? "").trim();
    return label || `Boolean ${index + 1}`;
}

function cleanId(value) {
    const id = String(value ?? "").trim();
    return id || null;
}

export function createBooleanItem(index, parentId = null, idFactory = defaultIdFactory) {
    return {
        id: idFactory(),
        label: `Boolean ${index + 1}`,
        value: false,
        parent_id: parentId,
    };
}

export function normalizeItems(value, options = {}) {
    const idFactory = options.idFactory || defaultIdFactory;
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value || "[]");
        } catch {
            parsed = [];
        }
    }
    if (!Array.isArray(parsed)) parsed = [];

    const rawItems = parsed.slice(0, MAX_BOOLEAN_OUTPUTS);
    const usedIds = new Set();
    const prepared = rawItems.map((rawItem, index) => {
        const source = rawItem && typeof rawItem === "object" ? rawItem : {};
        let id = cleanId(source.id);
        if (!id || usedIds.has(id)) {
            do {
                id = idFactory();
            } while (usedIds.has(id));
        }
        usedIds.add(id);
        return {
            id,
            label: cleanLabel(source.label ?? source.name, index),
            value: toBoolean(source.value),
            explicitParentId: cleanId(source.parent_id ?? source.parentId),
            legacyLevel: Number(source.level) === 1 ? 1 : 0,
        };
    });

    if (!prepared.length) {
        return [createBooleanItem(0, null, idFactory)];
    }

    let currentLegacyRootId = null;
    const candidates = prepared.map((item) => {
        let parentId = item.explicitParentId;
        if (!parentId && item.legacyLevel === 1) parentId = currentLegacyRootId;
        if (!parentId || item.legacyLevel === 0 && !item.explicitParentId) {
            currentLegacyRootId = item.id;
        }
        return {
            id: item.id,
            label: item.label,
            value: item.value,
            parent_id: parentId,
        };
    });

    const byId = new Map(candidates.map((item) => [item.id, item]));
    for (const item of candidates) {
        const parent = item.parent_id ? byId.get(item.parent_id) : null;
        if (!parent || parent.id === item.id || parent.parent_id) item.parent_id = null;
    }

    const roots = candidates.filter((item) => !item.parent_id);
    if (!roots.length) candidates[0].parent_id = null;

    const ordered = [];
    for (const root of candidates.filter((item) => !item.parent_id)) {
        ordered.push(root);
        for (const child of candidates) {
            if (child.parent_id === root.id) ordered.push(child);
        }
    }

    return applyParentCascade(ordered.slice(0, MAX_BOOLEAN_OUTPUTS));
}

export function encodeItems(items) {
    return JSON.stringify(normalizeItems(items).map((item) => ({
        id: item.id,
        label: item.label,
        value: Boolean(item.value),
        parent_id: item.parent_id,
    })));
}

export function cloneItems(items) {
    return items.map((item) => ({ ...item }));
}

export function applyParentCascade(items) {
    const nextItems = cloneItems(items);
    const parents = new Map(
        nextItems.filter((item) => !item.parent_id).map((item) => [item.id, item])
    );
    for (const item of nextItems) {
        if (!item.parent_id) continue;
        const parent = parents.get(item.parent_id);
        if (!parent || !parent.value) item.value = false;
    }
    return nextItems;
}

export function hasChildren(items, itemId) {
    return items.some((item) => item.parent_id === itemId);
}

export function isChildDisabled(items, item) {
    if (!item.parent_id) return false;
    const parent = items.find((candidate) => candidate.id === item.parent_id);
    return !parent || !parent.value;
}

export function addRootItem(items, idFactory = defaultIdFactory) {
    if (items.length >= MAX_BOOLEAN_OUTPUTS) return cloneItems(items);
    return [...cloneItems(items), createBooleanItem(items.length, null, idFactory)];
}

export function addChildItem(items, parentId, idFactory = defaultIdFactory) {
    if (items.length >= MAX_BOOLEAN_OUTPUTS) return cloneItems(items);
    const parentIndex = items.findIndex((item) => item.id === parentId && !item.parent_id);
    if (parentIndex < 0) return cloneItems(items);
    let insertAt = parentIndex + 1;
    while (insertAt < items.length && items[insertAt].parent_id === parentId) insertAt += 1;
    const nextItems = cloneItems(items);
    nextItems.splice(insertAt, 0, createBooleanItem(items.length, parentId, idFactory));
    return nextItems;
}

function rootGroups(items) {
    const groups = [];
    for (let index = 0; index < items.length;) {
        const root = items[index];
        let end = index + 1;
        while (end < items.length && items[end].parent_id === root.id) end += 1;
        groups.push({ root, start: index, end, items: items.slice(index, end) });
        index = end;
    }
    return groups;
}

export function moveItem(items, itemId, direction) {
    const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    if (!delta) return cloneItems(items);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return cloneItems(items);

    if (item.parent_id) {
        const siblingIndices = [];
        items.forEach((candidate, index) => {
            if (candidate.parent_id === item.parent_id) siblingIndices.push(index);
        });
        const siblingPosition = siblingIndices.findIndex((index) => items[index].id === itemId);
        const targetPosition = siblingPosition + delta;
        if (siblingPosition < 0 || targetPosition < 0 || targetPosition >= siblingIndices.length) {
            return cloneItems(items);
        }
        const nextItems = cloneItems(items);
        const currentIndex = siblingIndices[siblingPosition];
        const targetIndex = siblingIndices[targetPosition];
        [nextItems[currentIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[currentIndex]];
        return nextItems;
    }

    const groups = rootGroups(items);
    const groupIndex = groups.findIndex((group) => group.root.id === itemId);
    const targetGroupIndex = groupIndex + delta;
    if (groupIndex < 0 || targetGroupIndex < 0 || targetGroupIndex >= groups.length) {
        return cloneItems(items);
    }
    const reorderedGroups = groups.map((group) => group.items.map((entry) => ({ ...entry })));
    [reorderedGroups[groupIndex], reorderedGroups[targetGroupIndex]] = [
        reorderedGroups[targetGroupIndex],
        reorderedGroups[groupIndex],
    ];
    return reorderedGroups.flat();
}

export function indentItem(items, itemId) {
    const groups = rootGroups(items);
    const groupIndex = groups.findIndex((group) => group.root.id === itemId);
    if (groupIndex <= 0 || groups[groupIndex].items.length > 1) return cloneItems(items);
    const nextItems = cloneItems(items);
    const item = nextItems.find((candidate) => candidate.id === itemId);
    item.parent_id = groups[groupIndex - 1].root.id;
    return applyParentCascade(nextItems);
}

export function outdentItem(items, itemId) {
    const itemIndex = items.findIndex((item) => item.id === itemId && item.parent_id);
    if (itemIndex < 0) return cloneItems(items);
    const nextItems = cloneItems(items);
    const [item] = nextItems.splice(itemIndex, 1);
    const formerParentId = item.parent_id;
    item.parent_id = null;
    const parentIndex = nextItems.findIndex((candidate) => candidate.id === formerParentId);
    let insertAt = parentIndex + 1;
    while (insertAt < nextItems.length && nextItems[insertAt].parent_id === formerParentId) insertAt += 1;
    nextItems.splice(insertAt, 0, item);
    return nextItems;
}

export function deleteItem(items, itemId) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return cloneItems(items);
    const removedIds = new Set([itemId]);
    if (!item.parent_id) {
        for (const candidate of items) {
            if (candidate.parent_id === itemId) removedIds.add(candidate.id);
        }
    }
    if (items.length - removedIds.size < 1) return cloneItems(items);
    return items.filter((candidate) => !removedIds.has(candidate.id)).map((candidate) => ({ ...candidate }));
}

function getGraphLink(graph, linkId) {
    if (!graph) return null;
    if (graph._links && typeof graph._links.get === "function") {
        return graph._links.get(linkId) || null;
    }
    return graph.links ? graph.links[linkId] || null : null;
}

export function reconcileOutputSlots(node, previousItems, nextItems) {
    node.outputs = node.outputs || [];
    const previousByIndex = previousItems || [];
    node.outputs.forEach((output, index) => {
        if (!output.boolean_item_id && previousByIndex[index]) {
            output.boolean_item_id = previousByIndex[index].id;
        }
    });

    const nextIds = new Set(nextItems.map((item) => item.id));
    for (let index = node.outputs.length - 1; index >= 0; index -= 1) {
        const output = node.outputs[index];
        if (!output.boolean_item_id || !nextIds.has(output.boolean_item_id)) {
            if (typeof node.removeOutput === "function") node.removeOutput(index);
            else node.outputs.splice(index, 1);
        }
    }

    const outputById = new Map(node.outputs.map((output) => [output.boolean_item_id, output]));
    for (const item of nextItems) {
        if (outputById.has(item.id)) continue;
        const output = typeof node.addOutput === "function"
            ? node.addOutput(item.label, "BOOLEAN")
            : { name: item.label, type: "BOOLEAN", links: null };
        output.boolean_item_id = item.id;
        if (!node.outputs.includes(output)) node.outputs.push(output);
        outputById.set(item.id, output);
    }

    node.outputs = nextItems.map((item, index) => {
        const output = outputById.get(item.id);
        const label = item.label || `Boolean ${index + 1}`;
        output.boolean_item_id = item.id;
        output.name = label;
        output.label = label;
        output.localized_name = label;
        output.type = "BOOLEAN";
        return output;
    });

    node.outputs.forEach((output, outputIndex) => {
        for (const linkId of output.links || []) {
            const link = getGraphLink(node.graph, linkId);
            if (link) link.origin_slot = outputIndex;
        }
    });
    return node.outputs;
}
