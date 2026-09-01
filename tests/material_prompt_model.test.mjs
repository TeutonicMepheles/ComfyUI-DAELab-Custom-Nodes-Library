import assert from "node:assert/strict";
import test from "node:test";

import {
    applyMaterialWidgetLabels,
    DEFAULT_MATERIAL_COLOR,
    DEFAULT_USE_COLOR,
    fitMaterialPromptNodeToContent,
    getCanonicalMaterialWidgetValues,
    getMaterialSelectorLayout,
    getMaterialThumbnailLayout,
    LEGACY_DEFAULT_MATERIAL_BASE_PROMPT,
    MATERIAL_COLOR_PICKER_WIDGET_NAME,
    MATERIAL_MIN_NODE_WIDTH,
    MATERIAL_PANEL_WIDGET_NAME,
    migrateMaterialWidgetValues,
    normalizeMaterialBasePrompt,
    orderMaterialPromptWidgets,
    isMaterialColorEnabled,
    isAutomaticMaterialColor,
    resolveMaterialColor,
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

test("measures compact node height without feeding restored surplus height back in", () => {
    const appliedSizes = [];
    const node = {
        size: [525, 1278],
        setSize(size) {
            this.size = [...size];
            appliedSizes.push([...size]);
        },
        arrange() {},
        computeSize() {
            return [this.size[0], this.size[1] > 1 ? 1278 : 880];
        },
    };

    assert.deepEqual(fitMaterialPromptNodeToContent(node), [525, 880]);
    assert.deepEqual(appliedSizes, [[525, 1], [525, 880]]);

    node.size = [300, 900];
    assert.deepEqual(fitMaterialPromptNodeToContent(node), [MATERIAL_MIN_NODE_WIDTH, 880]);
});

test("resolves automatic and custom material colors", () => {
    const colors = {
        bronze: { preview_color: "#6B3F24" },
        enamel: { preview_color: "#C62828" },
    };
    assert.equal(isAutomaticMaterialColor("auto"), true);
    assert.equal(isAutomaticMaterialColor("#00ffaa"), false);
    assert.equal(resolveMaterialColor(colors, "bronze", "auto"), "#6b3f24");
    assert.equal(resolveMaterialColor(colors, "enamel", "#00FFAA"), "#00ffaa");
});

test("normalizes whether material color is enabled", () => {
    for (const value of [undefined, null, true, 1, "true", "on"]) {
        assert.equal(isMaterialColorEnabled(value), true);
    }
    for (const value of [false, 0, "false", "off", ""]) {
        assert.equal(isMaterialColorEnabled(value), false);
    }
});

test("orders material DOM selector before native widgets", () => {
    const material = { name: "material_id" };
    const useColor = { name: "use_color" };
    const base = { name: "base_prompt" };
    const color = { name: "material_color" };
    const colorPicker = { name: MATERIAL_COLOR_PICKER_WIDGET_NAME, serialize: false };
    const details = { name: "additional_details" };
    const dom = { name: MATERIAL_PANEL_WIDGET_NAME, serialize: false };
    assert.deepEqual(
        orderMaterialPromptWidgets([details, material, dom, base, color, colorPicker, useColor]),
        [dom, material, useColor, colorPicker, color, base, details]
    );
});

test("serializes and migrates material widgets canonically", () => {
    const widgets = [
        { name: MATERIAL_PANEL_WIDGET_NAME, value: "bronze", serialize: false },
        { name: "material_id", value: "深色拉丝古铜" },
        { name: "material_color", value: "#6B3F24" },
        { name: "base_prompt", value: "BASE" },
        { name: "additional_details", value: "DETAILS" },
        { name: "use_color", value: false },
    ];
    const canonical = ["深色拉丝古铜", "#6B3F24", "BASE", "DETAILS", false];
    assert.deepEqual(getCanonicalMaterialWidgetValues(widgets), canonical);
    assert.deepEqual(migrateMaterialWidgetValues(canonical), canonical);
    assert.deepEqual(migrateMaterialWidgetValues([null, ...canonical]), canonical);
    assert.deepEqual(
        migrateMaterialWidgetValues(["深色拉丝古铜", "#6B3F24", "BASE", "DETAILS"]),
        ["深色拉丝古铜", "#6B3F24", "BASE", "DETAILS", DEFAULT_USE_COLOR]
    );
    assert.deepEqual(
        migrateMaterialWidgetValues([null, "深色拉丝古铜", "#6B3F24", "BASE", "DETAILS"]),
        ["深色拉丝古铜", "#6B3F24", "BASE", "DETAILS", DEFAULT_USE_COLOR]
    );
    assert.deepEqual(
        migrateMaterialWidgetValues(["深色拉丝古铜", "BASE", "DETAILS"]),
        ["深色拉丝古铜", DEFAULT_MATERIAL_COLOR, "BASE", "DETAILS", DEFAULT_USE_COLOR]
    );
    assert.deepEqual(
        migrateMaterialWidgetValues([null, "深色拉丝古铜", "BASE", "DETAILS"]),
        ["深色拉丝古铜", DEFAULT_MATERIAL_COLOR, "BASE", "DETAILS", DEFAULT_USE_COLOR]
    );
    assert.equal(migrateMaterialWidgetValues(["broken"]), null);
});

test("migrates the legacy auto-filled edit target to an empty optional value", () => {
    assert.equal(normalizeMaterialBasePrompt(undefined), "");
    assert.equal(normalizeMaterialBasePrompt("用户自定义目标"), "用户自定义目标");
    assert.equal(normalizeMaterialBasePrompt(LEGACY_DEFAULT_MATERIAL_BASE_PROMPT), "");

    const widgets = [
        { name: "material_id", value: "深色拉丝古铜" },
        { name: "material_color", value: "#6B3F24" },
        { name: "base_prompt", value: LEGACY_DEFAULT_MATERIAL_BASE_PROMPT },
        { name: "additional_details", value: "" },
        { name: "use_color", value: false },
    ];
    assert.deepEqual(getCanonicalMaterialWidgetValues(widgets), [
        "深色拉丝古铜",
        "#6B3F24",
        "",
        "",
        false,
    ]);
    assert.deepEqual(
        migrateMaterialWidgetValues([
            "深色拉丝古铜",
            "#6B3F24",
            LEGACY_DEFAULT_MATERIAL_BASE_PROMPT,
            "",
            false,
        ]),
        ["深色拉丝古铜", "#6B3F24", "", "", false]
    );
});

test("applies stable Chinese labels without changing widget values", () => {
    const widgets = [
        { name: "material_id", value: "深色拉丝古铜" },
        { name: "material_color", value: "#6B3F24" },
        { name: "base_prompt", value: "BASE" },
        { name: "additional_details", value: "" },
        { name: "use_color", value: false },
    ];
    assert.equal(applyMaterialWidgetLabels(widgets), true);
    assert.deepEqual(widgets.map(({ label, value }) => [label, value]), [
        ["材质", "深色拉丝古铜"],
        ["颜色", "#6B3F24"],
        ["编辑目标（可选）", "BASE"],
        ["补充要求", ""],
        ["启用颜色", false],
    ]);
    assert.equal(applyMaterialWidgetLabels(widgets), false);
});
