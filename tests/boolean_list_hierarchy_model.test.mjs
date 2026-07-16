import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_BOOLEAN_OUTPUTS,
    addChildItem,
    addRootItem,
    applyParentCascade,
    deleteItem,
    indentItem,
    moveItem,
    normalizeItems,
    outdentItem,
    reconcileOutputSlots,
} from "../web/boolean_list_hierarchy_model.mjs";

function idFactory() {
    let index = 0;
    return () => `generated-${++index}`;
}

function item(id, label, value = false, parentId = null) {
    return { id, label, value, parent_id: parentId };
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

test("applies only parent-to-child false cascade", () => {
    const items = applyParentCascade([
        item("a", "A", true),
        item("a-child", "A child", true, "a"),
        item("b", "B", false),
        item("b-child", "B child", true, "b"),
    ]);
    assert.equal(items[0].value, true);
    assert.equal(items[1].value, true);
    assert.equal(items[2].value, false);
    assert.equal(items[3].value, false);
    items[2].value = true;
    const reenabled = applyParentCascade(items);
    assert.equal(reenabled[3].value, false);
});

test("enforces maximum capacity and keeps at least one item", () => {
    const oversized = Array.from({ length: MAX_BOOLEAN_OUTPUTS + 5 }, (_, index) => item(`id-${index}`, `Item ${index}`));
    const normalized = normalizeItems(oversized);
    assert.equal(normalized.length, MAX_BOOLEAN_OUTPUTS);
    assert.equal(addRootItem(normalized).length, MAX_BOOLEAN_OUTPUTS);
    assert.deepEqual(deleteItem([item("only", "Only")], "only").map((entry) => entry.id), ["only"]);
});

test("supports group moves, sibling moves, indent, outdent, and cascade delete", () => {
    const initial = [
        item("a", "A", true),
        item("a1", "A1", false, "a"),
        item("a2", "A2", false, "a"),
        item("b", "B", false),
    ];
    assert.deepEqual(moveItem(initial, "a2", "up").map((entry) => entry.id), ["a", "a2", "a1", "b"]);
    assert.deepEqual(moveItem(initial, "b", "up").map((entry) => entry.id), ["b", "a", "a1", "a2"]);

    const indented = indentItem(initial, "b");
    assert.equal(indented.find((entry) => entry.id === "b").parent_id, "a");
    assert.equal(indentItem([item("p", "P"), ...initial], "a").find((entry) => entry.id === "a").parent_id, null);

    const outdented = outdentItem(initial, "a1");
    assert.deepEqual(outdented.map((entry) => entry.id), ["a", "a2", "a1", "b"]);
    assert.equal(outdented.find((entry) => entry.id === "a1").parent_id, null);

    assert.deepEqual(deleteItem(initial, "a").map((entry) => entry.id), ["b"]);
    assert.deepEqual(deleteItem([item("a", "A"), item("a1", "A1", false, "a")], "a").map((entry) => entry.id), ["a", "a1"]);
});

test("adds children at the end of their parent group", () => {
    const items = [item("a", "A"), item("a1", "A1", false, "a"), item("b", "B")];
    const next = addChildItem(items, "a", () => "a2");
    assert.deepEqual(next.map((entry) => entry.id), ["a", "a1", "a2", "b"]);
    assert.equal(next[2].parent_id, "a");
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
