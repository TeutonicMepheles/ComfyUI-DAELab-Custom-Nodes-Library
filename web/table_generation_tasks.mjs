import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261008-deepseek-api-r3';
import {request,modelCapabilities} from './table_generation_api.mjs?v=20261002-table-module-responsibilities';
import {generationReportNeedsApply,generationReceipt,recoveryJob,LOCAL_VIDEO_MODEL,isGeneration,generationRows,generationInput,applyGenerationResult,appendGenerationResult} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
const phaseNames={waiting:'等待提交',running:'生成中',pausing:'暂停中',paused:'已暂停',stopped:'已停止后续提交',failed:'生成失败',needs_input:'待补充',needs_recovery:'待恢复',complete:'已完成',stale:'输入已变化'};
const stageNames={local_queued:'本机排队',local_generating:'本机生成',preparing:'准备中',submitting:'提交平台',writing_back:'等待写回',verifying:'核对原任务',downloading:'下载中'};
export function stageText(report,phase){
 if(phase==='pausing')return '正在中断本地任务';
 if(phase==='waiting'||!report?.stage)return phase==='running'?'启动中':'排队中';
 if(report.stage==='generating')return Number.isFinite(report.progress)?`平台生成 ${report.progress}%`:'平台生成';
 return stageNames[report.stage]||'生成中';
}
export function liveLabel(report,phase,now=Date.now()){
 const age=report?.updatedAt?Math.max(0,Math.round((now-report.updatedAt)/1000)):null;
 return [stageText(report,phase),report?.taskId&&'任务 '+report.taskId,report?.detail,age!==null&&`最近确认 ${age} 秒前`].filter(Boolean).join(' · ');
}
export const generationTaskStyle=`
.dae-ui .generation-cell-state{position:absolute;right:8px;top:8px;z-index:3;display:flex;gap:4px;align-items:center;width:max-content;padding:4px;border-radius:22px;background:var(--dae-surface,#242424);color:var(--dae-text,#fff);box-shadow:0 1px 5px #0005}
.dae-ui .generation-cell-state :is(button,.generation-state-icon){display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;padding:6px!important;border:0!important;border-radius:50%!important;background:transparent!important}
.dae-ui .generation-cell-state button:is(:hover,:focus-visible){background:var(--dae-surface-high,#383838)!important}
.dae-ui .generation-cell-state .dae-table-icon{display:block;width:20px;height:20px;background:currentColor;mask:var(--table-icon) center/contain no-repeat}
.dae-ui .generation-cell-state[data-error=true]{color:var(--dae-error,#ffb4ab)}
.dae-ui .generation-cell-state[data-phase=complete] .generation-state-icon{color:var(--dae-success,#98d7ad)}
.dae-ui .generation-cell-state{max-width:calc(100% - 16px);box-sizing:border-box}
.dae-ui .generation-stage{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 8px 0 2px;font:500 12px/1.5 var(--dae-font-family,inherit);font-variant-numeric:tabular-nums}
.dae-ui .generation-progress{flex:none;margin-left:6px;box-sizing:border-box;width:20px;height:20px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dae-generation-spin 1s linear infinite}
@keyframes dae-generation-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dae-ui .generation-progress{animation:none;border-style:dashed}}
`;

