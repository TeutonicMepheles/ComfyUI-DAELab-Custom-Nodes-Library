import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261008-prompt-optimization';

const taskLabels={queued:'等待提交',preparing:'准备中',submitting:'正在提交',submitted:'已提交',polling:'等待结果',succeeded:'已完成',failed:'失败',skipped:'已跳过',stopped:'已停止',unknown:'提交结果未知'};
const suggestionLabels={valid:'有改动建议',unchanged:'未发现可安全改进的内容',stale:'建议已过期',invalid:'建议无效',applied:'已应用'};
const node=(tag,parent,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;parent?.append(e);return e;};
const credits=value=>typeof value==='number'&&Number.isFinite(value)?`${value.toLocaleString('zh-CN',{maximumFractionDigits:6})} 积分`:null;

export function optimizationQuoteLabel(quote,now=Date.now()){
    if(!quote)return '待估算';
    if(quote.status==='estimating')return '估算中…';
    if(quote.status==='expired'||quote.expiresAt&&quote.expiresAt<=now)return '估算已失效';
    if(quote.status!=='ready'||credits(quote.estimatedCredits)===null)return '暂无法估算';
    return `预计 ${credits(quote.estimatedCredits)}`;
}

// Used by both canvas context menus and native table menus. Estimating never
// opens a controller or submits an optimization request.
export function createPromptOptimizationEntry({editor,target}){
    let alive=true,quote={status:'estimating'};
    const element=node('span',null,undefined,'prompt-opt-entry');
    const label=target.scope==='column'?'优化整列提示词':'优化此提示词';
    const open=button(label,()=>editor.openPromptOptimization({...target,anchor:open}));
    tableIcon(open,'sparkling-line',label);
    node('span',open,target.scope==='column'?'AI 优化 · 列':'AI 优化');
    open.classList.add('prompt-opt-trigger');element.append(open);
    const cost=node('span',element,'估算中…','prompt-opt-menu-cost');cost.setAttribute('role','status');
    const update=()=>{if(alive){cost.textContent=optimizationQuoteLabel(quote);cost.title=quote?.reason||'仅估算，不会提交请求；打开侧栏后点击开始优化才会产生费用';}};
    Promise.resolve().then(()=>editor.promptOptimizationEstimate(target)).then(value=>{if(alive){quote=value;update();}},error=>{if(alive){quote={status:'unavailable',reason:error?.message};update();}});
    const timer=setInterval(update,1000);
    return {element,destroy(){alive=false;clearInterval(timer);element.remove();}};
}

