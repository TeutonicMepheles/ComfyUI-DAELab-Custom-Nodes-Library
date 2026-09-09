import { getConnectedLoadImageInfo, getConnectedLoadImageKey } from './polygon_mask_connection.mjs';

const requested = new WeakMap();

// Scoped to #8.7; reuse the native loader's loadToken race protection.
export function syncPolygonTarget87(graph) {
    if (graph?.extra?.daelabBadgeExecutionV1?.version !== 1) return false;
    const node = graph.getNodeById(142), drawing = node?.polygonWidget;
    if (!drawing || !node.loadConnectedLoadImage) return false;
    const info = getConnectedLoadImageInfo(node, graph);
    const key = getConnectedLoadImageKey(info);
    if (requested.get(drawing) === key) return false;
    requested.set(drawing, key);
    if (key && drawing.image && drawing.imageValue === key) return false;
    const previous = drawing.imageValue || node.properties?.source_image_hash;
    drawing.loadToken = (drawing.loadToken || 0) + 1;
    Object.assign(drawing, {image: null, imageValue: null, sourceImageData: null,
        sourceImageUrl: null, pendingSourceImageData: null, pendingSourceImageValue: null});
    delete drawing.badgePrototypeMaskPreview;
    if (!key || (previous && previous !== key)) {
        Object.assign(drawing, {polygons: [], brushStrokes: [], cleared: true, selectedIndex: -1});
        node.updatePolygonInfo?.();
        node.resetPolygonHistory?.();
    }
    node.redrawPolygonCanvas?.();
    node.updatePolygonButtons?.();
    if (info) node.loadConnectedLoadImage(info);
    return true;
}
