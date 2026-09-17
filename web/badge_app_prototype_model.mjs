import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs?v=20260916-content-1';

export const PROTOTYPE_PROPERTY = 'daelabBadgePrototypeV1';
export const APPLY_ITEM = 'badge.post.local.apply';

export function isBadgePrototype(graph) {
    return graph?.extra?.[PROTOTYPE_PROPERTY]?.version === 1;
}

export function isSamePrototype(graph, workflowId) {
    return isBadgePrototype(graph) && graph.id === workflowId;
}

export function widgetValue(node, name) {
    const live = node?.widgets?.find(w => w.name === name);
    if (live) return live.value;
    return node?.widgets_values_named?.[name];
}

export function prototypeSnapshot(graph) {
    const config = graph.extra[PROTOTYPE_PROPERTY];
    const node = id => graph.getNodeById(id);
    const hierarchy = readHierarchyState(node(config.stateNodeId));
    const enabled = id => itemValue(hierarchy, id);
    const image = id => widgetValue(node(id), 'image');
    const flat = enabled('badge.path.flat_height');
    const effect = enabled('badge.path.effect');
    const local = enabled('badge.post.local');
    const polygon = enabled('badge.post.local.selection.polygon');
    const color = enabled('badge.post.local.selection.color');
    const material = enabled('badge.post.local.material');
    const semantic = enabled('badge.post.local.semantic');
    const studio = enabled('badge.post.studio');
    let error = '';
    if (flat === effect) error = badgeText("app_prototype_model.text_001");
    else if (flat && !image(1)) error = badgeText("app_prototype_model.text_002");
    else if (flat && config.heightEnabled !== false && !image(2)) error = badgeText("app_prototype_model.text_003");
    else if (effect && !image(96)) error = badgeText("app_prototype_model.text_004");
    else if (local && !image(config.localReferenceNodeId)) error = badgeText("app_prototype_model.text_005");
    else if (local && color === polygon) error = badgeText("app_prototype_model.text_006");
    else if (local && semantic === material) error = badgeText("app_prototype_model.text_007");
    else if (local && semantic && !String(widgetValue(node(105), 'value') || '').trim()) error = badgeText("app_prototype_model.text_008");
    else if (studio && !image(config.studioReferenceNodeId)) error = badgeText("app_prototype_model.text_009");
    // Values, not canvas geometry or transient widget objects, define the draft.
    const inputs = (graph.extra.linearData?.inputs || []).filter(([key]) => !key.includes(':95:'))
        .map(([key]) => {
            const [, id, name] = key.split(':');
            const target = node(Number(id));
            return [key, target?.widgets?.filter(w => w.type !== 'button' && w.name !== 'upload')
                .map(w => [w.name, w.value]) ?? target?.widgets_values_named ?? target?.widgets_values,
                name === 'polygon_canvas' ? target?.properties?.polygon_info : undefined];
        });
    const fingerprint = JSON.stringify([hierarchy.filter(i => i.id !== APPLY_ITEM).map(i => [i.id, i.value]), inputs, config.heightEnabled !== false, config.heightBoard]);
    return { error, fingerprint, local, studio, apply: enabled(APPLY_ITEM),
        map: enabled('badge.post.local.color_id_map') };
}

export function simulateRun(previous, snapshot) {
    if (snapshot.error) return { ...previous, phase: 'error', message: snapshot.error, resetApply: true };
    if (snapshot.local && snapshot.apply) {
        if (previous.preview !== snapshot.fingerprint) {
            return { preview: null, phase: 'needs-preview', resetApply: true,
                message: badgeText("app_prototype_model.text_010") };
        }
        return { preview: snapshot.fingerprint, phase: 'applied', resetApply: false,
            message: badgeText("app_prototype_model.text_011", {p0: (snapshot.studio ? badgeText("app_prototype_model.text_012") : '')}) };
    }
    if (snapshot.local) return { preview: snapshot.fingerprint, phase: 'preview-ready', resetApply: false,
        message: badgeText("app_prototype_model.text_013") };
    return { preview: null, phase: 'complete', resetApply: false,
        message: badgeText("app_prototype_model.text_014", {p0: (snapshot.studio ? badgeText("app_prototype_model.text_015") : '')}) };
}

export function createPrototypeQueueHandler(original, getGraph, simulate) {
    return function (...args) {
        const graph = getGraph();
        if (isBadgePrototype(graph)) return simulate(graph);
        return original.apply(this, args);
    };
}
