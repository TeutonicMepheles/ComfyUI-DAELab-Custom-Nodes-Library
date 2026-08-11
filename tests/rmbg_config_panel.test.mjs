import test from "node:test";
import assert from "node:assert/strict";

import {
  RMBG_CONFIG_MEMBER_WIDGET_NAMES,
  RMBG_CONFIG_PANEL_WIDGET_NAME,
  collapseRMBGConfigPanelInputs,
  normalizeRMBGColor,
} from "../web/rmbg_config_panel.mjs";

test("groups the two RMBG Config controls under one panel widget", () => {
  assert.deepEqual(RMBG_CONFIG_MEMBER_WIDGET_NAMES, [
    RMBG_CONFIG_PANEL_WIDGET_NAME,
    "background",
    "background_color",
  ]);
});

test("collapses both RMBG Config members into one app input", () => {
  const source = [
    [3, "image"],
    [7, "background", { height: 40 }],
    [7, "background_color"],
    [9, "background"],
  ];

  const result = collapseRMBGConfigPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    [3, "image"],
    [7, RMBG_CONFIG_PANEL_WIDGET_NAME, { height: 40 }],
    [9, "background"],
  ]);
});

test("prefers the existing panel config and preserves unrelated inputs", () => {
  const panelConfig = { height: 92 };
  const source = [
    ["7", "background_color", { height: 40 }],
    [8, "background"],
    [7, RMBG_CONFIG_PANEL_WIDGET_NAME, panelConfig],
    [7, "background"],
  ];

  const result = collapseRMBGConfigPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    ["7", RMBG_CONFIG_PANEL_WIDGET_NAME, panelConfig],
    [8, "background"],
  ]);
});

test("does not rewrite a canonical or unrelated app builder selection", () => {
  const canonical = [[7, RMBG_CONFIG_PANEL_WIDGET_NAME], [8, "background"]];
  const canonicalResult = collapseRMBGConfigPanelInputs(canonical, 7);
  assert.equal(canonicalResult.changed, false);
  assert.equal(canonicalResult.inputs, canonical);

  const unrelated = [[8, "background_color"]];
  const unrelatedResult = collapseRMBGConfigPanelInputs(unrelated, 7);
  assert.equal(unrelatedResult.changed, false);
  assert.equal(unrelatedResult.inputs, unrelated);
});

test("normalizes six-digit RMBG colors without accepting malformed values", () => {
  assert.equal(normalizeRMBGColor("ffffff"), "#FFFFFF");
  assert.equal(normalizeRMBGColor("#22aaCC"), "#22AACC");
  assert.equal(normalizeRMBGColor("transparent", "#123456"), "#123456");
});
