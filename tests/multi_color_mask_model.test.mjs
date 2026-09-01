import assert from "node:assert/strict";
import test from "node:test";

import {
    addGroup,
    COMBINED_OUTPUT,
    commitColorWidgetValue,
    encodeConfig,
    MAX_MASK_GROUPS,
    normalizeConfig,
    outputChoices,
    removeLastGroup,
    updateGroup,
} from "../web/multi_color_mask_model.mjs";

test("defaults to one group and combined output", () => {
    const config = normalizeConfig(null);

    assert.equal(config.groups.length, 1);
    assert.equal(config.output, COMBINED_OUTPUT);
    assert.deepEqual(outputChoices(config.groups.length), ["combined_mask", "mask_1"]);
});

test("adds and removes groups while keeping at least one", () => {
    let config = addGroup(null);
    assert.equal(config.groups.length, 2);
    assert.equal(config.groups[1].color, "#00ff00");

    config.output = "mask_2";
    config = removeLastGroup(config);
    assert.equal(config.groups.length, 1);
    assert.equal(config.output, COMBINED_OUTPUT);
    assert.equal(removeLastGroup(config).groups.length, 1);
});

test("caps dynamic groups at the supported backend limit", () => {
    let config = normalizeConfig(null);
    for (let index = 0; index < MAX_MASK_GROUPS + 4; index += 1) config = addGroup(config);

    assert.equal(config.groups.length, MAX_MASK_GROUPS);
    assert.equal(outputChoices(config.groups.length).at(-1), `mask_${MAX_MASK_GROUPS}`);
});

test("normalizes group edits and serializes stable JSON", () => {
    const config = updateGroup(null, 0, {
        enabled: "false",
        color: "#Fa0",
        threshold: 500,
        invert: "true",
    });

    assert.deepEqual(config.groups[0], {
        enabled: false,
        color: "#ffaa00",
        threshold: 255,
        invert: true,
    });
    assert.deepEqual(JSON.parse(encodeConfig(config)), config);
});

test("commits color widget changes through the standard callback and redraw path", () => {
    const notifications = [];
    const changes = [];
    let redraws = 0;
    let nodeRedraws = 0;
    let graphRedraws = 0;
    const widget = {
        name: "color_1",
        value: "#0000ff",
        triggerDraw: () => { redraws += 1; },
    };
    const node = {
        graph: {
            _version: 7,
            setDirtyCanvas: () => { graphRedraws += 1; },
        },
        setDirtyCanvas: () => { nodeRedraws += 1; },
        onWidgetChanged: (...args) => notifications.push(args),
    };

    const result = commitColorWidgetValue(
        widget,
        node,
        "#Fa0",
        (value) => changes.push(value)
    );

    assert.equal(result, "#ffaa00");
    assert.equal(widget.value, "#ffaa00");
    assert.deepEqual(changes, ["#ffaa00"]);
    assert.deepEqual(notifications, [["color_1", "#ffaa00", "#0000ff", widget]]);
    assert.equal(redraws, 1);
    assert.equal(nodeRedraws, 1);
    assert.equal(graphRedraws, 1);
    assert.equal(node.graph._version, 8);
});

test("still forwards a native panel callback after the panel pre-sets widget.value", () => {
    const changes = [];
    const widget = { name: "color_1", value: "#123456" };

    commitColorWidgetValue(widget, null, "#123456", (value) => changes.push(value));

    assert.deepEqual(changes, ["#123456"]);
});

test("rejects output selections that do not have a matching group", () => {
    const config = normalizeConfig({
        groups: [{ color: "#123456" }],
        output: "mask_2",
    });

    assert.equal(config.output, COMBINED_OUTPUT);
});
