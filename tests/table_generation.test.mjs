import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable,duplicateSelected} from '../web/data_table_model.mjs';
import {generationReceipt,recoveryJob,addGenerationColumn,enableColumnPrompt,generationRows,generationInput,inputStamp,applyGenerationResult} from '../web/table_generation_model.mjs';
import {resolveColumnPrompt,setColumnTemplate} from '../web/table_prompt_template.mjs';
const fixture=()=>normalizeTable({fields:[{id:'image',type:'content',name:'参考图'}],records:[{id:'a',selected:false,values:{image:[{id:'asset-a',url:'/view?filename=a.png',kind:'image'}]}},{id:'b',selected:false,values:{image:[{id:'asset-b',url:'/view?filename=b.png',kind:'image'}]}}]});
test('generation creates a prompt when absent and preserves explicit selection semantics',()=>{
 const table=fixture(),field=addGenerationColumn(table,{name:'生成'});
 assert.equal(table.fields.find(f=>f.id===field.generation.promptFieldId).presentation,'prompt');
 assert.equal(generationRows(table,field.id).length,2);
 table.records[0].values[field.id]=[{url:'/view?filename=result.png'}];
 assert.deepEqual(generationRows(table,field.id).map(r=>r.id),['b']);
 table.records[0].selected=true;assert.deepEqual(generationRows(table,field.id).map(r=>r.id),['a']);
});
test('column references resolve only same-row media, independent of renaming or row position',()=>{
 const t=fixture(),f=addGenerationColumn(t),p=t.fields.find(p=>p.id===f.generation.promptFieldId);
 p.promptTemplate={kind:'column-template',version:1,segments:[{type:'text',text:'参考 '},{type:'column',fieldId:'image'}]};
 t.records.reverse();t.fields.find(f=>f.id==='image').name='改名';
 assert.equal(generationInput(t,f.id,'a').assets[0].id,'asset-a');
 assert.deepEqual(generationInput(t,f.id,'a').segments,[{type:'text',text:'参考 '},{type:'asset',index:0}]);
 t.records.find(r=>r.id==='a').values.image=[];assert.throws(()=>generationInput(t,f.id,'a'),/缺少参考素材/);
});
test('results match original identity and snapshot; modified prompt never gets overwritten',()=>{
 const t=fixture(),f=addGenerationColumn(t),row=t.records[0];row.values[f.generation.promptFieldId]={kind:'column-template',version:1,segments:[{type:'text',text:'原提示词'}]};
 const input=generationInput(t,f.id,row.id),stamp=inputStamp(input);row.meta={generationColumns:{[f.id]:{requestId:'request',phase:'running'}}};
 row.values[f.generation.promptFieldId].segments[0].text='修改';
 assert.equal(applyGenerationResult(t,f.id,row.id,'request',stamp,{url:'/view?filename=result.png'}),false);
 assert.equal(row.values[f.id].length,0);assert.equal(row.meta.generationColumns[f.id].phase,'stale');
});
test('only completed generation results can be used by downstream column references',()=>{
 const t=fixture(),f=addGenerationColumn(t),row=t.records[0],doc={kind:'column-template',version:1,segments:[{type:'column',fieldId:f.id}]};
 row.values[f.id]=[{id:'result',url:'/view?filename=result.png'}];row.meta={generationColumns:{[f.id]:{phase:'running'}}};
 assert.throws(()=>resolveColumnPrompt(doc,t,row),/尚未完成/);
 row.meta.generationColumns[f.id].phase='complete';assert.equal(resolveColumnPrompt(doc,t,row).assets[0].id,'result');
 const reload=normalizeTable(JSON.stringify(t));assert.equal(resolveColumnPrompt(doc,reload,reload.records[0]).assets[0].id,'result');
});
test('binding existing text preserves values when enabling the shared column prompt editor',()=>{
 const t=normalizeTable({fields:[{id:'p',type:'text',name:'描述'}],records:[{id:'r',values:{p:'保留原文'}}]});
 const f=addGenerationColumn(t);assert.equal(f.generation.promptFieldId,'p');
 enableColumnPrompt(t,'p');assert.equal(generationInput(t,f.id,'r').segments[0].text,'保留原文');
});
test('duplicating records clears job identities and generated outputs',()=>{
 const t=fixture(),f=addGenerationColumn(t),r=t.records[0];r.selected=true;
 r.meta={generationColumns:{[f.id]:{requestId:'paid',phase:'running'}}};r.values[f.id]=[{id:'old-result',url:'/view?filename=old.png'}];
 duplicateSelected(t);assert.equal(t.records[1].meta.generationColumns,undefined);assert.deepEqual(t.records[1].values[f.id],[]);
});
test('renaming a referenced column does not invalidate an in-flight result',()=>{
 const t=fixture(),f=addGenerationColumn(t),p=t.fields.find(p=>p.id===f.generation.promptFieldId),r=t.records[0];
 p.promptTemplate={kind:'column-template',version:1,segments:[{type:'column',fieldId:'image'}]};
 const stamp=inputStamp(generationInput(t,f.id,r.id));r.meta={generationColumns:{[f.id]:{requestId:'job',phase:'running'}}};
 t.fields.find(f=>f.id==='image').name='改名';t.records.reverse();
 assert.equal(applyGenerationResult(t,f.id,r.id,'job',stamp,{url:'/view?filename=result.png'}),true);
 assert.equal(r.meta.generationColumns[f.id].phase,'complete');
});
test('generation templates do not enable the storyboard parsing configuration',()=>{
 const t=fixture(),f=addGenerationColumn(t);
 setColumnTemplate(t,f.generation.promptFieldId,{kind:'column-template',version:1,segments:[{type:'text',text:'直接提交'}]});
 assert.equal(t.meta.prompt_config,undefined);assert.equal(t.meta.prompt_mode,undefined);
 assert.equal(generationInput(t,f.id,'a').segments[0].text,'直接提交');
});

test('replacement intent survives saved receipt and repeated recovery with the same identity',()=>{
 const job={requestId:'replacement-id',input:{prompt:'unchanged'},forceNew:true};
 const saved=JSON.parse(JSON.stringify(generationReceipt(job)));
 const recovered=recoveryJob(saved);
 assert.equal(recovered.forceNew,true);assert.equal(recovered.requestId,job.requestId);
 assert.deepEqual(recoveryJob(generationReceipt(recovered)),recovered);
 assert.equal(recoveryJob({...saved,forceNew:false}).forceNew,false);
});
