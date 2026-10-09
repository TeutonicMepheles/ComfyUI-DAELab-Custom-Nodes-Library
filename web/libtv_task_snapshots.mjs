// LibTV owns task identity and execution mapping; Canvas only sees tasks v1.
const tasks=new WeakMap();
const value=(node,name)=>node.widgets?.find(w=>w.name===name)?.value;
export function setLibTVTask(node,task){tasks.set(node,{request:value(node,'request_id'),project:value(node,'project_uuid'),...task});}
export function clearLibTVTask(node){tasks.delete(node);}
export function libtvTasks(node){const task=tasks.get(node);return task&&task.request===value(node,'request_id')&&task.project===value(node,'project_uuid')?[{...task}]:[];}
export function batchTask(node,report,live=false){
 const complete=report.phase==='complete',running=report.phase!=='stopped'&&!complete;
 setLibTVTask(node,{id:'libtv-batch',label:'分镜生成',state:complete?'success':running&&live?'running':'recovery',
  done:report.rows.filter(row=>row.phase==='complete').length,total:report.rows.length,countLabel:'已完成',unit:'行',
  detail:complete?'批次完成':running&&live?'当前行生成 / 恢复中':live?'批次暂停 · 待恢复':'待核对原批次',finishedAt:complete&&live?Date.now():undefined});
}
export function updateLibTVExecution(node,event,detail){
 if(!detail)return;
 const previous=tasks.get(node);
 if(event==='executing'){
  if(String(detail.node)!==String(node.id)||!detail.prompt_id)return;
  setLibTVTask(node,{id:'libtv-video',label:'视频生成',state:'running',detail:'等待生成结果',startedAt:Date.now(),elapsed:true,promptId:detail.prompt_id});return;
 }
 if(!previous||previous.promptId!==detail.prompt_id||!libtvTasks(node).length)return;
 if(event==='execution_error'||event==='execution_interrupted')setLibTVTask(node,{...previous,state:event==='execution_error'?'error':'cancelled',detail:event==='execution_error'?'生成失败，请查看执行错误':'执行已取消',finishedAt:Date.now()});
 if(event==='executed'&&String(detail.node)===String(node.id))setLibTVTask(node,{...previous,state:'success',detail:'生成完成',finishedAt:Date.now()});
}
