import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptOptimizationApi,nativeOptimizationAuth} from '../web/prompt_optimization_api.mjs';

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
  const api=createPromptOptimizationApi({getAuth:()=>({authToken:'fake-token'}),fetchApi:async()=>{count++;return {ok:false,json:async()=>({error:'unknown'})};}});
  await assert.rejects(api.advance({}),/unknown/);
  assert.equal(count,1);
});

function nativeAccount(){
  const auth={$id:'auth',currentUser:{uid:'user-a'},currentUserIdentity:()=>auth.currentUser?.uid||keys.key,getWorkspaceAuthToken:async()=> 'workspace-token'};
  const workspace={$id:'teamWorkspace',initState:'ready',activeWorkspaceId:'workspace-a',workspaceTransitionGeneration:1,waitForWorkspaceSwitch:async()=>{}};
  const keys={$id:'apiKeyAuth',isAuthenticated:true,key:'old-api-key',getAuthHeader:()=>({'X-API-KEY':keys.key})};
  const root={__COMFYUI_FRONTEND_VERSION__:'1.52.7',comfyAPI:{app:{app:{extensionManager:{$id:'workspace',_p:{_s:new Map([['auth',auth],['teamWorkspace',workspace],['apiKeyAuth',keys]])}}}},api:{api:{}}}};
  return {root,auth,workspace,keys};
}

test('logged-in native account works without queuePrompt transient credentials',async()=>{
  const {root}=nativeAccount(),calls=[];
  const api=createPromptOptimizationApi({getAuth:()=>nativeOptimizationAuth({root,required:true}),fetchApi:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({batchId:'b'})};}});
  await api.advance({permitId:'p'});
  assert.equal(root.comfyAPI.api.api.authToken,undefined);
  assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer workspace-token');
  assert.equal(calls[0].headers['X-API-Key'],undefined);
  assert.ok(!calls[0].body.includes('workspace-token'));
});

test('native account initializes its workspace before obtaining the workspace token',async()=>{
  const {root,auth,workspace}=nativeAccount(),steps=[];
  workspace.activeWorkspaceId=null;workspace.initState='uninitialized';
  workspace.initialize=async()=>{steps.push('initialize');workspace.activeWorkspaceId='workspace-a';workspace.workspaceTransitionGeneration++;};
  auth.getWorkspaceAuthToken=async()=>{assert.equal(workspace.activeWorkspaceId,'workspace-a');steps.push('token');return 'workspace-token';};
  await nativeOptimizationAuth({root,required:true});assert.deepEqual(steps,['initialize','token']);
});

test('identity and workspace changes during token refresh prevent any request',async()=>{
  for(const change of [({auth})=>auth.currentUser={uid:'user-b'},({workspace})=>workspace.workspaceTransitionGeneration++]){
    const account=nativeAccount();let sends=0;
    account.auth.getWorkspaceAuthToken=async()=>{change(account);return 'obsolete-token';};
    const api=createPromptOptimizationApi({getAuth:()=>nativeOptimizationAuth({root:account.root,required:true}),fetchApi:async()=>{sends++;}});
    await assert.rejects(api.advance({}),/登录身份或工作空间已变化/);assert.equal(sends,0);
  }
});

test('Firebase token failure never falls back to a stored API key',async()=>{
  const {root,auth,keys}=nativeAccount();let keyReads=0;
  auth.getWorkspaceAuthToken=async()=>undefined;keys.getAuthHeader=()=>{keyReads++;return {'X-API-KEY':'wrong-account'};};
  await assert.rejects(nativeOptimizationAuth({root,required:true}),/请登录/);assert.equal(keyReads,0);
});

test('native API-key-only account stays in local headers and detects key replacement',async()=>{
  const {root,auth,keys}=nativeAccount();auth.currentUser=null;
  const result=await nativeOptimizationAuth({root,required:true});
  assert.deepEqual(result.headers,{'X-API-Key':'old-api-key'});
  keys.key='another-key';assert.throws(result.assertCurrent,/登录身份或工作空间已变化/);
});

test('unsupported native auth shape or version fails closed for advance but permits ledger reads',async()=>{
  const {root}=nativeAccount();root.__COMFYUI_FRONTEND_VERSION__='other';
  await assert.rejects(nativeOptimizationAuth({root,required:true}),/前端登录接入不可用/);
  assert.deepEqual(await nativeOptimizationAuth({root}),{});
});

test('closing or editing while native auth awaits stops advance before local fetch',async()=>{
  let finish,sends=0,current=true;
  const api=createPromptOptimizationApi({getAuth:()=>new Promise(resolve=>{finish=resolve;}),fetchApi:async()=>{sends++;}});
  const pending=api.advance({permitId:'p'},{beforeSend:()=>current});
  current=false;finish({authToken:'fake-token'});
  await assert.rejects(pending,/当前视图或目标已变化/);assert.equal(sends,0);
});

test('native auth errors cannot expose credential-bearing native diagnostic text',async()=>{
  const {root,auth}=nativeAccount();auth.getWorkspaceAuthToken=async()=>{throw new Error('secret-token-in-native-error');};
  await assert.rejects(nativeOptimizationAuth({root,required:true}),e=>e.message.includes('无法取得')&&!e.message.includes('secret-token'));
});

test('failed account refresh still allows local query and recover without credentials',async()=>{
  for(const action of ['query','recover']){
    const {root,auth}=nativeAccount(),calls=[];
    auth.getWorkspaceAuthToken=async()=>{throw new Error('secret-refresh-failure');};
    const api=createPromptOptimizationApi({getAuth:()=>nativeOptimizationAuth({root}),fetchApi:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({batchId:'saved-batch'})};}});
    assert.equal((await api[action]({batchId:'saved-batch'})).batchId,'saved-batch');
    assert.equal(calls.length,1);assert.deepEqual(calls[0].headers,{'Content-Type':'application/json'});
    assert.ok(!JSON.stringify(calls).includes('secret-refresh-failure'));
    await assert.rejects(nativeOptimizationAuth({root,required:true}),/无法取得/);
  }
});
