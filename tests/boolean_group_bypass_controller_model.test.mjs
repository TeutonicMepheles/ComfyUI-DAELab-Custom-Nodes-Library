import assert from "node:assert/strict";
import test from "node:test";

import {
    MODE_ACTIVE,
    MODE_BYPASS,
    applyModeToNodes,
    buildGroupOptions,
    collectControllableNodes,
    desiredMode,
    findPlanConflicts,
    getGraphLink,
    resolveBooleanSource,
    resolveGroup,
} from "../web/boolean_group_bypass_controller_model.mjs";

function makeSource(items, outputs = null) {
    return {
        id: 7,
        type: "BooleanListHierarchy",
        title: "Hierarchy",
        properties: { boolean_list_items: JSON.stringify(items) },
        outputs: outputs || items.map((item) => ({
            name: item.label,
            type: "BOOLEAN",
            boolean_item_id: item.id,
        })),
    };
}

function makeGetSource(items, outputItemIds, valid = true) {
    return {
        id: 8,
        type: "BooleanListHierarchyGet",
        title: "Hierarchy Get",
        properties: {
            boolean_get_snapshot: JSON.stringify({
                version: 1,
                valid,
                source_node_id: "7",
                root_item_id: "root",
                include_root: true,
                items,
                output_item_ids: outputItemIds,
            }),
        },
        outputs: outputItemIds.map((itemId) => {
            const item = items.find((candidate) => candidate.id === itemId);
            return {
                name: item?.label || itemId,
                type: "BOOLEAN",
                boolean_item_id: itemId,
                boolean_get_item_key: `7::${itemId}`,
            };
        }),
    };
}

function makeController(source, linkStore) {
    const graph = {
        _links: linkStore,
        getNodeById(id) {
            return id === source.id ? source : null;
        },
    };
    return {
        id: 10,
        graph,
        inputs: [{ name: "boolean", type: "BOOLEAN", link: 101 }],
    };
}

test("resolves Map and object graph link stores", () => {
    const link = { origin_id: 7, origin_slot: 0 };
    assert.equal(getGraphLink({ _links: new Map([[101, link]]) }, 101), link);
    assert.equal(getGraphLink({ links: { 101: link } }, 101), link);
});

test("binds the connected Boolean by stable item id after output reorder", () => {
    const items = [
        { id: "a", label: "A renamed", value: false },
        { id: "b", label: "B renamed", value: true },
    ];
    const source = makeSource(items, [
        { name: "B renamed", type: "BOOLEAN", boolean_item_id: "b" },
        { name: "A renamed", type: "BOOLEAN", boolean_item_id: "a" },
    ]);
    const controller = makeController(source, new Map([[101, { origin_id: 7, origin_slot: 0 }]]));

    const resolved = resolveBooleanSource(controller);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.itemId, "b");
    assert.equal(resolved.itemLabel, "B renamed");
    assert.equal(resolved.value, true);
});

test("accepts Boolean List Hierarchy Get outputs by stable item id", () => {
    const items = [
        { id: "root", label: "Root", value: true, parent_id: null },
        { id: "child", label: "Child renamed", value: true, parent_id: "root" },
    ];
    const source = makeGetSource(items, ["child", "root"]);
    const controller = makeController(
        source,
        new Map([[101, { origin_id: 8, origin_slot: 0 }]])
    );

    const resolved = resolveBooleanSource(controller);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.itemId, "child");
    assert.equal(resolved.itemLabel, "Child renamed");
    assert.equal(resolved.value, true);
    assert.equal(resolved.sourceLabel, "Hierarchy Get");
});

test("ignores dependency context items that are not exposed by Hierarchy Get", () => {
    const items = [
        { id: "external", label: "External prerequisite", value: true, parent_id: null },
        {
            id: "selected",
            label: "Selected",
            value: true,
            parent_id: null,
            requires_ids: ["external"],
        },
    ];
    const source = makeGetSource(items, ["selected"]);
    const controller = makeController(
        source,
        new Map([[101, { origin_id: 8, origin_slot: 0 }]])
    );
    const resolved = resolveBooleanSource(controller);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.itemId, "selected");
    assert.equal(resolved.value, true);
});

