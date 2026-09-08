import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs';

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
    if (flat === effect) error = '请选择一条制作路线。';
    else if (flat && !image(1)) error = '请上传材质图。';
    else if (flat && config.heightEnabled !== false && !image(2)) error = '高度建立已开启，请上传高度图。';
    else if (effect && !image(96)) error = '请上传现有效果图。';
    else if (local && !image(config.localReferenceNodeId)) error = '请上传局部选区参考图。';
    else if (local && color === polygon) error = '请选择按颜色或自绘遮罩选区。';
    else if (local && semantic === material) error = '请选择纯语义或目标材质修改。';
    else if (local && semantic && !String(widgetValue(node(105), 'value') || '').trim()) error = '请填写局部修改描述。';
    else if (studio && !image(config.studioReferenceNodeId)) error = '请上传棚拍前主图。';
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
                message: '请先关闭应用并模拟预览，再确认当前选区。' };
        }
        return { preview: snapshot.fingerprint, phase: 'applied', resetApply: false,
            message: `已模拟应用局部修改${snapshot.studio ? '及棚拍流程' : ''}。参考图保持原样。` };
    }
    if (snapshot.local) return { preview: snapshot.fingerprint, phase: 'preview-ready', resetApply: false,
        message: '预览步骤已模拟完成。确认选区后开启“应用局部修改”，再点模拟运行。未计算像素遮罩。' };
    return { preview: null, phase: 'complete', resetApply: false,
        message: `已模拟完成效果图建立${snapshot.studio ? '及棚拍流程' : ''}。未生成图片。` };
}

export function createPrototypeQueueHandler(original, getGraph, simulate) {
    return function (...args) {
        const graph = getGraph();
        if (isBadgePrototype(graph)) return simulate(graph);
        return original.apply(this, args);
    };
}
