// Presentation only: derive progress from observed tasks, never invent model percentages.
const terminal=new Set(['succeeded','failed','skipped','stopped','unknown']);
const active=new Set(['submitting','submitted','polling']);
export function optimizationStatus(state,{now=Date.now(),composing=false,keyDraft=false,unknownAcknowledged=false}={}){
 const rows=state.rows||[],request=state.requestActivity,count=predicate=>rows.filter(predicate).length;
 const total=rows.length,settled=count(r=>terminal.has(r.status)),waiting=count(r=>['queued','preparing'].includes(r.status)&&(!request||r.requestId!==request.requestId));
 const unknown=count(r=>r.status==='unknown'),failed=count(r=>r.status==='failed'||r.suggestionStatus==='invalid'),stale=count(r=>r.suggestionStatus==='stale');
 const applied=count(r=>r.suggestionStatus==='applied'),usable=count(r=>r.canApply),stopped=count(r=>r.status==='stopped');
 const current=rows.find(r=>active.has(r.status));
 const result={total,settled,usable,showResults:total>0,progress:total?`已结束 ${settled}/${total} 行 · 等待 ${waiting} 行`:''};
 const show=(phase,title,detail,tone='neutral')=>({...result,phase,title,detail,tone});
 const operations={submit:['正在创建任务','正在校验输入并创建任务，请勿重复提交。'],recover:['正在查询原任务','正在读取已有状态，不会创建新的优化请求。'],stop:['正在停止剩余行','已发送的请求仍可能返回结果。'],continue:['正在准备继续','正在核对剩余任务的费用和提交条件。'],apply:['正在应用建议','仅写入仍然有效的目标提示词。']};
 if(operations[state.operationName])return show(state.operationName,...operations[state.operationName]);
 if(state.error&&state.paused&&current&&!request)return show('disconnected','状态查询中断','当前请求结果尚未确认。请查询原任务，不要重复提交。','warning');
 if(request||current){
  const elapsed=request?Math.max(0,Math.floor((now-request.startedAt)/1000)):null;
  return {...show('running',request?.phase==='prepare'?'正在准备请求':'正在请求模型',`${request?.label||current?.label||'当前行'}。${state.stopped?'剩余行已停止；当前请求等待返回。':'正在等待服务响应；模型未提供百分比进度。'}`),elapsed};
 }
 if(waiting||stopped&&state.permissions?.canContinue){
  if(state.paused||state.stopped)return show('paused',state.stopped?'已停止剩余行':'已暂停',state.error||(state.deepseekKeyRequired?'请展开优化设置，保存密钥后继续。':state.continuationReady?'剩余费用已重新估算。确认费用后点击“确认继续剩余行”。':'点击“核对继续费用”先查看估算，此步骤不收费。'),'warning');
  return show('queued','等待提交',`${waiting} 行等待处理，将按顺序逐行提交。`);
 }
 if(state.quote?.status==='estimating')return show('estimating','正在更新估算','正在校验范围并计算费用，不会调用模型。');
 if(total&&!state.draftActive){
  if(unknown)return show('unknown','处理结束，存在未知结果',`${unknown} 行未取得确定结果，可能已经计费。先查看结果说明；不会自动重发。`,'warning');
  if(failed||stale)return show('attention','处理结束，部分结果需处理',`失败或无效 ${failed} 行 · 已过期 ${stale} 行 · 可应用 ${usable} 行。`,'warning');
  if(stopped)return show('stopped','已停止',`${stopped} 行未继续提交。已有结果仍可查看。`);
  if(applied)return show('applied',usable?'部分建议已应用':'建议已应用',`已应用 ${applied} 行${usable?`，还有 ${usable} 行可应用`: '；可使用撤销恢复原文'}。`,'success');
  if(usable)return show('completed','优化完成，等待应用',`${usable} 行有有效建议。查看对比后应用，原提示词尚未改动。`,'success');
  return show('completed','处理完成',rows.some(r=>r.suggestionStatus==='unchanged')?'未发现可安全改进的内容，原提示词保持不变。':'没有可应用的建议，请查看各行结果说明。','success');
 }
 if(state.inactiveReason)return show('inactive','当前不可提交',state.inactiveReason,'warning');
 if(state.error)return show('error','需要处理',state.error,'warning');
 if((state.unknownRequests?.length||unknown)&&!unknownAcknowledged)return show('acknowledge','请确认未知请求的费用风险','查看全部历史未知请求并勾选确认后，再准备新的优化请求。','warning');
 if(composing)return show('composing','正在输入','请先确认输入法候选词，再更新估算。');
 if(keyDraft)return show('key','密钥尚未保存','请点击“保存到本页会话”，使输入的密钥生效。');
 if(state.deepseekKeyRequired)return show('key','请先保存密钥','填写 DeepSeek API 密钥并保存到本页会话，然后更新估算。');
 const quote=state.quote;
 if(quote?.status==='expired'||quote?.expiresAt&&quote.expiresAt<=now)return show('expired','估算已失效','请点击“更新估算”，确认新费用后再开始。');
 if(quote?.status==='unavailable')return show('unavailable','暂时无法开始',quote.reason||'请检查可处理行和服务状态，再更新估算。','warning');
 if(!quote)return show('estimate','请更新估算','输入或优化要求已变化；点击“更新估算”，此步骤不收费。');
 if(state.permissions?.canSubmit)return show('ready','可以开始优化','费用已估算；点击“开始优化”才会提交付费请求。');
 return show('blocked','尚不可开始','请检查目标是否仍有效，并更新估算。');
}
