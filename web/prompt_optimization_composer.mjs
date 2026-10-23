import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261023-h3-size-r3';
import {OPTIMIZATION_MODELS,optimizationProvider,DEFAULT_REQUIREMENTS} from './prompt_optimization_model.mjs?v=20261023-h3-size-r3';
import {optimizationSummary} from './prompt_optimization_summary.mjs';

const el=(tag,parent,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;parent?.append(e);return e;};
export function composerStyle(){if(document.getElementById('prompt-opt-composer-style'))return;const link=el('link',document.head);link.id='prompt-opt-composer-style';link.rel='stylesheet';link.href=new URL('./prompt_optimization_composer.css',import.meta.url).href;}
const logo=(button,name)=>{button.style.setProperty('--model-logo',`url("${new URL(name==='openai'?'./vendor/remixicon/openai-fill.svg':`./vendor/model-icons/${name}.svg`,import.meta.url).href}")`);};
const icon=(label,name,action,primary=false)=>{const b=button(label,action,primary);tableIcon(b,name,label);b.classList.add('opt-icon');return b;};
export function optimizationCostSummary(state){
 const q=state.quote,amount=n=>Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:6}):'—';
 if(state.provider==='qwen')return '本地运行 · 不产生 API 费用';
 if(q?.status==='estimating')return '正在估算…';
 if(q?.status!=='ready')return state.provider==='comfy'?'使用 ComfyUI 账号积分':'';
 if(q.expiresAt<=Date.now())return '估算已失效，请重新估算';
 return state.provider==='deepseek'?`预计 $${amount(q.estimatedCredits)} · 预算上界 $${amount(q.budgetUpperCredits)}`:`预计 ${amount(q.estimatedCredits)} 积分 · 预算上界 ${amount(q.budgetUpperCredits)} 积分`;
}

