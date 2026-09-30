import assert from "node:assert/strict";
import test from "node:test";

import {
  BADGE_RELIEF_LEVELS,
  BADGE_RELIEF_PANEL_WIDGET_NAME,
  collapseBadgeReliefPanelInputs,
  getReliefLevelSpec,
  normalizeReliefLevel,
} from "../web/badge_relief_prompt_panel.mjs";

test("defines six ordered relief segments", () => {
  assert.deepEqual(
    BADGE_RELIEF_LEVELS.map(({ value, title }) => [value, title]),
    [
      [0, "完全平面"],
      [1, "微浮雕"],
      [2, "浅浮雕"],
      [3, "中浮雕"],
      [4, "深浮雕"],
      [5, "高浮雕"],
    ],
  );
});

test("normalizes linked and persisted values to slider segments", () => {
  assert.equal(normalizeReliefLevel(-4), 0);
  assert.equal(normalizeReliefLevel(2.5), 3);
  assert.equal(normalizeReliefLevel(2.6), 3);
  assert.equal(normalizeReliefLevel(99), 5);
  assert.equal(normalizeReliefLevel("invalid"), 2);
  assert.equal(getReliefLevelSpec(4).title, "深浮雕");
});

test("collapses native and panel app inputs into one canonical panel input", () => {
  const config = { label: "浮雕立体程度" };
  const source = [
    [7, "relief_level", config],
    [9, "value"],
    [7, BADGE_RELIEF_PANEL_WIDGET_NAME],
  ];

  const result = collapseBadgeReliefPanelInputs(source, 7);

  assert.equal(result.changed, true);
  assert.deepEqual(result.inputs, [
    [7, BADGE_RELIEF_PANEL_WIDGET_NAME, config],
    [9, "value"],
  ]);
});

test("leaves canonical and unrelated app inputs unchanged", () => {
  const canonical = [[7, BADGE_RELIEF_PANEL_WIDGET_NAME], [9, "value"]];
  const canonicalResult = collapseBadgeReliefPanelInputs(canonical, 7);
  assert.equal(canonicalResult.changed, false);
  assert.equal(canonicalResult.inputs, canonical);

  const unrelated = [[9, "value"]];
  const unrelatedResult = collapseBadgeReliefPanelInputs(unrelated, 7);
  assert.equal(unrelatedResult.changed, false);
  assert.equal(unrelatedResult.inputs, unrelated);
});
