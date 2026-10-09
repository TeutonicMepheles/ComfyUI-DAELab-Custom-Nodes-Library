import test from 'node:test';
import assert from 'node:assert/strict';
import {generationTaskSnapshots,optimizationTaskSnapshots,trackTaskCompletion} from '../web/task_snapshots.mjs';
import {updateLibTVExecution,libtvTasks,batchTask} from '../web/libtv_task_snapshots.mjs';
const table={fields:[{id:'i',presentation:'generation',generation:{kind:'image'}},{id:'v',presentation:'generation',generation:{kind:'video'}}],records:[{meta:{generationColumns:{i:{requestId:'i1',phase:'running'},v:{requestId:'v1',phase:'paused'}}}},{meta:{generationColumns:{i:{requestId:'i2',phase:'complete'}}}}]};
test('business groups image/video separately, excludes unrelated rows and reports true platform progress',()=>{
 const result=generationTaskSnapshots(table,new Map([['i1',{stage:'generating',progress:42}]]));assert.equal(result.length,2);assert.equal(result[0].done,1);assert.equal(result[0].total,2);assert.equal(result[0].progress,42);assert.equal(result[1].state,'paused');
});
test('multiple in-flight rows never present a single row percentage as the group percentage',()=>{
 const t=structuredClone(table);t.records[1].meta.generationColumns.i.phase='running';const result=generationTaskSnapshots(t,new Map([['i1',{stage:'generating',progress:42}]]));assert.equal(result[0].progress,undefined);
});
test('optimization counts ended rather than successful rows and combines active targets',()=>{
 const result=optimizationTaskSnapshots([{batchId:'a',rows:[{requestId:'1',status:'failed'},{requestId:'2',status:'polling'}],requestActivity:{phase:'request',startedAt:1000}}]);assert.equal(result[0].done,1);assert.equal(result[0].total,2);assert.equal(result[0].countLabel,'已结束');assert.equal(result[0].progress,undefined);assert.equal(result[0].state,'running');assert.deepEqual(optimizationTaskSnapshots([{rows:[]}]),[]);
});
test('historical success is quiet, live completion is timed and isolated',()=>{
 let state='success';const one=trackTaskCompletion(()=>[{id:'x',state}]),two=trackTaskCompletion(()=>[{id:'x',state:'success'}]);assert.equal(one()[0].finishedAt,undefined);state='running';one();state='success';assert.equal(typeof one()[0].finishedAt,'number');assert.equal(two()[0].finishedAt,undefined);
});
const node=id=>({id,widgets:[{name:'request_id',value:'request'},{name:'project_uuid',value:'project'}]});
test('receipt kind wins over changed column defaults and unverified running stays queued',()=>{
 const t=structuredClone(table);t.records[0].meta.generationColumns.i.input={config:{kind:'video'}};
 const result=generationTaskSnapshots(t);assert.equal(result.find(t=>t.id==='generation:video').total,2);assert.equal(result.find(t=>t.id==='generation:video').state,'queued');
});
test('LibTV event receipts reject another prompt, node and changed request identity',()=>{
 const a=node(1),b=node(2);updateLibTVExecution(a,'executing',{node:1,prompt_id:'p'});updateLibTVExecution(b,'executing',{node:1,prompt_id:'p'});assert.equal(libtvTasks(b).length,0);
 updateLibTVExecution(a,'executed',{node:1,prompt_id:'old'});assert.equal(libtvTasks(a)[0].state,'running');updateLibTVExecution(a,'executed',{node:1,prompt_id:'p'});assert.equal(libtvTasks(a)[0].state,'success');a.widgets[0].value='new';assert.equal(libtvTasks(a).length,0);
});
test('LibTV saved running report needs verification, not a fabricated live task',()=>{
 const a=node(1);batchTask(a,{phase:'running',rows:[{phase:'running'}]});assert.equal(libtvTasks(a)[0].state,'recovery');batchTask(a,{phase:'running',rows:[{phase:'running'}]},true);assert.equal(libtvTasks(a)[0].state,'running');
});
