import assert from "node:assert/strict";
import test from "node:test";

import {
  bindPolygonDataQueueSync,
  resolveWorkflowPolygonInfo,
} from "../web/polygon_mask_state.mjs";


function polygonInfo(offset = 0) {
  return JSON.stringify({
    polygons: [{
      points: [
        { x: offset + 1, y: 1 },
        { x: offset + 5, y: 1 },
        { x: offset + 3, y: 5 },
      ],
    }],
    selectedIndex: 0,
    cleared: false,
    image: "load-image:674:Original.jpg",
  });
}


function makeWorkflowNode(widgetValue, properties = {}) {
  return {
    id: 673,
    properties,
    getPolygonWidget(name) {
      return name === "polygon_data" ? { value: widgetValue } : null;
    },
  };
}


test("copied workflows with identical node and image ids restore their own state", () => {
  const workflowAState = polygonInfo(0);
  const workflowBState = polygonInfo(100);
  const workflowA = makeWorkflowNode(workflowAState, {
    polygon_data_value: workflowAState,
    polygon_info: workflowAState,
  });
  const workflowB = makeWorkflowNode(workflowBState, {
    polygon_data_value: workflowBState,
    polygon_info: workflowBState,
  });

  assert.equal(resolveWorkflowPolygonInfo(workflowA), workflowAState);
  assert.equal(resolveWorkflowPolygonInfo(workflowB), workflowBState);
});


test("workflow state restore follows widget, current property, then legacy property precedence", () => {
  const widgetState = polygonInfo(10);
  const propertyState = polygonInfo(20);
  const legacyState = polygonInfo(30);

  assert.equal(
    resolveWorkflowPolygonInfo(makeWorkflowNode(widgetState, {
      polygon_data_value: propertyState,
      polygon_info: legacyState,
    })),
    widgetState,
  );
  assert.equal(
    resolveWorkflowPolygonInfo(makeWorkflowNode("", {
      polygon_data_value: propertyState,
      polygon_info: legacyState,
    })),
    propertyState,
  );
  assert.equal(
    resolveWorkflowPolygonInfo(makeWorkflowNode("", {
      polygon_data_value: "",
      polygon_info: legacyState,
    })),
    legacyState,
  );
});


test("invalid or missing workflow state does not restore a polygon", () => {
  assert.equal(resolveWorkflowPolygonInfo(makeWorkflowNode("", {})), null);
  assert.equal(resolveWorkflowPolygonInfo(makeWorkflowNode("{}", {})), null);
  assert.equal(resolveWorkflowPolygonInfo(makeWorkflowNode("{bad json", {})), null);
});


test("cleared workflow state is restored without creating a default polygon", () => {
  const clearedState = JSON.stringify({
    polygons: [],
    selectedIndex: -1,
    cleared: true,
  });

  assert.equal(resolveWorkflowPolygonInfo(makeWorkflowNode(clearedState, {})), clearedState);
});


test("beforeQueued and serializeValue both submit the latest canvas state", () => {
  const staleState = polygonInfo(0);
  const liveState = polygonInfo(200);
  const polygonDataWidget = { value: staleState };
  const savedStates = [];
  const node = {
    serializePolygonInfo() {
      return liveState;
    },
    savePolygonWidgetState(markDirty) {
      savedStates.push({ markDirty, value: polygonDataWidget.value });
    },
  };

  bindPolygonDataQueueSync(node, polygonDataWidget);
  polygonDataWidget.beforeQueued({ isPartialExecution: false });
  const serialized = polygonDataWidget.serializeValue();

  assert.equal(polygonDataWidget.value, liveState);
  assert.equal(serialized, liveState);
  assert.deepEqual(savedStates, [
    { markDirty: false, value: liveState },
    { markDirty: false, value: liveState },
  ]);
});
