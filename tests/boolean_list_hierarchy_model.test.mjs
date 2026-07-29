import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_BOOLEAN_OUTPUTS,
    MAX_HIERARCHY_DEPTH,
    addChildItem,
    addRootItem,
    applyHierarchyConstraints,
    applyParentCascade,
    canIndentItem,
    createExclusiveGroup,
    deleteExclusiveGroup,
    deleteItem,
    encodeItems,
    getExclusiveGroups,
    getItemDepth,
    getSubtreeIds,
    indentItem,
    moveItem,
    normalizeItems,
    outdentItem,
    reconcileOutputSlots,
    updateExclusiveGroup,
} from "../web/boolean_list_hierarchy_model.mjs";

function idFactory() {
    let index = 0;
    return () => `generated-${++index}`;
}

function item(id, label, value = false, parentId = null, exclusiveGroupId = null) {
    return {
        id,
        label,
        value,
        parent_id: parentId,
        exclusive_group_id: exclusiveGroupId,
    };
}

test("migrates legacy level data and repairs orphan children", () => {
    const items = normalizeItems([
        { label: "Root A", value: true, level: 0 },
        { label: "Child A", value: true, level: 1 },
        { label: "Root B", value: false, level: 0 },
    ], { idFactory: idFactory() });

    assert.equal(items.length, 3);
    assert.equal(items[1].parent_id, items[0].id);
    assert.equal(items[2].parent_id, null);

    const orphan = normalizeItems([
        { label: "Orphan", value: true, level: 1 },
    ], { idFactory: idFactory() });
    assert.equal(orphan[0].parent_id, null);
});

test("applies recursive ancestor-to-descendant false cascade", () => {
    const items = applyParentCascade([
        item("a", "A", true),
        item("a-child", "A child", true, "a"),
        item("a-grandchild", "A grandchild", true, "a-child"),
        item("b", "B", false),
        item("b-child", "B child", true, "b"),
        item("b-grandchild", "B grandchild", true, "b-child"),
    ]);
    assert.deepEqual(
        items.map((entry) => entry.value),
        [true, true, true, false, false, false]
    );
    items[3].value = true;
    const reenabled = applyParentCascade(items);
    assert.equal(reenabled[4].value, false);
    assert.equal(reenabled[5].value, false);
});

test("normalizes two child levels and promotes a fourth level to root", () => {
    const normalized = normalizeItems([
        item("root", "Root", true),
        item("child", "Child", true, "root"),
        item("grandchild", "Grandchild", true, "child"),
        item("too-deep", "Too deep", true, "grandchild"),
    ]);
    assert.deepEqual(
        normalized.map((entry) => [entry.id, entry.parent_id]),
        [
            ["root", null],
            ["child", "root"],
            ["grandchild", "child"],
            ["too-deep", null],
        ]
    );
    assert.equal(MAX_HIERARCHY_DEPTH, 2);
    assert.equal(getItemDepth(normalized, "grandchild"), 2);
});

test("enforces sibling exclusive groups while allowing every member to be false", () => {
    const normalized = normalizeItems([
        item("a", "A", true, null, "roots"),
        item("b", "B", true, null, "roots"),
        item("c", "C", false, null, "roots"),
    ]);
    assert.deepEqual(normalized.map((entry) => entry.value), [true, false, false]);

    const activated = applyHierarchyConstraints(
        normalized.map((entry) => ({ ...entry, value: entry.id !== "a" })),
        "c"
    );
    assert.deepEqual(activated.map((entry) => entry.value), [false, false, true]);

    const allFalse = applyHierarchyConstraints(
        normalized.map((entry) => ({ ...entry, value: false }))
    );
    assert.deepEqual(allFalse.map((entry) => entry.value), [false, false, false]);
});

test("repairs invalid exclusive groups and applies parent cascade after exclusivity", () => {
    const invalid = normalizeItems([
        item("root-a", "Root A", true),
        item("a1", "A1", true, "root-a", "cross-parent"),
        item("root-b", "Root B", true),
        item("b1", "B1", true, "root-b", "cross-parent"),
        item("single", "Single", true, null, "single-member"),
    ]);
    assert.ok(invalid.every((entry) => !entry.exclusive_group_id));

    const constrained = normalizeItems([
        item("root-a", "Root A", true, null, "root-group"),
        item("a1", "A1", true, "root-a"),
        item("root-b", "Root B", true, null, "root-group"),
        item("b1", "B1", true, "root-b"),
    ]);
    assert.deepEqual(constrained.map((entry) => entry.value), [true, true, false, false]);
});

