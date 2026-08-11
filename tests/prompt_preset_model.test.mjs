import assert from "node:assert/strict";
import test from "node:test";

import {
    PROMPT_BOOLEAN_WIDGET_LABELS,
    PROMPT_WIDGET_LABELS,
    PROMPT_WIDGET_PLACEHOLDERS,
    PROMPT_WIDGET_SERIALIZATION_ORDER,
    TEMPLATE_PANEL_WIDGET_NAME,
    applyPromptWidgetMetadata,
    collapseTemplatePanelInputs,
    getCanonicalPromptWidgetValues,
    isHexColorString,
    migratePromptWidgetValues,
    normalizeBooleanValue,
    orderPromptPanelWidgets,
    repairPromptTextValues,
    resolveLinkedBooleanValue,
    setTemplateWidgetsDisabled,
} from "../web/prompt_preset_model.mjs";

const defaults = {
    defaultBasePrompt: "DEFAULT BASE",
    defaultAdditionalDetails: "DEFAULT DETAILS",
};

test("recognizes serialized hex colors in text fields", () => {
    assert.equal(isHexColorString("#567DF0"), true);
    assert.equal(isHexColorString("567df0"), true);
    assert.equal(isHexColorString("普通文本"), false);
});

test("preserves empty and verbatim user text", () => {
    assert.deepEqual(repairPromptTextValues({
        ...defaults,
        basePrompt: "",
        additionalDetails: "",
    }), {
        basePrompt: "",
        additionalDetails: "",
    });

    assert.deepEqual(repairPromptTextValues({
        ...defaults,
        basePrompt: "  第一行\n第二行。  ",
        additionalDetails: "  材质说明。  ",
    }), {
        basePrompt: "  第一行\n第二行。  ",
        additionalDetails: "  材质说明。  ",
    });
});

test("repairs only known corrupted text values", () => {
    assert.deepEqual(repairPromptTextValues({
        ...defaults,
        basePrompt: "#567DF0",
        additionalDetails: "#D0D5DD",
    }), {
        basePrompt: "DEFAULT BASE",
        additionalDetails: "DEFAULT DETAILS",
    });

    assert.deepEqual(repairPromptTextValues({
        ...defaults,
        basePrompt: "SAME VALUE",
        additionalDetails: " SAME  VALUE\n。 ",
    }), {
        basePrompt: "SAME VALUE",
        additionalDetails: "DEFAULT DETAILS",
    });
});

test("normalizes legacy boolean strings and corrupted values", () => {
    assert.equal(normalizeBooleanValue(false), false);
    assert.equal(normalizeBooleanValue("false"), false);
    assert.equal(normalizeBooleanValue(" TRUE "), true);
    assert.equal(normalizeBooleanValue(0), false);
    assert.equal(normalizeBooleanValue("legacy prompt text"), true);
});

test("places base prompt and the DOM selector at the top of the display order", () => {
    const style = { name: "style_id" };
    const tone = { name: "tone" };
    const primary = { name: "primary_color" };
    const base = { name: "base_prompt" };
    const elementReference = { name: "use_element_reference" };
    const lockEditRegion = { name: "lock_edit_region" };
    const dom = { name: "style_thumbnail_dom_selector", serialize: false };
    const next = orderPromptPanelWidgets([
        style,
        tone,
        primary,
        base,
        elementReference,
        lockEditRegion,
        dom,
    ]);

    assert.deepEqual(next, [
        base,
        dom,
        style,
        tone,
        primary,
        lockEditRegion,
        elementReference,
    ]);
    assert.deepEqual(orderPromptPanelWidgets(next), next);
});

test("serializes native prompt widgets in canonical schema order", () => {
    const widgets = [
        { name: "base_prompt", value: "BASE" },
        { name: "style_thumbnail_dom_selector", value: "party_building", serialize: false },
        ...PROMPT_WIDGET_SERIALIZATION_ORDER
            .filter((name) => name !== "base_prompt")
            .map((name, index) => ({ name, value: `${index}` })),
    ];

    assert.deepEqual(getCanonicalPromptWidgetValues(widgets), [
        "0",
        "1",
        "2",
        "3",
        "BASE",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
    ]);
});

