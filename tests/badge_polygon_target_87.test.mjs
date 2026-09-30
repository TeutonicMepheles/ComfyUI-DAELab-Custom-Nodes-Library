import test from 'node:test';
import assert from 'node:assert/strict';
import {syncPolygonTarget87} from '../web/badge_polygon_target_87.mjs';

function fixture() {
    const source = {id:146,type:'LoadImage',widgets:[{name:'image',value:'new.png'}]};
    const drawing = {image:{}, imageValue:'load-image:146:old.png',loadToken:4,
        polygons:[{points:[]}],brushStrokes:[{}]};
    const calls = [];
    const node = {inputs:[{name:'image',link:1}],polygonWidget:drawing,properties:{},
        loadConnectedLoadImage:info=>calls.push(info.imageValue)};
    const graph = {extra:{daelabBadgeExecutionV1:{version:1}},links:{1:{origin_id:146}},
        getNodeById:id=>id===142?node:source};
    return {graph,source,node,drawing,calls};
}
test('target changes load automatically once and invalidate both selection types',()=>{
    const {graph,source,drawing,calls}=fixture();
    assert.equal(syncPolygonTarget87(graph),true);
    assert.deepEqual(calls,['new.png']);
    assert.equal(drawing.image,null);
    assert.deepEqual(drawing.polygons,[]);
    assert.deepEqual(drawing.brushStrokes,[]);
    assert.equal(drawing.loadToken,5);
    assert.equal(syncPolygonTarget87(graph),false);
    source.widgets[0].value='next.png';
    syncPolygonTarget87(graph);
    assert.equal(drawing.loadToken,6);
    assert.deepEqual(calls,['new.png','next.png']);
    source.widgets[0].value='';
    syncPolygonTarget87(graph);
    assert.equal(drawing.loadToken,7);
    assert.equal(drawing.image,null);
});
test('matching loaded image preserves selections on remount; #8.6 is unchanged',()=>{
    const {graph,source,drawing,calls}=fixture();
    source.widgets[0].value='old.png';
    assert.equal(syncPolygonTarget87(graph),false);
    assert.equal(drawing.brushStrokes.length,1);
    source.widgets[0].value='next.png';
    delete graph.extra.daelabBadgeExecutionV1;
    assert.equal(syncPolygonTarget87(graph),false);
    assert.deepEqual(calls,[]);
});
test('late widget initialization loads once it becomes available',()=>{
    const {graph,node,drawing,calls}=fixture();
    delete node.polygonWidget;
    assert.equal(syncPolygonTarget87(graph),false);
    node.polygonWidget=drawing;
    syncPolygonTarget87(graph);
    assert.deepEqual(calls,['new.png']);
});