test("supports exclusive groups between grandchildren of the same parent", () => {
    const normalized = normalizeItems([
        item("root", "Root", true),
        item("child", "Child", true, "root"),
        item("g1", "G1", true, "child", "grandchildren"),
        item("g2", "G2", true, "child", "grandchildren"),
        item("g3", "G3", false, "child", "grandchildren"),
    ]);
    assert.deepEqual(
        normalized.slice(2).map((entry) => entry.value),
        [true, false, false]
    );
    assert.equal(getExclusiveGroups(normalized)[0].parent_id, "child");
});

test("creates, edits, and deletes exclusive groups within one sibling scope", () => {
    const initial = [
        item("a", "A", true),
        item("b", "B", true),
        item("c", "C", false),
    ];
    const created = createExclusiveGroup(initial, ["a", "b"], () => "group-1");
    assert.equal(getExclusiveGroups(created).length, 1);
    assert.deepEqual(created.map((entry) => entry.value), [true, false, false]);

    const updated = updateExclusiveGroup(created, "group-1", ["b", "c"]);
    assert.deepEqual(
        updated.filter((entry) => entry.exclusive_group_id === "group-1").map((entry) => entry.id),
        ["b", "c"]
    );
    assert.equal(updated.find((entry) => entry.id === "a").exclusive_group_id, null);

    const deleted = deleteExclusiveGroup(updated, "group-1");
    assert.ok(deleted.every((entry) => !entry.exclusive_group_id));
    assert.deepEqual(deleted.map((entry) => entry.value), updated.map((entry) => entry.value));
});

test("serializes exclusive membership without adding fields to legacy ungrouped items", () => {
    const ungrouped = JSON.parse(encodeItems([item("a", "A")]));
    assert.equal("exclusive_group_id" in ungrouped[0], false);

    const grouped = JSON.parse(encodeItems([
        item("a", "A", true, null, "roots"),
        item("b", "B", false, null, "roots"),
    ]));
    assert.deepEqual(grouped.map((entry) => entry.exclusive_group_id), ["roots", "roots"]);
});

test("cleans exclusive membership after delete, indent, and outdent", () => {
    const groupedRoots = [
        item("a", "A", true, null, "roots"),
        item("b", "B", false, null, "roots"),
        item("c", "C", false, null, "roots"),
    ];
    const deleted = deleteItem(groupedRoots, "c");
    assert.deepEqual(
        deleted.filter((entry) => entry.exclusive_group_id === "roots").map((entry) => entry.id),
        ["a", "b"]
    );

    const indented = indentItem(groupedRoots, "c");
    assert.equal(indented.find((entry) => entry.id === "c").exclusive_group_id, null);
    assert.deepEqual(
        indented.filter((entry) => entry.exclusive_group_id === "roots").map((entry) => entry.id),
        ["a", "b"]
    );

    const groupedChildren = [
        item("p", "Parent", true),
        item("p1", "P1", true, "p", "children"),
        item("p2", "P2", false, "p", "children"),
        item("q", "Q", false),
    ];
    const outdented = outdentItem(groupedChildren, "p1");
    assert.ok(outdented.every((entry) => !entry.exclusive_group_id));
});

test("enforces maximum capacity and keeps at least one item", () => {
    const oversized = Array.from({ length: MAX_BOOLEAN_OUTPUTS + 5 }, (_, index) => item(`id-${index}`, `Item ${index}`));
    const normalized = normalizeItems(oversized);
    assert.equal(normalized.length, MAX_BOOLEAN_OUTPUTS);
    assert.equal(addRootItem(normalized).length, MAX_BOOLEAN_OUTPUTS);
    assert.deepEqual(deleteItem([item("only", "Only")], "only").map((entry) => entry.id), ["only"]);
});

