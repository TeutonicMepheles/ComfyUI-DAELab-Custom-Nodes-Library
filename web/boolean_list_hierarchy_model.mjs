export const MAX_BOOLEAN_OUTPUTS = 64;
export const MAX_HIERARCHY_DEPTH = 2;

let fallbackIdCounter = 0;
let fallbackExclusiveGroupCounter = 0;

function defaultIdFactory() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    fallbackIdCounter += 1;
    return `boolean-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

function defaultExclusiveGroupIdFactory() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    fallbackExclusiveGroupCounter += 1;
    return `exclusive-${Date.now().toString(36)}-${fallbackExclusiveGroupCounter.toString(36)}`;
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

function cleanIdList(value) {
    const values = Array.isArray(value)
        ? value
        : value == null || value === ""
            ? []
            : [value];
    const ids = [];
    const seen = new Set();
    for (const rawId of values) {
        const id = cleanId(rawId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

export function createBooleanItem(index, parentId = null, idFactory = defaultIdFactory) {
    return {
        id: idFactory(),
        label: `Boolean ${index + 1}`,
        value: false,
        parent_id: parentId,
        requires_ids: [],
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
            exclusiveGroupId: cleanId(source.exclusive_group_id ?? source.exclusiveGroupId),
            requiresIds: cleanIdList(source.requires_ids ?? source.requiresIds),
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
            exclusive_group_id: item.exclusiveGroupId,
            requires_ids: item.requiresIds,
        };
    });

    repairHierarchyDepths(candidates);
    const ordered = flattenHierarchy(candidates);

    return applyHierarchyConstraints(
        ordered.slice(0, MAX_BOOLEAN_OUTPUTS),
        options.preferredItemId || null
    );
}

export function encodeItems(items) {
    return JSON.stringify(normalizeItems(items).map((item) => {
        const encoded = {
            id: item.id,
            label: item.label,
            value: Boolean(item.value),
            parent_id: item.parent_id,
        };
        if (item.exclusive_group_id) encoded.exclusive_group_id = item.exclusive_group_id;
        if (item.requires_ids?.length) encoded.requires_ids = [...item.requires_ids];
        return encoded;
    }));
}

export function cloneItems(items) {
    return items.map((item) => ({ ...item }));
}

function repairHierarchyDepths(items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const depthById = new Map();

    function resolveDepth(item, visiting = new Set()) {
        if (depthById.has(item.id)) return depthById.get(item.id);
        if (!item.parent_id) {
            depthById.set(item.id, 0);
            return 0;
        }

        const parent = byId.get(item.parent_id);
        if (!parent || parent === item || visiting.has(parent.id)) {
            item.parent_id = null;
            depthById.set(item.id, 0);
            return 0;
        }

        visiting.add(item.id);
        const parentDepth = resolveDepth(parent, visiting);
        visiting.delete(item.id);
        if (parentDepth >= MAX_HIERARCHY_DEPTH) {
            item.parent_id = null;
            depthById.set(item.id, 0);
            return 0;
        }

        const depth = parentDepth + 1;
        depthById.set(item.id, depth);
        return depth;
    }

    for (const item of items) resolveDepth(item);
    if (!items.some((item) => !item.parent_id) && items.length) {
        items[0].parent_id = null;
    }
    return items;
}

function childrenByParent(items) {
    const children = new Map();
    for (const item of items) {
        const parentId = item.parent_id || null;
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(item);
    }
    return children;
}

function flattenHierarchy(items, children = childrenByParent(items)) {
    const ordered = [];
    const visited = new Set();

    function appendSubtree(item) {
        if (!item || visited.has(item.id)) return;
        visited.add(item.id);
        ordered.push(item);
        for (const child of children.get(item.id) || []) appendSubtree(child);
    }

    for (const root of children.get(null) || []) appendSubtree(root);
    for (const item of items) appendSubtree(item);
    return ordered;
}

export function getItemDepth(items, itemOrId) {
    let item = typeof itemOrId === "string"
        ? items.find((candidate) => candidate.id === itemOrId)
        : itemOrId;
    if (!item) return -1;

    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const visited = new Set([item.id]);
    let depth = 0;
    while (item.parent_id) {
        const parent = byId.get(item.parent_id);
        if (!parent || visited.has(parent.id)) return -1;
        visited.add(parent.id);
        depth += 1;
        item = parent;
    }
    return depth;
}

export function getSubtreeIds(items, itemId) {
    const children = childrenByParent(items);
    const ids = new Set();
    function collect(id) {
        if (ids.has(id)) return;
        ids.add(id);
        for (const child of children.get(id) || []) collect(child.id);
    }
    if (items.some((item) => item.id === itemId)) collect(itemId);
    return ids;
}

export function applyParentCascade(items) {
    const nextItems = cloneItems(items);
    const byId = new Map(nextItems.map((item) => [item.id, item]));

    function ancestorsEnabled(item, visiting = new Set()) {
        if (!item.parent_id) return true;
        if (visiting.has(item.id)) return false;
        visiting.add(item.id);
        const parent = byId.get(item.parent_id);
        return Boolean(parent?.value) && ancestorsEnabled(parent, visiting);
    }

    for (const item of nextItems) {
        if (!item.parent_id) continue;
        if (!ancestorsEnabled(item)) item.value = false;
    }
    return nextItems;
}

function getAncestorIds(items, itemId) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const ancestors = [];
    const visited = new Set([itemId]);
    let item = byId.get(itemId);
    while (item?.parent_id) {
        const parent = byId.get(item.parent_id);
        if (!parent || visited.has(parent.id)) break;
        visited.add(parent.id);
        ancestors.push(parent.id);
        item = parent;
    }
    return ancestors;
}

function collectRequirementClosure(items, itemId) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const closure = new Set();
    function collect(id) {
        if (!id || closure.has(id)) return;
        const item = byId.get(id);
        if (!item) return;
        closure.add(id);
        if (item.parent_id) collect(item.parent_id);
        for (const requiredId of item.requires_ids || []) collect(requiredId);
    }
    collect(itemId);
    return closure;
}

function dependencyGraphIssue(items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const visiting = new Set();
    const visited = new Set();

    function visit(item) {
        if (visiting.has(item.id)) {
            return `Dependency cycle includes ${item.label}`;
        }
        if (visited.has(item.id)) return null;
        visiting.add(item.id);
        const directIds = [
            ...(item.parent_id ? [item.parent_id] : []),
            ...(item.requires_ids || []),
        ];
        for (const requiredId of directIds) {
            const required = byId.get(requiredId);
            if (!required) continue;
            const issue = visit(required);
            if (issue) return issue;
        }
        visiting.delete(item.id);
        visited.add(item.id);
        return null;
    }

    for (const item of items) {
        const issue = visit(item);
        if (issue) return issue;
    }

    for (const item of items) {
        const groupMembers = new Map();
        for (const requiredId of collectRequirementClosure(items, item.id)) {
            const required = byId.get(requiredId);
            const groupId = required?.exclusive_group_id;
            if (!groupId) continue;
            const previous = groupMembers.get(groupId);
            if (previous && previous !== required.id) {
                return `${item.label} requires mutually exclusive items`;
            }
            groupMembers.set(groupId, required.id);
        }
    }
    return null;
}

export function sanitizeDependencies(items) {
    const nextItems = sanitizeExclusiveGroups(items);
    const byId = new Map(nextItems.map((item) => [item.id, item]));
    for (const item of nextItems) item.requires_ids = [];

    const sourceById = new Map(items.map((item) => [item.id, item]));
    for (const item of nextItems) {
        const ancestors = new Set(getAncestorIds(nextItems, item.id));
        const rawIds = cleanIdList(
            sourceById.get(item.id)?.requires_ids
            ?? sourceById.get(item.id)?.requiresIds
        );
        for (const requiredId of rawIds) {
            if (
                requiredId === item.id
                || !byId.has(requiredId)
                || ancestors.has(requiredId)
            ) {
                continue;
            }
            item.requires_ids.push(requiredId);
            if (dependencyGraphIssue(nextItems)) item.requires_ids.pop();
        }
    }
    return nextItems;
}

export function validateDependencySelection(items, dependentId, requiredIds) {
    const normalized = sanitizeDependencies(items);
    const dependent = normalized.find((item) => item.id === dependentId);
    if (!dependent) return { valid: false, message: "Select a dependent Boolean" };

    const cleanedIds = cleanIdList(requiredIds);
    if (!cleanedIds.length) {
        return { valid: false, message: "Select at least one prerequisite" };
    }
    const byId = new Map(normalized.map((item) => [item.id, item]));
    const ancestors = new Set(getAncestorIds(normalized, dependent.id));
    for (const requiredId of cleanedIds) {
        if (requiredId === dependent.id) {
            return { valid: false, message: "A Boolean cannot require itself" };
        }
        if (!byId.has(requiredId)) {
            return { valid: false, message: "A prerequisite no longer exists" };
        }
        if (ancestors.has(requiredId)) {
            return { valid: false, message: "Parent ancestry is already required implicitly" };
        }
    }

    dependent.requires_ids = cleanedIds;
    const issue = dependencyGraphIssue(normalized);
    return issue
        ? { valid: false, message: issue }
        : { valid: true, message: "", requires_ids: cleanedIds };
}

export function setItemRequirements(items, dependentId, requiredIds) {
    const validation = validateDependencySelection(items, dependentId, requiredIds);
    if (!validation.valid) return cloneItems(items);
    const nextItems = cloneItems(items);
    const dependent = nextItems.find((item) => item.id === dependentId);
    dependent.requires_ids = [...validation.requires_ids];
    return applyHierarchyConstraints(nextItems);
}

export function deleteItemRequirements(items, dependentId) {
    const nextItems = cloneItems(items);
    const dependent = nextItems.find((item) => item.id === dependentId);
    if (!dependent) return nextItems;
    dependent.requires_ids = [];
    return applyHierarchyConstraints(nextItems);
}

export function sanitizeExclusiveGroups(items) {
    const nextItems = cloneItems(items);
    const membersByGroup = new Map();
    for (const item of nextItems) {
        const groupId = cleanId(item.exclusive_group_id);
        item.exclusive_group_id = groupId;
        if (!groupId) continue;
        if (!membersByGroup.has(groupId)) membersByGroup.set(groupId, []);
        membersByGroup.get(groupId).push(item);
    }

    for (const members of membersByGroup.values()) {
        const parentIds = new Set(members.map((item) => item.parent_id || null));
        if (members.length >= 2 && parentIds.size === 1) continue;
        for (const item of members) item.exclusive_group_id = null;
    }
    return nextItems;
}

export function applyExclusiveConstraint(
    items,
    preferredItemId = null,
    preferredItemIds = null
) {
    const nextItems = sanitizeExclusiveGroups(items);
    const preferredIds = preferredItemIds instanceof Set
        ? preferredItemIds
        : new Set(preferredItemIds || []);
    const membersByGroup = new Map();
    for (const item of nextItems) {
        if (!item.exclusive_group_id) continue;
        if (!membersByGroup.has(item.exclusive_group_id)) {
            membersByGroup.set(item.exclusive_group_id, []);
        }
        membersByGroup.get(item.exclusive_group_id).push(item);
    }

    for (const members of membersByGroup.values()) {
        const preferred = members.find((item) => preferredIds.has(item.id) && item.value)
            || members.find((item) => item.id === preferredItemId && item.value);
        const active = preferred || members.find((item) => item.value) || null;
        for (const item of members) item.value = item === active;
    }
    return nextItems;
}

export function applyRequirementCascade(items) {
    const nextItems = cloneItems(items);
    const byId = new Map(nextItems.map((item) => [item.id, item]));
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of nextItems) {
            if (!item.value) continue;
            const directIds = [
                ...(item.parent_id ? [item.parent_id] : []),
                ...(item.requires_ids || []),
            ];
            if (directIds.some((requiredId) => !byId.get(requiredId)?.value)) {
                item.value = false;
                changed = true;
            }
        }
    }
    return nextItems;
}

export function getRequirementClosure(items, itemId) {
    const normalized = sanitizeDependencies(items);
    return collectRequirementClosure(normalized, itemId);
}

export function applyHierarchyConstraints(items, preferredItemId = null) {
    let nextItems = sanitizeDependencies(items);
    let activationIds = new Set();
    const preferred = nextItems.find((item) => item.id === preferredItemId);
    if (preferredItemId && preferred?.value) {
        activationIds = collectRequirementClosure(nextItems, preferredItemId);
        for (const item of nextItems) {
            if (activationIds.has(item.id)) item.value = true;
        }
    }
    nextItems = applyExclusiveConstraint(
        nextItems,
        preferredItemId,
        activationIds
    );
    return applyRequirementCascade(nextItems);
}

export function getExclusiveGroups(items) {
    const normalized = sanitizeExclusiveGroups(items);
    const groups = [];
    const byId = new Map();
    for (const item of normalized) {
        if (!item.exclusive_group_id) continue;
        let group = byId.get(item.exclusive_group_id);
        if (!group) {
            group = {
                id: item.exclusive_group_id,
                parent_id: item.parent_id || null,
                member_ids: [],
            };
            byId.set(group.id, group);
            groups.push(group);
        }
        group.member_ids.push(item.id);
    }
    return groups;
}

function resolveExclusiveMembers(items, memberIds) {
    const selectedIds = new Set(memberIds || []);
    const members = items.filter((item) => selectedIds.has(item.id));
    if (members.length < 2 || members.length !== selectedIds.size) return null;
    const parentIds = new Set(members.map((item) => item.parent_id || null));
    return parentIds.size === 1 ? members : null;
}

export function validateExclusiveGroupSelection(items, groupId, memberIds) {
    const nextItems = sanitizeDependencies(items);
    const cleanGroupId = cleanId(groupId);
    const members = resolveExclusiveMembers(nextItems, memberIds);
    if (!members) {
        return {
            valid: false,
            message: "Select at least two Booleans from the same sibling scope",
        };
    }
    if (members.some(
        (item) => item.exclusive_group_id
            && item.exclusive_group_id !== cleanGroupId
    )) {
        return { valid: false, message: "A selected Boolean already belongs to another group" };
    }

    for (const item of nextItems) {
        if (cleanGroupId && item.exclusive_group_id === cleanGroupId) {
            item.exclusive_group_id = null;
        }
    }
    const candidateGroupId = cleanGroupId || "__dependency_validation_group__";
    for (const item of members) item.exclusive_group_id = candidateGroupId;
    const issue = dependencyGraphIssue(nextItems);
    return issue
        ? { valid: false, message: issue }
        : { valid: true, message: "" };
}

export function createExclusiveGroup(
    items,
    memberIds,
    idFactory = defaultExclusiveGroupIdFactory
) {
    const nextItems = sanitizeExclusiveGroups(items);
    const members = resolveExclusiveMembers(nextItems, memberIds);
    const validation = validateExclusiveGroupSelection(items, null, memberIds);
    if (
        !validation.valid
        || !members
        || members.some((item) => item.exclusive_group_id)
    ) {
        return cloneItems(items);
    }
    let groupId;
    const existingIds = new Set(
        nextItems.map((item) => item.exclusive_group_id).filter(Boolean)
    );
    do {
        groupId = cleanId(idFactory());
    } while (!groupId || existingIds.has(groupId));
    for (const item of members) item.exclusive_group_id = groupId;
    return applyHierarchyConstraints(nextItems);
}

export function updateExclusiveGroup(items, groupId, memberIds) {
    const cleanGroupId = cleanId(groupId);
    const nextItems = sanitizeExclusiveGroups(items);
    const currentMembers = nextItems.filter(
        (item) => item.exclusive_group_id === cleanGroupId
    );
    const members = resolveExclusiveMembers(nextItems, memberIds);
    const validation = validateExclusiveGroupSelection(items, cleanGroupId, memberIds);
    if (
        !validation.valid
        || !cleanGroupId
        || currentMembers.length < 2
        || !members
    ) {
        return cloneItems(items);
    }
    const currentParentId = currentMembers[0].parent_id || null;
    if (
        (members[0].parent_id || null) !== currentParentId
        || members.some(
            (item) => item.exclusive_group_id && item.exclusive_group_id !== cleanGroupId
        )
    ) {
        return cloneItems(items);
    }
    for (const item of currentMembers) item.exclusive_group_id = null;
    for (const item of members) item.exclusive_group_id = cleanGroupId;
    return applyHierarchyConstraints(nextItems);
}

export function deleteExclusiveGroup(items, groupId) {
    const cleanGroupId = cleanId(groupId);
    if (!cleanGroupId) return cloneItems(items);
    return items.map((item) => ({
        ...item,
        exclusive_group_id: item.exclusive_group_id === cleanGroupId
            ? null
            : item.exclusive_group_id,
    }));
}

export function hasChildren(items, itemId) {
    return items.some((item) => item.parent_id === itemId);
}

export function isChildDisabled(items, item) {
    if (!item.parent_id) return false;
    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const visited = new Set([item.id]);
    let parentId = item.parent_id;
    while (parentId) {
        const parent = byId.get(parentId);
        if (!parent || visited.has(parent.id) || !parent.value) return true;
        visited.add(parent.id);
        parentId = parent.parent_id;
    }
    return false;
}

export function addRootItem(items, idFactory = defaultIdFactory) {
    if (items.length >= MAX_BOOLEAN_OUTPUTS) return cloneItems(items);
    return [...cloneItems(items), createBooleanItem(items.length, null, idFactory)];
}

export function addChildItem(items, parentId, idFactory = defaultIdFactory) {
    if (items.length >= MAX_BOOLEAN_OUTPUTS) return cloneItems(items);
    const nextItems = cloneItems(items);
    const parent = nextItems.find((item) => item.id === parentId);
    const parentDepth = getItemDepth(nextItems, parent);
    if (!parent || parentDepth < 0 || parentDepth >= MAX_HIERARCHY_DEPTH) {
        return cloneItems(items);
    }
    const child = createBooleanItem(items.length, parentId, idFactory);
    nextItems.push(child);
    const children = childrenByParent(nextItems);
    return applyHierarchyConstraints(flattenHierarchy(nextItems, children));
}

function maxRelativeSubtreeDepth(items, itemId) {
    const children = childrenByParent(items);
    function visit(id, visiting = new Set()) {
        if (visiting.has(id)) return 0;
        const nextVisiting = new Set(visiting);
        nextVisiting.add(id);
        let maximum = 0;
        for (const child of children.get(id) || []) {
            maximum = Math.max(maximum, 1 + visit(child.id, nextVisiting));
        }
        return maximum;
    }
    return visit(itemId);
}

export function canIndentItem(items, itemId) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return false;
    const parentId = item.parent_id || null;
    const siblings = items.filter(
        (candidate) => (candidate.parent_id || null) === parentId
    );
    const position = siblings.findIndex((candidate) => candidate.id === itemId);
    if (position <= 0) return false;
    const previousSibling = siblings[position - 1];
    const targetDepth = getItemDepth(items, previousSibling) + 1;
    return targetDepth >= 1
        && targetDepth + maxRelativeSubtreeDepth(items, itemId) <= MAX_HIERARCHY_DEPTH;
}

export function moveItem(items, itemId, direction) {
    const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    if (!delta) return cloneItems(items);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return cloneItems(items);

    const nextItems = cloneItems(items);
    const children = childrenByParent(nextItems);
    const siblings = children.get(item.parent_id || null) || [];
    const position = siblings.findIndex((candidate) => candidate.id === itemId);
    const targetPosition = position + delta;
    if (position < 0 || targetPosition < 0 || targetPosition >= siblings.length) {
        return cloneItems(items);
    }
    [siblings[position], siblings[targetPosition]] = [
        siblings[targetPosition],
        siblings[position],
    ];
    return applyHierarchyConstraints(flattenHierarchy(nextItems, children));
}

export function indentItem(items, itemId) {
    if (!canIndentItem(items, itemId)) return cloneItems(items);
    const nextItems = cloneItems(items);
    const children = childrenByParent(nextItems);
    const item = nextItems.find((candidate) => candidate.id === itemId);
    const oldParentId = item.parent_id || null;
    const siblings = children.get(oldParentId) || [];
    const position = siblings.findIndex((candidate) => candidate.id === itemId);
    const previousSibling = siblings[position - 1];
    siblings.splice(position, 1);
    item.exclusive_group_id = null;
    item.parent_id = previousSibling.id;
    if (!children.has(previousSibling.id)) children.set(previousSibling.id, []);
    children.get(previousSibling.id).push(item);
    return applyHierarchyConstraints(flattenHierarchy(nextItems, children));
}

export function outdentItem(items, itemId) {
    const nextItems = cloneItems(items);
    const item = nextItems.find((candidate) => candidate.id === itemId);
    if (!item?.parent_id) return cloneItems(items);
    const parent = nextItems.find((candidate) => candidate.id === item.parent_id);
    if (!parent) return cloneItems(items);
    const children = childrenByParent(nextItems);
    const currentSiblings = children.get(parent.id) || [];
    const currentPosition = currentSiblings.findIndex(
        (candidate) => candidate.id === itemId
    );
    if (currentPosition < 0) return cloneItems(items);
    currentSiblings.splice(currentPosition, 1);

    const grandparentId = parent.parent_id || null;
    const parentSiblings = children.get(grandparentId) || [];
    const parentPosition = parentSiblings.findIndex(
        (candidate) => candidate.id === parent.id
    );
    if (parentPosition < 0) return cloneItems(items);
    item.exclusive_group_id = null;
    item.parent_id = grandparentId;
    parentSiblings.splice(parentPosition + 1, 0, item);
    return applyHierarchyConstraints(flattenHierarchy(nextItems, children));
}

export function deleteItem(items, itemId) {
    const removedIds = getSubtreeIds(items, itemId);
    if (!removedIds.size) return cloneItems(items);
    if (items.length - removedIds.size < 1) return cloneItems(items);
    return applyHierarchyConstraints(
        items.filter((candidate) => !removedIds.has(candidate.id)).map((candidate) => ({ ...candidate }))
    );
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
