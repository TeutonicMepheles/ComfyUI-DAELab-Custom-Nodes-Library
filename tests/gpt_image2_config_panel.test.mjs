import test from "node:test";
import assert from "node:assert/strict";

import {
  GPT_IMAGE2_CONFIG_MEMBER_WIDGET_NAMES,
  GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
  collapseGPTImage2ConfigPanelInputs,
} from "../web/gpt_image2_config_panel.mjs";

test("groups the three GPT Image2 Config controls under one panel widget", () => {
  assert.deepEqual(GPT_IMAGE2_CONFIG_MEMBER_WIDGET_NAMES, [
    GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
    "size",
    "background",
    "quality",
  ]);
});

test("collapses all GPT Image2 Config members into one app input", () => {
  const source = [
    [3, "seed"],
    [7, "size", { height: 40 }],
    [7, "background"],
    [9, "quality"],
    [7, "quality"],
  ];

  const result = collapseGPTImage2ConfigPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    [3, "seed"],
    [7, GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME, { height: 40 }],
    [9, "quality"],
  ]);
});

test("prefers the existing panel config and preserves unrelated inputs", () => {
  const panelConfig = { height: 126 };
  const source = [
    ["7", "background", { height: 40 }],
    [8, "size"],
    [7, GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME, panelConfig],
    [7, "quality"],
  ];

  const result = collapseGPTImage2ConfigPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    ["7", GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME, panelConfig],
    [8, "size"],
  ]);
});

test("does not rewrite a canonical or unrelated app builder selection", () => {
  const canonical = [[7, GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME], [8, "quality"]];
  const canonicalResult = collapseGPTImage2ConfigPanelInputs(canonical, 7);
  assert.equal(canonicalResult.changed, false);
  assert.equal(canonicalResult.inputs, canonical);

  const unrelated = [[8, "quality"]];
  const unrelatedResult = collapseGPTImage2ConfigPanelInputs(unrelated, 7);
  assert.equal(unrelatedResult.changed, false);
  assert.equal(unrelatedResult.inputs, unrelated);
});
