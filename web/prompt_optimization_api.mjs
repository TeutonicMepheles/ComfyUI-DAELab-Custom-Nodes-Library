/** Contract K. Only the native account's transient auth reaches local headers. */
export function createPromptOptimizationApi({fetchApi, getAuth} = {}) {
  const nativeApi = () => globalThis.comfyAPI?.api?.api;
  const fetcher = fetchApi || ((...args) => nativeApi().fetchApi(...args));
  async function call(action, payload = {}) {
    const headers = {'Content-Type': 'application/json'};
    if (['advance', 'query', 'recover'].includes(action)) {
      const auth = getAuth ? await getAuth() : nativeApi();
      if (auth?.authToken) headers.Authorization = `Bearer ${auth.authToken}`;
      else if (auth?.apiKey) headers['X-API-Key'] = auth.apiKey;
    }
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
    'permit', 'advance', 'stop', 'continue', 'skip'].map(name => [name, payload => call(name, payload)]));
}
