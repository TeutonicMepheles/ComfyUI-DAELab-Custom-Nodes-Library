import assert from "node:assert/strict";
import test from "node:test";

import {
    BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME,
    HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME,
    HEIGHT_LAYER_OPTIONS,
    MAX_HEIGHT_GROUPS,
    V1_GROUP_HEIGHT,
    addHeightGroupAfter,
    collapseBadgeHeightLayerV1Inputs,
    encodeHeightConfig,
    formatHeightLayerOption,
    getBadgeHeightLayerV1PanelHeight,
    heightLayerConfigDigest,
    normalizeHeightConfig,
    normalizeHeightLayer,
    removeSelectedHeightGroup,
    resolveSelectedHeightGroupId,
    syncHeightLayerPromptConfigWidget,
    updateHeightGroup,
    validateHeightLayerConfigSnapshot,
} from "../web/badge_height_layer_v1_model.mjs";

test("defines semantic height labels with exact normalized and grayscale values", () => {
    assert.deepEqual(
        HEIGHT_LAYER_OPTIONS.map(({ value, label, height, gray }) => [value, label, height, gray]),
        [
            [0, "镂空（无实体）", 0.0, 0],
            [1, "最低层", 0.2, 51],
            [2, "次低层", 0.4, 102],
            [3, "中间层", 0.6, 153],
            [4, "次高层", 0.8, 204],
            [5, "最高层", 1.0, 255],
        ],
    );
    assert.equal(formatHeightLayerOption(5), "最高层 · H=1.0 · 255/255");
    assert.equal(normalizeHeightLayer("Layer 3 (0.6)"), 3);
    assert.equal(normalizeHeightLayer("最低层 · H=0.2 · 51/255"), 1);
    assert.equal(normalizeHeightLayer("镂空（无实体） · H=0.0 · 0/255"), 0);
});

test("migrates enabled legacy groups into stable V1 groups", () => {
    const config = normalizeHeightConfig({
        version: 1,
        groups: [
            { enabled: true, color: "#Fa0", threshold: 40, layer: "Layer 4 (0.8)" },
            { enabled: false, color: "#000000", threshold: 0, layer: 0 },
            { color: "#ffffff", threshold: 300, layer: 5 },
        ],
    });

    assert.deepEqual(config, {
        version: 1,
        groups: [
            { id: "height_legacy_1", color: "#ffaa00", threshold: 40, layer: 4 },
            { id: "height_legacy_3", color: "#ffffff", threshold: 255, layer: 5 },
        ],
    });
    assert.deepEqual(JSON.parse(encodeHeightConfig(config)), config);
});

test("adds directly after the selected layer and selects the new layer", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, layer: 1 },
            { id: "b", color: "#222222", threshold: 2, layer: 2 },
        ],
    };
    const result = addHeightGroupAfter(source, "a", () => "inserted");
    assert.deepEqual(result.config.groups.map(({ id }) => id), ["a", "inserted", "b"]);
    assert.equal(result.selectedId, "inserted");
    assert.equal(result.addedId, "inserted");
});

test("deletes the selected layer and chooses its nearest remaining neighbor", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, layer: 1 },
            { id: "b", color: "#222222", threshold: 2, layer: 2 },
            { id: "c", color: "#333333", threshold: 3, layer: 3 },
        ],
    };
    const middle = removeSelectedHeightGroup(source, "b");
    assert.deepEqual(middle.config.groups.map(({ id }) => id), ["a", "c"]);
    assert.equal(middle.selectedId, "c");

    const last = removeSelectedHeightGroup(source, "c");
    assert.deepEqual(last.config.groups.map(({ id }) => id), ["a", "b"]);
    assert.equal(last.selectedId, "b");

    const only = removeSelectedHeightGroup({ groups: [source.groups[0]] }, "a");
    assert.equal(only.removedId, null);
    assert.equal(only.config.groups.length, 1);
});

test("updates a stable selected group without reordering other groups", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, layer: 1 },
            { id: "b", color: "#222222", threshold: 2, layer: 2 },
        ],
    };
    const updated = updateHeightGroup(source, "b", {
        color: "#abcdef",
        threshold: 999,
        layer: "最高层 · H=1.0 · 255/255",
    });
    assert.deepEqual(updated.groups, [
        { id: "a", color: "#111111", threshold: 1, layer: 1 },
        { id: "b", color: "#abcdef", threshold: 255, layer: 5 },
    ]);
    assert.equal(resolveSelectedHeightGroupId(updated, "missing"), "a");
});

test("derives compact panel height only from group count", () => {
    const sixGroupHeight = getBadgeHeightLayerV1PanelHeight(6);
    assert.equal(getBadgeHeightLayerV1PanelHeight(6), sixGroupHeight);
    assert.equal(getBadgeHeightLayerV1PanelHeight(7) - sixGroupHeight, V1_GROUP_HEIGHT);
    assert.equal(getBadgeHeightLayerV1PanelHeight(999), getBadgeHeightLayerV1PanelHeight(MAX_HEIGHT_GROUPS));
});

test("synchronizes the canonical config into the prompt widget and cache digest", () => {
    const changes = [];
    const node = {
        onWidgetChanged: (...args) => changes.push(args),
    };
    const widget = { name: HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME, value: "stale" };
    const config = {
        groups: [{ id: "picked", color: "#349384", threshold: 35, layer: 4 }],
    };
    const encoded = syncHeightLayerPromptConfigWidget(node, widget, config);
    assert.equal(widget.value, encoded);
    assert.equal(changes.length, 1);
    assert.equal(changes[0][0], HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME);
    assert.equal(changes[0][1], encoded);
    assert.match(heightLayerConfigDigest(config), /^[0-9a-f]{64}$/);

    assert.deepEqual(validateHeightLayerConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: encoded,
        queueValue: encoded,
    }), {
        ok: true,
        encoded,
        digest: heightLayerConfigDigest(config),
        mismatches: [],
        invalidHex: [],
    });
});

test("blocks invalid hex and reports stale queue sources", () => {
    const config = { groups: [{ id: "a", color: "#112233", threshold: 1, layer: 1 }] };
    const encoded = encodeHeightConfig(config);
    assert.deepEqual(validateHeightLayerConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: "stale-widget",
        queueValue: "stale-queue",
    }).mismatches, ["widget", "queue"]);
    assert.deepEqual(validateHeightLayerConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: encoded,
        queueValue: encoded,
        invalidHex: ["#12"],
    }).mismatches, ["invalid_hex"]);
});

test("collapses legacy per-field app inputs into one canonical V1 panel input", () => {
    const config = { label: "徽章高度层" };
    const source = [
        [3, "enabled_1", config],
        [3, "color_1"],
        [3, HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME],
        [9, "value"],
        [3, "layer_1"],
    ];
    const result = collapseBadgeHeightLayerV1Inputs(source, 3);
    assert.equal(result.changed, true);
    assert.deepEqual(result.inputs, [
        [3, BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME, config],
        [9, "value"],
    ]);

    const canonical = [[3, BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME], [9, "value"]];
    const canonicalResult = collapseBadgeHeightLayerV1Inputs(canonical, 3);
    assert.equal(canonicalResult.changed, false);
    assert.equal(canonicalResult.inputs, canonical);
});
