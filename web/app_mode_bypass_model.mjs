export const MODE_ALWAYS = 0;

export const DAELAB_NODE_TYPES = Object.freeze([
    "BooleanList",
    "BooleanListHierarchy",
    "BooleanListHierarchyGet",
    "BooleanGroupBypassController",
    "SeedreamExhibitionPromptBuilder",
    "GPTImage2Config",
    "DAELAB.ComfyTV.GPTImageStoryboardStage",
    "GPTImage2MaterialPrompt",
    "DAELabBadgeMaterialRegionV1",
    "BadgeReliefPrompt",
    "DAELabMultiColorMask",
    "DAELabMultiColorMaskV1",
    "DAELabBadgeHeightLayer",
    "DAELabBadgeHeightLayerV1",
    "BadgeHeightEstablishPromptBuilder",
    "DAELAB.BadgeMaterialCanvasNormalizeV1",
    "DAELAB.BadgeRenderSpaceMaskAlignV1",
    "DAELAB.BadgeRoute2CanvasV1",
    "DAELAB.BadgeEntryRouteV1",
    "DAELAB.BadgeLocalMaskRouteV1",
    "DAELAB.BadgeEditPromptRouteV1",
    "DAELAB.BadgeLazyImageSwitchV1",
    "DAELAB.BadgeColorIdMapV1",
    "DAELAB.BadgeColorIdMapCacheStoreV1",
    "DAELAB.BadgeLocalSelectionGuardV1",
    "BadgeDesignCanvas",
    "BadgeRenderPromptBuilder",
    "BadgeMasterRegistration",
    "BadgeEditMaskValidator",
    "BadgeLocalEditPromptBuilder",
    "BadgeHeightPatch",
    "BadgeDeterministicComposite",
    "BadgePresentationPromptBuilder",
    "BadgeEditStateSave",
    "BadgeEditStateLoad",
    "BadgeHeightReferenceAlignV1",
    "BadgeHeightLockedBaseV1",
    "DAELAB.BadgeReliefGeometryV1",
    "DAELAB.BadgeGPTStructureTransferV1",
    "DAELAB.BadgeStructureConstraintV1",
    "BadgeMaterialConstraintV1",
    "BadgeMaterialRegionGPTChannelV1",
    "BadgeMaterialRegionMergeV1",
    "BadgeMaterialRegionExecutorV1",
    "BadgeStudioCompositeV1",
    "DAELAB.BadgeSemanticRegionGPTChannelV1",
    "DAELAB.BadgeSemanticRegionMergeV1",
    "DAELAB.BadgeStudioBackgroundGPTV1",
    "DAELAB.BadgeStudioColorLockV1",
    "RMBGConfig",
    "AppModeLoadImage",
    "BBoxPromptReroute",
    "PolygonMask",
    "DAELAB.PolygonMaskV1",
    "DAELAB.BadgeSelectionMaskV1",
    "SAM3ComplexCollector",
]);

const DAELAB_NODE_TYPE_SET = new Set(DAELAB_NODE_TYPES);

export function isDaelabNode(node) {
    return Boolean(node && DAELAB_NODE_TYPE_SET.has(node.type));
}

export function isNodeAvailableInAppMode(node) {
    return Boolean(node) && Number(node.mode ?? MODE_ALWAYS) === MODE_ALWAYS;
}

export function getRootGraphSafely(appLike) {
    try {
        if (appLike?.isGraphReady === false) return null;
        return appLike?.rootGraph ?? null;
    } catch {
        return null;
    }
}

export function refreshGraphNodesReference(graph) {
    if (!Array.isArray(graph?._nodes)) return false;

    const previousNodes = graph._nodes;
    graph._nodes = [...previousNodes];
    return graph._nodes !== previousNodes;
}

export function getLinearData(graph) {
    const data = graph?.extra?.linearData;
    return {
        inputs: Array.isArray(data?.inputs) ? data.inputs : [],
        outputs: Array.isArray(data?.outputs) ? data.outputs : [],
    };
}

