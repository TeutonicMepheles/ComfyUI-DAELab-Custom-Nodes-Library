import {optimizationProvider} from './prompt_optimization_model.mjs?v=20261009-progress-r5';

// This module lives only in this page. Never expose the value through state,
// serialized payloads, preferences, storage, or diagnostic messages.
let pageDeepSeekKey='';
const keyListeners=new Set();
const keyChanged=()=>{for(const fn of keyListeners)fn(Boolean(pageDeepSeekKey));};

/** Contract K. Only the native account's transient auth reaches local headers. */
export async function nativeOptimizationAuth({root=globalThis,required=false}={}) {
  try {
  // Frontend 1.52.7 exposes only isLoggedIn on the public extension manager.
  // Its api.authToken is populated ONLY around queuePrompt, then deleted.
  // Keep the version-locked Pinia compatibility seam here; never scrape storage,
  // import hashed chunks, queue a workflow, or persist account credentials.
  const manager=root.comfyAPI?.app?.app?.extensionManager,stores=manager?._p?._s;
  const unsupported=()=>{if(required)throw new Error('当前前端登录接入不可用，请使用已验证的 ComfyUI 前端 1.52.7');return {};};
  if(root.__COMFYUI_FRONTEND_VERSION__!=='1.52.7'||manager?.$id!=='workspace'||typeof stores?.get!=='function')return unsupported();
  const auth=stores.get('auth'),workspace=stores.get('teamWorkspace'),keys=stores.get('apiKeyAuth');
  if(auth?.$id!=='auth'||workspace?.$id!=='teamWorkspace'||typeof auth.getWorkspaceAuthToken!=='function'||typeof auth.currentUserIdentity!=='function'||typeof workspace.waitForWorkspaceSwitch!=='function')return unsupported();
  const identity=auth.currentUserIdentity();
  const sameIdentity=()=>auth.currentUserIdentity()===identity;
  const changed=()=>{throw new Error('登录身份或工作空间已变化，请重新确认后继续');};
  await workspace.waitForWorkspaceSwitch();
  if(!sameIdentity())changed();
  if(auth.currentUser&&!workspace.activeWorkspaceId&&['uninitialized','loading','error'].includes(workspace.initState)) {
    if(typeof workspace.initialize!=='function')return unsupported();
    await workspace.initialize();
    if(!sameIdentity())changed();
  }
  const workspaceId=workspace.activeWorkspaceId,generation=workspace.workspaceTransitionGeneration;
  const assertCurrent=()=>{if(!sameIdentity()||workspace.activeWorkspaceId!==workspaceId||workspace.workspaceTransitionGeneration!==generation)changed();};
  const headers={};
  if(auth.currentUser) {
    const token=await auth.getWorkspaceAuthToken();
    if(token)headers.Authorization=`Bearer ${token}`;
  } else if(keys?.$id==='apiKeyAuth'&&keys.isAuthenticated&&typeof keys.getAuthHeader==='function') {
    const nativeHeaders=keys.getAuthHeader();
    const key=nativeHeaders?.['X-API-KEY'];
    if(key)headers['X-API-Key']=key;
  }
  assertCurrent();
  if(required&&!Object.keys(headers).length)throw new Error('请登录 ComfyUI 账号后继续');
  return {headers,assertCurrent};
  } catch(error) {
    // Ledger recovery remains available offline or after account refresh fails.
    // Without auth the local service cannot poll or submit to the provider.
    if(!required)return {};
    const safe=['当前前端登录接入不可用，请使用已验证的 ComfyUI 前端 1.52.7','登录身份或工作空间已变化，请重新确认后继续','请登录 ComfyUI 账号后继续'];
    throw new Error(safe.includes(error?.message)?error.message:'无法取得当前工作空间的登录授权，请重新登录后继续');
  }
}

export function createPromptOptimizationApi({fetchApi, getAuth} = {}) {
  let serverDeepSeekKeyConfigured=false;
  const batchProviders=new Map();
  const nativeApi = () => globalThis.comfyAPI?.api?.api;
  const fetcher = fetchApi || ((...args) => nativeApi().fetchApi(...args));
  async function call(action, payload = {}, {beforeSend,localOnly=false} = {}) {
    const headers = {'Content-Type': 'application/json'};
    const provider=payload.provider||batchProviders.get(payload.batchId)||optimizationProvider(payload.model);
    let auth;
    if(provider==='deepseek'&&action==='advance'){
      if(!pageDeepSeekKey&&!serverDeepSeekKeyConfigured)throw new Error('请先保存本页 DeepSeek API 密钥，或配置服务器 DEEPSEEK_API_KEY，再点击继续剩余行');
      if(pageDeepSeekKey)headers['X-DAELab-DeepSeek-Key']=pageDeepSeekKey;
    }else if (provider!=='deepseek'&&!localOnly&&['advance', 'query', 'recover'].includes(action)) {
      auth = getAuth ? await getAuth() : await nativeOptimizationAuth({required:action==='advance'});
      if (auth?.headers?.Authorization) headers.Authorization=auth.headers.Authorization;
      else if(auth?.headers?.['X-API-Key']) headers['X-API-Key']=auth.headers['X-API-Key'];
      else if (auth?.authToken) headers.Authorization = `Bearer ${auth.authToken}`;
      else if (auth?.apiKey) headers['X-API-Key'] = auth.apiKey;
    }
    auth?.assertCurrent?.();
    if(beforeSend&&beforeSend()===false)throw new Error('当前视图或目标已变化，未发送请求');
    let response;
    try { response = await fetcher(`/daelab/prompt-optimization/${action}`, {
      method: 'POST', headers, body: JSON.stringify({...payload,...(provider==='deepseek'?{provider}:{}),contractVersion: 1}),
    }); } catch(error) {
      if(provider==='deepseek')throw new Error('DeepSeek 请求连接中断；请查询原任务，不要自动重新提交');
      throw error;
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('优化服务响应无效；已有任务请恢复查询'); }
    if (!response.ok || result.error && !result.batchId) {
      const message=result.error||'优化服务暂不可用';
      throw new Error(pageDeepSeekKey?String(message).replaceAll(pageDeepSeekKey,'[已隐藏]'):message);
    }
    if(action==='capabilities')serverDeepSeekKeyConfigured=Boolean(result.deepseekKeyConfigured);
    if(result.batchId){const model=result.rows?.[0]?.snapshot?.model;if(model)batchProviders.set(result.batchId,optimizationProvider(model));}
    return result;
  }
  return {...Object.fromEntries(['capabilities', 'estimate', 'lease', 'submit', 'query', 'recover',
    'permit', 'advance', 'stop', 'continue', 'skip'].map(name => [name, (payload,options) => call(name, payload,options)])),
    setDeepSeekKey(value){pageDeepSeekKey=String(value||'').trim();keyChanged();return Boolean(pageDeepSeekKey);},
    clearDeepSeekKey(){pageDeepSeekKey='';keyChanged();return false;},
    hasDeepSeekKey:()=>Boolean(pageDeepSeekKey),
    subscribeDeepSeekKey(fn){keyListeners.add(fn);return()=>keyListeners.delete(fn);},
  };
}
