import {OptimizationRevisions,freezeSnapshot,matchesSnapshot,restoreSuggestion,applySuggestions,inspectTarget,displaySuggestion,NAMESPACE} from './prompt_optimization_model.mjs';
import {createPromptOptimizationApi} from './prompt_optimization_api.mjs';
import {createPromptOptimizationPanel} from './prompt_optimization_panel.mjs';

const registries=new Map(),batchReferences=new Map();
const activeStatuses=new Set(['submitting','submitted','polling']);
const terminal=new Set(['succeeded','failed','skipped','stopped','unknown']);
const uuid=()=>crypto.randomUUID();
export function createOptimizationController({getTable,identity,revisions,persist,change,api,scope,fieldId,recordId,isActive=()=>true,onBatch=()=>{},instanceId=uuid(),preferences={},onPreferences=()=>{}}){
 let dead=false,epoch=0,lifecycle=0,lease=null,batch=null,timer=null,prepared=[],running=false,requiresContinue=false,continuationQuoteId=null,acknowledgeUnknownRequestIds=[];
 const listeners=new Set(),items=new Map();
 const state={scope,fieldId,recordId,requirements:preferences.requirements||'',model:preferences.model||'gpt-4.1-mini',models:[],range:{total:0,processable:0,skipped:[]},quote:null,busy:false,error:'',rows:[],batchId:null,permissions:{}};
 function update(){
  if(dead)return;revisions.observe(getTable());persist();state.inactiveReason=isActive()?'':'节点处于停用模式或视图已释放，请恢复 Active 后继续';
  state.rows=[...items.values()].map(item=>{const s=item.frozen?.wire||item.snapshot;const match=item.frozen&&matchesSnapshot(getTable(),identity,revisions,item.frozen);const suggestionStatus=item.applied?'applied':item.suggestion?.status==='valid'&&!match?'stale':item.suggestion?.status;
   return {requestId:item.requestId,recordId:s?.target.recordId,label:`第 ${getTable().records.findIndex(r=>r.id===s?.target.recordId)+1} 行`,before:s?displaySuggestion({wire:s},s.input.prompt_text):'',after:s?displaySuggestion({wire:s},item.suggestion?.text||''):'',status:item.status,suggestionStatus,reason:!match&&item.suggestion?.status==='valid'?'目标或依赖已变化，建议仅供查看':item.suggestion?.reason||item.error||'',canApply:suggestionStatus==='valid'&&match&&isActive(),actualCredits:item.actualCredits??null};});
  const inFlight=[...items.values()].some(i=>activeStatuses.has(i.status)),queued=[...items.values()].some(i=>['queued','preparing'].includes(i.status));
  const resumable=[...items.values()].some(i=>['queued','preparing','stopped'].includes(i.status));
  const quoteValid=state.quote?.status==='ready'&&state.quote.expiresAt>Date.now();
  state.permissions={canEstimate:!state.busy&&!inFlight,canSubmit:!state.busy&&quoteValid&&prepared.length>0&&!inFlight&&!queued&&isActive(),canStop:!!batch&&(inFlight||queued)&&!batch.stopped,canContinue:!!batch&&resumable&&(requiresContinue||batch.paused||batch.stopped)&&isActive(),canRecover:!!state.batchId,canApplyAll:state.rows.some(i=>i.canApply)};
  for(const listener of listeners)listener(state);
 }
 async function operation(fn){if(dead)return;state.busy=true;state.error='';update();try{return await fn();}catch(e){state.error=e.message||String(e);}finally{state.busy=false;update();}}
 function observe(){revisions.observe(getTable());persist();if(!isActive()){requiresContinue=true;lifecycle++;}update();}
 async function estimate(){return operation(async()=>{
  const e=++epoch,table=getTable(),rows=scope==='cell'?table.records.filter(r=>r.id===recordId):table.records;
  const pending=[],skipped=[];const temporary=new OptimizationRevisions(revisions.serialize());
  for(const row of rows)try{pending.push(await freezeSnapshot(table,{...identity,recordId:row.id,fieldId},temporary,{model:state.model,requirements:state.requirements,begin:true}));}catch(error){skipped.push({recordId:row.id,reason:error.message});}
  if(dead||e!==epoch)return;state.range={total:rows.length,processable:pending.length,skipped};update();
  const quote=pending.length?await api.estimate({rows:pending.map(p=>p.wire),skipped,model:state.model,maxOutputTokens:1024}):{status:'unavailable',reason:'当前范围没有可优化的提示词'};
  if(dead||e!==epoch)return;prepared=pending;state.range={total:rows.length,processable:pending.length,skipped};state.quote=quote;
 });}
 async function controlLease(){lease=await api.lease({target:identity,instanceId,leaseId:lease?.leaseId});return lease;}
 function schedule(){clearTimeout(timer);if(!dead&&batch&&[...items.values()].some(i=>!terminal.has(i.status)))timer=setTimeout(()=>void tick(),1200);}
 function ingest(value){
  batch=value;state.batchId=value.batchId;
  for(const row of value.rows||[]){let item=items.get(row.requestId);if(!item){item={...row};items.set(row.requestId,item);}Object.assign(item,row);
   if(row.suggestion&&item.frozen){try{item.suggestion={...row.suggestion,...restoreSuggestion(item.frozen,row.suggestion.text,{status:row.status==='succeeded'?'completed':'incomplete'})};}catch(e){item.suggestion={...row.suggestion,status:'invalid',reason:e.message};}}
  }update();
 }
 async function tick(){
  if(dead||running||!batch)return;running=true;const life=lifecycle;
  try{
   ingest(await api.query({batchId:batch.batchId}));
   if(dead||life!==lifecycle)return;if(!isActive()){requiresContinue=true;return;}
   if(!requiresContinue&&!batch.paused&&!batch.stopped){await controlLease();if(dead||life!==lifecycle||!isActive())return;}
   const current=[...items.values()].find(i=>activeStatuses.has(i.status));
   if(current){ingest(await api.recover({batchId:batch.batchId}));return;}
   if(requiresContinue||batch.stopped||batch.paused)return;
   const next=batch.rows.map(r=>items.get(r.requestId)).find(i=>['queued','preparing'].includes(i.status));if(!next)return;
   await controlLease();if(dead||life!==lifecycle||!isActive()){requiresContinue=true;return;}
   if(!next.frozen||!matchesSnapshot(getTable(),identity,revisions,next.frozen)){ingest(await api.skip({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,reason:'发送前目标或依赖已变化'}));return;}
   const s=next.frozen.wire;const permit=await api.permit({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,snapshotDigest:s.snapshotDigest,revision:s.revision,requestSeq:s.requestSeq});
   // Recheck after awaiting permit: UI edits/close must not race an old approval.
   if(dead||life!==lifecycle||requiresContinue||!isActive()||!matchesSnapshot(getTable(),identity,revisions,next.frozen)){requiresContinue=true;return;}
   ingest(await api.advance({batchId:batch.batchId,requestId:next.requestId,leaseId:lease.leaseId,permitId:permit.permitId},{beforeSend:()=>!dead&&life===lifecycle&&!requiresContinue&&isActive()&&matchesSnapshot(getTable(),identity,revisions,next.frozen)}));
  }catch(e){state.error=e.message;requiresContinue=true;}finally{running=false;update();schedule();}
 }
 async function submit(){const life=lifecycle;const canSubmit=state.permissions.canSubmit;return operation(async()=>{
  if(!canSubmit)throw new Error('请先取得当前范围的有效积分估算');
  for(const p of prepared){const s=p.wire,now=revisions.current(getTable(),s.target.recordId,s.target.fieldId);if(now.revision!==s.revision||now.requestSeq+1!==s.requestSeq||inspectTarget(getTable(),s.target.recordId,s.target.fieldId).stamp!==p.local.stamp)throw new Error('估算后目标已变化，请重新估算');}
  await controlLease();if(dead||life!==lifecycle||!isActive())throw new Error('当前视图不可提交');
  for(const p of prepared){const s=p.wire,now=revisions.current(getTable(),s.target.recordId,s.target.fieldId);if(now.revision!==s.revision||now.requestSeq+1!==s.requestSeq||inspectTarget(getTable(),s.target.recordId,s.target.fieldId).stamp!==p.local.stamp)throw new Error('取得控制权期间目标已变化，请重新估算');}
  const rows=prepared.map(frozen=>({requestId:uuid(),snapshot:frozen.wire,frozen})),batchId=uuid();
  onBatch(batchId,{scope,fieldId,recordId});
  const range=scope==='cell'?{scope,fieldId,recordId}:{scope,fieldId};
  const value=await api.submit({quoteId:state.quote.quoteId,batchId,range,rows:rows.map(({requestId,snapshot})=>({requestId,snapshot})),leaseId:lease.leaseId,budgetCredits:state.quote.budgetUpperCredits,acknowledgeUnknownRequestIds});
  if(dead)return;
  if(value.reusedExisting){onBatch(value.batchId,{scope,fieldId,recordId});await recover(value.batchId);return;}
  for(const r of rows){revisions.begin(getTable(),r.snapshot.target.recordId,r.snapshot.target.fieldId);items.set(r.requestId,{...r,status:'queued'});}persist();
  requiresContinue=life!==lifecycle||!isActive();ingest(value);schedule();
 });}
 async function recover(batchId=state.batchId){return operation(async()=>{
  if(!batchId)return;state.batchId=batchId;state.quote=null;prepared=[];continuationQuoteId=null;epoch++;
  const value=await api.recover({batchId});requiresContinue=true;
  const skipped=value.preflightSkipped||[];
  state.range={total:value.rows.length+skipped.length,processable:value.rows.length,skipped};
  for(const row of value.rows||[]){if(items.has(row.requestId))continue;let frozen;try{const s=row.snapshot,nonce=s.input.protected_tokens[0]?.match(/^⟦DAE_REF_(.+)_\d+⟧$/)?.[1];frozen=await freezeSnapshot(getTable(),s.target,revisions,{model:s.model,requirements:s.requirements,maxOutputTokens:s.maxOutputTokens,...(nonce?{nonce}:{})});if(frozen.wire.snapshotDigest!==s.snapshotDigest)frozen=null;}catch{}items.set(row.requestId,{...row,frozen});}
  ingest(value);schedule();
 });}
 function apply(ids){return operation(()=>{if(!isActive())throw new Error('当前模式不可应用');const selected=[...items.values()].filter(i=>ids.includes(i.requestId));const result=applySuggestions({table:getTable(),identity,revisions,items:selected,change});for(const id of result.applied)items.get(id).applied=true;state.error=result.conflicts.map(c=>c.reason).join('；');observe();return result;});}
 const controller={getState:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},setRequirements(text){state.requirements=text;onPreferences({model:state.model,requirements:text});state.quote=null;epoch++;update();},setModel(id){state.model=id;onPreferences({model:id,requirements:state.requirements});state.quote=null;epoch++;update();},estimate,submit,stop:()=>operation(async()=>{requiresContinue=true;await controlLease();ingest(await api.stop({batchId:state.batchId,leaseId:lease.leaseId}));}),recover,continue:()=>operation(async()=>{
  const life=lifecycle;
  if(!state.quote||state.quote.status!=='ready'||state.quote.quoteId!==continuationQuoteId||state.quote.expiresAt<=Date.now()||state.quote.quoteId===batch.quoteId){
   prepared=[];
   const e=++epoch,rows=batch.rows.map(i=>i.snapshot),quote=await api.estimate({rows,skipped:[],model:rows[0].model,maxOutputTokens:rows[0].maxOutputTokens});
   if(dead||e!==epoch||life!==lifecycle)return;
   state.quote=quote;continuationQuoteId=quote.quoteId;state.model=rows[0].model;
   if(quote.status!=='ready'){state.error=quote.reason||'剩余任务暂无法估算';return;}
   state.error='剩余任务预算已重新核对，请查看当前估算后再次点击继续剩余行。';return;
  }
  await controlLease();ingest(await api.continue({batchId:state.batchId,leaseId:lease.leaseId,quoteId:state.quote.quoteId,budgetCredits:state.quote.budgetUpperCredits}));requiresContinue=life!==lifecycle||!isActive();schedule();
 }),retry:({acknowledgeUnknown=false}={})=>{
  const unknown=[...items.values()].filter(i=>i.status==='unknown');
  if(unknown.length&&!acknowledgeUnknown){state.error='原请求结果未知，可能已产生费用；请明确确认新请求可能重复收费。';update();return;}
  acknowledgeUnknownRequestIds=unknown.map(i=>i.requestId);return estimate();
 },apply:id=>apply([id]),applyAll:()=>apply(state.rows.filter(r=>r.canApply).map(r=>r.requestId)),observe,pause(){requiresContinue=true;lifecycle++;update();},destroy(){dead=true;epoch++;clearTimeout(timer);listeners.clear();}};
 void operation(async()=>{const caps=await api.capabilities({});state.models=caps.models||[];if(!caps.available)state.error=caps.reason||'原生模型不可用';});
 return controller;
}

