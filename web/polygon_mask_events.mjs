export const POLYGON_MASK_CHANGE_EVENT = "daelab:polygon-mask-change";

export function createPolygonMaskChangeDetail(node) {
  return {
    graph: node?.graph ?? null,
    nodeId: String(node?.id ?? ""),
    polygonInfo: String(node?.properties?.polygon_info ?? ""),
  };
}

export function dispatchPolygonMaskChange(node, eventTarget = globalThis) {
  if (!node || !eventTarget?.dispatchEvent || typeof CustomEvent !== "function") {
    return false;
  }
  eventTarget.dispatchEvent(new CustomEvent(POLYGON_MASK_CHANGE_EVENT, {
    detail: createPolygonMaskChangeDetail(node),
  }));
  return true;
}
