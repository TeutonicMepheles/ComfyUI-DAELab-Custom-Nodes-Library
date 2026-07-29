export function isHexColorString(value) {
    if (typeof value !== "string") return false;
    return /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

function comparablePromptText(value) {
    if (typeof value !== "string") return "";
    return value
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/[。！？；，,\s]+$/gu, "");
}

export function normalizeBooleanValue(value, defaultValue = true) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    if (value === 0 || value === 1) return Boolean(value);
    return defaultValue;
}

export const PROMPT_WIDGET_SERIALIZATION_ORDER = [
    "style_id",
    "tone",
    "primary_color",
    "secondary_color",
    "base_prompt",
    "additional_details",
    "use_theme_template",
    "use_space_reference",
    "include_people_placeholder",
    "use_element_reference",
    "lock_edit_region",
];

export const TEMPLATE_CONTROL_WIDGET_NAMES = [
    "style_id",
    "tone",
    "primary_color",
    "secondary_color",
    "additional_details",
    "use_space_reference",
    "include_people_placeholder",
    "use_element_reference",
    "lock_edit_region",
];

const PROMPT_WIDGET_DISPLAY_ORDER = [
    "base_prompt",
    "style_thumbnail_dom_selector",
    "style_id",
    "tone",
    "primary_color",
    "secondary_color",
    "additional_details",
    "use_theme_template",
    "use_space_reference",
    "include_people_placeholder",
    "lock_edit_region",
    "use_element_reference",
];

export function repairPromptTextValues({
    basePrompt,
    additionalDetails,
    defaultBasePrompt,
    defaultAdditionalDetails,
}) {
    const repairedBase = typeof basePrompt !== "string" || isHexColorString(basePrompt)
        ? defaultBasePrompt
        : basePrompt;
    const comparableAdditional = comparablePromptText(additionalDetails);
    const additionalIsDuplicate = comparableAdditional.length > 0
        && comparableAdditional === comparablePromptText(repairedBase);
    const repairedAdditional = typeof additionalDetails !== "string"
        || isHexColorString(additionalDetails)
        || additionalIsDuplicate
        ? defaultAdditionalDetails
        : additionalDetails;

    return {
        basePrompt: repairedBase,
        additionalDetails: repairedAdditional,
    };
}

export function orderPromptPanelWidgets(widgets) {
    const source = widgets || [];
    const byName = new Map(source.map((widget) => [widget.name, widget]));
    const ordered = PROMPT_WIDGET_DISPLAY_ORDER
        .map((name) => byName.get(name))
        .filter(Boolean);
    const orderedSet = new Set(ordered);
    return [...ordered, ...source.filter((widget) => !orderedSet.has(widget))];
}

export function getCanonicalPromptWidgetValues(widgets) {
    const byName = new Map((widgets || []).map((widget) => [widget.name, widget]));
    return PROMPT_WIDGET_SERIALIZATION_ORDER.map(
        (name) => byName.get(name)?.value ?? null
    );
}

export function migratePromptWidgetValues(values) {
    if (!Array.isArray(values)) return null;
    const expectedLength = PROMPT_WIDGET_SERIALIZATION_ORDER.length;
    if (values.length === expectedLength) return values.slice();

    if (values.length === expectedLength + 1 && values[0] == null) {
        return values.slice(1);
    }

    if (values.length === expectedLength + 1 && values[1] == null) {
        return [
            values[2],
            values[3],
            values[4],
            values[5],
            values[0],
            ...values.slice(6),
        ];
    }
    return null;
}

export function setTemplateWidgetsDisabled(widgets, disabled) {
    const targets = new Set(TEMPLATE_CONTROL_WIDGET_NAMES);
    let changed = false;
    for (const widget of widgets || []) {
        if (!targets.has(widget.name)) continue;
        if (!Object.hasOwn(widget, "__seedreamOriginalDisabled")) {
            widget.__seedreamOriginalDisabled = Boolean(widget.disabled);
            widget.__seedreamOriginalOptionsDisabled = Boolean(
                widget.options?.disabled
            );
        }
        const nextDisabled = disabled
            ? true
            : widget.__seedreamOriginalDisabled;
        if (widget.disabled !== nextDisabled) {
            widget.disabled = nextDisabled;
            changed = true;
        }
        if (widget.options) {
            const nextOptionsDisabled = disabled
                ? true
                : widget.__seedreamOriginalOptionsDisabled;
            if (widget.options.disabled !== nextOptionsDisabled) {
                widget.options.disabled = nextOptionsDisabled;
                changed = true;
            }
        }
        if (
            disabled
            && !widget.__seedreamTemplateDisabled
            && (widget.name === "primary_color"
                || widget.name === "secondary_color")
        ) {
            widget.__seedreamEnabledValue = widget.value;
        }
        widget.__seedreamTemplateDisabled = disabled;
    }
    return changed;
}

function getGraphLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (graph._links && typeof graph._links.get === "function") {
        return graph._links.get(linkId) || null;
    }
    if (graph.links && typeof graph.links.get === "function") {
        return graph.links.get(linkId) || null;
    }
    return graph._links?.[linkId] || graph.links?.[linkId] || null;
}

function getGraphNode(graph, nodeId) {
    const direct = graph?.getNodeById?.(nodeId);
    if (direct) return direct;
    const nodes = graph?._nodes || graph?.nodes || [];
    if (Array.isArray(nodes)) {
        return nodes.find((node) => String(node?.id) === String(nodeId)) || null;
    }
    if (typeof nodes.values === "function") {
        return Array.from(nodes.values()).find(
            (node) => String(node?.id) === String(nodeId)
        ) || null;
    }
    return nodes?.[nodeId] || null;
}

function knownBoolean(value) {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === 1) return Boolean(value);
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return null;
}

function readHierarchyItems(sourceNode) {
    const value = sourceNode?._booleanHierarchyItems
        || sourceNode?.properties?.boolean_list_items
        || sourceNode?.widgets?.find((widget) => widget.name === "config_json")?.value;
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function readGetHierarchyItems(sourceNode) {
    const value = sourceNode?._booleanHierarchyGetSnapshot
        || sourceNode?.properties?.boolean_get_snapshot
        || sourceNode?.widgets?.find((widget) => widget.name === "config_json")?.value;
    let snapshot = value;
    if (typeof value === "string") {
        try {
            snapshot = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!snapshot || typeof snapshot !== "object") return [];
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const itemById = new Map(
        items.map((item) => [String(item?.id ?? ""), item])
    );
    const outputIds = Array.isArray(snapshot.output_item_ids)
        ? snapshot.output_item_ids
        : items.map((item) => item?.id);
    return outputIds.map((itemId, index) => {
        const item = itemById.get(String(itemId ?? "")) || {};
        return {
            ...item,
            id: String(item?.id ?? itemId ?? index),
            value: snapshot.valid === true
                && knownBoolean(item?.value) === true,
        };
    });
}

function readSourceWidgetBoolean(sourceNode, output) {
    const outputWidget = output?.widget;
    const widgetName = typeof outputWidget === "string"
        ? outputWidget
        : outputWidget?.name;
    const namedWidget = widgetName
        ? sourceNode?.widgets?.find((widget) => widget.name === widgetName)
        : null;
    const namedValue = knownBoolean(namedWidget?.value);
    if (namedValue !== null) return namedValue;

    const booleanWidgets = (sourceNode?.widgets || []).filter(
        (widget) => knownBoolean(widget?.value) !== null
    );
    if (booleanWidgets.length === 1) {
        return knownBoolean(booleanWidgets[0].value);
    }
    return null;
}

export function resolveLinkedBooleanValue(node, inputName) {
    const input = node?.inputs?.find((candidate) => candidate.name === inputName);
    if (input?.link == null) return null;

    const link = getGraphLink(node.graph, input.link);
    if (!link) return null;
    const sourceNode = getGraphNode(node.graph, link.origin_id);
    if (!sourceNode) return null;
    const originSlot = Number(link.origin_slot);

    if (
        sourceNode.type === "BooleanListHierarchy"
        || sourceNode.comfyClass === "BooleanListHierarchy"
    ) {
        const items = readHierarchyItems(sourceNode);
        const output = sourceNode.outputs?.[originSlot];
        const itemId = output?.boolean_item_id;
        const item = itemId
            ? items.find((candidate) => candidate.id === itemId)
            : items[originSlot];
        const hierarchyValue = knownBoolean(item?.value);
        if (hierarchyValue !== null) return hierarchyValue;
    }

    if (
        sourceNode.type === "BooleanListHierarchyGet"
        || sourceNode.comfyClass === "BooleanListHierarchyGet"
    ) {
        const items = readGetHierarchyItems(sourceNode);
        const output = sourceNode.outputs?.[originSlot];
        const itemId = output?.boolean_item_id;
        const item = itemId
            ? items.find(
                (candidate) => String(candidate.id) === String(itemId)
            )
            : items[originSlot];
        const hierarchyValue = knownBoolean(item?.value);
        if (hierarchyValue !== null) return hierarchyValue;
    }

    const output = sourceNode.outputs?.[originSlot];
    const widgetValue = readSourceWidgetBoolean(sourceNode, output);
    if (widgetValue !== null) return widgetValue;
    const runtimeValue = knownBoolean(sourceNode.getOutputData?.(originSlot));
    if (runtimeValue !== null) return runtimeValue;
    return knownBoolean(output?.value);
}