export function createOptimizationSourceView({container,source,onLocate}){
 composerStyle();container.classList.add('prompt-opt-popover');container.replaceChildren();
 el('strong',container,source.synchronized===false?'只读列不可直接优化':'同步列不可直接优化');el('p',container,source.reason);
 if(source.synchronized===false)return {destroy(){container.replaceChildren();}};
 el('p',container,'请在上游原始列优化并应用结果，当前列会随之同步。','opt-muted');
 el('p',container,`上游来源：${source.title}${source.nodeId!=null?` · #${source.nodeId}`:''} → ${source.fieldName}`,'opt-source');
 const locate=button('定位上游列',onLocate);locate.disabled=!source.available;container.append(locate);
 return {destroy(){container.replaceChildren();}};
}

// This is only a view. The existing controller owns snapshots, transport, leases,
// recovery and the single editor history transaction used to apply results.
export function createOptimizationComposer({controller,container,fieldName}){
 composerStyle();container.classList.add('prompt-opt-popover');container.replaceChildren();
 let alive=true,composing=false,acting=false,state=controller.getState(),estimateTimer,settleTimer,localError='',riskSignature='';
 const view=el('section',container,undefined,'opt-composer'),head=el('header',view,undefined,'opt-head');
 const title=el('span',head,'改写要求'),scope=el('span',head,'','opt-muted');
 const requirements=el('textarea',view,undefined,'opt-requirements');requirements.setAttribute('aria-label','改写要求');requirements.placeholder=DEFAULT_REQUIREMENTS;requirements.rows=4;
 const progressArea=el('div',view,undefined,'opt-progress-area'),progressLabel=el('div',progressArea,undefined,'opt-progress-label');
 const progressText=el('span',progressLabel),progressDetail=el('span',progressLabel,undefined,'opt-muted');
 const progress=el('div',progressArea,undefined,'opt-progress');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','整列改写进度');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');const bar=el('div',progress);
 const summary=el('p',progressArea,'','opt-muted');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
 const acknowledge=el('label',view,undefined,'opt-ack'),ack=el('input',acknowledge);ack.type='checkbox';const ackLabel=el('span',acknowledge);ack.addEventListener('change',()=>render(state));
 const message=el('p',view,'','opt-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const footer=el('footer',view,undefined,'opt-footer'),modelControls=el('div',footer,undefined,'opt-model-controls'),modelArea=el('div',modelControls,undefined,'opt-model-area');
 const model=button('选择优化模型',()=>{setKeyOpen(false);menu.hidden=!menu.hidden;model.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('[aria-selected="true"]')?.focus();});model.classList.add('opt-model');model.setAttribute('aria-haspopup','listbox');model.setAttribute('aria-expanded','false');
 model.setAttribute('aria-label','选择优化模型');model.title='选择优化模型';model.replaceChildren();el('span',model,undefined,'opt-logo');const modelName=el('span',model);el('span',model,'↓','opt-down');modelArea.append(model);
 const menu=el('div',modelArea,undefined,'opt-model-menu');menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label','优化模型');el('span',menu,'模型','opt-muted');
 const modelButtons=OPTIMIZATION_MODELS.map(item=>{const b=button(item.label,()=>{if(controller.setModel(item.id)){menu.hidden=true;model.setAttribute('aria-expanded','false');model.focus();scheduleEstimate();}});b.replaceChildren();b.classList.add('opt-model-option');b.setAttribute('role','option');logo(b,item.logo);el('span',b,undefined,'opt-logo');el('span',b,item.label);el('span',b,'✓','opt-model-check');menu.append(b);return {b,item};});
 menu.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=modelButtons.map(v=>v.b),index=buttons.indexOf(document.activeElement);buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}});
 const settings=icon('DeepSeek API 设置','settings-3-line',()=>{menu.hidden=true;model.setAttribute('aria-expanded','false');setKeyOpen(keyArea.hidden);if(!keyArea.hidden)keyInput.focus();});settings.classList.add('opt-settings');settings.setAttribute('aria-haspopup','dialog');settings.setAttribute('aria-expanded','false');modelControls.append(settings);
 const keyArea=el('section',modelControls,undefined,'opt-key-panel');keyArea.hidden=true;keyArea.id='opt-api-'+crypto.randomUUID();keyArea.setAttribute('role','dialog');keyArea.setAttribute('aria-label','DeepSeek API 设置');settings.setAttribute('aria-controls',keyArea.id);
 el('strong',keyArea,'DeepSeek API 设置');const keySummary=el('p',keyArea,'','opt-muted');keySummary.setAttribute('role','status');
 const keyInput=el('input',keyArea);keyInput.type='password';keyInput.autocomplete='off';keyInput.placeholder='仅保存在当前页面会话';keyInput.setAttribute('aria-label','DeepSeek API 密钥');
 const keyActions=el('div',keyArea,undefined,'opt-key-actions');const saveKey=button('保存到本页',()=>{controller.setDeepSeekKey(keyInput.value);setKeyOpen(false);settings.focus();}),clearKey=button('清除本页密钥',()=>{keyInput.value='';controller.clearDeepSeekKey();});keyActions.append(saveKey,clearKey);
 const keyCost=el('p',keyArea,'','opt-muted');keyCost.setAttribute('role','status');
 function setKeyOpen(open){keyArea.hidden=!open;settings.setAttribute('aria-expanded',String(open));if(!open)keyInput.value='';}
 function closeNested(){if(!keyArea.hidden){setKeyOpen(false);settings.focus();return true;}if(!menu.hidden){menu.hidden=true;model.setAttribute('aria-expanded','false');model.focus();return true;}return false;}
 const outside=e=>{if(!keyArea.contains(e.target)&&!settings.contains(e.target))setKeyOpen(false);if(!menu.contains(e.target)&&!model.contains(e.target)){menu.hidden=true;model.setAttribute('aria-expanded','false');}};view.addEventListener('pointerdown',outside);
 const actions=el('div',footer,undefined,'opt-actions');
 async function run(action){if(acting||composing)return;acting=true;localError='';render(state);try{await action();}catch(error){localError=error.message||String(error);}finally{acting=false;clearTimeout(settleTimer);settleTimer=setTimeout(()=>alive&&render(controller.getState()),0);}}
 const start=icon('开始改写','play-line',()=>run(async()=>{clearTimeout(estimateTimer);if(state.permissions.canContinue){await controller.continue();return;}if(!state.permissions.canSubmit)await controller.estimate();if(controller.getState().permissions.canSubmit)await controller.submit({acknowledgeUnknown:ack.checked});}),true);
 const stop=button('停止剩余行',()=>run(()=>controller.stop()),true);stop.replaceChildren();stop.title='停止剩余行';stop.setAttribute('aria-label','停止剩余行');stop.classList.add('opt-icon','opt-stop');el('span',stop);
 const regenerate=icon('重新生成','restart-line',()=>run(async()=>{clearTimeout(estimateTimer);await controller.retry({acknowledgeUnknown:ack.checked});if(controller.getState().permissions.canSubmit)await controller.submit({acknowledgeUnknown:ack.checked});}));
 const apply=button('应用结果',()=>run(()=>controller.applyAll()),true);tableIcon(apply,'check-line','应用结果');const applyLabel=el('span',apply,'应用结果');apply.classList.add('opt-apply');
 actions.append(start,stop,regenerate,apply);
 const recover=button('查询原任务',()=>run(()=>controller.recover()));recover.classList.add('opt-recover');view.insertBefore(recover,footer);
 function scheduleEstimate(){clearTimeout(estimateTimer);estimateTimer=setTimeout(()=>{if(alive&&!composing&&controller.getState().permissions.canEstimate)void controller.estimate();},400);}
 requirements.addEventListener('compositionstart',()=>{composing=true;clearTimeout(estimateTimer);render(state);});
 requirements.addEventListener('compositionend',()=>{composing=false;controller.setRequirements(requirements.value);scheduleEstimate();});
 requirements.addEventListener('input',()=>{if(!composing){controller.setRequirements(requirements.value);scheduleEstimate();}});
 function render(next){
  if(!alive)return;state=next;const s=optimizationSummary(state),p=state.permissions||{},hasBatch=Boolean(state.batchId),waiting=s.pending>0&&!state.paused&&!state.stopped,locked=p.canChangeProvider===false;
  const legacy=!OPTIMIZATION_MODELS.some(m=>m.id===state.model),selected=OPTIMIZATION_MODELS.find(m=>m.id===state.model);
  title.textContent=state.busy&&state.operationName==='apply'?'正在应用':waiting?'正在改写':hasBatch&&!state.draftActive?(s.failed||s.unknown?'改写结束':state.paused&&s.pending||s.stopped?'改写已暂停':'改写完成'):'改写要求';
  scope.textContent=`${fieldName} · ${s.total} ${state.scope==='cell'?'格':'行'}`;
  if(!composing&&document.activeElement!==requirements)requirements.value=state.requirements||'';
  requirements.disabled=locked&&!composing;model.disabled=locked;modelName.textContent=selected?.label||`${state.model}（历史任务）`;logo(model,selected?.logo||'deepseek');
  for(const {b,item} of modelButtons){b.setAttribute('aria-selected',String(state.model===item.id));b.disabled=locked;}
  const applicationDetail=[[s.applied,'已应用'],[s.reverted,'已撤销']].filter(([n])=>n).map(([n,label])=>`${label} ${n} 行`).join(' · ');
  progressArea.hidden=!hasBatch;progressText.textContent=`${s.completed} / ${s.total} 行已完成`;progressDetail.textContent=waiting?`${s.percent}%`:applicationDetail||'尚未应用';bar.style.width=s.percent+'%';progress.setAttribute('aria-valuenow',String(s.percent));progress.setAttribute('aria-valuetext',`${s.completed} 行完成，${s.failed} 行失败，${s.skipped} 行跳过`);
  summary.textContent=[[s.failed,'失败'],[s.skipped,'跳过'],[s.stale,'过期'],[s.unknown,'结果未知'],[s.stopped,'停止'],[s.unchanged,'未改动']].filter(([n])=>n).map(([n,label])=>`${label} ${n} 行`).join(' · ')||(waiting?'完成后可统一应用结果。':s.valid?`待应用 ${s.valid} 行`:'');summary.hidden=!summary.textContent;
  settings.hidden=state.provider!=='deepseek';if(settings.hidden)setKeyOpen(false);settings.dataset.attention=String(Boolean(state.deepseekKeyRequired));settings.title=state.deepseekKeyRequired?'DeepSeek API 设置：请配置密钥':'DeepSeek API 设置';keySummary.textContent=state.deepseekKeyRequired?'密钥未配置':state.pageDeepSeekKeyConfigured?'本页密钥已配置':'服务器密钥已配置';keyInput.disabled=saveKey.disabled=clearKey.disabled=locked;keyCost.textContent=optimizationCostSummary(state);
  const riskKey=JSON.stringify((state.unknownRequests||[]).map(r=>r.requestId).sort());if(riskKey!==riskSignature){riskSignature=riskKey;ack.checked=false;}
  const unknown=state.unknownRequests?.length>0;acknowledge.hidden=!unknown;ackLabel.textContent=(state.unknownRequests||[]).some(r=>optimizationProvider(r.model)!=='qwen')?'我了解历史请求结果未知，重新生成可能重复计费':'我了解历史本地请求结果未知，将显式重新生成';
  const reason=localError||state.error||state.inactiveReason||state.quote?.reason;
  message.textContent=reason||(s.reverted?'本次应用已撤销，可使用重做恢复结果。':(!hasBatch||state.draftActive)&&state.provider!=='deepseek'?optimizationCostSummary(state):'');message.hidden=!message.textContent;message.dataset.error=String(Boolean(reason));
  stop.hidden=!p.canStop;stop.disabled=acting||state.busy;start.hidden=Boolean(p.canStop)||hasBatch&&!p.canContinue;regenerate.hidden=!hasBatch||Boolean(p.canStop)||Boolean(p.canContinue);apply.hidden=!hasBatch||waiting||s.inflight>0;
  start.title=p.canContinue?(state.continuationReady?'继续剩余行':'核对继续任务'):'开始改写';start.setAttribute('aria-label',start.title);
  start.disabled=acting||state.busy||composing||state.deepseekKeyRequired||Boolean(state.inactiveReason)||legacy||unknown&&!ack.checked||(!p.canSubmit&&!p.canEstimate&&!p.canContinue);
  regenerate.disabled=acting||state.busy||composing||locked||state.deepseekKeyRequired||legacy||unknown&&!ack.checked;apply.disabled=acting||state.busy||s.inflight>0||s.pending>0&&!state.paused||!p.canApplyAll;applyLabel.textContent=s.valid?`应用 ${s.valid} 行`:applicationDetail||'应用结果';
  recover.hidden=!hasBatch||!(s.unknown||state.paused&&(s.inflight||state.error));recover.disabled=acting||state.busy;
  view.setAttribute('aria-busy',String(acting||state.busy||waiting));
 }
 const unsubscribe=controller.subscribe(render);
 return {root:view,closeNested,destroy(){alive=false;clearTimeout(estimateTimer);clearTimeout(settleTimer);keyInput.value='';view.removeEventListener('pointerdown',outside);unsubscribe();view.remove();}};
}
