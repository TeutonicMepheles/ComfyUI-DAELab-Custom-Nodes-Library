import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptEditor} from '../web/table_prompt_editor.mjs';
import {newStoryboardTable,importRows} from '../web/storyboard_table_adapter.mjs';

// Parsing owns no DOM beyond its style and hover cleanup in these scenarios.
function fixture(request) {
    globalThis.document={createElement:()=>({remove(){}}),head:{append(){}},querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
    const table=newStoryboardTable();importRows(table,{shots:[{id:'r',image_prompt:'scene'}]},'append');
    const states=[];
    const panel=createPromptEditor({getTable:()=>table,editor:{change:fn=>fn(table)},request,notify(){},onStatus:s=>states.push(s)});
    return {panel,states};
}
test('one table cannot submit overlapping parses and retains completion feedback',async()=>{
    let resolve,calls=0;
    const {panel,states}=fixture(()=>{calls++;return new Promise(r=>resolve=r);});
    const pending=panel.parse(['r']);await panel.parse(['r']);
    assert.equal(calls,1);assert.equal(states.at(-1).busy,true);
    resolve({results:[]});await pending;
    assert.equal(states.at(-1).busy,false);assert.match(states.at(-1).message,/解析完成/);
    panel.destroy();
});
test('failed parse clears busy feedback and permits retry',async()=>{
    let calls=0;const {panel,states}=fixture(async()=>{calls++;throw Error('offline');});
    await panel.parse(['r']);await panel.parse(['r']);
    assert.equal(calls,2);assert.deepEqual(states.at(-1),{busy:false,error:true,message:'offline'});panel.destroy();
});
test('destroyed table does not receive late completion feedback',async()=>{
    let resolve;const {panel,states}=fixture(()=>new Promise(r=>resolve=r));
    const pending=panel.parse(['r']);panel.destroy();const count=states.length;
    resolve({results:[]});await pending;assert.equal(states.length,count);
});
