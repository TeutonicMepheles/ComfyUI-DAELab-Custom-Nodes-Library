import assert from "node:assert/strict";
import test from "node:test";

import {
    applyMaterialWidgetLabels,
    fitMaterialPromptNodeToContent,
    getCanonicalMaterialOutputs,
    getCanonicalMaterialWidgetValues,
    getLegacyMaterialOutputIndexes,
    getMaterialSelectorLayout,
    getMaterialThumbnailLayout,
    LEGACY_DEFAULT_MATERIAL_BASE_PROMPT,
    MATERIAL_FALLBACK_NODE_HEIGHT,
    MATERIAL_MIN_NODE_WIDTH,
    MATERIAL_PANEL_WIDGET_NAME,
    migrateMaterialWidgetValues,
    normalizeMaterialBasePrompt,
    orderMaterialPromptWidgets,
} from "../web/material_prompt_model.mjs";
import {
    catalogEntries,
    makeCatalogThumbnailUrl,
    resolveCatalogId,
} from "../web/thumbnail_selector.mjs";

const catalog = {
    bronze: { label: "深色拉丝古铜", thumbnail: "bronze.png" },
    enamel: { label: "高光珐琅", thumbnail: "enamel.png" },
};

test("normalizes catalog entries and resolves ids from ids or labels", () => {
    assert.deepEqual(catalogEntries(catalog), [
        { id: "bronze", label: "深色拉丝古铜", thumbnail: "bronze.png" },
        { id: "enamel", label: "高光珐琅", thumbnail: "enamel.png" },
    ]);
    assert.equal(resolveCatalogId(catalog, "bronze"), "bronze");
    assert.equal(resolveCatalogId(catalog, "高光珐琅"), "enamel");
    assert.equal(resolveCatalogId(catalog, "unknown", "bronze"), "bronze");
});

test("builds cache-busted thumbnail URLs", () => {
    const url = makeCatalogThumbnailUrl(
        catalog.bronze,
        new URL("https://example.com/thumbs/"),
        "v1"
    );
    assert.equal(url, "https://example.com/thumbs/bronze.png?v=v1");
});

test("lays out eight square material buttons in four columns and two rows", () => {
    const narrow = getMaterialThumbnailLayout(470, 8);
    assert.equal(narrow.columns, 4);
    assert.equal(narrow.rows, 2);
    assert.equal(narrow.cardSize, 105.5);
    assert.equal(narrow.height, 231);

    const wide = getMaterialThumbnailLayout(900, 8);
    assert.equal(wide.cardSize, 120);
    assert.equal(wide.height, 260);
});

test("adds a capped square selected-material viewport to the fixed selector row", () => {
    const narrow = getMaterialSelectorLayout(470, 8);
    assert.equal(narrow.viewportSize, 320);
    assert.equal(narrow.thumbnailHeight, 231);
    assert.equal(narrow.height, 563);

    const wide = getMaterialSelectorLayout(900, 8);
    assert.equal(wide.viewportSize, 320);
    assert.equal(wide.thumbnailHeight, 260);
    assert.equal(wide.height, 592);
});

test("measures compact node height without restored surplus", () => {
    const appliedSizes = [];
    const node = {
        size: [525, 1278],
        setSize(size) {
            this.size = [...size];
            appliedSizes.push([...size]);
        },
        arrange() {},
        computeSize() {
            return [this.size[0], this.size[1] > 1 ? 1278 : 760];
        },
    };

    assert.deepEqual(fitMaterialPromptNodeToContent(node), [525, 760]);
    assert.deepEqual(appliedSizes, [[525, 1], [525, 760]]);

    const fallbackNode = { size: [300, 900], computeSize: () => [300, NaN] };
    assert.deepEqual(
        fitMaterialPromptNodeToContent(fallbackNode),
        [MATERIAL_MIN_NODE_WIDTH, MATERIAL_FALLBACK_NODE_HEIGHT]
    );
});

test("orders selector before the three native widgets", () => {
    const material = { name: "material_id" };
    const base = { name: "base_prompt" };
    const details = { name: "additional_details" };
    const dom = { name: MATERIAL_PANEL_WIDGET_NAME, serialize: false };
    assert.deepEqual(
        orderMaterialPromptWidgets([details, material, dom, base]),
        [dom, material, base, details]
    );
});

test("serializes the achromatic schema canonically", () => {
    const widgets = [
        { name: MATERIAL_PANEL_WIDGET_NAME, value: "bronze", serialize: false },
        { name: "material_id", value: "深色拉丝古铜" },
        { name: "base_prompt", value: "BASE" },
        { name: "additional_details", value: "DETAILS" },
    ];
    const canonical = ["深色拉丝古铜", "BASE", "DETAILS"];
    assert.deepEqual(getCanonicalMaterialWidgetValues(widgets), canonical);
    assert.deepEqual(migrateMaterialWidgetValues(canonical), canonical);
    assert.deepEqual(migrateMaterialWidgetValues([null, ...canonical]), canonical);
});

test("drops color picker values when migrating legacy workflows", () => {
    const expected = ["透明漆", "BASE", "DETAILS"];
    assert.deepEqual(
        migrateMaterialWidgetValues(["透明漆", "#169c98", "BASE", "DETAILS", false]),
        expected
    );
    assert.deepEqual(
        migrateMaterialWidgetValues([null, "透明漆", "#169c98", "BASE", "DETAILS", false]),
        expected
    );
    assert.deepEqual(
        migrateMaterialWidgetValues(["透明漆", "#169c98", "BASE", "DETAILS"]),
        expected
    );
    assert.equal(migrateMaterialWidgetValues(["broken"]), null);
});

test("drops only the legacy selected_color output from restored workflows", () => {
    const outputs = [
        { name: "prompt", type: "STRING" },
        { name: "material_semantics", type: "STRING" },
        { name: "preview_image", type: "IMAGE" },
        { localized_name: "selected_color", name: "selected_color", type: "STRING" },
        { name: "future_output", type: "STRING" },
    ];

    assert.deepEqual(getLegacyMaterialOutputIndexes(outputs), [3]);
    assert.deepEqual(
        getCanonicalMaterialOutputs(outputs).map((output) => output.name),
        ["prompt", "material_semantics", "preview_image", "future_output"]
    );
});

test("migrates the legacy auto-filled edit target", () => {
    assert.equal(normalizeMaterialBasePrompt(undefined), "");
    assert.equal(normalizeMaterialBasePrompt("用户自定义目标"), "用户自定义目标");
    assert.equal(normalizeMaterialBasePrompt(LEGACY_DEFAULT_MATERIAL_BASE_PROMPT), "");
    assert.deepEqual(
        migrateMaterialWidgetValues([
            "深色拉丝古铜",
            "#6B3F24",
            LEGACY_DEFAULT_MATERIAL_BASE_PROMPT,
            "",
            false,
        ]),
        ["深色拉丝古铜", "", ""]
    );
});

test("applies stable Chinese labels only to current widgets", () => {
    const widgets = [
        { name: "material_id", value: "深色拉丝古铜" },
        { name: "base_prompt", value: "BASE" },
        { name: "additional_details", value: "" },
    ];
    assert.equal(applyMaterialWidgetLabels(widgets), true);
    assert.deepEqual(widgets.map(({ label, value }) => [label, value]), [
        ["材质", "深色拉丝古铜"],
        ["编辑目标（可选）", "BASE"],
        ["补充要求", ""],
    ]);
    assert.equal(applyMaterialWidgetLabels(widgets), false);
});
