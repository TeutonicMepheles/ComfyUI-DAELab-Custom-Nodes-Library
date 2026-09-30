import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createExecutionReferenceCache,
    getQuickControlState,
    getTabAvailability,
    getVisibleReferenceSources,
    normalizeBadgeAppLayout,
    normalizeExecutionOutputImages,
    readHierarchyState,
    resolveActiveTab,
    shouldResetApplyForPolygonChange,
} from "../web/badge_app_layout_model.mjs";

const WORKFLOW_URL = new URL(
    "../../../user/default/workflows/%238.6%20-%20Badge%20Workflow.json",
    import.meta.url,
);

function loadGraph() {
    const workflow = JSON.parse(readFileSync(WORKFLOW_URL, "utf8"));
    const nodes = workflow.nodes.map((node) => ({ ...node }));
    return {
        id: workflow.id,
        extra: structuredClone(workflow.extra),
        _nodes: nodes,
        nodes,
        getNodeById(nodeId) {
            return nodes.find((node) => String(node.id) === String(nodeId)) || null;
        },
    };
}

test("normalizes the four-tab #8.6 layout and its unique 13-input partition", () => {
    const result = normalizeBadgeAppLayout(loadGraph());
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.layout.tabs.map((tab) => tab.id), ["control", "build", "local", "studio"]);
    assert.deepEqual(result.layout.tabs.map((tab) => tab.inputKeys.length), [1, 7, 4, 1]);
    assert.equal(new Set(result.layout.tabs.flatMap((tab) => tab.inputKeys)).size, 13);
    assert.equal(result.layout.stateSource.nodeId, "95");
    assert.equal(result.layout.quickControls.build.length, 2);
    assert.equal(result.layout.quickControls.local.length, 5);
    assert.deepEqual(result.layout.polygonChange, {
        nodeId: "142",
        selectionItemId: "badge.post.local.selection.polygon",
        applyItemId: "badge.post.local.apply",
    });
});

test("derives disabled tabs and falls back immediately when a current tab becomes unavailable", () => {
    const graph = loadGraph();
    const { layout } = normalizeBadgeAppLayout(graph);
    const state = readHierarchyState(layout.stateNode);
    const availability = getTabAvailability(layout, state);
    assert.equal(availability.get("control"), true);
    assert.equal(availability.get("build"), true);
    assert.equal(availability.get("local"), false);
    assert.equal(availability.get("studio"), false);
    assert.equal(resolveActiveTab(layout, "local", state), "control");

    state.find((item) => item.id === "badge.post.local").value = true;
    assert.equal(resolveActiveTab(layout, "local", state), "local");
    state.find((item) => item.id === "badge.post.local").value = false;
    assert.equal(resolveActiveTab(layout, "local", state), "control");
});

test("filters build references by route and emphasizes only focusInputKeys", () => {
    const graph = loadGraph();
    const { layout } = normalizeBadgeAppLayout(graph);
    const state = readHierarchyState(layout.stateNode);
    const heightKey = layout.tabById.get("build").inputKeys[3];
    let sources = getVisibleReferenceSources(layout, "build", state, heightKey);
    assert.deepEqual(sources.map((source) => source.id), ["build-flat", "build-height"]);
    assert.deepEqual(sources.map((source) => source.emphasized), [false, true]);
    assert.deepEqual(sources.map((source) => source.expanded), [false, false]);

    sources = getVisibleReferenceSources(layout, "build", state, heightKey, heightKey);
    assert.deepEqual(sources.map((source) => source.expanded), [false, true]);

    const flatKey = layout.tabById.get("build").inputKeys[1];
    sources = getVisibleReferenceSources(layout, "build", state, flatKey, flatKey);
    assert.deepEqual(sources.map((source) => source.expanded), [true, false]);

    state.find((item) => item.id === "badge.path.flat_height").value = false;
    state.find((item) => item.id === "badge.path.effect").value = true;
    sources = getVisibleReferenceSources(layout, "build", state, null);
    assert.deepEqual(sources.map((source) => source.id), ["build-effect"]);
});

test("derives synchronized quick-control values and parent availability", () => {
    const graph = loadGraph();
    const { layout } = normalizeBadgeAppLayout(graph);
    const state = readHierarchyState(layout.stateNode);
    const special = getQuickControlState(layout.quickControls.build[1], state);
    assert.deepEqual(special.choices.map((choice) => [choice.value, choice.interactive]), [[true, true]]);

    state.find((item) => item.id === "badge.path.flat_height").value = false;
    const disabled = getQuickControlState(layout.quickControls.build[1], state);
    assert.deepEqual(disabled.choices.map((choice) => [choice.value, choice.interactive]), [[true, false]]);
});

test("rejects version, duplicate, omitted, unknown, and invalid reference configuration", () => {
    const mutations = [
        (graph) => { graph.extra.daelabAppLayoutV1.version = 2; },
        (graph) => { graph.extra.daelabAppLayoutV1.tabs[1].inputKeys[0] = graph.extra.daelabAppLayoutV1.tabs[0].inputKeys[0]; },
        (graph) => { graph.extra.daelabAppLayoutV1.tabs[1].inputKeys.pop(); },
        (graph) => { graph.extra.daelabAppLayoutV1.inputKeys[0] = "unknown:input"; },
        (graph) => { graph.extra.daelabAppLayoutV1.referenceSources[0].nodeId = 9999; },
        (graph) => { graph.extra.daelabAppLayoutV1.stateSource.nodeId = 9999; },
    ];
    for (const mutate of mutations) {
        const graph = loadGraph();
        mutate(graph);
        assert.equal(normalizeBadgeAppLayout(graph).ok, false);
    }
});

test("normalizes execution images and keeps missing output as an empty placeholder state", () => {
    assert.deepEqual(normalizeExecutionOutputImages({}, "images"), []);
    assert.deepEqual(normalizeExecutionOutputImages({
        images: [{ filename: "same.png", subfolder: "badge", type: "temp" }],
    }), [{ filename: "same.png", subfolder: "badge", type: "temp" }]);
});

test("execution references refresh same-name files and clear between runs or routes", () => {
    const cache = createExecutionReferenceCache();
    const output = { images: [{ filename: "same.png", subfolder: "badge", type: "temp" }] };
    const first = cache.capture(116, output);
    const second = cache.capture(116, output);
    assert.notEqual(first.token, second.token);
    assert.equal(cache.get("116").token, second.token);
    assert.equal(cache.size, 1);

    cache.clear();
    assert.equal(cache.get(116), null);
    assert.equal(cache.size, 0);
    const nextRun = cache.capture(116, output);
    assert.notEqual(nextRun.token, first.token);
});

test("polygon confirmation reset is scoped to the configured node, graph, and active mode", () => {
    const graph = loadGraph();
    const { layout } = normalizeBadgeAppLayout(graph);
    const state = readHierarchyState(layout.stateNode);
    const detail = { graph, nodeId: "142" };

    assert.equal(shouldResetApplyForPolygonChange(layout, graph, detail, state), false);
    state.find((item) => item.id === "badge.post.local.selection.color").value = false;
    state.find((item) => item.id === "badge.post.local.selection.polygon").value = true;
    assert.equal(shouldResetApplyForPolygonChange(layout, graph, detail, state), true);
    assert.equal(shouldResetApplyForPolygonChange(layout, graph, { graph, nodeId: "999" }, state), false);
    assert.equal(shouldResetApplyForPolygonChange(layout, {}, detail, state), false);
});
