import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrateBadgeSelection} from '../web/badge_selection_migration.mjs';
import {resolveWorkflowPolygonInfo} from '../web/polygon_mask_state.mjs';
test('brush-only state restores without a polygon',()=>{
    const value=JSON.stringify({polygons:[],brush_strokes:[{diameter:.1,points:[{x:.5,y:.5}]}]});
    assert.equal(resolveWorkflowPolygonInfo({properties:{polygon_info:value}}),value);
});
test('prototype migration preserves geometry and links and is idempotent',()=>{
    const node={id:142,type:'DAELAB.PolygonMaskV1',inputs:[{name:'image',link:7},{name:'text'}],outputs:[{links:[]},{links:[]},{links:[]}],widgets_values:[4,'#FF1744',35,3,'stored','semantic'],properties:{polygon_info:'geometry'}};
    const graph={nodes:[node],extra:{daelabBadgePrototypeV1:{version:1}}};
    assert.equal(migrateBadgeSelection(graph),true);
    assert.equal(node.properties.polygon_info,'geometry');assert.equal(node.inputs[0].link,7);
    assert.equal(node.widgets_values.length,5);assert.equal(node.outputs.length,2);
    assert.equal(migrateBadgeSelection(graph),false);
    const ordinary={nodes:[{...node,type:'DAELAB.PolygonMaskV1'}],extra:{}};
    assert.equal(migrateBadgeSelection(ordinary),false);
});
