import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptOptimizationApi} from '../web/prompt_optimization_api.mjs';

test('native transient account credentials only enter local headers; query is never submit', async()=>{
  const calls=[];
  const api=createPromptOptimizationApi({getAuth:()=>({authToken:'fake-token'}),fetchApi:async(url,opts)=>{
    calls.push({url,...opts}); return {ok:true,json:async()=>({contractVersion:1,batchId:'batch'})};
  }});
  await api.estimate({rows:[]}); await api.query({batchId:'batch'}); await api.advance({permitId:'permit'});
  assert.equal(calls[0].headers.Authorization,undefined);
  assert.equal(calls[1].headers.Authorization,'Bearer fake-token');
  assert.equal(calls[2].headers.Authorization,'Bearer fake-token');
  assert.ok(calls.every(c=>!c.body.includes('fake-token')));
  assert.deepEqual(calls.map(c=>c.url.split('/').at(-1)),['estimate','query','advance']);
  assert.ok(calls.every(c=>JSON.parse(c.body).contractVersion===1));
});

test('a failed POST is surfaced once and never retried implicitly',async()=>{
  let count=0;
  const api=createPromptOptimizationApi({fetchApi:async()=>{count++;return {ok:false,json:async()=>({error:'unknown'})};}});
  await assert.rejects(api.advance({}),/unknown/);
  assert.equal(count,1);
});
