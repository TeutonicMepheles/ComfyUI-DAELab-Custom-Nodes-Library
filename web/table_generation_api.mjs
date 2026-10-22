import {isLocalGenerationModel,isComfyGenerationModel} from './table_generation_model.mjs?v=20261022-comfy-seedance';
import {nativeOptimizationAuth} from './prompt_optimization_api.mjs?v=20261022-comfy-auth-r2';

export async function request(action,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='submit'?120000:30000);
 try{
 const headers=body?{'Content-Type':'application/json'}:{};
 if(action==='submit'&&body?.jobs?.some(job=>job.input?.config?.provider==='comfy')){
  try{const auth=await nativeOptimizationAuth({required:true});auth.assertCurrent?.();Object.assign(headers,auth.headers);}
  catch(error){error.preflightRejected=true;throw error;}
 }
 const response=await fetch('/daelab/libtv/table/'+action,{signal:controller.signal,method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
 if(response.status===404)throw new Error('生成服务尚未加载，请重启 ComfyUI 后刷新');
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'生成请求失败');error.preflightRejected=data.submitted===false;throw error;}return data;
 }catch(error){if(error.name==='AbortError')throw new Error('请求超时；原任务仍保留，请刷新任务状态，不要重复生成');throw error;}
 finally{clearTimeout(timer);}
}
export async function modelCapabilities(config){
 const local=isLocalGenerationModel(config.model);
 const restart='本地模型服务尚未加载，请重启 ComfyUI 后刷新页面；本地模型无需 LibTV 画布或登录。';
 try{
  const caps=await request('capabilities?'+new URLSearchParams({kind:config.kind,model:config.model}));
  if(local&&caps.local!==true)throw new Error(restart);
  if(isComfyGenerationModel(config.model)&&caps.provider!=='comfy')throw new Error('Comfy Seedance 接入尚未加载，请重启 ComfyUI 后刷新；未切换至 LibTV');
  return caps;
 }catch(error){if(local&&error.message==='Unsupported model')throw new Error(restart);throw error;}
}
