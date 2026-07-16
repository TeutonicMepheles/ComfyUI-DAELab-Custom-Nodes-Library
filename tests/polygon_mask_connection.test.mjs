import assert from "node:assert/strict";
import test from "node:test";

import {
  getConnectedLoadImageInfo,
  getConnectedLoadImageKey,
} from "../web/polygon_mask_connection.mjs";


function makeGraph(imageValue, links = { 1010: { origin_id: 674 } }) {
  return {
    links,
    getNodeById(id) {
      if (id !== 674) return null;
      return {
        id,
        type: "LoadImage",
        widgets: [{ name: "image", value: imageValue }],
      };
    },
  };
}


test("the node graph wins over a different global workflow with the same ids", () => {
  const nodeGraph = makeGraph("Original.jpg");
  const unrelatedGlobalGraph = makeGraph("1.jpg");
  const polygonNode = {
    graph: nodeGraph,
    inputs: [{ name: "image", link: 1010 }],
  };

  const info = getConnectedLoadImageInfo(polygonNode, unrelatedGlobalGraph);

  assert.deepEqual(info, {
    nodeId: 674,
    nodeType: "LoadImage",
    imageValue: "Original.jpg",
  });
  assert.equal(getConnectedLoadImageKey(info), "load-image:674:Original.jpg");
});


test("Map-based graph links are supported", () => {
  const graph = makeGraph("Original.jpg", new Map([[1010, { origin_id: 674 }]]));
  const polygonNode = {
    graph,
    inputs: [{ name: "image", link: 1010 }],
  };

  assert.equal(getConnectedLoadImageInfo(polygonNode)?.imageValue, "Original.jpg");
});
