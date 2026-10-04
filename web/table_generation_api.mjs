import {LOCAL_VIDEO_MODEL} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';

export async function request(action,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='submit'?120000:30000);
 try{
 const response=await fetch('/daelab/libtv/table/'+action,{signal:controller.signal,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 if(response.status===404)throw new Error('生成服务尚未加载，请重启 ComfyUI 后刷新');
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'生成请求失败');error.preflightRejected=data.submitted===false;throw error;}return data;
 }catch(error){if(error.name==='AbortError')throw new Error('请求超时；原任务仍保留，请刷新任务状态，不要重复生成');throw error;}
 finally{clearTimeout(timer);}
}
export async function modelCapabilities(config){
 const local=config.model===LOCAL_VIDEO_MODEL;
 const restart='本地模型服务尚未加载，请重启 ComfyUI 后刷新页面；本地模型无需 LibTV 画布或登录。';
 try{
  const caps=await request('capabilities?'+new URLSearchParams({kind:config.kind,model:config.model}));
  if(local&&caps.local!==true)throw new Error(restart);
  return caps;
 }catch(error){if(local&&error.message==='Unsupported model')throw new Error(restart);throw error;}
}
