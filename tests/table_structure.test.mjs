import test from 'node:test';
import assert from 'node:assert/strict';
import {moveRows,moveColumn,moveItems} from '../web/table_structure_model.mjs';
import {SnapshotHistory} from '../web/data_table_model.mjs';

test('multi-row moves preserve original order, assets, task metadata and one-step undo',()=>{
    const table={records:['a','b','c','d','e'].map(id=>({id,values:{media:[{id:'asset-'+id}],prompt:{segments:[{type:'ref',field:'media'}]}},meta:{generation:{id:'task-'+id}}}))};
    const before=JSON.stringify(table),objects=[...table.records],history=new SnapshotHistory();
    moveRows(table,['d','b'],'e',true);
    assert.deepEqual(table.records.map(r=>r.id),['a','c','e','b','d']);
    assert.equal(table.records[3],objects[1]);assert.equal(table.records[4],objects[3]);
    history.record(before,JSON.stringify(table));
    assert.deepEqual(history.restore(JSON.stringify(table)),JSON.parse(before));
});

test('column moves retain hidden positions, values and prompt references across serialization',()=>{
    const table={fields:[{id:'a'},{id:'hidden',hidden:true},{id:'b'},{id:'c'}],records:[{id:'r',values:{a:'first',b:[{id:'asset'}],c:{segments:[{type:'ref',field:'b'}]}}}],meta:{prompt_config:{bindings:{final_prompt:'c',image_url:'b'}}}};
    const values=JSON.stringify(table.records),meta=JSON.stringify(table.meta);
    moveColumn(table,'c','a',false);
    assert.deepEqual(table.fields.map(f=>f.id),['c','hidden','a','b']);
    assert.equal(JSON.stringify(table.records),values);assert.equal(JSON.stringify(table.meta),meta);
    assert.deepEqual(JSON.parse(JSON.stringify(table)).records,table.records);
});

test('self targets, removed targets and absent sources do not lose or duplicate items',()=>{
    const items=['a','b','c'].map(id=>({id}));
    for(const [ids,target] of [[['a','b'],'b'],[['a'],'missing'],[['missing'],'c']])assert.deepEqual(moveItems(items,ids,target),items);
    assert.deepEqual(moveItems(items,['a'],null).map(i=>i.id),['b','c','a']);
    assert.deepEqual(moveItems(items,['a','b','c'],null),items);
});