test("migrates legacy DOM serialization holes to canonical values", () => {
    const canonical = [
        "航天科技",
        "标准",
        "#567DF0",
        "#D0D5DD",
        "BASE",
        "DETAILS",
        true,
        false,
        true,
        false,
        true,
    ];

    assert.deepEqual(migratePromptWidgetValues(canonical), canonical);
    assert.deepEqual(
        migratePromptWidgetValues([null, ...canonical]),
        canonical
    );
    assert.deepEqual(
        migratePromptWidgetValues([
            "BASE",
            null,
            "航天科技",
            "标准",
            "#567DF0",
            "#D0D5DD",
            "DETAILS",
            true,
            false,
            true,
            false,
            true,
        ]),
        canonical
    );
    assert.equal(migratePromptWidgetValues(["unknown"]), null);
});

test("collapses app builder template members into one stable panel input", () => {
    const detailsConfig = { height: 164 };
    const source = [
        [3, "base_prompt"],
        [7, "style_id"],
        [7, "tone"],
        [9, "seed"],
        [7, "additional_details", detailsConfig],
        [7, "primary_color"],
        [7, "secondary_color"],
    ];

    const result = collapseTemplatePanelInputs(source, 7);

    assert.equal(result.changed, true);
    assert.deepEqual(result.inputs, [
        [3, "base_prompt"],
        [7, TEMPLATE_PANEL_WIDGET_NAME, detailsConfig],
        [9, "seed"],
    ]);
});

test("prefers an existing panel config and leaves unrelated nodes untouched", () => {
    const panelConfig = { height: 240 };
    const source = [
        ["7", "style_id"],
        [8, "tone"],
        [7, TEMPLATE_PANEL_WIDGET_NAME, panelConfig],
        [7, "additional_details", { height: 100 }],
        [8, "additional_details"],
    ];

    const result = collapseTemplatePanelInputs(source, 7);

    assert.equal(result.changed, true);
    assert.deepEqual(result.inputs, [
        ["7", TEMPLATE_PANEL_WIDGET_NAME, panelConfig],
        [8, "tone"],
        [8, "additional_details"],
    ]);
});

test("does not rewrite a canonical or unrelated app builder selection", () => {
    const canonical = [[7, TEMPLATE_PANEL_WIDGET_NAME], [8, "tone"]];
    const canonicalResult = collapseTemplatePanelInputs(canonical, 7);
    assert.equal(canonicalResult.changed, false);
    assert.equal(canonicalResult.inputs, canonical);

    const unrelated = [[8, "tone"]];
    const unrelatedResult = collapseTemplatePanelInputs(unrelated, 7);
    assert.equal(unrelatedResult.changed, false);
    assert.equal(unrelatedResult.inputs, unrelated);
});

test("applies Chinese input labels and placeholders without changing frontend widget keys", () => {
    const widgets = [
        { name: "style_id", value: "航天科技" },
        { name: "tone", label: "画面语气", value: "标准" },
        { name: "primary_color", value: "#567DF0" },
        { name: "secondary_color", value: "#D0D5DD" },
        { name: "base_prompt", value: "prompt" },
        { name: "additional_details", value: "details" },
        { name: "use_theme_template", value: true },
        { name: "use_space_reference", value: false },
        { name: "include_people_placeholder", value: true },
        { name: "lock_edit_region", value: false },
        { name: "use_element_reference", value: true },
        { name: "use_theme_template", label: "用户自定义名称", value: false },
        { name: "include_people_placeholder", label: "替换占位人物", value: false },
    ];
    const originalNames = widgets.map((widget) => widget.name);
    const originalValues = widgets.map((widget) => widget.value);

    assert.deepEqual(PROMPT_BOOLEAN_WIDGET_LABELS, {
        use_theme_template: "使用主题模板",
        use_space_reference: "使用空间参考",
        include_people_placeholder: "包含参观者",
        use_element_reference: "使用元素参考",
        lock_edit_region: "锁定编辑区域",
    });
    assert.deepEqual(PROMPT_WIDGET_LABELS, {
        style_id: "主题风格",
        tone: "画面氛围",
        primary_color: "主色",
        secondary_color: "辅助色",
        base_prompt: "基础提示词",
        additional_details: "附加细节描述",
        ...PROMPT_BOOLEAN_WIDGET_LABELS,
    });
    assert.deepEqual(PROMPT_WIDGET_PLACEHOLDERS, {
        additional_details: "输入指定材质、饰品等要求",
    });
    assert.equal(applyPromptWidgetMetadata(widgets), true);
    assert.deepEqual(
        widgets.slice(0, 11).map(({ name, label }) => [name, label]),
        widgets.slice(0, 11).map(({ name }) => [
            name,
            PROMPT_WIDGET_LABELS[name],
        ])
    );
    assert.equal(widgets[5].options.placeholder, "输入指定材质、饰品等要求");
    assert.equal(widgets[11].label, "用户自定义名称");
    assert.equal(widgets[12].label, "包含参观者");
    assert.deepEqual(widgets.map((widget) => widget.name), originalNames);
    assert.deepEqual(widgets.map((widget) => widget.value), originalValues);
    assert.equal(applyPromptWidgetMetadata(widgets), false);
});

