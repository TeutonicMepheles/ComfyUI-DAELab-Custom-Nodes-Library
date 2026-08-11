import assert from "node:assert/strict";
import test from "node:test";

import {
    MODE_ACTIVE,
    MODE_BYPASS,
    applyModeToNodes,
    buildNodeModeAssignments,
    buildGroupOptions,
    collectBooleanAncestorIds,
    collectControllableNodes,
    desiredMode,
    findPlanConflicts,
    getGraphLink,
    isAllowedHierarchicalOverlap,
    resolveBooleanSource,
    resolveGroup,
    setNodeMode,
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

function makePlan({
    controllerId,
    graph,
    groupId,
    nodes,
    hierarchySourceId = "hierarchy",
    itemId,
    ancestorItemIds = [],
    mode = MODE_ACTIVE,
}) {
    return {
        controller: { id: controllerId },
        graph,
        groupId,
        nodes,
        mode,
        source: {
            hierarchySourceId,
            itemId,
            ancestorItemIds,
        },
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
    assert.equal(resolved.hierarchySourceId, "7");
    assert.deepEqual(resolved.ancestorItemIds, []);
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
    assert.equal(resolved.hierarchySourceId, "7");
    assert.deepEqual(resolved.ancestorItemIds, ["root"]);
});

test("collects a stable root-to-parent ancestry without following requires ids", () => {
    const items = [
        { id: "root", parent_id: null },
        { id: "child", parent_id: "root", requires_ids: ["external"] },
        { id: "grandchild", parent_id: "child" },
        { id: "external", parent_id: null },
    ];
    assert.deepEqual(
        collectBooleanAncestorIds(items, "grandchild"),
        ["child", "root"]
    );
});

test("matches a direct parent source with a child exposed through Hierarchy Get", () => {
    const items = [
        { id: "root", label: "Root", value: true, parent_id: null },
        { id: "child", label: "Child", value: false, parent_id: "root" },
    ];
    const directSource = makeSource(items);
    const getSource = makeGetSource(items, ["child"]);
    const direct = resolveBooleanSource(makeController(
        directSource,
        new Map([[101, { origin_id: 7, origin_slot: 0 }]])
    ));
    const child = resolveBooleanSource(makeController(
        getSource,
        new Map([[101, { origin_id: 8, origin_slot: 0 }]])
    ));
    const graph = {};
    const shared = { id: 1 };
    const parentPlan = {
        controller: { id: 1 },
        graph,
        groupId: "parent",
        nodes: [shared],
        source: direct,
    };
    const childPlan = {
        controller: { id: 2 },
        graph,
        groupId: "child",
        nodes: [shared],
        source: child,
    };

    assert.equal(isAllowedHierarchicalOverlap(parentPlan, childPlan), true);
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

test("emits a standard graph property event when changing node mode", () => {
    const events = [];
    const node = {
        id: 12,
        mode: MODE_ACTIVE,
        graph: { trigger: (...args) => events.push(args) },
    };

    assert.equal(setNodeMode(node, MODE_BYPASS), true);
    assert.equal(node.mode, MODE_BYPASS);
    assert.deepEqual(events, [["node:property:changed", {
        nodeId: 12,
        property: "mode",
        oldValue: MODE_ACTIVE,
        newValue: MODE_BYPASS,
    }]]);
    assert.equal(setNodeMode(node, MODE_BYPASS), false);
    assert.equal(events.length, 1);
});

test("changes only nodes that differ from the requested mode", () => {
    const active = { id: 1, mode: MODE_ACTIVE };
    const bypassed = { id: 2, mode: MODE_BYPASS };
    assert.equal(applyModeToNodes([active, bypassed], MODE_BYPASS), true);
    assert.equal(active.mode, MODE_BYPASS);
    assert.equal(bypassed.mode, MODE_BYPASS);
    assert.equal(applyModeToNodes([active, bypassed], MODE_BYPASS), false);
});

test("allows nested group overlap that follows Boolean ancestry", () => {
    const graph = {};
    const parentOnly = { id: 1 };
    const shared = { id: 2 };
    const parent = makePlan({
        controllerId: 10,
        graph,
        groupId: "parent-group",
        nodes: [parentOnly, shared],
        itemId: "root",
    });
    const child = makePlan({
        controllerId: 11,
        graph,
        groupId: "child-group",
        nodes: [shared],
        itemId: "child",
        ancestorItemIds: ["root"],
    });

    assert.equal(isAllowedHierarchicalOverlap(parent, child), true);
    assert.equal(findPlanConflicts([parent, child]).size, 0);

    const sameMembers = { ...parent, nodes: [shared] };
    assert.equal(isAllowedHierarchicalOverlap(sameMembers, child), true);
    assert.equal(findPlanConflicts([sameMembers, child]).size, 0);
});

test("combines nested plans with bypass dominance independent of plan order", () => {
    const graph = {};
    const rootOnly = { id: 1 };
    const childOnly = { id: 2 };
    const grandchildOnly = { id: 3 };
    const plansFor = (rootMode, childMode, grandchildMode) => [
        makePlan({
            controllerId: 1,
            graph,
            groupId: "root-group",
            nodes: [rootOnly, childOnly, grandchildOnly],
            itemId: "root",
            mode: rootMode,
        }),
        makePlan({
            controllerId: 2,
            graph,
            groupId: "child-group",
            nodes: [childOnly, grandchildOnly],
            itemId: "child",
            ancestorItemIds: ["root"],
            mode: childMode,
        }),
        makePlan({
            controllerId: 3,
            graph,
            groupId: "grandchild-group",
            nodes: [grandchildOnly],
            itemId: "grandchild",
            ancestorItemIds: ["child", "root"],
            mode: grandchildMode,
        }),
    ];
    const modesFor = (plans) => {
        const assignments = buildNodeModeAssignments(plans);
        return [
            assignments.get(rootOnly),
            assignments.get(childOnly),
            assignments.get(grandchildOnly),
        ];
    };

    assert.deepEqual(
        modesFor(plansFor(MODE_BYPASS, MODE_ACTIVE, MODE_ACTIVE)),
        [MODE_BYPASS, MODE_BYPASS, MODE_BYPASS]
    );
    assert.deepEqual(
        modesFor(plansFor(MODE_ACTIVE, MODE_BYPASS, MODE_ACTIVE)),
        [MODE_ACTIVE, MODE_BYPASS, MODE_BYPASS]
    );
    assert.deepEqual(
        modesFor(plansFor(MODE_ACTIVE, MODE_ACTIVE, MODE_BYPASS)),
        [MODE_ACTIVE, MODE_ACTIVE, MODE_BYPASS]
    );
    const activePlans = plansFor(MODE_ACTIVE, MODE_ACTIVE, MODE_ACTIVE);
    assert.deepEqual(
        modesFor(activePlans),
        [MODE_ACTIVE, MODE_ACTIVE, MODE_ACTIVE]
    );
    assert.deepEqual(
        modesFor([...activePlans].reverse()),
        [MODE_ACTIVE, MODE_ACTIVE, MODE_ACTIVE]
    );
    assert.deepEqual(
        modesFor(plansFor(MODE_ACTIVE, desiredMode(false, true), MODE_ACTIVE)),
        [MODE_ACTIVE, MODE_ACTIVE, MODE_ACTIVE]
    );
});

test("rejects duplicate, unrelated, partial, and reversed overlaps", () => {
    const graph = {};
    const first = { id: 1 };
    const second = { id: 2 };
    const shared = { id: 3 };
    const extra = { id: 4 };

    const duplicate = findPlanConflicts([
        makePlan({
            controllerId: 10,
            graph,
            groupId: "same",
            nodes: [],
            itemId: "root",
        }),
        makePlan({
            controllerId: 11,
            graph,
            groupId: "same",
            nodes: [],
            itemId: "child",
            ancestorItemIds: ["root"],
        }),
    ]);
    assert.equal(duplicate.size, 2);

    const siblings = findPlanConflicts([
        makePlan({
            controllerId: 12,
            graph,
            groupId: "first",
            nodes: [first, shared],
            itemId: "left",
            ancestorItemIds: ["root"],
        }),
        makePlan({
            controllerId: 13,
            graph,
            groupId: "second",
            nodes: [shared, second],
            itemId: "right",
            ancestorItemIds: ["root"],
        }),
    ]);
    assert.equal(siblings.size, 2);

    const crossHierarchy = findPlanConflicts([
        makePlan({
            controllerId: 14,
            graph,
            groupId: "first",
            nodes: [first, shared],
            hierarchySourceId: "a",
            itemId: "root",
        }),
        makePlan({
            controllerId: 15,
            graph,
            groupId: "second",
            nodes: [shared],
            hierarchySourceId: "b",
            itemId: "child",
            ancestorItemIds: ["root"],
        }),
    ]);
    assert.equal(crossHierarchy.size, 2);

    const partial = findPlanConflicts([
        makePlan({
            controllerId: 16,
            graph,
            groupId: "parent",
            nodes: [first, shared],
            itemId: "root",
        }),
        makePlan({
            controllerId: 17,
            graph,
            groupId: "child",
            nodes: [shared, extra],
            itemId: "child",
            ancestorItemIds: ["root"],
        }),
    ]);
    assert.equal(partial.size, 2);

    const reversed = findPlanConflicts([
        makePlan({
            controllerId: 18,
            graph,
            groupId: "parent",
            nodes: [shared],
            itemId: "root",
        }),
        makePlan({
            controllerId: 19,
            graph,
            groupId: "child",
            nodes: [shared, extra],
            itemId: "child",
            ancestorItemIds: ["root"],
        }),
    ]);
    assert.equal(reversed.size, 2);
});

test("propagates an invalid binding through its hierarchical overlap chain", () => {
    const graph = {};
    const rootOnly = { id: 1 };
    const childNode = { id: 2 };
    const leafNode = { id: 3 };
    const root = makePlan({
        controllerId: 1,
        graph,
        groupId: "root-group",
        nodes: [rootOnly, childNode, leafNode],
        itemId: "root",
    });
    const child = makePlan({
        controllerId: 2,
        graph,
        groupId: "duplicate-group",
        nodes: [childNode, leafNode],
        itemId: "child",
        ancestorItemIds: ["root"],
    });
    const grandchild = makePlan({
        controllerId: 3,
        graph,
        groupId: "duplicate-group",
        nodes: [leafNode],
        itemId: "grandchild",
        ancestorItemIds: ["child", "root"],
    });

    const conflicts = findPlanConflicts([root, child, grandchild]);
    assert.equal(conflicts.size, 3);
    assert.equal(conflicts.has(root.controller), true);
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
