import {
    MAX_BOOLEAN_OUTPUTS,
    getRequirementClosure,
    normalizeItems,
} from "./boolean_list_hierarchy_model.mjs?v=hierarchy-dependencies-1";

export const HIERARCHY_SOURCE_NODE_TYPE = "BooleanListHierarchy";
export const HIERARCHY_GET_NODE_TYPE = "BooleanListHierarchyGet";

function cleanId(value) {
    const id = String(value ?? "").trim();
    return id || "";
}

function parseJson(value, fallback) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
        return JSON.parse(value || "");
    } catch {
        return fallback;
    }
}

export function getGraphNodes(graph) {
    const nodes = graph?._nodes || graph?.nodes || [];
    if (Array.isArray(nodes)) return nodes;
    if (typeof nodes.values === "function") return Array.from(nodes.values());
    return nodes && typeof nodes === "object" ? Object.values(nodes) : [];
}

export function isHierarchySource(node) {
    return node?.type === HIERARCHY_SOURCE_NODE_TYPE
        || node?.comfyClass === HIERARCHY_SOURCE_NODE_TYPE;
}

export function readHierarchyItems(sourceNode) {
    if (!sourceNode) return [];
    const widget = (sourceNode.widgets || []).find(
        (candidate) => candidate.name === "config_json"
    );
    const value = sourceNode._booleanHierarchyItems
        || sourceNode.properties?.boolean_list_items
        || widget?.value;
    if (value == null) return [];
    return normalizeItems(value);
}

export function buildSourceOptions(graph) {
    const sources = getGraphNodes(graph).filter(isHierarchySource);
    const titleCounts = new Map();
    for (const source of sources) {
        const title = String(source.title || "Boolean List Hierarchy");
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    return sources.map((source) => {
        const id = cleanId(source.id);
        const title = String(source.title || "Boolean List Hierarchy");
        return {
            id,
            label: titleCounts.get(title) > 1 ? `${title} (#${id})` : title,
            source,
        };
    }).filter((option) => option.id);
}

export function resolveSourceNode(graph, sourceNodeId) {
    const sourceId = cleanId(sourceNodeId);
    if (!sourceId) return null;
    const direct = graph?.getNodeById?.(sourceNodeId)
        || graph?.getNodeById?.(sourceId);
    if (isHierarchySource(direct)) return direct;
    return getGraphNodes(graph).find(
        (node) => isHierarchySource(node) && cleanId(node.id) === sourceId
    ) || null;
}

export function buildRootOptions(sourceNode) {
    const roots = readHierarchyItems(sourceNode).filter((item) => !item.parent_id);
    const labelCounts = new Map();
    for (const root of roots) {
        labelCounts.set(root.label, (labelCounts.get(root.label) || 0) + 1);
    }
    return roots.map((root) => ({
        id: cleanId(root.id),
        label: labelCounts.get(root.label) > 1
            ? `${root.label} (#${cleanId(root.id).slice(0, 8)})`
            : root.label,
        item: root,
    }));
}

export function getBranchItems(sourceNode, rootItemId) {
    const items = readHierarchyItems(sourceNode);
    const rootId = cleanId(rootItemId);
    const root = items.find(
        (item) => cleanId(item.id) === rootId && !item.parent_id
    );
    if (!root) return [];

    const children = new Map();
    for (const item of items) {
        const parentId = cleanId(item.parent_id);
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(item);
    }
    const branch = [];
    const visited = new Set();
    function append(item) {
        if (visited.has(item.id)) return;
        visited.add(item.id);
        branch.push({ ...item });
        for (const child of children.get(cleanId(item.id)) || []) append(child);
    }
    append(root);
    return branch.slice(0, MAX_BOOLEAN_OUTPUTS);
}

export function makeOutputKey(sourceNodeId, itemId) {
    return `${cleanId(sourceNodeId)}::${cleanId(itemId)}`;
}

export function normalizeGetSnapshot(value) {
    const source = parseJson(value, {});
    const items = Array.isArray(source?.items)
        ? source.items.slice(0, MAX_BOOLEAN_OUTPUTS).map((item, index) => ({
            id: cleanId(item?.id) || `missing-${index + 1}`,
            label: String(item?.label || `Boolean ${index + 1}`),
            value: Boolean(item?.value),
            parent_id: cleanId(item?.parent_id) || null,
            ...(cleanId(item?.exclusive_group_id)
                ? { exclusive_group_id: cleanId(item.exclusive_group_id) }
                : {}),
            ...(Array.isArray(item?.requires_ids) && item.requires_ids.length
                ? {
                    requires_ids: item.requires_ids
                        .map(cleanId)
                        .filter((id, requirementIndex, ids) => (
                            id
                            && ids.indexOf(id) === requirementIndex
                        )),
                }
                : {}),
        }))
        : [];
    const itemIds = new Set(items.map((item) => item.id));
    const outputItemIds = Array.isArray(source?.output_item_ids)
        ? source.output_item_ids
            .map(cleanId)
            .filter((id, index, ids) => itemIds.has(id) && ids.indexOf(id) === index)
        : items.map((item) => item.id);
    return {
        version: 2,
        valid: source?.valid === true,
        source_node_id: cleanId(source?.source_node_id),
        root_item_id: cleanId(source?.root_item_id),
        include_root: source?.include_root !== false,
        items,
        output_item_ids: outputItemIds,
    };
}

export function createValidSnapshot(sourceNode, rootItemId, includeRoot = true) {
    const sourceNodeId = cleanId(sourceNode?.id);
    const branch = getBranchItems(sourceNode, rootItemId);
    if (!sourceNodeId || !branch.length) return null;
    const allItems = readHierarchyItems(sourceNode);
    const contextIds = new Set(branch.map((item) => item.id));
    for (const item of branch) {
        for (const requiredId of getRequirementClosure(allItems, item.id)) {
            contextIds.add(requiredId);
        }
    }
    const contextItems = allItems.filter((item) => contextIds.has(item.id));
    return normalizeGetSnapshot({
        version: 2,
        valid: true,
        source_node_id: sourceNodeId,
        root_item_id: cleanId(rootItemId),
        include_root: includeRoot !== false,
        items: contextItems,
        output_item_ids: (includeRoot === false ? branch.slice(1) : branch)
            .map((item) => item.id),
    });
}

export function createMissingSnapshot(
    previousValue,
    { sourceNodeId = "", rootItemId = "", includeRoot = true, preserveItems = true } = {}
) {
    const previous = normalizeGetSnapshot(previousValue);
    const sourceId = cleanId(sourceNodeId);
    const rootId = cleanId(rootItemId);
    const keep = preserveItems
        && previous.source_node_id === sourceId
        && previous.root_item_id === rootId;
    const items = keep
        ? previous.items.map((item) => ({ ...item, value: false }))
        : [];
    return normalizeGetSnapshot({
        version: 2,
        valid: false,
        source_node_id: sourceId,
        root_item_id: rootId,
        include_root: includeRoot !== false,
        items,
        output_item_ids: keep ? previous.output_item_ids : [],
    });
}

export function getSnapshotOutputDescriptors(value) {
    const snapshot = normalizeGetSnapshot(value);
    const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
    return snapshot.output_item_ids.map((itemId, index) => {
        const item = itemById.get(itemId);
        return {
            key: makeOutputKey(snapshot.source_node_id, itemId),
            item_id: itemId,
            label: item?.label || `Boolean ${index + 1}`,
            value: snapshot.valid ? Boolean(item?.value) : false,
        };
    });
}

export function getOutputSlotsMatchDescriptors(node, descriptors) {
    const outputs = Array.isArray(node?.outputs) ? node.outputs : [];
    const expected = Array.isArray(descriptors) ? descriptors : [];
    if (outputs.length !== expected.length) return false;
    return expected.every((descriptor, index) => {
        const output = outputs[index];
        return output?.boolean_get_item_key === descriptor.key
            && output?.boolean_item_id === descriptor.item_id
            && output?.name === descriptor.label
            && output?.type === "BOOLEAN";
    });
}

function getGraphLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    for (const links of [graph._links, graph.links]) {
        if (!links) continue;
        if (typeof links.get === "function") {
            const link = links.get(linkId);
            if (link) return link;
        } else if (links[linkId]) {
            return links[linkId];
        }
    }
    return null;
}