test("disables only template controls and restores their original state", () => {
    const widgets = [
        { name: "base_prompt", disabled: false },
        { name: "use_theme_template", disabled: false },
        { name: "include_people_placeholder", disabled: false, value: true },
        { name: "style_id", disabled: false, value: "航天科技" },
        { name: "tone", disabled: true, value: "标准" },
        {
            name: "primary_color",
            disabled: false,
            options: { disabled: false },
            value: "#567DF0",
        },
        {
            name: "secondary_color",
            disabled: true,
            options: { disabled: true },
            value: "#D0D5DD",
        },
        { name: "additional_details", disabled: false, value: "DETAILS" },
    ];

    assert.equal(setTemplateWidgetsDisabled(widgets, true), true);
    assert.deepEqual(
        widgets.map(({ name, disabled }) => [name, disabled]),
        [
            ["base_prompt", false],
            ["use_theme_template", false],
            ["include_people_placeholder", true],
            ["style_id", true],
            ["tone", true],
            ["primary_color", true],
            ["secondary_color", true],
            ["additional_details", true],
        ]
    );
    assert.equal(widgets[5].options.disabled, true);
    assert.equal(widgets[6].options.disabled, true);
    assert.equal(setTemplateWidgetsDisabled(widgets, true), false);
    assert.equal(setTemplateWidgetsDisabled(widgets, false), true);
    assert.deepEqual(
        widgets.map(({ name, disabled }) => [name, disabled]),
        [
            ["base_prompt", false],
            ["use_theme_template", false],
            ["include_people_placeholder", false],
            ["style_id", false],
            ["tone", true],
            ["primary_color", false],
            ["secondary_color", true],
            ["additional_details", false],
        ]
    );
    assert.equal(widgets[5].options.disabled, false);
    assert.equal(widgets[6].options.disabled, true);
    assert.equal(widgets[2].value, true);
    assert.equal(widgets[3].value, "航天科技");
    assert.equal(widgets[5].value, "#567DF0");
    assert.equal(widgets[6].value, "#D0D5DD");
    assert.equal(widgets[7].value, "DETAILS");
});

test("resolves linked booleans from runtime data and hierarchy stable item ids", () => {
    const hierarchyItems = [
        { id: "space", value: true },
        { id: "template", value: false },
    ];
    const source = {
        id: 7,
        type: "BooleanListHierarchy",
        properties: { boolean_list_items: JSON.stringify(hierarchyItems) },
        outputs: [
            { boolean_item_id: "template" },
            { boolean_item_id: "space" },
        ],
    };
    const graph = {
        _links: new Map([[42, { origin_id: 7, origin_slot: 0 }]]),
        _nodes: [source],
        getNodeById(id) {
            return this._nodes.find((node) => node.id === id);
        },
    };
    const target = {
        graph,
        inputs: [{ name: "use_theme_template", link: 42 }],
    };

    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        false
    );
    source.getOutputData = () => true;
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        false
    );

    source.properties.boolean_list_items = JSON.stringify([
        { id: "space", value: true },
        { id: "template", value: true },
    ]);
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        true
    );

    source.type = "PrimitiveBoolean";
    source.outputs = [{ widget: { name: "value" } }];
    source.widgets = [{ name: "value", value: false }];
    source.getOutputData = () => true;
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        false
    );
    source.widgets[0].value = true;
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        true
    );

    source.type = "BooleanListHierarchyGet";
    source.outputs = [{ boolean_item_id: "template" }];
    source.properties.boolean_get_snapshot = JSON.stringify({
        valid: true,
        items: [{ id: "template", value: false }],
        output_item_ids: ["template"],
    });
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        false
    );
    source.properties.boolean_get_snapshot = JSON.stringify({
        valid: true,
        items: [{ id: "template", value: true }],
        output_item_ids: ["template"],
    });
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        true
    );
    target.inputs[0].link = null;
    assert.equal(
        resolveLinkedBooleanValue(target, "use_theme_template"),
        null
    );
});
