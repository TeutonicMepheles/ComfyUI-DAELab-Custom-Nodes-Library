import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestForStage, promptForRequest } from '../web/badge_execution_88_model.mjs';
import { requestForStage as request87 } from '../web/badge_execution_87_model.mjs';
import { readHierarchyState, normalizeBadgeAppLayout } from '../web/badge_app_layout_model.mjs';
import { stageNodeIds } from '../web/badge_generation_model.mjs';
import { previewLocalMaterials88 } from '../web/badge_local_material_88_model.mjs';
import { setExistingTarget87 } from '../web/badge_result_target_87.mjs';
import {setLocalTargetSize87} from '../web/badge_refinement_87.mjs';

function fixture(version = '8.8') {
    const graph = JSON.parse(readFileSync(new URL(`../user/default/workflows/%23${version}%20-%20Badge%20Workflow.json`, import.meta.url)));
    graph.getNodeById = id => graph.nodes.find(n => String(n.id) === String(id));
    graph.nodes.forEach(n => { n.mode = 0; });
    const h = readHierarchyState(graph.getNodeById(95));
    graph.getNodeById(95).daelabBooleanHierarchyV1 = {getState: () => h};
    const set = (id, value) => { h.find(i => i.id === id).value = value; };
    for (const [id, value] of [['badge.post.local', true], ['badge.post.local.selection.color', true], ['badge.post.local.selection.polygon', false], ['badge.post.local.material', true], ['badge.post.local.semantic', false]]) set(id, value);
    graph.getNodeById(146).widgets_values_named.image = 'target.png';
    setLocalTargetSize87(graph, 'target.png', 1024, 1024);
    return {graph, set};
}

test('8.8 has separate identity, valid App Mode references and a target-connected list', () => {
    const {graph} = fixture(), old = fixture('8.7').graph;
    assert.notEqual(graph.id, old.id);
    assert.equal(normalizeBadgeAppLayout(graph).ok, true);
    assert.equal(graph.getNodeById(200).type, 'DAELAB.BadgeApp88V1');
    const link = graph.links.find(l => l[0] === graph.getNodeById(201).inputs[0].link);
    assert.deepEqual(link.slice(1), [146, 0, 201, 0, 'IMAGE']);
    assert.equal(old.getNodeById(201), undefined);
});

test('local lists replace inactive single controls and invalidate on material changes', () => {
    const {graph} = fixture();
    assert.deepEqual(stageNodeIds(graph, 'local'), [146, 201]);
    const before = requestForStage(graph, 'local');
    assert.equal(before.request.edit_mode, 'region_materials');
    assert.equal(before.request.material, undefined);
    assert.equal(before.request.colors, undefined);
    const config = JSON.parse(graph.getNodeById(201).widgets_values_named.material_region_config);
    config.groups[0].material_id = 'rhinestone';
    graph.getNodeById(201).widgets_values_named.material_region_config = JSON.stringify(config);
    assert.notEqual(requestForStage(graph, 'local').fingerprint, before.fingerprint);
    graph.getNodeById(104).widgets_values_named.config_json = '{invalid';
    graph.getNodeById(104).mode = graph.getNodeById(106).mode = 4;
    assert.doesNotThrow(() => requestForStage(graph, 'local'));
    graph.getNodeById(201).mode = 4;
    assert.throws(() => requestForStage(graph, 'local'), /跳过/);
});

test('semantic and brush modes retain old inputs; 8.7 never gains multi materials', () => {
    const {graph, set} = fixture();
    const original = graph.getNodeById(201).widgets_values_named.material_region_config;
    set('badge.post.local.material', false); set('badge.post.local.semantic', true);
    assert.deepEqual(stageNodeIds(graph, 'local'), [146, 104, 105]);
    assert.equal(requestForStage(graph, 'local').request.edit_mode, 'semantic');
    set('badge.post.local.material', true); set('badge.post.local.semantic', false);
    set('badge.post.local.selection.color', false); set('badge.post.local.selection.polygon', true);
    assert.deepEqual(stageNodeIds(graph, 'local'), [146, 142, 106]);
    assert.equal(requestForStage(graph, 'local').request.edit_mode, 'material');
    assert.equal(graph.getNodeById(201).widgets_values_named.material_region_config, original);
    assert.equal(request87(fixture('8.7').graph, 'local').request.edit_mode, 'material');
});

test('8.8 queues exactly one executor and uses its own output directory', () => {
    const {graph} = fixture();
    const prompt = promptForRequest(requestForStage(graph, 'local').request);
    assert.equal(prompt[200].class_type, 'DAELAB.BadgeApp88V1');
    assert.equal(prompt[113].inputs.filename_prefix, 'Badge88/local');
    assert.equal(Object.values(prompt).filter(n => n.class_type.startsWith('DAELAB.BadgeApp')).length, 1);
});

test('preview assigns overlaps once, preserves holes and uses target alpha for maps', () => {
    const source = new Uint8ClampedArray([100,0,0,255, 110,0,0,255, 100,0,0,255, 0,0,0,255]);
    const target = new Uint8ClampedArray(source); target[11] = 0;
    const config = {groups: [{id:'a',color:'#640000',threshold:15}, {id:'b',color:'#6e0000',threshold:15}]};
    const values = id => [...previewLocalMaterials88(source,target,config,'mask',id)].filter((_,i) => i % 4 === 0);
    assert.deepEqual(values(null), [255,255,0,0]);
    assert.deepEqual(values('a'), [255,0,0,0]);
    assert.deepEqual(values('b'), [0,255,0,0]);
    config.groups[1].color = '#640000';
    assert.deepEqual(values('b'), [0,0,0,0]);
});

test('map source and replacement participate in validation', () => {
    const {graph, set} = fixture(); set('badge.post.local.color_id_map', true);
    assert.throws(() => requestForStage(graph, 'local'), /色彩分区图/);
    const source = {filename:'target.png',subfolder:'',type:'input'};
    graph.extra.daelabBadgePrototypeV1.gptColorMap = {model:'gpt-image-2.5-sunburst',image:'map.png', source, sourceKey:JSON.stringify(source)};
    const before = requestForStage(graph, 'local');
    graph.extra.daelabBadgePrototypeV1.gptColorMap.image = 'new-map.png';
    assert.notEqual(requestForStage(graph, 'local').fingerprint, before.fingerprint);
});

test('switching target saves separate material drafts and clears generation tokens', () => {
    const {graph} = fixture();
    graph.getNodeById(95).daelabBooleanHierarchyV1.setItemValue = () => {};
    const image = {name:'image',value:'first.png',options:{values:[]}};
    graph.getNodeById(146).widgets = [image];
    const regions = {name:'badge_material_region_v1_panel',value:graph.getNodeById(201).widgets_values_named.material_region_config};
    graph.getNodeById(201).widgets = [regions];
    const first = regions.value, session = {preview:'old',serverToken:'old'};
    setExistingTarget87(graph,'second.png',session);
    assert.notEqual(regions.value,first);
    const second = regions.value;
    assert.equal(session.preview,null); assert.equal(session.serverToken,null);
    setExistingTarget87(graph,'first.png',session);
    assert.equal(regions.value,first);
    setExistingTarget87(graph,'second.png',session);
    assert.equal(regions.value,second);
});
