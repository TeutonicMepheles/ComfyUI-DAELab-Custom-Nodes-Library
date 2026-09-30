import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20260930-table-surfaces3';
import {connectionPanel} from './libtv_connection.mjs';
import {generationReceipt,recoveryJob,GENERATION_MODELS,isGeneration,promptColumns,createGenerationPrompt,enableColumnPrompt,generationRows,generationInput,inputStamp,applyGenerationResult} from './table_generation_model.mjs';
const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
async function request(action,body){
 const response=await fetch('/daelab/libtv/table/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 if(response.status===404)throw new Error('生成服务尚未加载，请重启 ComfyUI 后刷新');
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'生成请求失败');error.preflightRejected=data.submitted===false;throw error;}return data;
}
const phaseNames={waiting:'等待提交',running:'生成中',stopped:'已停止后续提交',failed:'生成失败',needs_input:'待补充',needs_recovery:'待恢复',complete:'已完成',stale:'输入已变化'};
export function attachGenerationColumns({editor,getTable,notify,editPromptTemplate}){
 let alive=true,polling=false,submitting=false,epoch=0,lastCompletedCheck=0;
 const style=el('style',document.head);style.textContent=`
.dae-ui .generation-actions{display:flex;gap:4px;align-items:center;margin-top:8px;max-width:100%;flex-wrap:wrap}
.dae-ui .generation-actions button{min-height:32px;max-width:100%;font:inherit;padding:4px 8px!important}
.dae-ui .generation-actions .generation-settings{width:32px;min-width:32px;padding:6px!important}
.dae-ui .generation-cell-state{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;white-space:normal;overflow-wrap:anywhere}
.dae-ui .generation-cell-state[data-error=true]{color:var(--dae-error,#ffb4ab)}
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
 async function generate(fieldId,recordId=null,recover=false){
  if(submitting)return;submitting=true;
  try{
   const table=getTable(),rows=recordId?table.records.filter(r=>r.id===recordId):generationRows(table,fieldId),jobs=[];
   for(const row of rows){
    const old=row.meta?.generationColumns?.[fieldId];
    if(['running','waiting'].includes(old?.phase))continue;
    if(recover||['needs_recovery','stopped'].includes(old?.phase)){
     if(!old?.input)throw new Error('原任务快照缺失');jobs.push(recoveryJob(old));continue;
    }
    try{const input=generationInput(table,fieldId,row.id);if(!input.project)throw new Error('请先在生成配置中选择 LibTV 画布');jobs.push({requestId:crypto.randomUUID(),input,forceNew:Boolean(row.values[fieldId]?.length)||old?.phase==='failed'});}
    catch(error){if(recordId||table.records.some(r=>r.selected))throw new Error(`第 ${table.records.indexOf(row)+1} 行：${error.message}`);}
   }
   if(!jobs.length)throw new Error('没有可生成的行，请补充提示词或检查任务状态');
   editor.change(t=>{for(const job of jobs){const row=t.records.find(r=>r.id===job.input.recordId);row.meta||={};row.meta.generationColumns||={};row.meta.generationColumns[fieldId]=generationReceipt(job);}});
   try{await request('submit',{jobs});}catch(error){
    if(error.preflightRejected)editor.change(t=>{for(const job of jobs){const state=t.records.find(r=>r.id===job.input.recordId)?.meta?.generationColumns?.[fieldId];if(state?.requestId===job.requestId){state.phase=job.recovery?'needs_recovery':'needs_input';state.error=error.message;}}});
    notify(error.message);
   }
   await poll(true);
  }catch(error){notify(error.message);}finally{submitting=false;decorate();}
 }
 async function poll(force=false){
  if(!alive||polling||submitting&&!force)return;const captured=epoch,jobs=[],checkCompleted=force||Date.now()-lastCompletedCheck>30000;if(checkCompleted)lastCompletedCheck=Date.now();
  for(const row of getTable().records)for(const [fieldId,state] of Object.entries(row.meta?.generationColumns||{}))if(['waiting','running'].includes(state.phase)||checkCompleted&&state.phase==='complete')jobs.push({recordId:row.id,fieldId,...state});
  if(!jobs.length)return;polling=true;
  try{const response=await request('status',{requestIds:jobs.map(j=>j.requestId)});if(!alive||captured!==epoch)return;
   const updates=response.jobs.filter(report=>{const job=jobs.find(j=>j.requestId===report.requestId);return job&&(job.phase!==report.phase||job.error!==report.error);});if(!updates.length)return;
   editor.change(t=>{for(const report of updates){const job=jobs.find(j=>j.requestId===report.requestId),row=t.records.find(r=>r.id===job?.recordId),state=row?.meta?.generationColumns?.[job?.fieldId];if(!state||state.requestId!==report.requestId)continue;
    if(report.phase==='complete')applyGenerationResult(t,job.fieldId,job.recordId,job.requestId,job.stamp,report.result);
    else {state.phase=report.phase;state.error=report.error;}
   }});
  }catch{/* Keep recoverable identities while the server is unreachable. */}finally{polling=false;}
 }
 function decorate(){
  if(!alive)return;
  for(const field of getTable().fields.filter(isGeneration)){
   const header=[...editor.root.querySelectorAll('th[data-column]')].find(h=>h.dataset.column===field.id);
   if(header&&!header.querySelector('.generation-actions')){
    const actions=el('div',header);actions.className='generation-actions';
    const settings=tableIcon(button('生成配置',()=>open(field.id)),'edit-line',field.name+' · 生成配置');settings.classList.add('generation-settings');
    const run=button('生成 '+generationRows(getTable(),field.id).length+' 行',()=>generate(field.id),true);run.disabled=submitting;
    actions.append(settings,run);
    const active=getTable().records.map(r=>r.meta?.generationColumns?.[field.id]).filter(s=>['waiting','running'].includes(s?.phase));
    if(active.length)actions.append(button('停止后续行',async()=>{try{await request('stop',{requestIds:active.map(s=>s.requestId)});await poll(true);}catch(error){notify(error.message);}}));
    actions.onpointerdown=e=>e.stopPropagation();actions.ondragstart=e=>e.preventDefault();
   }
   for(const cell of editor.root.querySelectorAll('td[data-field]'))if(cell.dataset.field===field.id&&!cell.querySelector('.generation-cell-state')){
    const row=getTable().records.find(r=>r.id===cell.dataset.record),state=row?.meta?.generationColumns?.[field.id];
    const status=el('div',cell);status.className='generation-cell-state';status.setAttribute('role','status');status.dataset.error=String(Boolean(state?.error)&&!['running','waiting'].includes(state?.phase));
    el('span',status,state?(phaseNames[state.phase]||state.phase)+(state.error?' · '+state.error:''):'尚未生成');
    if(state?.phase==='stale'&&state.result)status.append(button('查看旧输入结果',()=>cell.dispatchEvent(new CustomEvent('dae-preview',{bubbles:true,detail:state.result}))));
    if(!['waiting','running'].includes(state?.phase))status.append(button(state?.phase==='needs_recovery'?'恢复任务':state?.phase==='complete'?'重新生成':'生成此行',()=>generate(field.id,row.id,state?.phase==='needs_recovery')));
   }
  }
 }
 const observer=new MutationObserver(decorate);observer.observe(editor.root,{childList:true,subtree:true});
 const created=e=>open(e.detail.fieldId);editor.root.addEventListener('dae-generation-created',created);
 const timer=setInterval(()=>void poll(),3000);decorate();
 return {open,invalidate(){epoch++;},destroy(){alive=false;epoch++;clearInterval(timer);observer.disconnect();editor.root.removeEventListener('dae-generation-created',created);style.remove();}};
}
