import assert from "node:assert/strict";
import test from "node:test";

import { addColorPickerWidget } from "../web/color_picker_widget.mjs";

test("an open picker commits to the replacement widget after a group rebuild", () => {
    const listeners = new Map();
    const picker = {
        style: {},
        value: "#000000",
        addEventListener(type, callback) {
            listeners.set(type, callback);
        },
        click() {},
        remove() {},
    };
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement() {
            return picker;
        },
        body: {
            appendChild() {},
        },
    };

    try {
        const changes = [];
        const notifications = [];
        const node = {
            size: [340, 300],
            widgets: [],
            graph: { _version: 3 },
            redraws: 0,
            setDirtyCanvas() {
                this.redraws += 1;
            },
            addCustomWidget(widget) {
                this.widgets.push(widget);
                return widget;
            },
            onWidgetChanged(...args) {
                notifications.push(args);
            },
        };
        const removedWidget = addColorPickerWidget(
            node,
            "color_2",
            "#000000",
            (value) => changes.push(value),
            "owned"
        );

        assert.equal(removedWidget.mouse({ type: "pointerdown" }, [20, 0], node), true);
        const replacementWidget = {
            name: "color_2",
            value: "#ffffff",
            owned: true,
        };
        node.widgets = [replacementWidget];
        picker.value = "#123456";
        listeners.get("input")?.({ type: "input" });

        assert.equal(removedWidget.value, "#000000");
        assert.equal(replacementWidget.value, "#123456");
        assert.deepEqual(changes, ["#123456"]);
        assert.deepEqual(notifications.map(([name, value, previous]) => [name, value, previous]), [
            ["color_2", "#123456", "#ffffff"],
        ]);
        assert.equal(node.graph._version, 4);
        assert.equal(node.redraws, 1);
    } finally {
        globalThis.document = previousDocument;
    }
});
