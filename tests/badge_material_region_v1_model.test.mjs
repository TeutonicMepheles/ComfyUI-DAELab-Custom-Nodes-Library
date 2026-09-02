import assert from "node:assert/strict";
import test from "node:test";

import {
    BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME,
    DEFAULT_REGION_MATERIAL_ID,
    MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME,
    MATERIAL_REGION_GROUP_HEIGHT,
    MAX_MATERIAL_REGION_GROUPS,
    addMaterialRegionAfter,
    advanceMaterialRegionConfig,
    bindMaterialRegionPromptConfigQueueSync,
    collapseBadgeMaterialRegionV1Inputs,
    encodeMaterialRegionConfig,
    getBadgeMaterialRegionV1PanelHeight,
    materialRegionConfigDigest,
    normalizeMaterialRegionConfig,
    removeSelectedMaterialRegion,
    rerollSelectedMaterialRegion,
    resolveSelectedMaterialRegionId,
    syncMaterialRegionPromptConfigWidget,
    updateMaterialRegion,
    validateMaterialRegionConfigSnapshot,
} from "../web/badge_material_region_v1_model.mjs";

test("normalizes legacy region groups with transparent lacquer as the fixed default", () => {
    const config = normalizeMaterialRegionConfig({
        groups: [
            { enabled: true, color: "#Fa0", threshold: 40, material_id: "glitter" },
            { enabled: false, color: "#000000", threshold: 0, material_id: "rhinestone" },
            { color: "#ffffff", threshold: 300, material_id: "satin_gold" },
        ],
    });

    assert.deepEqual(config, {
        version: 2,
        revision: 0,
        default_material_id: DEFAULT_REGION_MATERIAL_ID,
        groups: [
            { id: "material_legacy_1", color: "#ffaa00", threshold: 40, material_id: "glitter", color_policy: "preserve", material_strength: 1, reroll_revision: 0 },
            { id: "material_legacy_3", color: "#ffffff", threshold: 255, material_id: "satin_gold", color_policy: "preserve", material_strength: 1, reroll_revision: 0 },
        ],
    });
    assert.deepEqual(JSON.parse(encodeMaterialRegionConfig(config)), config);
});

test("adds after the selected region and keeps stable ids", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, material_id: "glitter" },
            { id: "b", color: "#222222", threshold: 2, material_id: "rhinestone" },
        ],
    };
    const result = addMaterialRegionAfter(source, "a", () => "inserted");
    assert.deepEqual(result.config.groups.map(({ id }) => id), ["a", "inserted", "b"]);
    assert.equal(result.selectedId, "inserted");
    assert.equal(result.config.groups[1].material_id, DEFAULT_REGION_MATERIAL_ID);
});

test("removes the selected region and updates only the requested material mapping", () => {
    const source = {
        groups: [
            { id: "a", color: "#111111", threshold: 1, material_id: "glitter" },
            { id: "b", color: "#222222", threshold: 2, material_id: "rhinestone" },
            { id: "c", color: "#333333", threshold: 3, material_id: "satin_silver" },
        ],
    };
    const removed = removeSelectedMaterialRegion(source, "b");
    assert.deepEqual(removed.config.groups.map(({ id }) => id), ["a", "c"]);
    assert.equal(removed.selectedId, "c");

    const updated = updateMaterialRegion(source, "b", {
        color: "#abcdef",
        threshold: 999,
        material_id: "satin_gold",
        color_policy: "preserve",
        material_strength: 1,
        reroll_revision: 0,
    });
    assert.deepEqual(updated.groups[1], {
        id: "b",
        color: "#abcdef",
        threshold: 255,
        material_id: "satin_gold",
        color_policy: "preserve",
        material_strength: 1,
        reroll_revision: 0,
    });
    assert.equal(resolveSelectedMaterialRegionId(updated, "missing"), "a");
});

test("normalizes and updates per-region material strength without changing other regions", () => {
    const source = normalizeMaterialRegionConfig({
        groups: [
            { id: "a", material_id: "glitter", material_strength: 9 },
            { id: "b", material_id: "rhinestone", material_strength: 0.1 },
        ],
    });
    assert.deepEqual(source.groups.map(({ material_strength }) => material_strength), [1.5, 0.25]);
    const updated = updateMaterialRegion(source, "a", { material_strength: 1.15 });
    assert.deepEqual(updated.groups.map(({ material_strength }) => material_strength), [1.15, 0.25]);
});