// A view of the public controller: no API transport, table mutation, or result
// validation lives here. Inputs and row DOM survive polling updates.
export function createPromptOptimizationPanel({controller,container,renderPrompt}){
    let alive=true,composing=false,state=controller.getState(),modelSignature='',localError='';
    const view=node('section',container,undefined,'prompt-opt-panel');
    const scroller=node('div',view,undefined,'prompt-opt-scroll');
    node('p',scroller,'保留引用，仅润色可编辑文字；不会改写引用列。','prompt-opt-hint');
    const scope=node('p',scroller,'','prompt-opt-range');scope.setAttribute('role','status');
    const skipped=node('details',scroller,undefined,'prompt-opt-skipped');
    const skippedTitle=node('summary',skipped,'跳过原因'),skippedItems=node('ul',skipped);let skippedSignature='';
    const modelLabel=node('label',scroller,'润色模型','prompt-opt-field'),model=node('select',modelLabel);model.setAttribute('aria-label','润色模型');
    const requirementsLabel=node('label',scroller,'优化要求（可留空）','prompt-opt-field'),requirements=node('textarea',requirementsLabel);
    requirements.rows=3;requirements.placeholder='留空时提升清晰度、消除重复与含混表达，保持原意，不主动扩写。';requirements.setAttribute('aria-label','优化要求');
    requirements.addEventListener('compositionstart',()=>composing=true);
    requirements.addEventListener('compositionend',()=>{composing=false;controller.setRequirements(requirements.value);});
    requirements.addEventListener('input',()=>{if(!composing)controller.setRequirements(requirements.value);});
    model.addEventListener('change',()=>controller.setModel(model.value));
    const pricing=node('details',scroller,undefined,'prompt-opt-pricing');node('summary',pricing,'积分估算依据');
    const pricingText=node('p',pricing),priceSource=node('a',pricing);priceSource.target='_blank';priceSource.rel='noopener noreferrer';
    const counts=node('p',scroller,'','prompt-opt-counts');counts.setAttribute('role','status');
    const rowList=node('div',scroller,undefined,'prompt-opt-results'),rowViews=new Map();
    const recovery=node('div',scroller,undefined,'prompt-opt-recovery');
    const unknown=node('p',recovery,'提交结果未知，可能已经产生费用。查询原任务不会新建请求；重新优化会创建新的付费请求，可能重复计费。','prompt-opt-warning');
    const acknowledge=node('label',recovery,undefined,'prompt-opt-ack'),ack=node('input',acknowledge);ack.type='checkbox';node('span',acknowledge,'我理解重新优化可能重复计费');ack.addEventListener('change',()=>render(state));
    const recoveryActions=node('div',recovery,undefined,'prompt-opt-actions');
    const run=async(method,...args)=>{if(composing&&['submit','estimate','retry','continue'].includes(method))return;localError='';try{await controller[method](...args);}catch(error){if(alive){localError=error?.message||String(error);render(controller.getState());}}};
    const recover=button('查询原任务',()=>run('recover')),resume=button('继续剩余行',()=>run('continue')),retry=button('重新优化（新请求）',()=>run('retry'));
    recoveryActions.append(recover,resume,retry);
    const error=node('p',view,'','prompt-opt-error');error.setAttribute('role','alert');
    const footer=node('footer',view,undefined,'prompt-opt-footer');
    const quoteText=node('strong',footer),footerRange=node('span',footer,undefined,'prompt-opt-hint');
    const footerActions=node('div',footer,undefined,'prompt-opt-actions');
    const estimate=button('更新估算',()=>run('estimate')),start=button('开始优化',()=>run('submit'),true),stop=button('停止剩余行',()=>run('stop'));
    footerActions.append(estimate,start,stop);
    const applyAll=button('应用全部有效建议',()=>run('applyAll'));footer.append(applyAll);
    const displayPrompt=(element,value)=>{if(element._prompt===value)return;element._prompt=value;element.replaceChildren();if(renderPrompt)renderPrompt(element,value);else element.textContent=value??'';};
    function rowView(row){
        let v=rowViews.get(row.requestId);if(v)return v;
        const element=node('details',rowList,undefined,'prompt-opt-result'),summary=node('summary',element),title=node('span',summary),status=node('span',summary,undefined,'prompt-opt-row-status');
        const comparison=node('div',element,undefined,'prompt-opt-comparison');
        node('strong',comparison,'原提示词');const before=node('pre',comparison);node('strong',comparison,'优化建议');const after=node('pre',comparison);
        const reason=node('p',element,undefined,'prompt-opt-hint'),actual=node('p',element,undefined,'prompt-opt-hint');
        const apply=button('应用此建议',()=>run('apply',row.requestId));element.append(apply);
        v={element,title,status,before,after,reason,actual,apply};rowViews.set(row.requestId,v);return v;
    }
    function render(next){
        if(!alive)return;state=next;
        const permissions=state.permissions||{},range=state.range||{total:0,processable:0,skipped:[]},rows=state.rows||[],quote=state.quote;
        view.setAttribute('aria-busy',String(Boolean(state.busy)));
        scope.textContent=`${state.scope==='column'?'整列':'单元格'}：共 ${range.total} 行，处理 ${range.processable} 行，跳过 ${range.skipped?.length||0} 行`;
        footerRange.textContent=state.scope==='column'?`整列 ${range.processable} 行 · 点击开始才提交`:'单元格 · 点击开始才提交';
        skipped.hidden=!range.skipped?.length;skippedTitle.textContent=`查看 ${range.skipped?.length||0} 行跳过原因`;
        const signature=JSON.stringify(range.skipped);if(signature!==skippedSignature){skippedSignature=signature;skippedItems.replaceChildren();for(const item of range.skipped||[])node('li',skippedItems,`${item.label||item.recordId}：${item.reason}`);}
        const models=state.models||[],newModelSignature=JSON.stringify([models,state.model]);
        if(modelSignature!==newModelSignature){modelSignature=newModelSignature;model.replaceChildren();if(!models.some(m=>m.id===state.model)){const unavailable=node('option',model,`${state.model||'未选择'}（不可用）`);unavailable.value=state.model||'';unavailable.disabled=true;}for(const item of models){const option=node('option',model,`${item.label||item.id}${item.available===false?'（不可用）':''}`);option.value=item.id;option.disabled=item.available===false;}model.value=state.model||'';}
        if(!composing&&document.activeElement!==requirements&&requirements.value!==(state.requirements||''))requirements.value=state.requirements||'';
        model.disabled=Boolean(state.busy);requirements.disabled=Boolean(state.busy)&&!composing;
        const expired=quote?.status==='expired'||Boolean(quote?.expiresAt&&quote.expiresAt<=Date.now());
        quoteText.textContent=optimizationQuoteLabel(quote);
        pricingText.textContent=quote?[
            `完整输入 ${quote.inputTokens??'未知'} tokens；预计输出 ${quote.expectedOutputTokens??'未知'} tokens；最大输出 ${quote.maxOutputTokens??'未知'} tokens。`,
            `预计消耗：${credits(quote.estimatedCredits)||'暂无法估算'}。预算上界：${credits(quote.budgetUpperCredits)||'暂无法估算'}（不是预期消耗）。`,
            quote.price?`费率版本：${quote.price.version||'未提供'}；单位：${quote.price.unit||'未提供'}。`:'尚无可信价格。',quote.reason||''
        ].join('\n'):'更新估算后可查看完整输入、预计输出与预算上界。';
        const source=quote?.price?.source||quote?.price?.sourceUrl;const safeSource=typeof source==='string'&&/^https:\/\//.test(source);priceSource.hidden=!safeSource;if(safeSource){priceSource.href=source;priceSource.textContent='查看官方价格来源';}
        const count=status=>rows.filter(r=>r.suggestionStatus===status).length;
        counts.textContent=`有改动 ${count('valid')} · 未改动 ${count('unchanged')} · 失败 ${rows.filter(r=>r.status==='failed'||r.suggestionStatus==='invalid').length} · 跳过 ${rows.filter(r=>r.status==='skipped').length} · 过期 ${count('stale')} · 未知 ${rows.filter(r=>r.status==='unknown').length}`;
        if(state.scope==='column'&&rows.length)footerRange.textContent+=`\n可应用 ${rows.filter(r=>r.canApply).length} 条 · 冲突 ${count('stale')+count('invalid')} 条，应用时重新校验`;
        const ids=new Set(rows.map(r=>r.requestId));for(const [id,v] of rowViews)if(!ids.has(id)){v.element.remove();rowViews.delete(id);}
        for(const row of rows){const v=rowView(row);v.title.textContent=row.label||row.recordId;v.status.textContent=suggestionLabels[row.suggestionStatus]||taskLabels[row.status]||row.status;v.element.dataset.status=row.suggestionStatus||row.status;displayPrompt(v.before,row.before);displayPrompt(v.after,row.after);v.reason.textContent=row.reason||'';v.reason.hidden=!row.reason;v.actual.textContent=credits(row.actualCredits)?`实际消耗：${credits(row.actualCredits)}`:'实际消耗未取得';v.apply.disabled=!row.canApply||Boolean(state.busy);}
        const hasUnknown=rows.some(r=>r.status==='unknown');unknown.hidden=!hasUnknown;acknowledge.hidden=!hasUnknown;if(!hasUnknown)ack.checked=false;
        recovery.hidden=!state.batchId;recover.hidden=!permissions.canRecover;recover.disabled=Boolean(state.busy);resume.hidden=!permissions.canContinue;resume.disabled=Boolean(state.busy);
        retry.disabled=Boolean(state.busy)||rows.some(r=>['queued','preparing','submitting','submitted','polling'].includes(r.status))||(hasUnknown&&!ack.checked);retry.hidden=!rows.length;
        estimate.disabled=!permissions.canEstimate||Boolean(state.busy);start.disabled=!permissions.canSubmit||Boolean(state.busy)||composing||expired||quote?.status!=='ready';stop.hidden=!permissions.canStop;stop.disabled=!permissions.canStop;
        applyAll.hidden=state.scope!=='column';applyAll.disabled=!permissions.canApplyAll||Boolean(state.busy);applyAll.textContent=`应用全部有效建议（${rows.filter(r=>r.canApply).length}）`;
        error.textContent=localError||state.error||'';error.hidden=!error.textContent;
    }
    const unsubscribe=controller.subscribe(render);render(state);
    const timer=setInterval(()=>{if(state.quote?.expiresAt&&state.quote.expiresAt<=Date.now())render(state);},1000);
    return {root:view,destroy(){alive=false;unsubscribe?.();clearInterval(timer);view.remove();}};
}
