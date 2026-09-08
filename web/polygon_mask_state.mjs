const MIN_VERTICES = 3;


function hasValidPolygonState(info) {
  if (!info || typeof info !== "object") {
    return false;
  }
  if (info.cleared === true) {
    return true;
  }
  if (Array.isArray(info.brush_strokes) && info.brush_strokes.length) return true;
  if (Array.isArray(info.polygons)) {
    return info.polygons.some((polygon) => {
      const points = Array.isArray(polygon?.points) ? polygon.points : polygon;
      return Array.isArray(points) && points.length >= MIN_VERTICES;
    });
  }
  return Array.isArray(info.points) && info.points.length >= MIN_VERTICES;
}


function parsePolygonInfo(value) {
  if (!value) {
    return null;
  }
  try {
    const info = typeof value === "string" ? JSON.parse(value) : value;
    return hasValidPolygonState(info) ? value : null;
  } catch {
    return null;
  }
}


export function resolveWorkflowPolygonInfo(node) {
  const candidates = [
    node?.getPolygonWidget?.("polygon_data")?.value,
    node?.properties?.polygon_data_value,
    node?.properties?.polygon_info,
  ];

  for (const candidate of candidates) {
    const polygonInfo = parsePolygonInfo(candidate);
    if (polygonInfo) {
      return polygonInfo;
    }
  }
  return null;
}


export function syncPolygonDataForQueue(node, polygonDataWidget) {
  if (!node || !polygonDataWidget || typeof node.serializePolygonInfo !== "function") {
    return "";
  }

  const polygonInfo = node.serializePolygonInfo();
  polygonDataWidget.value = polygonInfo;
  node.savePolygonWidgetState?.(false);
  return polygonInfo;
}


export function bindPolygonDataQueueSync(node, polygonDataWidget) {
  const syncPolygonData = () => syncPolygonDataForQueue(node, polygonDataWidget);
  const originalBeforeQueued = polygonDataWidget.beforeQueued;

  polygonDataWidget.beforeQueued = function () {
    const result = originalBeforeQueued?.apply(this, arguments);
    syncPolygonData();
    return result;
  };
  polygonDataWidget.serializeValue = syncPolygonData;

  return syncPolygonData;
}
