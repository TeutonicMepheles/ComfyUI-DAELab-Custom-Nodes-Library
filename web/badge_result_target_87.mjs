import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { isBadge87 } from './badge_execution_87_model.mjs';
import { syncPolygonTarget87 } from './badge_polygon_target_87.mjs?v=20260911-results';
import { normalizeMaskV1Config } from './multi_color_mask_v1_model.mjs';

export const targetKey87 = image => JSON.stringify(normalizeImageSelection(image));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function localTargets87(graph) {
    const meta = graph.extra.daelabBadgePrototypeV1;
    if (!meta.localTargets) {
        const value = graph.getNodeById(meta.localReferenceNodeId)?.widgets?.find(w => w.name === 'image')?.value;
        const current = normalizeImageSelection(value);
        meta.localTargets = {source: 'generated', generated: current?.type === 'output' ? current : null,
            existing: current && current.type !== 'output' ? current : null};
    }
    const targets = meta.localTargets;
    targets.results ||= targets.generated ? [targets.generated] : [];
    targets.drafts ||= {};
    return targets;
}

function saveDraft(graph, image) {
    if (!normalizeImageSelection(image)) return;
    const meta = graph.extra.daelabBadgePrototypeV1;
    const drawing = graph.getNodeById(142)?.polygonWidget;
    const color = graph.getNodeById(104)?.widgets?.find(w => w.name === 'multi_color_mask_v1_panel');
    localTargets87(graph).drafts[targetKey87(image)] = clone({
        polygon: drawing && {polygons: drawing.polygons, brushStrokes: drawing.brushStrokes,
            cleared: drawing.cleared, selectedIndex: drawing.selectedIndex, stateImageSize: drawing.stateImageSize},
        color: color?.value, map: meta.gptColorMap,
    });
}

// Use the same notification contract as native widget edits. The preview
// callback alone does not update ComfyUI's widget-related media errors.
function bindImageWidget(node, widget, source) {
    const previous = widget.value;
    const value = source ? `${source.subfolder ? `${source.subfolder}/` : ''}${source.filename} [${source.type}]` : '';
    if (value && Array.isArray(widget.options?.values) && !widget.options.values.includes(value)) widget.options.values.push(value);
    widget.value = value;
    if (node.widgets_values_named) node.widgets_values_named.image = value;
    widget.callback?.(value);
    if (source) node.onWidgetChanged?.(widget.name, value, previous, widget);
}

// Use the existing LoadImage contract, including its annotated output references.
function applyTarget(graph, image, session) {
    const source = normalizeImageSelection(image);
    const meta = graph.extra.daelabBadgePrototypeV1;
    const node = graph.getNodeById(meta.localReferenceNodeId);
    const widget = node?.widgets?.find(w => w.name === 'image');
    if (!widget) return false;
    if (targetKey87(widget.value) === targetKey87(source)) {
        // A reload can restore the image while leaving the native missing-media
        // state stale. Rebind without clearing the image's drawing or tokens.
        if (source) bindImageWidget(node, widget, source);
        return false;
    }
    saveDraft(graph, widget.value);
    const draft = clone(localTargets87(graph).drafts[targetKey87(source)]);
    bindImageWidget(node, widget, source);
    syncPolygonTarget87(graph, draft?.polygon || {polygons: [], brushStrokes: [], cleared: true, selectedIndex: -1, stateImageSize: null});
    const color = graph.getNodeById(104)?.widgets?.find(w => w.name === 'multi_color_mask_v1_panel');
    if (color) color.value = draft?.color || JSON.stringify(normalizeMaskV1Config({}));
    meta.gptColorMap = draft?.map?.sourceKey === targetKey87(source) ? draft.map : null;
    graph.getNodeById(meta.stateNodeId)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
    Object.assign(session, {preview: null, serverToken: null, seed: undefined, images: null, phase: 'changed',
        message: source ? '编辑目标已更新，选择编辑区域后即可生成。' : '当前来源尚无图片。'});
    node.setDirtyCanvas?.(true, true);
    graph.setDirtyCanvas?.(true, true);
    return true;
}

export function selectLocalSource87(graph, source, session) {
    if (!isBadge87(graph) || session?.busy || !['generated', 'existing'].includes(source)) return false;
    if (source === 'generated' && !normalizeImageSelection(localTargets87(graph).generated)) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph); targets.source = source;
    const updated = applyTarget(graph, targets[source], session);
    graph.afterChange?.();
    return updated;
}

// Preserve explicit source and image choices across App Mode rebuilds.
export function enterLocalStage87(graph, session) {
    const targets = localTargets87(graph);
    const source = targets.source === 'generated' && !targets.generated ? 'existing' : targets.source;
    selectLocalSource87(graph, source, session);
    return source;
}

export function setExistingTarget87(graph, image, session) {
    if (!isBadge87(graph) || session?.busy || !normalizeImageSelection(image)) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph);
    targets.existing = normalizeImageSelection(image); targets.source = 'existing';
    const updated = applyTarget(graph, targets.existing, session);
    graph.afterChange?.();
    return updated;
}

export function updateLocalTarget87(graph, image, session) {
    const images = (Array.isArray(image) ? image : [image]).map(normalizeImageSelection).filter(Boolean);
    if (!isBadge87(graph) || !images.length) return false;
    graph.beforeChange?.();
    const targets = localTargets87(graph);
    targets.results = images;
    targets.pendingResults = Boolean(targets.generated);
    const first = !targets.generated;
    if (first) targets.generated = images[0];
    const updated = first && !session?.busy && targets.source === 'generated' && applyTarget(graph, targets.generated, session);
    const retained = new Set([...images, targets.generated, targets.existing].filter(Boolean).map(targetKey87));
    for (const key of Object.keys(targets.drafts)) if (!retained.has(key)) delete targets.drafts[key];
    graph.afterChange?.();
    return updated;
}

export function selectGeneratedTarget87(graph, image, session) {
    if (!isBadge87(graph) || session?.busy) return false;
    const targets = localTargets87(graph);
    const selected = [...targets.results, targets.generated].find(item => item && targetKey87(item) === targetKey87(image));
    if (!selected) return false;
    graph.beforeChange?.();
    targets.generated = normalizeImageSelection(selected);
    targets.source = 'generated';
    targets.pendingResults = false;
    const updated = applyTarget(graph, targets.generated, session);
    graph.afterChange?.();
    return updated;
}
