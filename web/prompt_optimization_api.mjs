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
  const nativeApi = () => globalThis.comfyAPI?.api?.api;
  const fetcher = fetchApi || ((...args) => nativeApi().fetchApi(...args));
  async function call(action, payload = {}, {beforeSend} = {}) {
    const headers = {'Content-Type': 'application/json'};
    let auth;
    if (['advance', 'query', 'recover'].includes(action)) {
      auth = getAuth ? await getAuth() : await nativeOptimizationAuth({required:action==='advance'});
      if (auth?.headers?.Authorization) headers.Authorization=auth.headers.Authorization;
      else if(auth?.headers?.['X-API-Key']) headers['X-API-Key']=auth.headers['X-API-Key'];
      else if (auth?.authToken) headers.Authorization = `Bearer ${auth.authToken}`;
      else if (auth?.apiKey) headers['X-API-Key'] = auth.apiKey;
    }
    auth?.assertCurrent?.();
    if(beforeSend&&beforeSend()===false)throw new Error('当前视图或目标已变化，未发送请求');
    const response = await fetcher(`/daelab/prompt-optimization/${action}`, {
      method: 'POST', headers, body: JSON.stringify({...payload, contractVersion: 1}),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('优化服务响应无效；已有任务请恢复查询'); }
    if (!response.ok || result.error && !result.batchId) throw new Error(result.error || '优化服务暂不可用');
    return result;
  }
  return Object.fromEntries(['capabilities', 'estimate', 'lease', 'submit', 'query', 'recover',
    'permit', 'advance', 'stop', 'continue', 'skip'].map(name => [name, (payload,options) => call(name, payload,options)]));
}
