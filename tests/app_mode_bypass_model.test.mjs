import assert from "node:assert/strict";
import test from "node:test";

import {
    createGraphTriggerWrapper,
    DAELAB_NODE_TYPES,
    getBuilderIoAssignments,
    getLinearData,
    getRootGraphSafely,
    getSelectedInputEntries,
    isDaelabNode,
    isNodeAvailableInAppMode,
    normalizeLinearInputReference,
    refreshGraphNodesReference,
    resolveNode,
} from "../web/app_mode_bypass_model.mjs";

function makeGraph(nodes, linearData = {}) {
    return {
        _nodes: nodes,
        get nodes() {
            return this._nodes;
        },
        extra: { linearData },
        subgraphs: new Map(),
        getNodeById(id) {
            return this._nodes.find((node) => String(node.id) === String(id));
        },
    };
}

test("covers every node exported by the DAELab package", () => {
    assert.deepEqual(DAELAB_NODE_TYPES, [
  "DAELAB.BadgeApp87V1",
  "DAELAB.BadgeApp87RegionAlignV1",
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
    for (const type of DAELAB_NODE_TYPES) assert.equal(isDaelabNode({ type }), true);
    assert.equal(isDaelabNode({ type: "SaveImage" }), false);
});

test("includes grouped panel nodes in app mode bypass collapsing", () => {
    for (const type of [
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
        "BadgeMasterRegistration",
        "BadgeEditMaskValidator",
        "BadgeLocalEditPromptBuilder",
        "BadgeHeightPatch",
        "BadgeDeterministicComposite",
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
        "DAELAB.PolygonMaskV1",
    ]) {
        const node = { type, mode: 4 };
        assert.equal(isDaelabNode(node), true);
        assert.equal(isNodeAvailableInAppMode(node), false);
    }
});

test("treats only ALWAYS mode as available in app mode", () => {
    assert.equal(isNodeAvailableInAppMode({ mode: 0 }), true);
    assert.equal(isNodeAvailableInAppMode({}), true);
    assert.equal(isNodeAvailableInAppMode({ mode: 2 }), false);
    assert.equal(isNodeAvailableInAppMode({ mode: 4 }), false);
});

test("waits safely while ComfyUI initializes the root graph", () => {
    const graph = { nodes: [] };
    assert.equal(getRootGraphSafely({ rootGraph: graph }), graph);
    assert.equal(getRootGraphSafely(null), null);
    let earlyRootGraphReads = 0;
    assert.equal(
        getRootGraphSafely({
            isGraphReady: false,
            get rootGraph() {
                earlyRootGraphReads += 1;
                throw new Error("ComfyApp graph accessed before initialization");
            },
        }),
        null
    );
    assert.equal(earlyRootGraphReads, 0);
    assert.equal(
        getRootGraphSafely({
            get rootGraph() {
                throw new Error("ComfyApp graph accessed before initialization");
            },
        }),
        null
    );
});

test("rotates the graph node-array reference without replacing its nodes", () => {
    const first = { id: 1 };
    const second = { id: 2 };
    const graph = makeGraph([first, second]);
    const previousNodes = graph.nodes;

    assert.equal(refreshGraphNodesReference(graph), true);
    assert.notEqual(graph.nodes, previousNodes);
    assert.deepEqual(graph.nodes, [first, second]);
    assert.equal(graph.getNodeById(2), second);
    assert.equal(refreshGraphNodesReference(null), false);
    assert.equal(refreshGraphNodesReference({ _nodes: new Set() }), false);
});

test("chains mode observation without changing the existing graph callback", () => {
    const calls = [];
    const owner = { name: "graph" };
    const original = function (event, extra) {
        calls.push(["original", this, event, extra]);
        return "preserved-result";
    };
    const wrapped = createGraphTriggerWrapper(original, (event) => calls.push(["mode", event]));
    const modeEvent = { type: "node:property:changed", property: "mode", newValue: 4 };

    assert.equal(wrapped.call(owner, modeEvent, "extra"), "preserved-result");
    assert.deepEqual(calls, [
        ["original", owner, modeEvent, "extra"],
        ["mode", modeEvent],
    ]);

    calls.length = 0;
    const titleEvent = { type: "node:property:changed", property: "title" };
    wrapped.call(owner, titleEvent);
    assert.deepEqual(calls, [["original", owner, titleEvent, undefined]]);
});

test("reads linear data without mutating missing workflow state", () => {
    assert.deepEqual(getLinearData(null), { inputs: [], outputs: [] });
    assert.deepEqual(getLinearData({ extra: {} }), { inputs: [], outputs: [] });
});

test("resolves custom nodes from root and nested subgraphs", () => {
    const rootNode = { id: 1, type: "BooleanList" };
    const nestedNode = { id: 2, type: "PolygonMask" };
    const graph = makeGraph([rootNode]);
    graph.subgraphs.set("nested", makeGraph([nestedNode]));

    assert.equal(resolveNode(graph, "1"), rootNode);
    assert.equal(resolveNode(graph, "2"), nestedNode);
    assert.equal(resolveNode(graph, 99), null);
});

test("builds exact Inspector keys from the persisted input order", () => {
    const node = { id: 7, type: "SeedreamExhibitionPromptBuilder", mode: 4 };
    const graph = makeGraph([node], { inputs: [[7, "base_prompt"], [7, "tone"]] });

    assert.deepEqual(
        getSelectedInputEntries(graph).map(({ key, node: entryNode }) => [key, entryNode]),
        [["7:base_prompt", node], ["7:tone", node]]
    );
});

test("resolves workflow-scoped App Mode widget references", () => {
    const node = { id: 7, type: "AppModeLoadImage", mode: 0 };
    const graph = makeGraph([node], {
        inputs: [["workflow-uuid:7:image", "image"]],
    });

    assert.deepEqual(normalizeLinearInputReference("workflow-uuid:7:image", "image"), {
        nodeId: "7",
        widgetKey: "workflow-uuid:7:image",
    });
    assert.deepEqual(
        getSelectedInputEntries(graph).map(({ nodeId, key, node: entryNode }) => [nodeId, key, entryNode]),
        [["7", "workflow-uuid:7:image", node]],
    );
});

test("maps input-step IO rows by order even when node titles are duplicated", () => {
    const first = { id: 10, type: "SeedreamExhibitionPromptBuilder", title: "Prompt", mode: 4 };
    const second = { id: 11, type: "SeedreamExhibitionPromptBuilder", title: "Prompt", mode: 0 };
    const graph = makeGraph([first, second], {
        inputs: [[10, "base_prompt"], [11, "base_prompt"]],
        outputs: [],
    });
    const assignments = getBuilderIoAssignments(graph, [
        { subtitle: "Prompt" },
        { subtitle: "Prompt" },
    ]);

    assert.deepEqual(assignments.map(({ node, confidence }) => [node.id, confidence]), [
        [10, "ordered-input"],
        [11, "ordered-input"],
    ]);
});

test("recognizes output-step IO rows by their node id subtitles", () => {
    const first = { id: 10, type: "BooleanGroupBypassController", title: "Controller", mode: 4 };
    const second = { id: 20, type: "SaveImage", title: "Save", mode: 0 };
    const graph = makeGraph([first, second], {
        inputs: [[20, "filename_prefix"]],
        outputs: [10, 20],
    });
    const assignments = getBuilderIoAssignments(graph, [
        { subtitle: "10" },
        { subtitle: "20" },
    ]);

    assert.deepEqual(assignments.map(({ node, confidence }) => [node.id, confidence]), [
        [10, "ordered-output"],
        [20, "ordered-output"],
    ]);
});

test("uses unique titles for selected inputs from any node package", () => {
    const standardNode = { id: 30, type: "ThirdPartyInput", title: "Prompt", mode: 4 };
    const graph = makeGraph([standardNode], {
        inputs: [[30, "value"]],
        outputs: [],
    });
    const assignments = getBuilderIoAssignments(graph, [
        { subtitle: "unmatched" },
        { subtitle: "Prompt" },
    ]);

    assert.deepEqual(assignments.map(({ node, confidence, elementIndex }) => [
        node.id,
        confidence,
        elementIndex,
    ]), [[30, "unique-title", 1]]);
});
