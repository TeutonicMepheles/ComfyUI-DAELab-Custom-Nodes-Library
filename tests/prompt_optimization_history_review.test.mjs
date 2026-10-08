import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveGenerationHistory} from '../web/table_generation_history.mjs';
import {assertTransition} from '../web/script_parser_model.mjs';

test('history preservation cannot remove a generation field while its media request remains active',()=>{
 const current={fields:[{id:'p',type:'text'},{id:'g',type:'content',presentation:'generation'}],records:[{
  id:'r',values:{p:'原提示词',g:[]},meta:{generationColumns:{g:{phase:'running',requestId:'remote',stamp:'frozen',input:{prompt:'原提示词'}}}},
 }],meta:{}};
 // Undoing an older add-column edit would remove both the field and its receipt.
 const old={fields:[{id:'p',type:'text'}],records:[{id:'r',values:{p:'原提示词'},meta:{}}],meta:{}};
 assert.throws(()=>assertTransition(current,preserveGenerationHistory(current,old),{restoring:true}),/任务|生成|字段|列/);
 assert.equal(current.fields.length,2);
});

function legacyTable(phase,text,result=[]){return {fields:[{id:'p',type:'text'},{id:'v',type:'assets',readonly:true},{id:'s',type:'text',readonly:true}],records:[{id:'r',values:{p:text,v:result,s:phase},meta:{generation:{phase,request:'legacy-request'}}}],meta:{storyboard:{bindings:{video_result:'v',generation_status:'s'}}}};}

test('the shared table-history helper preserves legacy results and status during table-local undo',()=>{
 const old=legacyTable('running','原文'),live=legacyTable('complete','新文',[{id:'asset',url:'/view?filename=legacy.mp4'}]);
 const restored=preserveGenerationHistory(live,structuredClone(old));
 assert.equal(restored.records[0].values.p,'原文');assert.equal(restored.records[0].values.s,'complete');
 assert.deepEqual(restored.records[0].values.v,live.records[0].values.v);assert.equal(restored.records[0].meta.generation.phase,'complete');
});

test('legacy active row or bound result field cannot be removed by table-local undo',()=>{
 const live=legacyTable('running','原文');
 for(const target of ['row','field']){const old=structuredClone(live);if(target==='row')old.records=[];else old.fields=old.fields.filter(f=>f.id!=='v');assert.throws(()=>preserveGenerationHistory(live,old),/任务/);}
});
