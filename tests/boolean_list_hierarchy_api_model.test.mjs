import assert from "node:assert/strict";
import test from "node:test";

import {
    createBooleanHierarchyApiController,
} from "../web/boolean_list_hierarchy_api_model.mjs";
import {
    applyConfirmationPolicy,
    encodeItems,
    normalizeItems,
} from "../web/boolean_list_hierarchy_model.mjs";

function item(id, value, parentId = null, groupId = null) {
    return {
        id,
        label: id,
        value,
        parent_id: parentId,
        exclusive_group_id: groupId,
        requires_ids: [],
    };
}

function makeHarness() {
    let state = normalizeItems([
        item("route-1", true, null, "route"),
        item("special", true, "route-1"),
        item("route-2", false, null, "route"),
        item("local", true),
        item("semantic", true, "local", "edit"),
        item("material", false, "local", "edit"),
        item("apply", false, "local"),
    ]);
    let revision = 0;
    let commits = 0;
    let controller;
    const policy = {
        apply_item_id: "apply",
        invalidating_item_ids: ["route-1", "route-2", "semantic", "material"],
    };
    controller = createBooleanHierarchyApiController({
        readItems: () => state,
        commitItems(nextItems, options) {
            const constrained = normalizeItems(nextItems, options);
            const confirmation = applyConfirmationPolicy(state, constrained, policy);
            if (encodeItems(state) === encodeItems(confirmation.items)) return false;
            state = confirmation.items;
            commits += 1;
            if (confirmation.increment_revision) revision += 1;
            controller.notify(state);
            return true;
        },
    });
    return {
        controller,
        get revision() { return revision; },
        get commits() { return commits; },
    };
}

test("hierarchy API returns isolated normalized clones", () => {
    const harness = makeHarness();
    const state = harness.controller.api.getState();
    state[0].value = false;
    state[0].requires_ids.push("mutated");
    assert.equal(harness.controller.api.getItemValue("route-1"), true);
    assert.deepEqual(harness.controller.api.getState()[0].requires_ids, []);
    assert.equal(harness.controller.api.getItemValue("missing"), undefined);
});

test("hierarchy API uses preferred IDs for exclusivity and parent cascades", () => {
    const harness = makeHarness();
    const notifications = [];
    harness.controller.api.subscribe((state) => notifications.push(state));

    assert.equal(harness.controller.api.setItemValue("route-2", true), true);
    assert.equal(harness.controller.api.getItemValue("route-1"), false);
    assert.equal(harness.controller.api.getItemValue("special"), false);
    assert.equal(harness.controller.api.getItemValue("route-2"), true);
    assert.equal(harness.commits, 1);
    assert.equal(notifications.length, 1);

    assert.equal(harness.controller.api.setItemValue("material", true), true);
    assert.equal(harness.controller.api.getItemValue("semantic"), false);
    assert.equal(harness.controller.api.getItemValue("material"), true);
    assert.equal(notifications.length, 2);
});

test("hierarchy API preserves Apply invalidation, revision, and single notification", () => {
    const harness = makeHarness();
    let notifications = 0;
    const unsubscribe = harness.controller.api.subscribe(() => { notifications += 1; });

    assert.equal(harness.controller.api.setItemValue("apply", true), true);
    assert.equal(harness.revision, 1);
    assert.equal(notifications, 1);
    assert.equal(harness.controller.api.setItemValue("material", true), true);
    assert.equal(harness.controller.api.getItemValue("apply"), false);
    assert.equal(harness.revision, 1);
    assert.equal(notifications, 2);

    unsubscribe();
    assert.equal(harness.controller.api.setItemValue("semantic", true), true);
    assert.equal(notifications, 2);
});

test("hierarchy API rejects unknown and no-op writes without partial commits", () => {
    const harness = makeHarness();
    let notifications = 0;
    harness.controller.api.subscribe(() => { notifications += 1; });
    const before = harness.controller.api.getState();

    assert.equal(harness.controller.api.setItemValue("unknown", true), false);
    assert.equal(harness.controller.api.setItemValue("route-1", true), false);
    assert.deepEqual(harness.controller.api.getState(), before);
    assert.equal(harness.commits, 0);
    assert.equal(notifications, 0);
});

test("disposing the hierarchy API clears subscriptions and rejects writes", () => {
    const harness = makeHarness();
    let notifications = 0;
    harness.controller.api.subscribe(() => { notifications += 1; });
    harness.controller.dispose();
    assert.equal(harness.controller.api.setItemValue("route-2", true), false);
    harness.controller.notify();
    assert.equal(notifications, 0);
});
