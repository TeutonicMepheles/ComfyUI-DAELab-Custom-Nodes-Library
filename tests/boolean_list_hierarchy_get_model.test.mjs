import assert from "node:assert/strict";
import test from "node:test";

import {
    buildRootOptions,
    buildSourceOptions,
    createMissingSnapshot,
    createValidSnapshot,
    getBranchItems,
    getOutputSlotsMatchDescriptors,
    getSnapshotOutputDescriptors,
    reconcileGetOutputSlots,
    resolveSourceNode,
} from "../web/boolean_list_hierarchy_get_model.mjs";

function item(id, label, value = false, parentId = null, requiresIds = []) {
    return { id, label, value, parent_id: parentId, requires_ids: requiresIds };
}

function source(id, title, items) {
    return {
        id,
        type: "BooleanListHierarchy",
        title,
        properties: { boolean_list_items: JSON.stringify(items) },
    };
}

test("lists hierarchy sources and disambiguates duplicate titles", () => {
    const first = source(1, "Flags", [item("a", "A")]);
    const second = source(2, "Flags", [item("b", "B")]);
    const graph = {
        _nodes: [first, second, { id: 3, type: "BooleanList" }],
        getNodeById(id) {
            return this._nodes.find((node) => String(node.id) === String(id));
        },
    };
    assert.deepEqual(
        buildSourceOptions(graph).map((option) => option.label),
        ["Flags (#1)", "Flags (#2)"]
    );
    assert.equal(resolveSourceNode(graph, "2"), second);
});

test("selects roots and returns a complete three-level branch in visible order", () => {
    const hierarchy = source(7, "Hierarchy", [
        item("a", "A", true),
        item("a1", "A1", true, "a"),
        item("a1x", "A1X", true, "a1"),
        item("a2", "A2", false, "a"),
        item("b", "B", true),
        item("b1", "B1", true, "b"),
    ]);
    assert.deepEqual(
        buildRootOptions(hierarchy).map((option) => option.id),
        ["a", "b"]
    );
    assert.deepEqual(
        getBranchItems(hierarchy, "a").map((entry) => entry.id),
        ["a", "a1", "a1x", "a2"]
    );
});

test("creates snapshots with optional root output and composite stable keys", () => {
    const hierarchy = source(7, "Hierarchy", [
        item("a", "A", true),
        item("a1", "A1", true, "a"),
        item("a1x", "A1X", false, "a1"),
    ]);
    const withRoot = createValidSnapshot(hierarchy, "a", true);
    assert.deepEqual(withRoot.output_item_ids, ["a", "a1", "a1x"]);
    assert.deepEqual(
        getSnapshotOutputDescriptors(withRoot).map((entry) => entry.key),
        ["7::a", "7::a1", "7::a1x"]
    );

    const descendantsOnly = createValidSnapshot(hierarchy, "a", false);
    assert.deepEqual(descendantsOnly.output_item_ids, ["a1", "a1x"]);
});

test("snapshots include cross-branch prerequisite context without exposing extra outputs", () => {
    const hierarchy = source(7, "Hierarchy", [
        item("a", "External prerequisite", true),
        item("b", "Selected root", true, null, ["a"]),
        item("b1", "Selected child", true, "b"),
    ]);
    const selected = createValidSnapshot(hierarchy, "b", true);
    assert.equal(selected.version, 2);
    assert.deepEqual(selected.items.map((entry) => entry.id), ["a", "b", "b1"]);
    assert.deepEqual(selected.output_item_ids, ["b", "b1"]);
    assert.deepEqual(
        selected.items.find((entry) => entry.id === "b").requires_ids,
        ["a"]
    );
    assert.deepEqual(
        getSnapshotOutputDescriptors(selected).map((entry) => entry.item_id),
        ["b", "b1"]
    );
});

