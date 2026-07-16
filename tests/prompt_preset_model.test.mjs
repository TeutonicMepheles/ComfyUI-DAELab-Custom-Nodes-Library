import assert from "node:assert/strict";
import test from "node:test";

import {
    isHexColorString,
    normalizeBooleanValue,
    placeNonSerializingWidgetBefore,
    repairPromptTextValues,
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

test("places the DOM selector without changing native widget order", () => {
    const style = { name: "style_id" };
    const tone = { name: "tone" };
    const primary = { name: "primary_color" };
    const base = { name: "base_prompt" };
    const dom = { name: "style_thumbnail_dom_selector", serialize: false };
    const next = placeNonSerializingWidgetBefore([style, tone, primary, base, dom], dom, "style_id");

    assert.deepEqual(next, [dom, style, tone, primary, base]);
    assert.deepEqual(next.filter((widget) => widget.serialize !== false), [style, tone, primary, base]);
    assert.deepEqual(placeNonSerializingWidgetBefore(next, dom, "style_id"), next);
});
