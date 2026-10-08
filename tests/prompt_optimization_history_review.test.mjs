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
