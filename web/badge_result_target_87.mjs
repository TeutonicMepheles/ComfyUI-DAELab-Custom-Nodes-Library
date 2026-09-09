import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { isBadge87 } from './badge_execution_87_model.mjs';
import { syncPolygonTarget87 } from './badge_polygon_target_87.mjs';

export function localTargets87(graph) {
    const meta = graph.extra.daelabBadgePrototypeV1;
    if (!meta.localTargets) {
        const value = graph.getNodeById(meta.localReferenceNodeId)?.widgets?.find(w => w.name === 'image')?.value;
        const current = normalizeImageSelection(value);
        meta.localTargets = {source: 'generated', generated: current?.type === 'output' ? current : null,
            existing: current && current.type !== 'output' ? current : null};
    }
    return meta.localTargets;
}

// Use the existing LoadImage contract, including its annotated output references.
function applyTarget(graph, image, session) {
    const source = normalizeImageSelection(image);
    const meta = graph.extra.daelabBadgePrototypeV1;
    const node = graph.getNodeById(meta.localReferenceNodeId);
    const widget = node?.widgets?.find(w => w.name === 'image');
    if (!widget) return false;
    const value = source ? `${source.subfolder ? `${source.subfolder}/` : ''}${source.filename} [${source.type}]` : '';
    widget.value = value;
    if (value && Array.isArray(widget.options?.values) && !widget.options.values.includes(value)) widget.options.values.push(value);
    if (node.widgets_values_named) node.widgets_values_named.image = value;
    widget.callback?.(value);
    syncPolygonTarget87(graph);
    graph.getNodeById(meta.stateNodeId)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
    Object.assign(session, {preview: null, serverToken: null, seed: undefined, images: null, phase: 'changed',
        message: source ? '编辑目标已更新，请重新选择并预览编辑区域。' : '当前来源尚无图片。'});
    node.setDirtyCanvas?.(true, true);
    graph.setDirtyCanvas?.(true, true);
    return true;
}

export function selectLocalSource87(graph, source, session) {
    if (!isBadge87(graph) || !['generated', 'existing'].includes(source)) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph); targets.source = source;
    const updated = applyTarget(graph, targets[source], session);
    graph.afterChange?.();
    return updated;
}

export function setExistingTarget87(graph, image, session) {
    if (!isBadge87(graph) || !normalizeImageSelection(image)) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph);
    targets.existing = normalizeImageSelection(image); targets.source = 'existing';
    const updated = applyTarget(graph, targets.existing, session);
    graph.afterChange?.();
    return updated;
}

export function updateLocalTarget87(graph, image, session) {
    if (!isBadge87(graph) || !normalizeImageSelection(image)) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph);
    targets.generated = normalizeImageSelection(image);
    const updated = targets.source === 'generated' && applyTarget(graph, targets.generated, session);
    graph.afterChange?.();
    return updated;
}