test("moves complete subtrees and edits hierarchy within the depth limit", () => {
    const initial = [
        item("a", "A", true),
        item("a1", "A1", true, "a"),
        item("a1x", "A1X", false, "a1"),
        item("a2", "A2", false, "a"),
        item("b", "B", false),
    ];
    assert.deepEqual(
        moveItem(initial, "a2", "up").map((entry) => entry.id),
        ["a", "a2", "a1", "a1x", "b"]
    );
    assert.deepEqual(
        moveItem(initial, "b", "up").map((entry) => entry.id),
        ["b", "a", "a1", "a1x", "a2"]
    );

    const indented = indentItem(initial, "b");
    assert.equal(indented.find((entry) => entry.id === "b").parent_id, "a");
    assert.equal(canIndentItem(initial, "a2"), true);
    const nestedSibling = indentItem(initial, "a2");
    assert.equal(nestedSibling.find((entry) => entry.id === "a2").parent_id, "a1");
    assert.equal(canIndentItem([item("p", "P"), ...initial], "a"), false);
    assert.equal(
        indentItem([item("p", "P"), ...initial], "a")
            .find((entry) => entry.id === "a").parent_id,
        null
    );

    const outdented = outdentItem(initial, "a1x");
    assert.deepEqual(outdented.map((entry) => entry.id), ["a", "a1", "a1x", "a2", "b"]);
    assert.equal(outdented.find((entry) => entry.id === "a1x").parent_id, "a");

    assert.deepEqual(deleteItem(initial, "a").map((entry) => entry.id), ["b"]);
    assert.deepEqual(deleteItem(initial, "a1").map((entry) => entry.id), ["a", "a2", "b"]);
    assert.deepEqual([...getSubtreeIds(initial, "a1")], ["a1", "a1x"]);
    assert.deepEqual(
        deleteItem([item("a", "A"), item("a1", "A1", false, "a")], "a")
            .map((entry) => entry.id),
        ["a", "a1"]
    );
});

test("adds children at both supported levels but not below a grandchild", () => {
    const items = [
        item("a", "A", true),
        item("a1", "A1", true, "a"),
        item("a1x", "A1X", false, "a1"),
        item("b", "B"),
    ];
    const next = addChildItem(items, "a1", () => "a1y");
    assert.deepEqual(next.map((entry) => entry.id), ["a", "a1", "a1x", "a1y", "b"]);
    assert.equal(next[3].parent_id, "a1");
    assert.deepEqual(
        addChildItem(next, "a1x", () => "too-deep"),
        next
    );
});

function createMockNode(items) {
    const links = new Map();
    const disconnected = [];
    const outputs = items.map((entry, index) => {
        const linkId = 100 + index;
        links.set(linkId, { id: linkId, origin_slot: index });
        return {
            name: entry.label,
            type: "BOOLEAN",
            links: [linkId],
            boolean_item_id: entry.id,
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
            for (let outputIndex = index; outputIndex < this.outputs.length; outputIndex += 1) {
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

test("keeps links attached to stable item ids across reorder and delete", () => {
    const previous = [item("a", "A"), item("a1", "A1", false, "a"), item("b", "B")];
    const node = createMockNode(previous);
    const reordered = moveItem(previous, "b", "up");
    reconcileOutputSlots(node, previous, reordered);

    assert.deepEqual(node.outputs.map((output) => output.boolean_item_id), ["b", "a", "a1"]);
    assert.equal(node.graph._links.get(102).origin_slot, 0);
    assert.equal(node.graph._links.get(100).origin_slot, 1);
    assert.equal(node.graph._links.get(101).origin_slot, 2);
    assert.deepEqual(node.disconnected, []);

    const remaining = deleteItem(reordered, "a");
    reconcileOutputSlots(node, reordered, remaining);
    assert.deepEqual(node.outputs.map((output) => output.boolean_item_id), ["b"]);
    assert.equal(node.graph._links.get(102).origin_slot, 0);
    assert.deepEqual(node.disconnected.sort(), [100, 101]);
});

test("binds legacy untagged outputs by index before trimming schema outputs", () => {
    const items = [item("a", "A"), item("b", "B")];
    const node = createMockNode(items);
    node.outputs.forEach((output) => { delete output.boolean_item_id; });
    node.outputs.push({ name: "unused", type: "BOOLEAN", links: null });
    reconcileOutputSlots(node, items, items);
    assert.deepEqual(node.outputs.map((output) => output.boolean_item_id), ["a", "b"]);
    assert.deepEqual(node.disconnected, []);
});

test("updates legacy graph link objects when outputs move", () => {
    const previous = [item("a", "A"), item("b", "B")];
    const node = createMockNode(previous);
    node.graph.links = Object.fromEntries(node.graph._links);
    delete node.graph._links;
    const reordered = moveItem(previous, "b", "up");
    reconcileOutputSlots(node, previous, reordered);
    assert.equal(node.graph.links[101].origin_slot, 0);
    assert.equal(node.graph.links[100].origin_slot, 1);
});
