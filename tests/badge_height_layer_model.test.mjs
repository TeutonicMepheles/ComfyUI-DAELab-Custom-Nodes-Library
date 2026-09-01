import assert from "node:assert/strict";
import test from "node:test";

import {
    addGroup,
    encodeConfig,
    layerWidgetValue,
    LAYER_LABELS,
    MAX_COLOR_GROUPS,
    normalizeConfig,
    normalizeLayer,
    removeLastGroup,
    updateGroup,
} from "../web/badge_height_layer_model.mjs";

test("defaults to one color group", () => {
    const config = normalizeConfig(null);
    assert.equal(config.groups.length, 1);
    assert.equal(config.groups[0].layer, 1);
});

test("normalizes layer labels to fixed numeric levels", () => {
    assert.equal(normalizeLayer("Cut Out (0.0)"), 0);
    assert.equal(normalizeLayer("Layer 3 (0.6)"), 3);
    assert.equal(layerWidgetValue(5), "Layer 5 (1.0)");
    assert.equal(LAYER_LABELS.length, 6);
});

test("adds and removes color groups within limits", () => {
    let config = normalizeConfig(null);
    for (let index = 0; index < MAX_COLOR_GROUPS + 3; index += 1) config = addGroup(config);
    assert.equal(config.groups.length, MAX_COLOR_GROUPS);
    while (config.groups.length > 1) config = removeLastGroup(config);
    assert.equal(removeLastGroup(config).groups.length, 1);
});

test("normalizes edits and produces stable JSON", () => {
    const config = updateGroup(null, 0, {
        enabled: "false",
        color: "#Fa0",
        threshold: 500,
        layer: "Layer 4 (0.8)",
    });
    assert.deepEqual(config.groups[0], {
        enabled: false,
        color: "#ffaa00",
        threshold: 255,
        layer: 4,
    });
    assert.deepEqual(JSON.parse(encodeConfig(config)), config);
});
