import assert from "node:assert/strict";
import test from "node:test";

import {
  migratePolygonsForImage,
  stagePolygonExecutionPreview,
} from "../web/polygon_mask_image_state.mjs";


function rectangle() {
  return [{
    points: [
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 80 },
      { x: 10, y: 80 },
    ],
  }];
}


test("an image identity change with the same dimensions preserves valid geometry", () => {
  const polygons = rectangle();
  const result = migratePolygonsForImage(
    polygons,
    false,
    { width: 100, height: 100 },
    { width: 100, height: 100 },
  );

  assert.deepEqual(result.polygons, polygons);
  assert.equal(result.shouldCreateDefault, false);
  assert.equal(result.geometryChanged, false);
});


test("different image dimensions scale polygon coordinates independently", () => {
  const result = migratePolygonsForImage(
    rectangle(),
    false,
    { width: 100, height: 100 },
    { width: 200, height: 50 },
  );

  assert.deepEqual(result.polygons[0].points, [
    { x: 20, y: 10 },
    { x: 180, y: 10 },
    { x: 180, y: 40 },
    { x: 20, y: 40 },
  ]);
  assert.equal(result.geometryChanged, true);
});


test("unknown previous dimensions preserve coordinates and clamp them to the new image", () => {
  const result = migratePolygonsForImage(
    [{
      points: [
        { x: -10, y: 10 },
        { x: 120, y: 10 },
        { x: 50, y: 130 },
      ],
    }],
    false,
    null,
    { width: 100, height: 80 },
  );

  assert.deepEqual(result.polygons[0].points, [
    { x: 0, y: 10 },
    { x: 100, y: 10 },
    { x: 50, y: 80 },
  ]);
  assert.equal(result.geometryChanged, true);
});


test("only missing polygon state requests a default shape", () => {
  const missing = migratePolygonsForImage([], false, null, { width: 100, height: 80 });
  const cleared = migratePolygonsForImage([], true, null, { width: 100, height: 80 });

  assert.equal(missing.shouldCreateDefault, true);
  assert.equal(missing.cleared, false);
  assert.equal(cleared.shouldCreateDefault, false);
  assert.equal(cleared.cleared, true);
  assert.deepEqual(cleared.polygons, []);
});


test("execution previews stage only transient image fields", () => {
  const polygonWidget = {
    polygons: rectangle(),
    cleared: false,
    selectedIndex: 0,
    imageValue: "committed-image",
    history: [{ polygons: rectangle() }],
  };
  const persistentSnapshot = JSON.stringify(polygonWidget);

  assert.equal(
    stagePolygonExecutionPreview(polygonWidget, "encoded-preview", "preview-hash"),
    true,
  );
  const {
    pendingSourceImageData,
    pendingSourceImageValue,
    ...persistentState
  } = polygonWidget;

  assert.equal(pendingSourceImageData, "encoded-preview");
  assert.equal(pendingSourceImageValue, "preview-hash");
  assert.equal(JSON.stringify(persistentState), persistentSnapshot);
});
