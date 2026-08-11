import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_LOAD_IMAGE_NODE_TYPES,
  getConnectedLoadImageInfo,
  getConnectedLoadImageKey,
  installConnectedLoadImageResolver,
  isDirectLoadImageNodeType,
  resolveExecutedImageUpdate,
} from "../web/polygon_mask_connection.mjs";


function makeGraph(imageValue, links = { 1010: { origin_id: 674 } }, nodeType = "LoadImage") {
  return {
    links,
    getNodeById(id) {
      if (id !== 674) return null;
      return {
        id,
        type: nodeType,
        widgets: [{ name: "image", value: imageValue }],
      };
    },
  };
}


test("supports both native and app-mode image upload nodes", () => {
  assert.deepEqual(DIRECT_LOAD_IMAGE_NODE_TYPES, ["LoadImage", "AppModeLoadImage"]);
  assert.equal(isDirectLoadImageNodeType("LoadImage"), true);
  assert.equal(isDirectLoadImageNodeType("AppModeLoadImage"), true);
  assert.equal(isDirectLoadImageNodeType("GeneratedImageNode"), false);

  const graph = makeGraph("App-Mode.jpg", undefined, "AppModeLoadImage");
  const polygonNode = {
    graph,
    inputs: [{ name: "image", link: 1010 }],
  };

  assert.deepEqual(getConnectedLoadImageInfo(polygonNode), {
    nodeId: 674,
    nodeType: "AppModeLoadImage",
    imageValue: "App-Mode.jpg",
  });
});


test("installs the compatibility resolver regardless of extension registration order", () => {
  class PolygonNodeType {}
  const calls = [];
  PolygonNodeType.prototype.onNodeCreated = function () {
    calls.push("existing");
  };

  installConnectedLoadImageResolver(PolygonNodeType, (node) => ({ node }));

  // Simulate polygon_mask.js assigning its original resolver and chaining its
  // creation hook after the compatibility extension has already registered.
  PolygonNodeType.prototype.getConnectedLoadImageInfo = () => null;
  const compatibilityCreationHook = PolygonNodeType.prototype.onNodeCreated;
  PolygonNodeType.prototype.onNodeCreated = function () {
    compatibilityCreationHook.call(this);
    calls.push("polygon-mask");
  };

  const node = new PolygonNodeType();
  node.onNodeCreated();

  assert.deepEqual(calls, ["existing", "polygon-mask"]);
  assert.deepEqual(node.getConnectedLoadImageInfo(), { node });
});


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


test("execution payloads cannot replace a copied workflow's connected image", () => {
  const activeGraph = makeGraph("Workflow-B.jpg");
  const polygonNode = {
    graph: activeGraph,
    inputs: [{ name: "image", link: 1010 }],
  };
  const update = resolveExecutedImageUpdate(polygonNode, {
    source_image: ["encoded-workflow-a-image"],
    source_image_hash: ["workflow-a-hash"],
  }, makeGraph("Workflow-A.jpg"));

  assert.deepEqual(update, {
    type: "connected",
    connectedInfo: {
      nodeId: 674,
      nodeType: "LoadImage",
      imageValue: "Workflow-B.jpg",
    },
  });
});


test("indirect execution results are classified as transient previews", () => {
  const polygonNode = {
    graph: { links: {}, getNodeById() { return null; } },
    inputs: [{ name: "image", link: 1010 }],
  };
  const message = {
    source_image: ["encoded-image"],
    source_image_hash: ["tensor-hash"],
  };

  assert.deepEqual(resolveExecutedImageUpdate(polygonNode, message), {
    type: "preview",
    encodedImage: "encoded-image",
    imageValue: "tensor-hash",
  });
  assert.deepEqual(resolveExecutedImageUpdate(polygonNode, {}), { type: "none" });
});


test("an upstream image widget is not treated as a direct loader unless its node type matches", () => {
  const graph = makeGraph("not-a-file.jpg");
  graph.getNodeById = () => ({
    id: 674,
    type: "GeneratedImageNode",
    widgets: [{ name: "image", value: "not-a-file.jpg" }],
  });
  const polygonNode = {
    graph,
    inputs: [{ name: "image", link: 1010 }],
  };

  assert.equal(getConnectedLoadImageInfo(polygonNode), null);
  assert.equal(resolveExecutedImageUpdate(polygonNode, {
    source_image: ["encoded-generated-image"],
  }).type, "preview");
});