export function resolveNode(graph, nodeId) {
    if (!graph) return null;

    const direct = graph.getNodeById?.(nodeId);
    if (direct) return direct;

    const subgraphs = graph.subgraphs;
    if (!subgraphs || typeof subgraphs.values !== "function") return null;

    for (const subgraph of subgraphs.values()) {
        const nested = subgraph?.getNodeById?.(nodeId);
        if (nested) return nested;
    }
    return null;
}

export function makeWidgetKey(nodeId, widgetName) {
    return `${nodeId}:${widgetName}`;
}

export function normalizeLinearInputReference(nodeReference, widgetName) {
    const rawReference = String(nodeReference ?? "");
    const suffix = `:${widgetName}`;
    const widgetKey = rawReference.endsWith(suffix)
        ? rawReference
        : makeWidgetKey(rawReference, widgetName);
    const nodePath = rawReference.endsWith(suffix)
        ? rawReference.slice(0, -suffix.length)
        : rawReference;
    const nodeId = nodePath.includes(":")
        ? nodePath.slice(nodePath.lastIndexOf(":") + 1)
        : nodePath;
    return { nodeId, widgetKey };
}

export function createGraphTriggerWrapper(original, onModeChanged) {
    return function (event) {
        const result = original?.apply(this, arguments);
        if (event?.type === "node:property:changed" && event.property === "mode") {
            onModeChanged?.(event);
        }
        return result;
    };
}

export function getSelectedInputEntries(graph) {
    return getLinearData(graph).inputs.map(([nodeReference, widgetName]) => {
        const { nodeId, widgetKey } = normalizeLinearInputReference(nodeReference, widgetName);
        return {
            nodeId,
            widgetName,
            key: widgetKey,
            node: resolveNode(graph, nodeId),
        };
    });
}

export function getSelectedOutputEntries(graph) {
    return getLinearData(graph).outputs.map((nodeId) => ({
        nodeId,
        node: resolveNode(graph, nodeId),
    }));
}

function normalizeText(value) {
    return String(value ?? "").trim();
}

function inputAssignments(graph, items) {
    const entries = getSelectedInputEntries(graph);
    if (entries.length !== items.length) return null;

    return entries.map((entry, index) => ({
        elementIndex: index,
        node: entry.node,
        confidence: "ordered-input",
    }));
}

function outputAssignments(graph, items) {
    const entries = getSelectedOutputEntries(graph);
    if (entries.length !== items.length) return null;

    const idsMatch = entries.every(
        (entry, index) => normalizeText(items[index]?.subtitle) === normalizeText(entry.nodeId)
    );
    if (!idsMatch) return null;

    return entries.map((entry, index) => ({
        elementIndex: index,
        node: entry.node,
        confidence: "ordered-output",
    }));
}

function titleFallbackAssignments(graph, items) {
    const selectedNodes = [
        ...getSelectedInputEntries(graph).map((entry) => entry.node),
        ...getSelectedOutputEntries(graph).map((entry) => entry.node),
    ].filter(Boolean);

    const nodesByTitle = new Map();
    for (const node of selectedNodes) {
        const title = normalizeText(node.title);
        if (!title) continue;
        const matches = nodesByTitle.get(title) ?? [];
        if (!matches.includes(node)) matches.push(node);
        nodesByTitle.set(title, matches);
    }

    return items.flatMap((item, index) => {
        const matches = nodesByTitle.get(normalizeText(item?.subtitle)) ?? [];
        if (matches.length !== 1) return [];
        return [{
            elementIndex: index,
            node: matches[0],
            confidence: "unique-title",
        }];
    });
}

export function getBuilderIoAssignments(graph, items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    return (
        outputAssignments(graph, items)
        ?? inputAssignments(graph, items)
        ?? titleFallbackAssignments(graph, items)
    );
}
