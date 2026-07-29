export const SOURCE_NODE_TYPE = "BooleanListHierarchy";
export const GET_SOURCE_NODE_TYPE = "BooleanListHierarchyGet";
export const CONTROLLER_NODE_TYPE = "BooleanGroupBypassController";
export const MODE_ACTIVE = 0;
export const MODE_BYPASS = 4;

export function getGraphLink(graph, linkId) {
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

export function getGraphNode(graph, nodeId) {
    if (!graph || nodeId == null) return null;
    const direct = graph.getNodeById?.(nodeId);
    if (direct) return direct;
    const byId = graph._nodes_by_id;
    if (typeof byId?.get === "function") return byId.get(nodeId) || null;
    if (byId?.[nodeId]) return byId[nodeId];
    const nodes = graph._nodes || graph.nodes || [];
    const values = Array.isArray(nodes)
        ? nodes
        : typeof nodes.values === "function"
            ? Array.from(nodes.values())
            : Object.values(nodes);
    return values.find((node) => String(node.id) === String(nodeId)) || null;
}

function parseItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function isNodeType(node, nodeType) {
    return node?.type === nodeType || node?.comfyClass === nodeType;
}

export function isSupportedBooleanSource(node) {
    return isNodeType(node, SOURCE_NODE_TYPE)
        || isNodeType(node, GET_SOURCE_NODE_TYPE);
}

function readGetBooleanItems(sourceNode) {
    const widget = (sourceNode.widgets || []).find(
        (candidate) => candidate.name === "config_json"
    );
    const snapshot = parseObject(
        sourceNode._booleanHierarchyGetSnapshot
        || sourceNode.properties?.boolean_get_snapshot
        || widget?.value
    );
    if (!snapshot) return [];
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const byId = new Map(
        items
            .filter((item) => item && typeof item === "object")
            .map((item) => [String(item.id), item])
    );
    const outputIds = Array.isArray(snapshot.output_item_ids)
        ? snapshot.output_item_ids
        : items.map((item) => item?.id);
    return outputIds.map((itemId, index) => {
        const id = String(itemId ?? "");
        const item = byId.get(id);
        return {
            ...(item || {}),
            id: id || String(item?.id ?? index),
            label: String(item?.label || `Boolean ${index + 1}`),
            value: snapshot.valid === true && toBoolean(item?.value),
        };
    });
}

export function readBooleanItems(sourceNode) {
    if (!sourceNode) return [];
    if (isNodeType(sourceNode, GET_SOURCE_NODE_TYPE)) {
        return readGetBooleanItems(sourceNode);
    }
    const propertyValue = sourceNode.properties?.boolean_list_items;
    if (propertyValue != null) return parseItems(propertyValue);
    if (Array.isArray(sourceNode._booleanHierarchyItems)) return sourceNode._booleanHierarchyItems;
    const widget = (sourceNode.widgets || []).find((candidate) => candidate.name === "config_json");
    return parseItems(widget?.value);
}

function toBoolean(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

export function resolveBooleanSource(controllerNode) {
    const input = (controllerNode?.inputs || []).find((candidate) => candidate.name === "boolean")
        || controllerNode?.inputs?.[0];
    if (!input || input.link == null) {
        return { ok: false, code: "unconnected", message: "等待连接 Hierarchy 或 Hierarchy Get" };
    }

    const graph = controllerNode.graph;
    const link = getGraphLink(graph, input.link);
    if (!link) {
        return { ok: false, code: "missing_link", message: "错误：输入连线不存在" };
    }

    const sourceNode = getGraphNode(graph, link.origin_id);
    if (!sourceNode) {
        return { ok: false, code: "missing_source", message: "错误：Boolean 源节点不存在" };
    }
    if (!isSupportedBooleanSource(sourceNode)) {
        return { ok: false, code: "wrong_source", message: "错误：仅支持 Hierarchy 或 Hierarchy Get" };
    }

    const outputIndex = Number(link.origin_slot);
    const output = sourceNode.outputs?.[outputIndex];
    const items = readBooleanItems(sourceNode);
    const stableItemId = output?.boolean_item_id;
    const item = stableItemId
        ? items.find((candidate) => String(candidate.id) === String(stableItemId))
        : items[outputIndex];
    if (!item) {
        return { ok: false, code: "missing_item", message: "错误：Boolean 条目不存在" };
    }

    return {
        ok: true,
        code: "ok",
        sourceNode,
        sourceLabel: sourceNode.title || sourceNode.type || SOURCE_NODE_TYPE,
        item,
        itemId: String(item.id ?? stableItemId ?? outputIndex),
        itemLabel: String(item.label || output?.label || output?.name || `Boolean ${outputIndex + 1}`),
        value: toBoolean(item.value),
    };
}

export function getGraphGroups(graph) {
    const groups = graph?._groups || graph?.groups || [];
    if (Array.isArray(groups)) return groups;
    if (typeof groups.values === "function") return Array.from(groups.values());
    if (groups && typeof groups === "object") return Object.values(groups);
    return [];
}

export function getGroupId(group) {
    const id = group?.id ?? group?._id;
    return id == null ? null : String(id);
}

export function buildGroupOptions(graph) {
    const groups = getGraphGroups(graph).filter((group) => getGroupId(group) != null);
    const titleCounts = new Map();
    for (const group of groups) {
        const title = String(group.title || "未命名组");
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    return groups.map((group) => {
        const id = getGroupId(group);
        const title = String(group.title || "未命名组");
        return {
            id,
            title,
            label: titleCounts.get(title) > 1 ? `${title} (#${id})` : title,
            group,
        };
    });
}

export function resolveGroup(graph, groupId) {
    if (groupId == null || groupId === "") return null;
    return getGraphGroups(graph).find((group) => getGroupId(group) === String(groupId)) || null;
}

export function getGroupChildren(group) {
    if (!group) return [];
    const children = group._children ?? group._nodes ?? [];
    if (Array.isArray(children)) return children;
    if (typeof children.values === "function") return Array.from(children.values());
    return Array.from(children || []);
}

export function collectControllableNodes(group, controllerNode = null) {
    return getGroupChildren(group).filter((node) => {
        if (!node || node === controllerNode) return false;
        if (node.type === CONTROLLER_NODE_TYPE || node.comfyClass === CONTROLLER_NODE_TYPE) return false;
        return node.id != null && ("mode" in node || Array.isArray(node.inputs) || Array.isArray(node.outputs));
    });
}

export function desiredMode(booleanValue, invert = false) {
    const active = invert ? !Boolean(booleanValue) : Boolean(booleanValue);
    return active ? MODE_ACTIVE : MODE_BYPASS;
}

export function applyModeToNodes(nodes, mode) {
    let changed = false;
    for (const node of nodes || []) {
        if (!node || node.mode === mode) continue;
        node.mode = mode;
        changed = true;
    }
    return changed;
}

export function findPlanConflicts(plans) {
    const conflicts = new Map();
    for (let leftIndex = 0; leftIndex < plans.length; leftIndex += 1) {
        const left = plans[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < plans.length; rightIndex += 1) {
            const right = plans[rightIndex];
            if (left.graph !== right.graph) continue;
            const sameGroup = String(left.groupId) === String(right.groupId);
            const rightNodes = new Set(right.nodes);
            const overlaps = sameGroup || left.nodes.some((node) => rightNodes.has(node));
            if (!overlaps) continue;
            const message = sameGroup
                ? "冲突：同一组被多个控制器绑定"
                : "冲突：受控节点组成员重叠";
            conflicts.set(left.controller, message);
            conflicts.set(right.controller, message);
        }
    }
    return conflicts;
}
