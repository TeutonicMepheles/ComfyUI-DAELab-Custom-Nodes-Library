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

  const imageWidget = originNode.widgets?.find((widget) => widget.name === "image");
  const imageValue = imageWidget?.value;
  if (!imageValue) {
    return null;
  }

  return {
    nodeId: originNode.id ?? "unknown",
    nodeType: originNode.type || originNode.comfyClass || "",
    imageValue,
  };
}

export function getConnectedLoadImageKey(info) {
  if (!info) {
    return "";
  }
  return `load-image:${info.nodeId}:${info.imageValue}`;
}
