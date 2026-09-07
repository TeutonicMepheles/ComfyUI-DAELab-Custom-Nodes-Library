import assert from "node:assert/strict";
import test from "node:test";

import {
    APP_PREVIEW_HEADING_PROPERTY,
    APP_PREVIEW_PROPERTY,
    buildImageViewPath,
    isAppPreviewEnabled,
    normalizeImageSelection,
    resolveAppPreviewHeading,
} from "../web/app_mode_load_image_preview_model.mjs";

test("keeps app image previews opt-in for existing workflows", () => {
    assert.equal(isAppPreviewEnabled({ properties: {} }), false);
    assert.equal(isAppPreviewEnabled({ properties: { [APP_PREVIEW_PROPERTY]: false } }), false);
    assert.equal(isAppPreviewEnabled({ properties: { [APP_PREVIEW_PROPERTY]: true } }), true);
    assert.equal(isAppPreviewEnabled({ properties: { [APP_PREVIEW_PROPERTY]: "true" } }), false);
});

test("uses a workflow-specific Chinese preview heading", () => {
    const node = { properties: { [APP_PREVIEW_HEADING_PROPERTY]: "高度层次图取色参考" } };
    assert.equal(resolveAppPreviewHeading(node), "高度层次图取色参考");
    assert.equal(resolveAppPreviewHeading({ properties: {} }), "当前图片参考");
});

test("normalizes native image values and annotated folders", () => {
    assert.deepEqual(normalizeImageSelection("BaseColor.png"), {
        filename: "BaseColor.png",
        subfolder: "",
        type: "input",
    });
    assert.deepEqual(normalizeImageSelection("徽章\\参考\\高度.png [temp]"), {
        filename: "高度.png",
        subfolder: "徽章/参考",
        type: "temp",
    });
    assert.equal(normalizeImageSelection(""), null);
});

test("builds an encoded Comfy view path", () => {
    const selection = normalizeImageSelection({
        filename: "层次 图.png",
        subfolder: "徽章/参考",
        type: "input",
    });
    assert.equal(
        buildImageViewPath(selection, "rev-1"),
        "/view?filename=%E5%B1%82%E6%AC%A1+%E5%9B%BE.png&subfolder=%E5%BE%BD%E7%AB%A0%2F%E5%8F%82%E8%80%83&type=input&v=rev-1",
    );
});