test("forces a missing Hierarchy Get binding to false", () => {
    const items = [
        { id: "root", label: "Root", value: true, parent_id: null },
    ];
    const source = makeGetSource(items, ["root"], false);
    const controller = makeController(
        source,
        new Map([[101, { origin_id: 8, origin_slot: 0 }]])
    );
    const resolved = resolveBooleanSource(controller);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.value, false);
});

test("rejects disconnected, missing, and non-hierarchy sources without mutation data", () => {
    const source = makeSource([{ id: "a", label: "A", value: true }]);
    const disconnected = makeController(source, new Map());
    disconnected.inputs[0].link = null;
    assert.equal(resolveBooleanSource(disconnected).code, "unconnected");

    const missingLink = makeController(source, new Map());
    assert.equal(resolveBooleanSource(missingLink).code, "missing_link");

    const wrongSource = makeController({ ...source, type: "PrimitiveBoolean" }, new Map([
        [101, { origin_id: 7, origin_slot: 0 }],
    ]));
    assert.equal(resolveBooleanSource(wrongSource).code, "wrong_source");
});

test("uses stable group ids and disambiguates duplicate titles", () => {
    const first = { id: 1, title: "Sampler" };
    const second = { id: 2, title: "Sampler" };
    const third = { id: 3, title: "Decode" };
    const graph = { _groups: [first, second, third] };
    const options = buildGroupOptions(graph);

    assert.deepEqual(options.map((option) => option.label), ["Sampler (#1)", "Sampler (#2)", "Decode"]);
    assert.equal(resolveGroup(graph, "2"), second);
});

test("collects group nodes while excluding all controller nodes", () => {
    const controller = { id: 10, type: "BooleanGroupBypassController", mode: 0 };
    const otherController = { id: 11, type: "BooleanGroupBypassController", mode: 0 };
    const sampler = { id: 12, type: "KSampler", mode: 0 };
    const group = { _children: new Set([controller, otherController, sampler, { id: 99 }]) };

    assert.deepEqual(collectControllableNodes(group, controller), [sampler]);
});

test("maps normal and inverted Boolean values to active and bypass modes", () => {
    assert.equal(desiredMode(true, false), MODE_ACTIVE);
    assert.equal(desiredMode(false, false), MODE_BYPASS);
    assert.equal(desiredMode(true, true), MODE_BYPASS);
    assert.equal(desiredMode(false, true), MODE_ACTIVE);
});

test("changes only nodes that differ from the requested mode", () => {
    const active = { id: 1, mode: MODE_ACTIVE };
    const bypassed = { id: 2, mode: MODE_BYPASS };
    assert.equal(applyModeToNodes([active, bypassed], MODE_BYPASS), true);
    assert.equal(active.mode, MODE_BYPASS);
    assert.equal(bypassed.mode, MODE_BYPASS);
    assert.equal(applyModeToNodes([active, bypassed], MODE_BYPASS), false);
});

test("detects duplicate targets and overlapping controlled members", () => {
    const graph = {};
    const a = { id: 1 };
    const b = { id: 2 };
    const shared = { id: 3 };
    const plans = [
        { controller: a, graph, groupId: "g1", nodes: [shared] },
        { controller: b, graph, groupId: "g2", nodes: [shared] },
    ];
    const overlap = findPlanConflicts(plans);
    assert.match(overlap.get(a), /重叠/);
    assert.match(overlap.get(b), /重叠/);

    const duplicate = findPlanConflicts([
        { controller: a, graph, groupId: "g1", nodes: [] },
        { controller: b, graph, groupId: "g1", nodes: [] },
    ]);
    assert.match(duplicate.get(a), /同一组/);
    assert.match(duplicate.get(b), /同一组/);
});

test("does not report conflicts between different graph instances", () => {
    const shared = { id: 3 };
    const first = { id: 1 };
    const second = { id: 2 };
    const conflicts = findPlanConflicts([
        { controller: first, graph: {}, groupId: "g1", nodes: [shared] },
        { controller: second, graph: {}, groupId: "g1", nodes: [shared] },
    ]);
    assert.equal(conflicts.size, 0);
});