test("missing sources preserve sockets but force every output false", () => {
    const hierarchy = source(7, "Hierarchy", [
        item("a", "A", true),
        item("a1", "A1", true, "a"),
    ]);
    const valid = createValidSnapshot(hierarchy, "a", true);
    const missing = createMissingSnapshot(valid, {
        sourceNodeId: "7",
        rootItemId: "a",
        includeRoot: true,
    });
    assert.equal(missing.valid, false);
    assert.deepEqual(
        getSnapshotOutputDescriptors(missing).map((entry) => entry.value),
        [false, false]
    );

    const rebound = createMissingSnapshot(valid, {
        sourceNodeId: "8",
        rootItemId: "",
        preserveItems: true,
    });
    assert.deepEqual(rebound.output_item_ids, []);
});

function createMockNode(descriptors) {
    const links = new Map();
    const disconnected = [];
    const outputs = descriptors.map((descriptor, index) => {
        const linkId = 200 + index;
        links.set(linkId, { id: linkId, origin_slot: index });
        return {
            name: descriptor.label,
            type: "BOOLEAN",
            links: [linkId],
            boolean_get_item_key: descriptor.key,
        };
    });
    return {
        graph: { _links: links },
        outputs,
        disconnected,
        removeOutput(index) {
            const [removed] = this.outputs.splice(index, 1);
            for (const linkId of removed.links || []) {
                disconnected.push(linkId);
                links.delete(linkId);
            }
            for (
                let outputIndex = index;
                outputIndex < this.outputs.length;
                outputIndex += 1
            ) {
                for (const linkId of this.outputs[outputIndex].links || []) {
                    links.get(linkId).origin_slot -= 1;
                }
            }
        },
        addOutput(name, type) {
            const output = { name, type, links: null };
            this.outputs.push(output);
            return output;
        },
    };
}

test("keeps Get links on stable branch items across rename and reorder", () => {
    const previous = [
        { key: "7::a", item_id: "a", label: "A" },
        { key: "7::b", item_id: "b", label: "B" },
        { key: "7::c", item_id: "c", label: "C" },
    ];
    const next = [
        { key: "7::c", item_id: "c", label: "C renamed" },
        { key: "7::a", item_id: "a", label: "A" },
    ];
    const node = createMockNode(previous);
    reconcileGetOutputSlots(node, previous, next);

    assert.deepEqual(
        node.outputs.map((output) => output.boolean_get_item_key),
        ["7::c", "7::a"]
    );
    assert.equal(node.outputs[0].name, "C renamed");
    assert.equal(node.graph._links.get(202).origin_slot, 0);
    assert.equal(node.graph._links.get(200).origin_slot, 1);
    assert.deepEqual(node.disconnected, [201]);
});

test("detects and removes the backend's 64 placeholder sockets for an empty selection", () => {
    const node = {
        outputs: Array.from({ length: 64 }, (_, index) => ({
            name: `Boolean ${index + 1}`,
            type: "BOOLEAN",
            links: null,
        })),
        removeOutput(index) {
            this.outputs.splice(index, 1);
        },
    };

    assert.equal(getOutputSlotsMatchDescriptors(node, []), false);
    reconcileGetOutputSlots(node, [], []);
    assert.deepEqual(node.outputs, []);
    assert.equal(getOutputSlotsMatchDescriptors(node, []), true);
});

test("recognizes only a fully reconciled selected branch socket list", () => {
    const descriptors = [
        { key: "7::a", item_id: "a", label: "A" },
        { key: "7::a1", item_id: "a1", label: "A1" },
    ];
    const node = {
        outputs: [],
        addOutput(name, type) {
            const output = { name, type, links: null };
            this.outputs.push(output);
            return output;
        },
    };

    reconcileGetOutputSlots(node, [], descriptors);
    assert.equal(getOutputSlotsMatchDescriptors(node, descriptors), true);

    node.outputs.push({ name: "Boolean 3", type: "BOOLEAN", links: null });
    assert.equal(getOutputSlotsMatchDescriptors(node, descriptors), false);
});