test("increments the global revision and only the selected reroll revision", () => {
    const source = normalizeMaterialRegionConfig({
        revision: 7,
        groups: [
            { id: "a", color: "#111111", material_id: "glitter", reroll_revision: 2 },
            { id: "b", color: "#222222", material_id: "rhinestone", reroll_revision: 4 },
        ],
    });
    const edited = advanceMaterialRegionConfig(source, (config) => {
        config.groups[0].threshold = 12;
        return config;
    });
    assert.equal(edited.revision, 8);
    const rerolled = rerollSelectedMaterialRegion(edited, "b");
    assert.equal(rerolled.revision, 9);
    assert.deepEqual(rerolled.groups.map(({ reroll_revision }) => reroll_revision), [2, 5]);
});

test("computes standard SHA-256 and rejects any stale queue snapshot", () => {
    const config = normalizeMaterialRegionConfig({ groups: [{ id: "a", color: "#112233" }] });
    assert.equal(
        materialRegionConfigDigest(config),
        "0e69a631c6e6a4938a3636938c01c8d08b31a9b9dfc8168610e0fefe1d96cd79",
    );
    const encoded = encodeMaterialRegionConfig(config);
    assert.equal(validateMaterialRegionConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: encoded,
        queueValue: encoded,
    }).ok, true);
    assert.deepEqual(validateMaterialRegionConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: "stale",
        queueValue: encoded,
    }).mismatches, ["widget"]);
    assert.deepEqual(validateMaterialRegionConfigSnapshot({
        draft: config,
        propertyValue: encoded,
        widgetValue: encoded,
        queueValue: encoded,
        invalidHex: ["#12"],
    }).mismatches, ["invalid_hex"]);
});

test("derives fixed panel height only from material region count", () => {
    const fourGroupHeight = getBadgeMaterialRegionV1PanelHeight(4);
    assert.equal(
        getBadgeMaterialRegionV1PanelHeight(5) - fourGroupHeight,
        MATERIAL_REGION_GROUP_HEIGHT,
    );
    assert.equal(
        getBadgeMaterialRegionV1PanelHeight(999),
        getBadgeMaterialRegionV1PanelHeight(MAX_MATERIAL_REGION_GROUPS),
    );
});

test("syncs material config into the serialized prompt widget before queueing", () => {
    const notifications = [];
    let beforeQueuedCalls = 0;
    const node = {
        onWidgetChanged: (...args) => notifications.push(args),
    };
    const widget = {
        name: MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME,
        value: "",
        beforeQueued: () => { beforeQueuedCalls += 1; },
    };
    let current = {
        groups: [{ id: "a", color: "#112233", threshold: 4, material_id: "glitter" }],
    };

    const encoded = syncMaterialRegionPromptConfigWidget(node, widget, current);
    assert.equal(widget.value, encoded);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][0], MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME);

    const sync = bindMaterialRegionPromptConfigQueueSync(node, widget, () => current);
    current = {
        groups: [
            { id: "a", color: "#112233", threshold: 4, material_id: "glitter" },
            { id: "b", color: "#abcdef", threshold: 9, material_id: "satin_gold" },
        ],
    };
    widget.beforeQueued();
    assert.equal(beforeQueuedCalls, 1);
    assert.equal(JSON.parse(widget.value).groups.length, 2);
    assert.equal(widget.serializeValue(), sync());
});

test("collapses per-field app inputs into one canonical material panel input", () => {
    const config = { label: "徽章材质区域" };
    const source = [
        [18, MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME, config],
        [18, "color_1", config],
        [18, "threshold_1"],
        [9, "value"],
        [18, "material_id_1"],
    ];
    const result = collapseBadgeMaterialRegionV1Inputs(source, 18);
    assert.equal(result.changed, true);
    assert.deepEqual(result.inputs, [
        [18, BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME, config],
        [9, "value"],
    ]);
});