export function reconcileGetOutputSlots(node, previousDescriptors, nextDescriptors) {
    node.outputs = node.outputs || [];
    const previous = previousDescriptors || [];
    node.outputs.forEach((output, index) => {
        if (!output.boolean_get_item_key && previous[index]) {
            output.boolean_get_item_key = previous[index].key;
        }
    });

    const nextKeys = new Set(nextDescriptors.map((descriptor) => descriptor.key));
    for (let index = node.outputs.length - 1; index >= 0; index -= 1) {
        const output = node.outputs[index];
        if (!output.boolean_get_item_key || !nextKeys.has(output.boolean_get_item_key)) {
            if (typeof node.removeOutput === "function") node.removeOutput(index);
            else node.outputs.splice(index, 1);
        }
    }

    const outputByKey = new Map(
        node.outputs.map((output) => [output.boolean_get_item_key, output])
    );
    for (const descriptor of nextDescriptors) {
        if (outputByKey.has(descriptor.key)) continue;
        const output = typeof node.addOutput === "function"
            ? node.addOutput(descriptor.label, "BOOLEAN")
            : { name: descriptor.label, type: "BOOLEAN", links: null };
        output.boolean_get_item_key = descriptor.key;
        if (!node.outputs.includes(output)) node.outputs.push(output);
        outputByKey.set(descriptor.key, output);
    }

    node.outputs = nextDescriptors.map((descriptor) => {
        const output = outputByKey.get(descriptor.key);
        output.boolean_get_item_key = descriptor.key;
        output.boolean_item_id = descriptor.item_id;
        output.name = descriptor.label;
        output.label = descriptor.label;
        output.localized_name = descriptor.label;
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

export function encodeGetSnapshot(value) {
    return JSON.stringify(normalizeGetSnapshot(value));
}
