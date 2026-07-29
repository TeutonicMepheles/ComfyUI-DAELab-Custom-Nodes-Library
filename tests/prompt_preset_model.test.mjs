import assert from "node:assert/strict";
import test from "node:test";

import {
    PROMPT_WIDGET_SERIALIZATION_ORDER,
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

test("disables only template controls and restores their original state", () => {
    const widgets = [
        { name: "base_prompt", disabled: false },
        { name: "use_theme_template", disabled: false },
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
            ["style_id", true],
            ["tone", true],
            ["primary_color", true],
            ["secondary_color", true],
            ["additional_details", true],
        ]
    );
    assert.equal(widgets[4].options.disabled, true);
    assert.equal(widgets[5].options.disabled, true);
    assert.equal(setTemplateWidgetsDisabled(widgets, true), false);
    assert.equal(setTemplateWidgetsDisabled(widgets, false), true);
    assert.deepEqual(
        widgets.map(({ name, disabled }) => [name, disabled]),
        [
            ["base_prompt", false],
            ["use_theme_template", false],
            ["style_id", false],
            ["tone", true],
            ["primary_color", false],
            ["secondary_color", true],
            ["additional_details", false],
        ]
    );
    assert.equal(widgets[4].options.disabled, false);
    assert.equal(widgets[5].options.disabled, true);
    assert.equal(widgets[2].value, "航天科技");
    assert.equal(widgets[4].value, "#567DF0");
    assert.equal(widgets[5].value, "#D0D5DD");
    assert.equal(widgets[6].value, "DETAILS");
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
