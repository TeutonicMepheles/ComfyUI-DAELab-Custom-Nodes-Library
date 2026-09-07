import assert from "node:assert/strict";
import test from "node:test";

import {
  createPolygonMaskChangeDetail,
} from "../web/polygon_mask_events.mjs";

test("polygon change details stay scoped to the owning graph and node", () => {
  const graph = { id: "workflow" };
  const detail = createPolygonMaskChangeDetail({
    id: 142,
    graph,
    properties: { polygon_info: "{\"cleared\":true}" },
  });
  assert.deepEqual(detail, {
    graph,
    nodeId: "142",
    polygonInfo: "{\"cleared\":true}",
  });
});
