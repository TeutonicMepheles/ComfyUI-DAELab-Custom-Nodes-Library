import assert from "node:assert/strict";
import test from "node:test";

import {
    COMBINED_OUTPUT,
    MASK_V1_GROUP_HEIGHT,
    MAX_MASK_V1_GROUPS,
    MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME,
    addMaskGroupAfter,
    collapseMultiColorMaskV1Inputs,
    encodeMaskV1Config,
    formatMaskOutputChoice,
    getMaskOutputGroupId,
    getMultiColorMaskV1PanelHeight,
    normalizeMaskV1Config,
    removeSelectedMaskGroup,
    resolveSelectedMaskGroupId,
    setMaskOutput,
    updateMaskGroup,
} from "../web/multi_color_mask_v1_model.mjs";

test("migrates only enabled legacy groups and remaps a selected output", () => {
    const config = normalizeMaskV1Config({
        groups: [
            { enabled: false, color: "#111111", threshold: 1, invert: false },
            { enabled: true, color: "#Fa0", threshold: 40, invert: "true" },
            { color: "#ffffff", threshold: 999, invert: false },
        ],
        output: "mask_2",
    });
    assert.deepEqual(config, {
        version: 1,
        groups: [
            { id: "mask_legacy_2", color: "#ffaa00", threshold: 40, invert: true },
            { id: "mask_legacy_3", color: "#ffffff", threshold: 255, invert: false },
        ],
        output: "mask_1",
    });
    assert.deepEqual(JSON.parse(encodeMaskV1Config(config)), config);
    assert.equal(getMaskOutputGroupId(config), "mask_legacy_2");
});

test("falls back to combined output when its disabled legacy group is removed", () => {
    const config = normalizeMaskV1Config({
        groups: [
            { enabled: false, color: "#111111" },
            { enabled: true, color: "#222222" },
        ],
        output: "mask_1",
    });
    assert.equal(config.output, COMBINED_OUTPUT);
    assert.equal(config.groups.length, 1);
});

test("adds after the selected group and preserves the output target by id", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, invert: false },
            { id: "b", color: "#222222", threshold: 2, invert: false },
        ],
        output: "mask_2",
    };
    const result = addMaskGroupAfter(source, "a", () => "inserted");
    assert.deepEqual(result.config.groups.map(({ id }) => id), ["a", "inserted", "b"]);
    assert.equal(result.config.output, "mask_3");
    assert.equal(result.selectedId, "inserted");
});

test("deletes the selected group and remaps or clears the output target", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111" },
            { id: "b", color: "#222222" },
            { id: "c", color: "#333333" },
        ],
        output: "mask_3",
    };
    const middle = removeSelectedMaskGroup(source, "b");
    assert.deepEqual(middle.config.groups.map(({ id }) => id), ["a", "c"]);
    assert.equal(middle.config.output, "mask_2");
    assert.equal(middle.selectedId, "c");

    const selectedOutput = removeSelectedMaskGroup(source, "c");
    assert.equal(selectedOutput.config.output, COMBINED_OUTPUT);
    assert.equal(selectedOutput.selectedId, "b");
});

test("updates a stable group and validates output selection", () => {
    const source = { groups: [{ id: "a", color: "#111111", threshold: 1, invert: false }] };
    const updated = updateMaskGroup(source, "a", {
        color: "#abcdef",
        threshold: 999,
        invert: "true",
    });
    assert.deepEqual(updated.groups[0], {
        id: "a",
        color: "#abcdef",
        threshold: 255,
        invert: true,
    });
    assert.equal(setMaskOutput(updated, "mask_1").output, "mask_1");
    assert.equal(setMaskOutput(updated, "mask_2").output, COMBINED_OUTPUT);
    assert.equal(formatMaskOutputChoice("mask_1"), "仅颜色 1");
    assert.equal(resolveSelectedMaskGroupId(updated, "missing"), "a");
});

test("derives compact panel height only from group count", () => {
    const sixGroupHeight = getMultiColorMaskV1PanelHeight(6);
    assert.equal(getMultiColorMaskV1PanelHeight(7) - sixGroupHeight, MASK_V1_GROUP_HEIGHT);
    assert.equal(
        getMultiColorMaskV1PanelHeight(999),
        getMultiColorMaskV1PanelHeight(MAX_MASK_V1_GROUPS),
    );
});

test("collapses legacy mask inputs into one canonical V1 panel input", () => {
    const config = { label: "颜色蒙版" };
    const source = [
        [4, "output_mask", config],
        [4, "enabled_1"],
        [9, "value"],
        [4, "invert_1"],
    ];
    const result = collapseMultiColorMaskV1Inputs(source, 4);
    assert.equal(result.changed, true);
    assert.deepEqual(result.inputs, [
        [4, MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME, config],
        [9, "value"],
    ]);

    const canonical = [[4, MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME], [9, "value"]];
    const canonicalResult = collapseMultiColorMaskV1Inputs(canonical, 4);
    assert.equal(canonicalResult.changed, false);
    assert.equal(canonicalResult.inputs, canonical);
});