export function attachGenerationTasks({editor,getTable,notify,prepareGeneration,getConfig}){
 let alive=true,polling=false,submitting=false,epoch=0,lastCompletedCheck=0;
 const live=new Map();
 async function generate(fieldId,recordId=null,recover=false,fresh=false){
  if(!alive||submitting)return;const captured=epoch;submitting=true;decorate();
  try{
   if(!recover)await prepareGeneration(fieldId,recordId);
   if(!alive||captured!==epoch)return;
   const table=getTable(),rows=recordId?table.records.filter(r=>r.id===recordId):generationRows(table,fieldId),jobs=[];
   for(const row of rows){
    const old=row.meta?.generationColumns?.[fieldId];
    if(['running','waiting','pausing'].includes(old?.phase))continue;
    if(!fresh&&(recover||['needs_recovery','stopped','paused'].includes(old?.phase))){
     if(!old?.input)throw new Error('原任务快照缺失');jobs.push(recoveryJob(old));continue;
    }
    // An abandoned original shares the input fingerprint; forceNew prevents reusing it.
    try{const input=generationInput(table,fieldId,row.id);if(input.config.model!==LOCAL_VIDEO_MODEL&&!input.project)throw new Error('请先在生成配置中选择 LibTV 画布');jobs.push({requestId:crypto.randomUUID(),input,forceNew:fresh||Boolean(row.values[fieldId]?.length)||old?.phase==='failed'});}
    catch(error){if(recordId||table.records.some(r=>r.selected))throw new Error(`第 ${table.records.indexOf(row)+1} 行：${error.message}`);}
   }
   if(!jobs.length)throw new Error('没有可生成的行，请补充提示词或检查任务状态');
   const localJob=jobs.find(job=>!job.recovery&&job.input.config.model===LOCAL_VIDEO_MODEL);if(localJob)await modelCapabilities(localJob.input.config);
   if(!alive||captured!==epoch)return;
   editor.change(t=>{for(const job of jobs){const row=t.records.find(r=>r.id===job.input.recordId);row.meta||={};row.meta.generationColumns||={};row.meta.generationColumns[fieldId]=generationReceipt(job,row.meta.generationColumns[fieldId]);}});
   try{await request('submit',{jobs});}catch(error){
    if(!alive||captured!==epoch)return;
    if(error.preflightRejected)editor.change(t=>{for(const job of jobs){const state=t.records.find(r=>r.id===job.input.recordId)?.meta?.generationColumns?.[fieldId];if(state?.requestId===job.requestId){state.phase=job.recovery?'needs_recovery':'needs_input';state.error=error.message;}}});
    notify(error.message);
   }
   if(alive&&captured===epoch)await poll(true);
  }catch(error){if(alive&&captured===epoch)notify(error.message);}finally{submitting=false;decorate();}
 }
 async function pause(states){
  try{const response=await request('pause',{requestIds:states.map(s=>s.requestId)});if(response.notice)notify(response.notice);await poll(true);}catch(error){notify(error.message);}
 }
 async function resume(fieldId){
  if(submitting)return;submitting=true;
  try{
   const jobs=getTable().records.map(r=>r.meta?.generationColumns?.[fieldId]).filter(s=>s?.phase==='paused').map(recoveryJob);
   if(jobs.length){
    const response=await request('submit',{jobs});
    if(alive)editor.change(t=>{for(const report of response.jobs){const row=t.records.find(r=>r.meta?.generationColumns?.[fieldId]?.requestId===report.requestId),state=row?.meta?.generationColumns?.[fieldId];if(!state)continue;if(report.phase==='complete')applyGenerationResult(t,fieldId,row.id,report.requestId,state.stamp,report.result);else {state.phase=report.phase;state.error=report.error;}}});
   }
   await poll(true);
  }catch(error){notify(error.message);}finally{submitting=false;decorate();}
 }
 async function poll(force=false){
  if(!alive||polling||submitting&&!force)return;const captured=epoch,jobs=[],checkCompleted=force||Date.now()-lastCompletedCheck>30000;if(checkCompleted)lastCompletedCheck=Date.now();
  for(const row of getTable().records)for(const [fieldId,state] of Object.entries(row.meta?.generationColumns||{})){
   if(['waiting','running','pausing'].includes(state.phase)||checkCompleted&&['complete','needs_recovery','stopped','paused','failed','stale'].includes(state.phase))jobs.push({recordId:row.id,fieldId,...state});
   if(checkCompleted)for(const old of state.history||[])if(!old.result?.url)jobs.push({recordId:row.id,fieldId,...old,historical:true});
  }
  if(!jobs.length)return;polling=true;
  try{const response=await request('status',{requestIds:jobs.map(j=>j.requestId)});if(!alive||captured!==epoch)return;
   for(const report of response.jobs)live.set(report.requestId,report);
   refreshLive();
   const updates=response.jobs.filter(report=>{const job=jobs.find(j=>j.requestId===report.requestId);return job&&(job.historical?report.phase==='complete'&&report.result?.url:generationReportNeedsApply(getTable(),job,report));});if(!updates.length)return;
   editor.change(t=>{for(const report of updates){const job=jobs.find(j=>j.requestId===report.requestId),row=t.records.find(r=>r.id===job?.recordId),state=row?.meta?.generationColumns?.[job?.fieldId];if(!state)continue;
    if(job.historical){const old=state.history?.find(s=>s.requestId===report.requestId);if(old){old.phase=report.phase;old.result=report.result;}continue;}
    if(state.requestId!==report.requestId)continue;
    if(report.phase==='complete')applyGenerationResult(t,job.fieldId,job.recordId,job.requestId,job.stamp,report.result);
    else {state.phase=report.phase;state.error=report.error;}
   }});
  }catch(error){
   const message='无法同步任务状态：'+error.message;
   if(alive&&captured===epoch&&jobs.some(job=>['waiting','running','pausing'].includes(job.phase)&&job.error!==message))editor.change(t=>{for(const job of jobs){const state=t.records.find(r=>r.id===job.recordId)?.meta?.generationColumns?.[job.fieldId];if(state?.requestId===job.requestId&&['waiting','running','pausing'].includes(state.phase))state.error=message;}});
  }finally{polling=false;}
 }
 function refreshLive(){
  for(const status of editor.root.querySelectorAll('.generation-cell-state[data-request-id]')){
   const chip=status.querySelector('.generation-stage');if(!chip)continue;
   const phase=status.dataset.phase,report=live.get(status.dataset.requestId),text=stageText(report,phase),label=(phaseNames[phase]||'')+' · '+liveLabel(report,phase);
   if(chip.textContent!==text)chip.textContent=text;
   status.title=label;status.setAttribute('aria-label',label);
   const ring=status.querySelector('.generation-progress');
   if(ring){ring.setAttribute('aria-label',label);if(Number.isFinite(report?.progress)&&report.stage==='generating')ring.setAttribute('aria-valuenow',String(report.progress));else ring.removeAttribute('aria-valuenow');}
  }
 }
 function decorate(headers){
  if(!alive)return;
  for(const run of editor.root.querySelectorAll('[data-generation-run]'))run.disabled=submitting;
  const table=getTable(),fields=table.fields.filter(isGeneration);if(!fields.length)return;
  headers||=new Map([...editor.root.querySelectorAll('th[data-column]')].map(h=>[h.dataset.column,h]));
  const rows=new Map(table.records.map(row=>[row.id,row])),cells=new Map(fields.map(f=>[f.id,[]]));
  for(const cell of editor.root.querySelectorAll('td[data-field]'))cells.get(cell.dataset.field)?.push(cell);
  let refresh=false;
  for(const field of fields){
   const header=headers.get(field.id);
   const actions=header?.querySelector('.generation-actions');
   if(actions){
    const states=table.records.map(r=>r.meta?.generationColumns?.[field.id]),active=states.filter(s=>['waiting','running'].includes(s?.phase));
    const pausing=states.some(s=>s?.phase==='pausing'),paused=states.some(s=>s?.phase==='paused');
    const action=active.length?'pause':pausing?'pausing':paused?'resume':'';
    const previous=actions.querySelector('[data-generation-control]');
    if(previous?.dataset.generationControl!==action){
     previous?.remove();
     if(action){
      const label=action==='pause'?'暂停本列生成':action==='pausing'?'正在暂停':'继续本列生成';
      const control=tableIcon(button(label,()=>action==='resume'?resume(field.id):pause(getTable().records.map(r=>r.meta?.generationColumns?.[field.id]).filter(s=>['waiting','running'].includes(s?.phase)))),action==='resume'?'play-line':'pause-fill',label);
      control.dataset.generationControl=action;control.classList.add('generation-settings');control.disabled=action==='pausing';
      control.title=label+'；本地当前行中断后会重新生成，云端已提交任务继续完成';
      actions.insertBefore(control,actions.querySelector('[data-generation-source]'));
     }
    }
   }
   for(const cell of cells.get(field.id))if(!cell.querySelector('.generation-cell-state')){
    const row=rows.get(cell.dataset.record),state=row?.meta?.generationColumns?.[field.id];
    const preview=cell.querySelector('.content-display')||cell;
    const phase=state?.phase||'idle',busy=['waiting','running','pausing'].includes(phase);
    const label=(phaseNames[phase]||'尚未生成')+(state?.error?' · '+state.error:'');
    const status=el('div',preview);status.className='generation-cell-state';status.dataset.phase=phase;status.dataset.error=String(Boolean(state?.error)&&!busy);status.setAttribute('role','status');status.setAttribute('aria-label',label);status.title=label;
    if(busy&&state?.error?.startsWith('无法同步任务状态：')){
     status.append(tableIcon(button(label,()=>notify(label)),'error-warning-line',label),tableIcon(button('刷新任务状态',()=>poll(true)),'restart-line','刷新任务状态'));
    }
    else if(busy){
     status.dataset.requestId=state.requestId;
     const ring=el('span',status);ring.className='generation-progress';ring.setAttribute('role','progressbar');ring.setAttribute('aria-valuemin','0');ring.setAttribute('aria-valuemax','100');ring.setAttribute('aria-label',label);
     el('span',status,stageText(live.get(state.requestId),phase)).className='generation-stage';
    }
    else if(state){const indicator=tableIcon(button(label,()=>notify(label)),phase==='complete'?'check-line':phase==='paused'?'pause-fill':'error-warning-line',label);indicator.classList.add('generation-state-icon');status.append(indicator);}
    if(busy&&phase!=='pausing')status.append(tableIcon(button('暂停此行',()=>pause([state])),'pause-fill','暂停此行；本地中断后从头生成，云端已提交任务继续完成'));
    if(!busy){const recover=phase==='needs_recovery'||phase==='stopped'||phase==='paused',retry=Boolean(state);const actionLabel=phase==='paused'?'继续生成':recover?'恢复原任务':retry?'重新生成':'生成此行';status.append(tableIcon(button(actionLabel,()=>generate(field.id,row.id,recover)),retry&&phase!=='paused'?'restart-line':'play-line',actionLabel));
     if(recover&&phase!=='paused')status.append(tableIcon(button('放弃原任务并重新生成',()=>{const dialog=editor.openDialog('重新生成本行');el('p',dialog,getConfig(field.id,getTable().records.find(r=>r.id===row.id))?.model===LOCAL_VIDEO_MODEL?'将提交一个新的本地生成任务，原任务不再查询。':'将提交一个新的付费生成任务，原任务不再查询。');dialog.append(button('确认重新生成',()=>{dialog.remove();void generate(field.id,row.id,false,true);},true),button('取消',()=>dialog.remove()));}),'play-line','放弃原任务并重新生成'));}
    const completedHistory=[...(state?.history||[]),...(phase==='stale'&&state?.result?[state]:[])].filter(s=>s.result?.url);
    if(completedHistory.length)status.append(tableIcon(button('已有生成结果',()=>{
     const dialog=editor.openDialog('已有生成结果');el('p',dialog,'将此前已完成的结果追加到本行，已有素材和当前任务保留；同一结果不会重复添加。');
     for(const old of completedHistory){const model=old.input?.config?.model||'原任务';dialog.append(button('添加 '+model+' · '+old.result.name,async()=>{
      try{const response=await request('status',{requestIds:[old.requestId]}),report=response.jobs.find(s=>s.requestId===old.requestId);if(report?.phase!=='complete'||!report.result?.url)throw new Error(report?.error||'原结果暂不可用，请恢复原任务');
       if(!alive||!dialog.isConnected)return;
       editor.change(t=>appendGenerationResult(t,t.records.find(r=>r.id===row.id),field.id,old.requestId,report.result,model));dialog.remove();
      }catch(error){notify(error.message);}
     }));}dialog.append(button('关闭',()=>dialog.remove()));
    }),'folder-image-line','已有生成结果'));
    status.onpointerdown=e=>e.stopPropagation();status.onmousedown=e=>e.stopPropagation();status.ondblclick=e=>e.stopPropagation();
    if(busy)refresh=true;
   }
  }
  if(refresh)refreshLive();
 }
 const timer=setInterval(()=>void poll(),3000);
 return {generate,decorate,get submitting(){return submitting;},invalidate(){epoch++;},destroy(){alive=false;epoch++;clearInterval(timer);live.clear();}};
}
