// Business-owned mapping to the optional Canvas tasks v1 protocol.
// No Canvas imports, DOM, polling, requests, or task execution.
import {optimizationStatus} from './prompt_optimization_status.mjs';
const active=new Set(['waiting','running','pausing']);
const stages={local_queued:'本机排队',local_generating:'本机生成',preparing:'准备中',submitting:'提交平台',writing_back:'等待写回',verifying:'核对原任务',downloading:'下载中',generating:'平台生成'};
export function generationTaskSnapshots(table,live=new Map()){
 const groups=new Map();
 for(const field of table.fields.filter(f=>f.presentation==='generation')){
  for(const row of table.records){const receipt=row.meta?.generationColumns?.[field.id];if(!receipt?.requestId)continue;
   const report=live.get(receipt.requestId),config=report?.input?.config||receipt.input?.config||row.meta?.generationSettings?.[field.generation?.promptFieldId]?.[field.id]||field.generation;
   const kind=config?.kind==='video'?'video':'image',list=groups.get(kind)||[];list.push({...receipt,...report,phase:receipt.phase==='stale'?'stale':report?.phase||receipt.phase,unverified:!report&&active.has(receipt.phase)});groups.set(kind,list);}
 }
 return [...groups].map(([kind,rows])=>{
  const running=rows.filter(r=>active.has(r.phase)),failed=rows.filter(r=>['failed','needs_input','needs_recovery'].includes(r.phase)||r.error),paused=rows.filter(r=>['paused','stopped'].includes(r.phase));
  const current=running.find(r=>r.phase==='running')||running[0],done=rows.filter(r=>r.phase==='complete').length;
  const state=running.length?(running.every(r=>r.phase==='waiting'||r.unverified)?'queued':'running'):failed.length?'recovery':paused.length?'paused':rows.some(r=>r.phase==='stale')?'recovery':'success';
  const detail=current?(current.unverified?'核对任务状态':current.phase==='pausing'?'正在暂停':stages[current.stage]||(current.phase==='waiting'?'等待提交':'启动中')):state==='paused'?'已暂停':state==='recovery'?'部分任务待处理':'生成完成';
  return {id:'generation:'+kind,label:kind==='image'?'图片生成':'视频生成',order:kind==='image'?20:30,state,done,total:rows.length,countLabel:'已完成',unit:'行',
   detail:detail+(running.length>1?` · 处理中 ${running.length} 行`:'')+(failed.length?` · 异常 ${failed.length} 行`:''),
   progress:running.length===1&&current?.stage==='generating'&&Number.isFinite(current.progress)?current.progress:undefined};
 });
}
export function optimizationTaskSnapshots(states){
 const present=states.filter(s=>s.batchId||s.requestActivity||s.operationName==='submit');if(!present.length)return [];
 const rows=[...new Map(present.flatMap(s=>s.rows||[]).filter(r=>r.requestId).map(r=>[r.requestId,r])).values()];
 const views=present.map(s=>optimizationStatus(s)),current=views.find(v=>['running','submit','recover','stop','continue','apply'].includes(v.phase));
 const ended=rows.filter(r=>['succeeded','failed','skipped','stopped','unknown'].includes(r.status)).length;
 const attention=views.find(v=>['disconnected','unknown','attention','error','acknowledge'].includes(v.phase));
 const paused=views.find(v=>['paused','stopped'].includes(v.phase));
 const state=current?'running':views.some(v=>v.phase==='queued')?'queued':attention?'recovery':paused?'paused':'success';
 const request=present.find(s=>s.requestActivity)?.requestActivity;
 return [{id:'prompt-optimization',label:'提示词优化',order:10,state,done:ended,total:rows.length,countLabel:'已结束',unit:'行',
  detail:current?(request?.phase==='request'?'等待模型响应':current.title):attention?.title||paused?.title||(state==='queued'?'等待提交':'优化完成'),
  startedAt:request?.startedAt,elapsed:Boolean(request)}];
}
// Only announce a completion observed in this live owner. Historical successes
// never reappear after workflow reload; timestamps are not serialized.
export function trackTaskCompletion(read){
 const previous=new Map();
 return ()=>read().map(task=>{
  const old=previous.get(task.id);let finishedAt=task.finishedAt;
  if(task.state==='success')finishedAt??=old?.state==='success'?old.finishedAt:old?Date.now():undefined;
  const next={...task,finishedAt};previous.set(task.id,next);return next;
 });
}
