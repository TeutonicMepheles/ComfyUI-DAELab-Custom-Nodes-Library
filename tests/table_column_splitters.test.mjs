import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeColumnPair,swapColumns} from '../web/table_column_splitters.mjs';

test('splitter conserves pair width and clamps both columns to persisted limits',()=>{
    assert.deepEqual(resizeColumnPair(180,240,35),[215,205]);
    assert.deepEqual(resizeColumnPair(580,130,200),[600,110]);
    assert.deepEqual(resizeColumnPair(120,590,-200),[110,600]);
    assert.deepEqual(resizeColumnPair(100,100,100),[100,100]);
    for(const delta of [-10000,-60,0,70,10000]){
        const widths=resizeColumnPair(230,440,delta);
        assert.equal(widths[0]+widths[1],670);
        assert(widths.every(w=>w>=100&&w<=600));
    }
});

test('swapping visible neighbors preserves hidden positions, values and stable field bindings',()=>{
    const table={fields:[{id:'a',width:180},{id:'hidden',hidden:true},{id:'b',width:240}],records:[{values:{a:'Prompt',b:[{id:'asset-1',url:'/view?filename=a.png'}]}}],meta:{prompt_config:{bindings:{image_prompt:'a',image_url:'b'}}}};
    const original=structuredClone(table);
    swapColumns(table,'a','b');
    assert.deepEqual(table.fields.map(f=>f.id),['b','hidden','a']);
    assert.deepEqual(table.records,original.records);assert.deepEqual(table.meta,original.meta);
    assert.equal(table.fields[0].width,240);
    swapColumns(table,'b','a');assert.deepEqual(table,original);
    swapColumns(table,'absent','a');assert.deepEqual(table,original);
});
