import test from 'node:test';
import assert from 'node:assert/strict';
import {applyIOResult,undoIOResult,outputTable} from '../web/llm_io_model.mjs';
const proposal=()=>({requestId:'real-1',complete:true,signature:'inputs',provider:'qwen',rows:[{id:'a',index:1,text:'original',result:'optimized',status:'completed'}]});
test('real result requires explicit apply; undo survives serialization and never edits inputs',()=>{
 const s={source:'original',ioResult:proposal()};assert.equal(s.appliedIO,undefined);
 assert.equal(applyIOResult(s,'inputs'),true);assert.equal(s.source,'original');assert.equal(applyIOResult(s,'inputs'),false);
 const restored=JSON.parse(JSON.stringify(s));assert.equal(undoIOResult(restored),true);assert.equal(restored.appliedIO,null);assert.equal(restored.source,'original');
});
test('partial and obsolete proposals cannot replace previously applied output',()=>{
 const s={ioResult:proposal(),appliedIO:{requestId:'old'}};
 assert.equal(applyIOResult(s,'changed'),false);s.ioResult.complete=false;assert.equal(applyIOResult(s,'inputs'),false);assert.equal(s.appliedIO.requestId,'old');
});
test('real table exports identify the provider and preserve original input',()=>{
 const table=outputTable(proposal().rows,'polish','keep','qwen');assert.equal(table.meta.llmIO.provider,'qwen');assert.equal(table.fields[1].name,'文本 · 优化结果');assert.equal(table.records[0].meta.llmIO.originalText,'original');
});

test('reactive proxy proposals can be applied without structuredClone',()=>{const s={ioResult:new Proxy(proposal(),{})};assert.equal(applyIOResult(s,'inputs'),true);assert.equal(s.appliedIO.rows[0].result,'optimized');});
