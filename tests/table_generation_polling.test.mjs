import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGenerationTasks} from '../web/table_generation_tasks.mjs';

test('synchronized and orphaned receipts never poll or create history edits; owning columns still recover',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const calls=[],table={fields:[{id:'copy',presentation:'generation',readonly:true},{id:'owned',presentation:'generation',readonly:true}],meta:{liveSource:{fields:{copy:'upstream'}}},records:[{id:'r',values:{},meta:{generationColumns:{orphan:{phase:'complete',requestId:'upstream-missing'},copy:{phase:'running',requestId:'upstream-copy'},owned:{phase:'running',requestId:'own'}}}}]};
 t.mock.method(globalThis,'fetch',async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({jobs:[]})};});
 let edits=0;const tasks=attachGenerationTasks({getTable:()=>table,editor:{root:{querySelectorAll:()=>[]},change(){edits++;}},notify(){}});t.after(()=>tasks.destroy());
 t.mock.timers.tick(3000);await new Promise(setImmediate);
 assert.deepEqual(calls,[{requestIds:['own']}]);assert.equal(edits,0);
 table.fields=table.fields.filter(f=>f.id!=='owned');t.mock.timers.tick(3000);await new Promise(setImmediate);
 assert.equal(calls.length,1);assert.equal(edits,0);assert.equal(table.records[0].meta.generationColumns.orphan.phase,'complete');
});
