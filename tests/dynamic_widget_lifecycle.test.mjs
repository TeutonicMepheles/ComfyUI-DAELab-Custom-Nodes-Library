import assert from "node:assert/strict";
import test from "node:test";

import {
    findLiveOwnedWidget,
    removeOwnedWidgets,
} from "../web/dynamic_widget_lifecycle.mjs";

test("removes rebuilt widgets through the node lifecycle", () => {
    const retained = { name: "images" };
    const removed = [
        { name: "color_1", owned: true },
        { name: "threshold_1", owned: true },
    ];
    const lifecycleCalls = [];
    const node = {
        widgets: [retained, ...removed],
        removeWidget(widget) {
            lifecycleCalls.push(widget.name);
            this.widgets.splice(this.widgets.indexOf(widget), 1);
            this._widgetSlotsDirty = true;
        },
    };

    assert.equal(removeOwnedWidgets(node, "owned"), 2);
    assert.deepEqual(node.widgets, [retained]);
    assert.deepEqual(lifecycleCalls, ["threshold_1", "color_1"]);
    assert.equal(node._widgetSlotsDirty, true);
});

test("falls back safely when the ComfyUI removal API rejects a stale widget", () => {
    let cleaned = 0;
    const stale = { name: "color_2", owned: true, onRemove: () => cleaned += 1 };
    const node = {
        widgets: [stale],
        removeWidget() {
            throw new Error("stale widget");
        },
    };

    assert.equal(removeOwnedWidgets(node, "owned"), 1);
    assert.deepEqual(node.widgets, []);
    assert.equal(cleaned, 1);
    assert.equal(node._widgetSlotsDirty, true);
});

test("color events resolve the current widget after remove and add", () => {
    const removedWidget = { name: "color_3", owned: true, value: "#000000" };
    const liveWidget = { name: "color_3", owned: true, value: "#ffffff" };
    const node = { widgets: [liveWidget] };

    assert.equal(findLiveOwnedWidget(node, "color_3", "owned", removedWidget), liveWidget);
    assert.equal(findLiveOwnedWidget(node, "missing", "owned", removedWidget), removedWidget);
});
