export function getConnectedLoadImageInfo(node, fallbackGraph = null) {
  const imageInput = node?.inputs?.find((input) => input.name === "image");
  const linkId = imageInput?.link;

  // Nodes can live in background workflow tabs or subgraphs. Their own graph
  // is authoritative; a global fallback can contain the same numeric ids.
  const graph = node?.graph || fallbackGraph;
  if (linkId == null || !graph) {
    return null;
  }

  const link = graph.links?.[linkId] || graph.links?.get?.(linkId);
  const originNode = link ? graph.getNodeById?.(link.origin_id) : null;
  if (!originNode) {
    return null;
  }

  const nodeType = originNode.type || originNode.comfyClass || "";
  if (nodeType !== "LoadImage") {
    return null;
  }

  const imageWidget = originNode.widgets?.find((widget) => widget.name === "image");
  const imageValue = imageWidget?.value;
  if (!imageValue) {
    return null;
  }

  return {
    nodeId: originNode.id ?? "unknown",
    nodeType,
    imageValue,
  };
}

export function getConnectedLoadImageKey(info) {
  if (!info) {
    return "";
  }
  return `load-image:${info.nodeId}:${info.imageValue}`;
}


export function resolveExecutedImageUpdate(node, message, fallbackGraph = null) {
  const connectedInfo = getConnectedLoadImageInfo(node, fallbackGraph);
  if (connectedInfo) {
    return {
      type: "connected",
      connectedInfo,
    };
  }

  const encodedImage = message?.source_image?.[0];
  if (!encodedImage) {
    return { type: "none" };
  }

  return {
    type: "preview",
    encodedImage,
    imageValue: message?.source_image_hash?.[0] || `socket-image-${encodedImage.length}`,
  };
}
