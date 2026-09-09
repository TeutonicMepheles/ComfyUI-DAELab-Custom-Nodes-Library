const suspended = new WeakMap();
const stages = new WeakMap();
export function getBadgeMediaStage87(graph) { return stages.get(graph) || 'build'; }
function setMode(node, mode) {
    const oldValue = node.mode;
    if (oldValue === mode) return;
    node.mode = mode;
    node.graph?.trigger?.('node:property:changed', {nodeId:node.id, property:'mode', oldValue, newValue:mode});
}
export function scopedBadgeMediaMode87(node, requestedMode) {
    const state = suspended.get(node);
    if (!state) return requestedMode;
    state.mode = requestedMode;
    return 4;
}

// Use native BYPASS so ComfyUI's media scanner ignores future-stage inputs.
// Restore the user's mode on activation and serialize the original mode.
export function syncBadgeMediaScope87(graph, stage) {
    if (graph?.extra?.daelabBadgeExecutionV1?.version !== 1) return;
    if (stage !== undefined) stages.set(graph, stage);
    stage = getBadgeMediaStage87(graph);
    const meta = graph.extra.daelabBadgePrototypeV1;
    const active = new Set(stage === 'local' ? [meta.localReferenceNodeId]
        : stage === 'studio' ? [meta.studioReferenceNodeId] : stage === 'effect' ? [96] : [1, 2]);
    for (const id of [1, 2, 96, meta.localReferenceNodeId, meta.studioReferenceNodeId]) {
        const node = graph.getNodeById(id);
        if (!node) continue;
        let saved = suspended.get(node);
        if (active.has(id)) {
            if (saved) {
                node.onSerialize = saved.onSerialize;
                suspended.delete(node);
                setMode(node, saved.mode);
            }
        } else {
            if (!saved) {
                saved = {mode:node.mode, onSerialize:node.onSerialize};
                suspended.set(node, saved);
                node.onSerialize = function (data, ...args) {
                    const result = saved.onSerialize?.call(this, data, ...args);
                    data.mode = saved.mode;
                    return result;
                };
            } else if (node.mode !== 4) saved.mode = node.mode;
            setMode(node, 4);
        }
    }
}
