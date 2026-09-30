import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20260930-public-layout4';
import {connectionPanel} from './libtv_connection.mjs';
import {generationReportNeedsApply,generationReceipt,recoveryJob,GENERATION_MODELS,isGeneration,promptColumns,createGenerationPrompt,enableColumnPrompt,generationRows,generationInput,inputStamp,applyGenerationResult} from './table_generation_model.mjs?v=20260930-result-sync3';
const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
async function request(action,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='submit'?120000:30000);
 try{
 const response=await fetch('/daelab/libtv/table/'+action,{signal:controller.signal,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 if(response.status===404)throw new Error('生成服务尚未加载，请重启 ComfyUI 后刷新');
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'生成请求失败');error.preflightRejected=data.submitted===false;throw error;}return data;
 }catch(error){if(error.name==='AbortError')throw new Error('请求超时；原任务仍保留，请刷新任务状态，不要重复生成');throw error;}
 finally{clearTimeout(timer);}
}
const phaseNames={waiting:'等待提交',running:'生成中',stopped:'已停止后续提交',failed:'生成失败',needs_input:'待补充',needs_recovery:'待恢复',complete:'已完成',stale:'输入已变化'};
const stageNames={preparing:'准备中',submitting:'提交平台',writing_back:'等待写回',verifying:'核对原任务',downloading:'下载中'};
export function stageText(report,phase){
 if(phase==='waiting'||!report?.stage)return phase==='running'?'启动中':'排队中';
 if(report.stage==='generating')return Number.isFinite(report.progress)?`平台生成 ${report.progress}%`:'平台生成';
 return stageNames[report.stage]||'生成中';
}
export function liveLabel(report,phase,now=Date.now()){
 const age=report?.updatedAt?Math.max(0,Math.round((now-report.updatedAt)/1000)):null;
 return [stageText(report,phase),report?.taskId&&'任务 '+report.taskId,report?.detail,age!==null&&`最近确认 ${age} 秒前`].filter(Boolean).join(' · ');
}
export function attachGenerationColumns({editor,getTable,notify,editPromptTemplate}){
 let alive=true,polling=false,submitting=false,epoch=0,lastCompletedCheck=0;
 const live=new Map();
 const style=el('style',document.head);style.textContent=`
.dae-ui [data-generation-source]{display:none}
[data-canvas-panel=true] .dae-ui [data-generation-source]{display:grid}
.dae-ui .generation-header-row{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0}
.dae-ui .generation-header-row>.field-title{flex:1;min-width:0;padding-right:0!important}
.dae-ui .generation-actions{display:flex;gap:4px;align-items:center;margin-top:0;flex:0 0 auto;flex-wrap:nowrap;white-space:nowrap}
.dae-ui .generation-actions button{flex-shrink:0;white-space:nowrap}
.dae-ui .generation-actions button{min-height:32px;max-width:100%;font:inherit;padding:4px 8px!important}
.dae-ui .generation-actions .generation-settings{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;max-height:36px!important;padding:8px!important;border:0!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important}
.dae-ui .generation-actions .generation-settings:is(:hover,:focus-visible){background:var(--dae-surface-high,#383838)!important}
.dae-ui .generation-actions .generation-settings .dae-table-icon{width:20px;height:20px;flex:none}
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
.dae-ui .generation-form{display:flex;flex-direction:column;gap:14px}
.dae-ui .generation-form label{display:flex;flex-direction:column;gap:6px;min-width:0}
.dae-ui .generation-form :is(input,select){box-sizing:border-box;width:100%;min-width:0;min-height:36px;font:inherit;color:var(--dae-text);background:var(--dae-surface);border:1px solid var(--dae-border-control);border-radius:6px;padding:6px}
.dae-ui .generation-form [role=status]{white-space:pre-wrap;overflow-wrap:anywhere}
`;
 const findField=id=>getTable().fields.find(f=>f.id===id);
 function open(fieldId){
  const field=findField(fieldId);if(!field)return;
  editor.openTextSide('generation',fieldId,field.name+' · 生成配置',body=>{
   body.classList.add('generation-form');let schema=null,sequence=0;
   const draft=structuredClone(field.generation),original=JSON.stringify(field.generation);
   const label=(name,tag='select')=>{const wrapper=el('label',body,name),input=el(tag,wrapper);input.setAttribute('aria-label',name);return input;};
   const kind=label('生成类型');for(const [v,n] of [['image','图片'],['video','视频']])kind.add(new Option(n,v));kind.value=draft.kind;
   const model=label('模型'),prompt=label('提示词列');
   function fillPrompts(){prompt.replaceChildren(new Option('请选择提示词列',''));for(const f of promptColumns(getTable()))prompt.add(new Option(f.name,f.id));prompt.value=draft.promptFieldId;}
   fillPrompts();prompt.onchange=()=>draft.promptFieldId=prompt.value;
   body.append(button('新建空白提示词列',()=>{editor.change(t=>{draft.promptFieldId=createGenerationPrompt(t,fieldId).id;});fillPrompts();}));
   const mode=label('生成方式'),settings=el('section',body),status=el('p',body);status.setAttribute('role','status');
   const project=label('LibTV 目标画布 ID','input');project.value=getTable().meta.generationProject||'';
   connectionPanel(body,{get:()=>project.value,set:(key,value)=>project.value=value,capabilities:async()=>{}});
   function fillModels(){model.replaceChildren();if(draft.model==='Image-2')draft.model='Lib Image';if(!GENERATION_MODELS[kind.value].includes(draft.model)){const placeholder=new Option('请选择具体模型版本','');placeholder.disabled=true;model.add(placeholder);}for(const name of GENERATION_MODELS[kind.value])model.add(new Option(name,name));model.value=GENERATION_MODELS[kind.value].includes(draft.model)?draft.model:'';}
   function drawSettings(){
    settings.replaceChildren();if(!schema)return;
    const props=schema.properties||{},config=schema.config||{};
    for(const bucket of ['settings','advancedSettings']){
     let keys=config[bucket]||[];if(!Array.isArray(keys))keys=keys[draft.mode]||[];
     for(const key of keys){const spec=props[key];if(!spec)continue;const name=spec.originalField||key;
      const wrapper=el('label',settings,spec.displayName||spec.title||spec.label||name),choices=spec.enum||[],input=el(choices.length?'select':'input',wrapper);input.setAttribute('aria-label',spec.displayName||spec.title||spec.label||name);
      const values=choices.map(x=>typeof x==='object'?x.value:x);
      if(choices.length)choices.forEach((x,i)=>input.add(new Option(typeof x==='object'?(x.displayName||x.label||x.value):String(x),String(i))));
      else {input.type=spec.type==='boolean'?'checkbox':(['integer','number'].includes(spec.type)||spec.component==='slider'||typeof spec.min==='number')?'number':'text';if(spec.min!==undefined)input.min=spec.min;if(spec.max!==undefined)input.max=spec.max;input.step=spec.type==='integer'?'1':'any';}
      const value=draft.settings[name]??spec.default;
      if(choices.length){input.value=String(Math.max(0,values.indexOf(value)));draft.settings[name]=values[Number(input.value)];}
      else if(input.type==='checkbox'){input.checked=Boolean(value);draft.settings[name]=input.checked;}
      else if(value!==undefined){input.value=value;draft.settings[name]=value;}
      input.onchange=()=>{if(!input.checkValidity())return;if(input.type==='checkbox')draft.settings[name]=input.checked;else draft.settings[name]=choices.length?values[Number(input.value)]:input.type==='number'?Number(input.value):input.value;};
     }
    }
   }
   async function capabilities(){
    const token=++sequence;schema=null;settings.replaceChildren();mode.replaceChildren();status.textContent='正在读取模型选项…';
    try{const caps=await request('capabilities?'+new URLSearchParams({kind:draft.kind,model:draft.model}));if(!alive||!body.isConnected||token!==sequence)return;
     schema=caps.schema;let modes=Object.keys(schema.properties?.modeType?.items||{});if(draft.kind==='video'&&!modes.includes('text2video'))modes.unshift('text2video');if(!modes.length)modes=[''];
     const names={text2video:'文生视频',singleImage2video:'首帧生视频',frames2video:'首尾帧',image2video:'多图参考',mixed2video:'混合参考',text2image:'文生图',image2image:'参考图生图'};
     for(const m of modes)mode.add(new Option(names[m]||m||'默认',m));if(!modes.includes(draft.mode))draft.mode=modes[0];mode.value=draft.mode;drawSettings();status.textContent='参考素材由提示词中的 @列 读取本行内容。首尾帧按引用出现顺序。';
    }catch(error){if(token===sequence&&body.isConnected)status.textContent=error.message;}
   }
   kind.onchange=()=>{draft.kind=kind.value;draft.model=GENERATION_MODELS[draft.kind][0];draft.settings={};draft.mode='';fillModels();void capabilities();};
   model.onchange=()=>{draft.model=model.value;draft.settings={};draft.mode='';void capabilities();};
   mode.onchange=()=>{draft.mode=mode.value;draft.settings={};drawSettings();};
   body.append(button('重新读取模型选项',capabilities),button('保存配置',()=>{
    try{const current=findField(fieldId);if(!current)throw new Error('生成列已删除');
     // Only creating a prompt through this panel may have changed its binding.
     const comparison={...current.generation,promptFieldId:JSON.parse(original).promptFieldId};
     if(JSON.stringify(comparison)!==original)throw new Error('列配置已在其他位置变化，请重新打开');
     if(!model.value)throw new Error('请选择具体模型版本');
     if(!draft.promptFieldId)throw new Error('请选择提示词列');
     if([...settings.querySelectorAll('input')].some(i=>!i.reportValidity()))return;
     editor.change(t=>{t.fields.find(f=>f.id===fieldId).generation=structuredClone(draft);t.meta.generationProject=project.value.trim();});body.close();
    }catch(error){status.textContent=error.message;}
   },true),button('编辑提示词模板',()=>{if(draft.promptFieldId){editor.change(t=>enableColumnPrompt(t,draft.promptFieldId));editPromptTemplate(draft.promptFieldId);}}));
   fillModels();void capabilities();
  },{toggle:true});
 }
 async function generate(fieldId,recordId=null,recover=false,fresh=false){
  if(submitting)return;submitting=true;decorate();
  try{
   const table=getTable(),rows=recordId?table.records.filter(r=>r.id===recordId):generationRows(table,fieldId),jobs=[];
   for(const row of rows){
    const old=row.meta?.generationColumns?.[fieldId];
    if(['running','waiting'].includes(old?.phase))continue;
    if(!fresh&&(recover||['needs_recovery','stopped'].includes(old?.phase))){
     if(!old?.input)throw new Error('原任务快照缺失');jobs.push(recoveryJob(old));continue;
    }
    // An abandoned original shares the input fingerprint; forceNew prevents reusing it.
    try{const input=generationInput(table,fieldId,row.id);if(!input.project)throw new Error('请先在生成配置中选择 LibTV 画布');jobs.push({requestId:crypto.randomUUID(),input,forceNew:fresh||Boolean(row.values[fieldId]?.length)||old?.phase==='failed'});}
    catch(error){if(recordId||table.records.some(r=>r.selected))throw new Error(`第 ${table.records.indexOf(row)+1} 行：${error.message}`);}
   }
   if(!jobs.length)throw new Error('没有可生成的行，请补充提示词或检查任务状态');
   editor.change(t=>{for(const job of jobs){const row=t.records.find(r=>r.id===job.input.recordId);row.meta||={};row.meta.generationColumns||={};row.meta.generationColumns[fieldId]=generationReceipt(job,row.meta.generationColumns[fieldId]);}});
   try{await request('submit',{jobs});}catch(error){
    if(error.preflightRejected)editor.change(t=>{for(const job of jobs){const state=t.records.find(r=>r.id===job.input.recordId)?.meta?.generationColumns?.[fieldId];if(state?.requestId===job.requestId){state.phase=job.recovery?'needs_recovery':'needs_input';state.error=error.message;}}});
    notify(error.message);
   }
   await poll(true);
  }catch(error){notify(error.message);}finally{submitting=false;decorate();}
 }
 async function poll(force=false){
  if(!alive||polling||submitting&&!force)return;const captured=epoch,jobs=[],checkCompleted=force||Date.now()-lastCompletedCheck>30000;if(checkCompleted)lastCompletedCheck=Date.now();
  for(const row of getTable().records)for(const [fieldId,state] of Object.entries(row.meta?.generationColumns||{})){
   if(['waiting','running'].includes(state.phase)||checkCompleted&&['complete','needs_recovery','stopped','failed','stale'].includes(state.phase))jobs.push({recordId:row.id,fieldId,...state});
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
   if(alive&&captured===epoch&&jobs.some(job=>['waiting','running'].includes(job.phase)&&job.error!==message))editor.change(t=>{for(const job of jobs){const state=t.records.find(r=>r.id===job.recordId)?.meta?.generationColumns?.[job.fieldId];if(state?.requestId===job.requestId&&['waiting','running'].includes(state.phase))state.error=message;}});
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
 function decorate(){
  if(!alive)return;
  for(const run of editor.root.querySelectorAll('[data-generation-run]'))run.disabled=submitting;
  const table=getTable(),fields=table.fields.filter(isGeneration);if(!fields.length)return;
  const rows=new Map(table.records.map(row=>[row.id,row])),headers=new Map([...editor.root.querySelectorAll('th[data-column]')].map(h=>[h.dataset.column,h])),cells=new Map(fields.map(f=>[f.id,[]]));
  for(const cell of editor.root.querySelectorAll('td[data-field]'))cells.get(cell.dataset.field)?.push(cell);
  let refresh=false;
  for(const field of fields){
   const header=headers.get(field.id);
   if(header&&!header.querySelector('.generation-actions')){
    const row=el('div',header);row.className='generation-header-row';
    const title=header.querySelector('.field-title');if(title)row.append(title);
    const actions=el('div',row);actions.className='generation-actions';
    const settings=tableIcon(button('生成配置',()=>open(field.id)),'settings-3-line',field.name+' · 生成配置');settings.classList.add('generation-settings');
    const run=button('生成 '+generationRows(getTable(),field.id).length+' 行',()=>generate(field.id),true);run.dataset.generationRun=field.id;run.disabled=submitting;
    actions.append(run);
    const active=getTable().records.map(r=>r.meta?.generationColumns?.[field.id]).filter(s=>['waiting','running'].includes(s?.phase));
    if(active.length)actions.append(button('停止后续行',async()=>{try{await request('stop',{requestIds:active.map(s=>s.requestId)});await poll(true);}catch(error){notify(error.message);}}));
    actions.append(settings);
    const output=document.createElement('button');output.type='button';output.className='dae-material-slot';output.dataset.generationSource=field.id;output.setAttribute('aria-label','输出为素材组');output.title='拖到画布空白处输出素材组';actions.append(output);
    actions.onpointerdown=e=>e.stopPropagation();actions.ondragstart=e=>e.preventDefault();
   }
   for(const cell of cells.get(field.id))if(!cell.querySelector('.generation-cell-state')){
    const row=rows.get(cell.dataset.record),state=row?.meta?.generationColumns?.[field.id];
    const preview=cell.querySelector('.content-display')||cell;
    const phase=state?.phase||'idle',busy=['waiting','running'].includes(phase);
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
    else if(state){const indicator=tableIcon(button(label,()=>notify(label)),phase==='complete'?'check-line':'error-warning-line',label);indicator.classList.add('generation-state-icon');status.append(indicator);}
    if(!busy){const recover=phase==='needs_recovery'||phase==='stopped',retry=Boolean(state);const actionLabel=recover?'恢复原任务':retry?'重新生成':'生成此行';status.append(tableIcon(button(actionLabel,()=>generate(field.id,row.id,recover)),retry?'restart-line':'play-line',actionLabel));
     if(recover)status.append(tableIcon(button('放弃原任务并重新生成',()=>{const dialog=editor.openDialog('重新生成本行');el('p',dialog,'将提交一个新的付费生成任务，原任务不再查询。');dialog.append(button('确认重新生成',()=>{dialog.remove();void generate(field.id,row.id,false,true);},true),button('取消',()=>dialog.remove()));}),'play-line','放弃原任务并重新生成'));}
    const completedHistory=[...(state?.history||[]),...(phase==='stale'&&state?.result?[state]:[])].filter(s=>s.result?.url);
    if(completedHistory.length)status.append(tableIcon(button('已有生成结果',()=>{
     const dialog=editor.openDialog('已有生成结果');el('p',dialog,'选择此前已完成的结果显示在本行；当前任务状态仍会保留。');
     for(const old of completedHistory){const model=old.input?.config?.model||'原任务';dialog.append(button('使用 '+model+' · '+old.result.name,async()=>{
      try{const response=await request('status',{requestIds:[old.requestId]}),report=response.jobs.find(s=>s.requestId===old.requestId);if(report?.phase!=='complete'||!report.result?.url)throw new Error(report?.error||'原结果暂不可用，请恢复原任务');
       if(!alive||!dialog.isConnected)return;
       editor.change(t=>{const current=t.records.find(r=>r.id===row.id);if(!current)return;current.values[field.id]=[{...report.result,id:crypto.randomUUID(),name:'已有结果 · '+model+' · '+report.result.name,provenance:{requestId:old.requestId,model}}];});dialog.remove();
      }catch(error){notify(error.message);}
     }));}dialog.append(button('关闭',()=>dialog.remove()));
    }),'folder-image-line','已有生成结果'));
    status.onpointerdown=e=>e.stopPropagation();status.onmousedown=e=>e.stopPropagation();status.ondblclick=e=>e.stopPropagation();
    if(busy)refresh=true;
   }
  }
  if(refresh)refreshLive();
 }
 const observer=new MutationObserver(decorate);observer.observe(editor.root,{childList:true,subtree:true});
 const created=e=>open(e.detail.fieldId);editor.root.addEventListener('dae-generation-created',created);
 const timer=setInterval(()=>void poll(),3000);decorate();
 return {open,invalidate(){epoch++;},destroy(){alive=false;epoch++;live.clear();clearInterval(timer);observer.disconnect();editor.root.removeEventListener('dae-generation-created',created);style.remove();}};
}
