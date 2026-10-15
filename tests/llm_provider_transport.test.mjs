import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeRow} from '../web/llm_local_provider.mjs';
for(const model of ['qwen','deepseek'])test(`${model} uses the shared real endpoint and preserves result identity`,async()=>{
 let calls=0;
 const row=await optimizeRow({text:'original'},'polish','keep',{model,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'/daelab/prompt-optimization/polish');const body=JSON.parse(options.body);assert.equal(body.model,model);assert.equal(body.source,'original');
  return {ok:true,json:async()=>({requestId:body.requestId,result:'optimized',model})};
 }});
 assert.equal(calls,1);assert.equal(row.result,'optimized');assert.equal(row.model,model);
});
test('failed remote requests are not silently retried or simulated',async()=>{
 let calls=0;
 await assert.rejects(optimizeRow({text:'original'},'polish','',{model:'deepseek',fetcher:async()=>{calls++;return {ok:false,json:async()=>({error:'network unavailable'})};}}),/network unavailable/);
 assert.equal(calls,1);
});