export function attachPromptOptimization({node,graph,editor,getTable,identity,fetchApi,isActive=()=>node.mode===0||node.mode==null}){
 const saved=()=>node.properties[NAMESPACE];
 const key=JSON.stringify(identity);let revisions=registries.get(key);if(!revisions){revisions=new OptimizationRevisions(saved().revisions);registries.set(key,revisions);}else revisions.merge(saved().revisions);
 const references=batchReferences.get(key)||new Map();batchReferences.set(key,references);
 for(const item of saved().batches||[])references.set(item.batchId,item);
 const persist=()=>{saved().revisions=revisions.serialize();saved().batches=[...references.values()];};const api=createPromptOptimizationApi({fetchApi});const controllers=new Map(),instanceId=uuid();let dead=false;
 function obtain(target){const key=JSON.stringify([target.scope,target.fieldId,target.recordId||'']);if(controllers.has(key))return controllers.get(key);
  const controller=createOptimizationController({getTable,identity,revisions,persist,change:editor.change,api,...target,instanceId,preferences:{model:saved().preferences?.model,requirements:saved().drafts?.[key]||''},onPreferences:value=>{saved().preferences={model:value.model};saved().drafts||={};saved().drafts[key]=value.requirements;},isActive:()=>!dead&&node.graph===graph&&isActive(),onBatch:(batchId,range)=>{references.set(batchId,{batchId,...range,updatedAt:Date.now()});persist();}});controllers.set(key,controller);
  const last=saved().batches?.filter(b=>b.scope===target.scope&&b.fieldId===target.fieldId&&b.recordId===target.recordId).reverse().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];if(last)void controller.recover(last.batchId);return controller;
 }
 editor.openPromptOptimization=target=>{const controller=obtain(target);editor.openTextSide(target.recordId||'',target.fieldId,target.scope==='column'?'优化整列提示词':'优化提示词',container=>{const panel=createPromptOptimizationPanel({controller,container});container.onCleanup(()=>panel?.destroy?.());},{kind:'optimization',returnFocus:target.anchor});if(!controller.getState().quote&&!controller.getState().batchId)void controller.estimate();};
 editor.promptOptimizationEstimate=async target=>{
  const table=getTable(),rows=target.scope==='cell'?table.records.filter(r=>r.id===target.recordId):table.records,temporary=new OptimizationRevisions(revisions.serialize()),frozen=[],skipped=[];
  for(const row of rows)try{frozen.push((await freezeSnapshot(table,{...identity,recordId:row.id,fieldId:target.fieldId},temporary,{begin:true,model:saved().preferences?.model||'gpt-4.1-mini',requirements:saved().drafts?.[JSON.stringify([target.scope,target.fieldId,target.recordId||''])]||''})).wire);}catch(e){skipped.push({recordId:row.id,reason:e.message});}
  return api.estimate({rows:frozen,skipped,model:saved().preferences?.model||'gpt-4.1-mini',maxOutputTokens:1024});
 };
 void api.query({target:identity}).then(result=>{if(dead)return;for(const item of result.batches||[]){
  // A late discovery is not an edit. Keep existing stable query references;
  // mutable server counters/timestamps must not disturb native Undo/Redo.
  if(!references.has(item.batchId))references.set(item.batchId,{batchId:item.batchId,scope:item.scope,fieldId:item.fieldId,...(item.recordId?{recordId:item.recordId}:{}),updatedAt:item.updatedAt});
 }persist();for(const controller of controllers.values()){const state=controller.getState();if(state.batchId)continue;const last=[...references.values()].filter(b=>b.scope===state.scope&&b.fieldId===state.fieldId&&b.recordId===state.recordId).reverse().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];if(last)void controller.recover(last.batchId);}}).catch(()=>{/* Offline ledger discovery can be retried on next mount. */});
 const unobserve=editor.onTableChange(()=>{revisions.observe(getTable());persist();for(const c of controllers.values())c.observe();});
 return {observe(){revisions.observe(getTable());persist();for(const c of controllers.values())c.observe();},pause(){for(const c of controllers.values())c.pause();},destroy(){dead=true;unobserve();for(const c of controllers.values())c.destroy();controllers.clear();delete editor.openPromptOptimization;delete editor.promptOptimizationEstimate;}};
}
