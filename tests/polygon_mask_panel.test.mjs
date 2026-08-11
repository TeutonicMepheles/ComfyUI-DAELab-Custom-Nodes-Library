import test from "node:test";
import assert from "node:assert/strict";

import {
  POLYGON_MASK_MAX_VERTICES,
  POLYGON_PANEL_WIDGET_NAME,
  collapsePolygonPanelInputs,
} from "../web/polygon_mask_panel.mjs";

test("exposes the Polygon Mask vertex limit", () => {
  assert.equal(POLYGON_MASK_MAX_VERTICES, 50);
});

test("collapses all Polygon Mask editor members into the canvas panel input", () => {
  const source = [
    [3, "vertex_count"],
    [7, "vertex_count", { height: 40 }],
    [7, "color", { height: 40 }],
    [7, "fill_opacity"],
    [7, "text"],
    [9, "seed"],
    [7, "outline_width"],
  ];

  const result = collapsePolygonPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    [3, "vertex_count"],
    [7, POLYGON_PANEL_WIDGET_NAME],
    [9, "seed"],
  ]);
});

test("prefers the existing canvas panel config and preserves unrelated inputs", () => {
  const panelConfig = { height: 320 };
  const source = [
    ["7", "fill_opacity", { height: 120 }],
    [8, "color"],
    [7, POLYGON_PANEL_WIDGET_NAME, panelConfig],
    [7, "outline_width"],
  ];

  const result = collapsePolygonPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    ["7", POLYGON_PANEL_WIDGET_NAME, panelConfig],
    [8, "color"],
  ]);
});

test("does not rewrite a canonical or unrelated app builder selection", () => {
  const canonical = [[7, POLYGON_PANEL_WIDGET_NAME], [8, "color"]];
  const canonicalResult = collapsePolygonPanelInputs(canonical, 7);
  assert.equal(canonicalResult.changed, false);
  assert.equal(canonicalResult.inputs, canonical);

  const unrelated = [[8, "color"]];
  const unrelatedResult = collapsePolygonPanelInputs(unrelated, 7);
  assert.equal(unrelatedResult.changed, false);
  assert.equal(unrelatedResult.inputs, unrelated);
});
