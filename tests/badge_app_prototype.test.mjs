import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeBadgeAppLayout, readHierarchyState, getVisibleReferenceSources } from '../web/badge_app_layout_model.mjs';
import { APPLY_ITEM, createPrototypeQueueHandler, isSamePrototype, prototypeSnapshot, simulateRun } from '../web/badge_app_prototype_model.mjs';

const sourceUrl = new URL('../../../user/default/workflows/%238.6%20-%20Badge%20Workflow.json', import.meta.url);
const prototypeUrl = new URL('../user/default/workflows/%238.6-UI%20-%20Badge%20App%20Mode%20Prototype.json', import.meta.url);
function loadGraph() {
    const graph = JSON.parse(readFileSync(prototypeUrl, 'utf8'));
    graph.getNodeById = id => graph.nodes.find(n => String(n.id) === String(id));
    graph._nodes = graph.nodes;
    return graph;
}
test('height is optional only when explicitly disabled in the prototype', () => {
    const graph = loadGraph();
    const initial = prototypeSnapshot(graph).fingerprint;
    graph.getNodeById(2).widgets = [{name:'image', value:''}];
    assert.match(prototypeSnapshot(graph).error, /高度/);
    graph.extra.daelabBadgePrototypeV1.heightEnabled = false;
    assert.equal(prototypeSnapshot(graph).error, '');
    assert.notEqual(prototypeSnapshot(graph).fingerprint, initial);
    graph.getNodeById(1).widgets = [{name:'image', value:''}];
    assert.match(prototypeSnapshot(graph).error, /材质图/);
});
test('prototype has its own identity and only UI, control and plain preview nodes', () => {
    const graph = loadGraph();
    assert.notEqual(graph.id, JSON.parse(readFileSync(sourceUrl)).id);
    const allowed = new Set(['AppModeLoadImage', 'DAELabBadgeHeightLayerV1', 'DAELabMultiColorMaskV1',
        'DAELabBadgeMaterialRegionV1', 'GPTImage2MaterialPrompt', 'BooleanListHierarchy',
        'BooleanListHierarchyGet', 'BooleanGroupBypassController', 'DAELAB.BadgeSelectionMaskV1', 'PrimitiveStringMultiline', 'PreviewImage']);
    for (const node of graph.nodes) assert.ok(allowed.has(node.type), node.type);
    assert.deepEqual(graph.extra.linearData.outputs, ['113']);
    for (const [id, source, slot, target, targetSlot] of graph.links) {
        assert.ok(graph.getNodeById(source).outputs[slot].links.includes(id));
        assert.equal(graph.getNodeById(target).inputs[targetSlot].link, id);
    }
    for (const node of graph.nodes.filter(n => n.type === 'BooleanGroupBypassController')) {
        assert.ok(graph.groups.some(g => g.id === node.properties.target_group_id));
    }
});
test('layout keeps four tabs, 15 scoped inputs and actual uploaded local reference', () => {
    const graph = loadGraph();
    const result = normalizeBadgeAppLayout(graph);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.layout.tabs.map(t => t.inputKeys.length), [1, 7, 5, 2]);
    const references = getVisibleReferenceSources(result.layout, 'local', readHierarchyState(result.layout.stateNode));
    assert.equal(references[0].nodeId, '146');
    const polygon = graph.getNodeById(142);
    const link = graph.links.find(l => l[0] === polygon.inputs[0].link);
    assert.equal(link[1], 146);
    assert.ok(result.layout.referenceSources.every(s => s.kind === 'inputWidget'));
});
test('queue interception applies only to the prototype, forwarding context, arguments and result otherwise', async () => {
    const context = {};
    let graph = { extra: {} };
    let simulations = 0;
    let realCalls = 0;
    const wrapped = createPrototypeQueueHandler(function (...args) {
        assert.equal(this, context); assert.deepEqual(args, [0, 2, [12]]);
        realCalls++; return 'real';
    }, () => graph, () => { simulations++; return 'mock'; });
    assert.equal(wrapped.call(context, 0, 2, [12]), 'real');
    graph = loadGraph();
    assert.equal(wrapped.call(context, 0, 2, [12]), 'mock');
    assert.equal(realCalls, 1); assert.equal(simulations, 1);
});
test('preview precedes confirmation; changed drafts require another preview', () => {
    const snapshot = { fingerprint: 'a', local: true, apply: true };
    assert.equal(simulateRun({}, snapshot).phase, 'needs-preview');
    const preview = simulateRun({}, { ...snapshot, apply: false });
    assert.equal(preview.phase, 'preview-ready');
    assert.equal(simulateRun(preview, snapshot).phase, 'applied');
    assert.equal(simulateRun(preview, { ...snapshot, fingerprint: 'b' }).phase, 'needs-preview');
    assert.equal(simulateRun(preview, { ...snapshot, error: '缺少参考图' }).phase, 'error');
});
test('pending simulation cannot mutate a graph object reused by the source workflow', () => {
    const graph = loadGraph();
    const id = graph.id;
    assert.equal(isSamePrototype(graph, id), true);
    Object.assign(graph, JSON.parse(readFileSync(sourceUrl, 'utf8')));
    assert.equal(isSamePrototype(graph, id), false);
});
test('snapshot distinguishes draft edits from Apply and rejects missing local mode', () => {
    const graph = loadGraph();
    const initial = prototypeSnapshot(graph);
    assert.equal(initial.error, '');
    const control = graph.getNodeById(95);
    const state = readHierarchyState(control);
    control.daelabBooleanHierarchyV1 = { getState: () => state };
    state.find(i => i.id === APPLY_ITEM).value = true;
    assert.equal(prototypeSnapshot(graph).fingerprint, initial.fingerprint);
    state.find(i => i.id === 'badge.post.local').value = true;
    assert.match(prototypeSnapshot(graph).error, /选区/);
    graph.getNodeById(146).widgets_values_named.image = '';
    assert.match(prototypeSnapshot(graph).error, /上传/);
});
