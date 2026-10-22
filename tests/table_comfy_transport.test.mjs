import test from 'node:test';
import assert from 'node:assert/strict';
import {request,modelCapabilities} from '../web/table_generation_api.mjs';
import {needsGenerationProject,generationInput,addGenerationColumn,recoveryJob} from '../web/table_generation_model.mjs';
import {normalizeTable} from '../web/data_table_model.mjs';

test('new Seedance requests explicitly select Comfy while legacy recovery keeps its route',()=>{
 const table=normalizeTable({fields:[],records:[{id:'one',values:{}}]}),field=addGenerationColumn(table);
 field.generation.model='Seedance 2.5';table.meta.generationProject='old-libtv-canvas';
 table.records[0].values[field.generation.promptFieldId]='orbit';
 const input=generationInput(table,field.id,'one');
 assert.equal(input.config.provider,'comfy');assert.equal(input.project,'');
 assert.equal(needsGenerationProject('Seedance 2.5'),false);
 assert.equal(needsGenerationProject('Seedance 2.0'),true);
 const old={requestId:'legacy',input:{...input,config:{...input.config,provider:undefined},project:'old-libtv-canvas'}};
 assert.equal(recoveryJob(old).input.config.provider,undefined);
 assert.equal(recoveryJob(old).input.project,'old-libtv-canvas');
});

test('Comfy capabilities refuse stale LibTV backend instead of silently switching payment account',async()=>{
 const before=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({schema:{}})});
 try{await assert.rejects(modelCapabilities({model:'Seedance 2.5',kind:'video'}),/未切换至 LibTV/);}
 finally{globalThis.fetch=before;}
});

test('new paid requests require native workspace auth, send it only as headers, and local status remains offline',async()=>{
 const saved={fetch:globalThis.fetch,comfyAPI:globalThis.comfyAPI,version:globalThis.__COMFYUI_FRONTEND_VERSION__};
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options);return {ok:true,status:200,json:async()=>({jobs:[]})};};
 const jobs=[{requestId:'new',input:{config:{model:'Seedance 2.5',provider:'comfy'}}}];
 try{
  delete globalThis.comfyAPI;
  await assert.rejects(request('submit',{jobs}),e=>e.preflightRejected===true);
  assert.equal(calls.length,0);
  const auth={$id:'auth',currentUser:{},currentUserIdentity:()=> 'same-user',getWorkspaceAuthToken:async()=> 'ephemeral-test-token'};
  const workspace={$id:'teamWorkspace',activeWorkspaceId:'workspace-a',workspaceTransitionGeneration:0,waitForWorkspaceSwitch:async()=>{}};
  globalThis.__COMFYUI_FRONTEND_VERSION__='1.52.7';
  globalThis.comfyAPI={app:{app:{extensionManager:{$id:'workspace',_p:{_s:new Map([['auth',auth],['teamWorkspace',workspace]])}}}}};
  await request('submit',{jobs});
  assert.equal(calls[0].headers.Authorization,'Bearer ephemeral-test-token');
  assert.ok(!calls[0].body.includes('ephemeral-test-token'));
  await request('status',{requestIds:['new']});
  await request('submit',{jobs:[{input:{config:{model:'MiniMax H3 FL（本地）'}}}]});
  assert.ok(calls.slice(1).every(c=>!c.headers.Authorization));
 }finally{globalThis.fetch=saved.fetch;globalThis.comfyAPI=saved.comfyAPI;globalThis.__COMFYUI_FRONTEND_VERSION__=saved.version;}
});
