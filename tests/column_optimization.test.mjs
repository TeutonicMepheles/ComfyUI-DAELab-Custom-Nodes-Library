import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeSnapshot,restoreSuggestion,OptimizationRevisions,QWEN_MODEL,applySuggestions} from '../web/prompt_optimization_model.mjs';
import {createPromptOptimizationApi} from '../web/prompt_optimization_api.mjs';
import {optimizationSummary} from '../web/prompt_optimization_summary.mjs';
import {describeTableSource} from '../web/table_exchange.mjs';

test('generic legacy content text optimizes without claiming the unique prompt role',async()=>{
 const t={fields:[{id:'note',name:'备注',type:'content'},{id:'prompt',name:'提示词',type:'text'}],records:[{id:'r',values:{note:'冗余的备注内容。',prompt:'原提示词'}}],meta:{generationInput:{version:1,promptFieldId:'prompt'}}};
 const identity={documentId:'doc',tableId:'table'},revisions=new OptimizationRevisions();
 const frozen=await freezeSnapshot(t,{...identity,recordId:'r',fieldId:'note'},revisions,{model:QWEN_MODEL,begin:true});
 const suggestion=restoreSuggestion(frozen,'简洁备注。');let history=0;
 applySuggestions({table:t,identity,revisions,items:[{requestId:'request',frozen,suggestion}],change:fn=>{history++;fn(t);}});
 assert.equal(history,1);assert.equal(t.records[0].values.note,'简洁备注。');assert.equal(t.records[0].values.prompt,'原提示词');assert.equal(t.meta.generationInput.promptFieldId,'prompt');
 t.fields[0].readonly=true;await assert.rejects(()=>freezeSnapshot(t,{...identity,recordId:'r',fieldId:'note'},revisions),/上游/);
});
test('local API never reads or forwards either cloud credential, including recovery',async()=>{
 const calls=[];const api=createPromptOptimizationApi({getAuth:()=>{throw new Error('Native auth forbidden');},fetchApi:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({batchId:'batch',rows:[{snapshot:{model:QWEN_MODEL}}]})};}});
 api.setDeepSeekKey('dummy-private-key');await api.advance({provider:'qwen',batchId:'batch'});await api.query({batchId:'batch'});await api.recover({batchId:'batch'});api.clearDeepSeekKey();
 assert.equal(calls.length,3);for(const call of calls){assert.deepEqual(call.headers,{'Content-Type':'application/json'});assert(!call.body.includes('dummy-private-key'));}
});
test('aggregate progress separates failures, skipped and stale from completed success',()=>{
 const state={range:{total:6,skipped:[{recordId:'empty'}]},rows:[{recordId:'a',status:'succeeded',suggestionStatus:'valid',canApply:true},{recordId:'b',status:'failed'},{recordId:'c',status:'succeeded',suggestionStatus:'invalid'},{recordId:'d',status:'unknown'},{recordId:'e',status:'succeeded',suggestionStatus:'stale'}]};
 const s=optimizationSummary(state);assert.deepEqual([s.total,s.completed,s.failed,s.skipped,s.stale,s.unknown,s.valid,s.percent],[6,2,2,1,1,1,1,100]);
});
test('disconnected synchronized column retains recorded upstream identity and disables navigation',()=>{
 const source=describeTableSource({inputs:[],graph:{links:{},getNodeById(){}}},{fields:[{id:'view',name:'画面'}],meta:{liveSource:{fields:{view:'scene'},origin:{nodeId:12,title:'分镜解析'}}}},'view');
 assert.equal(source.title,'分镜解析');assert.equal(source.fieldId,'scene');assert.equal(source.available,false);assert.match(source.reason,/断开/);
});

test('system readonly fields do not invent a disconnected upstream source',()=>{
 const source=describeTableSource({inputs:[]},{fields:[{id:'issues',readonly:true}],meta:{}},'issues');
 assert.equal(source.synchronized,false);assert.equal(source.available,false);assert.match(source.reason,/系统维护/);assert.equal(source.nodeId,undefined);
});
