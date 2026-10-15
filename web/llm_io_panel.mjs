import {createTableButton,tableIcon} from './table_controls.mjs?v=20261015-qwen5';
import {availableModes,simulateRows,applyIOResult,undoIOResult} from './llm_io_model.mjs?v=20261015-mixed1';
import {slotRows,slotSignature,outputText} from './llm_slot_model.mjs?v=20261015-mixed1';
import {optimizeRow} from './llm_local_provider.mjs?v=20261015-provider2';
import {createLLMTask} from './llm_task_model.mjs?v=20261015-provider2';
export function bindIOPanel({node,root,source,instruction,select,run,upload,result,materialHint}){
    const saved=()=>node.properties.llmStylePreview;
    saved().instruction??=instruction.value;
    if(!['polish','reverse'].includes(saved().mode))saved().mode='polish';
    const listeners=[],on=(el,event,fn)=>{el.addEventListener(event,fn);listeners.push(()=>el.removeEventListener(event,fn));};
    const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
    const heading=result.querySelector('.llm-style-result-head');heading.querySelector('.llm-style-result-actions')?.remove();result.before(heading);
    const paragraph=make('p','',''),status=make('div','llm-style-preview-status');status.setAttribute('role','status');
    const actions=make('div','llm-style-result-actions');result.replaceChildren(paragraph,status,actions);
    const changed=()=>{node.graph?.change?.();render();};
    const apply=createTableButton('',()=>{if(applyIOResult(saved(),signature())){message='已应用 · 下游通过连线读取';changed();}});tableIcon(apply,'check-line','同意更改');
    const undo=createTableButton('',()=>{if(undoIOResult(saved())){message='已撤销应用';changed();}});tableIcon(undo,'arrow-go-back-line','撤销应用');
    const regenerate=createTableButton('',()=>run.click());tableIcon(regenerate,'restart-line','重新生成');
    for(const b of [apply,undo,regenerate])b.classList.add('llm-style-result-action');actions.append(apply,undo,regenerate);
    const sourceSection=source.closest('.llm-style-source');source.readOnly=true;source.placeholder='通过 Slot 连接文字输入';
    const imageSection=make('section','llm-style-section llm-style-image-source'),imageBox=make('div','llm-style-image-upload'),image=make('img','llm-style-image-preview'),imageText=make('span','llm-style-image-text','通过 Slot 连接参考图片');
    imageSection.append(make('span','llm-style-label','参考图片'),imageBox);imageBox.append(image,imageText);sourceSection.after(imageSection);materialHint.parentElement.hidden=true;
    select.replaceChildren(new Option('Qwen3.5-9B · 本地','qwen'),new Option('DeepSeek · API','deepseek'),new Option('跳过模型 · 流程测试','mock'));
    if(!['qwen','deepseek','mock'].includes(saved().model))saved().model='qwen';select.value=saved().model;
    const generationTask=createLLMTask();
    let busy=false,disposed=false,message='',task=[],lastInput='';
    function signature(){try{return slotSignature(node);}catch{return '';}}
    function render(){
        if(disposed)return;
        let rows=[],error='',waiting=false;try{rows=slotRows(node);}catch(e){error=e.message;waiting=!!e.waiting;}
        const inputKey=JSON.stringify(rows),modes=availableModes(rows);
        if(inputKey!==lastInput){
            lastInput=inputKey;
            const linkedInstructions=[...new Set(rows.map(r=>r.instruction).filter(Boolean))].join('\n\n');
            if(linkedInstructions){
                if(saved().slotInstruction===undefined)saved().manualInstruction=saved().instruction;
                saved().slotInstruction=linkedInstructions;saved().instruction=linkedInstructions;instruction.value=linkedInstructions;saved().mode='reverse';
            }else if(saved().slotInstruction!==undefined){
                saved().instruction=saved().manualInstruction||'';instruction.value=saved().instruction;delete saved().slotInstruction;delete saved().manualInstruction;
            }
            if(!modes[saved().mode]){if(modes.reverse)saved().mode='reverse';else if(modes.polish)saved().mode='polish';}
        }
        for(const b of root.querySelectorAll('[data-mode]')){const selected=b.dataset.mode===saved().mode;b.setAttribute('aria-pressed',String(selected));b.toggleAttribute('data-primary',selected);}
        const mode=saved().mode||'polish',reverse=mode==='reverse',disabled=busy||!!node.mode;
        sourceSection.hidden=reverse;imageSection.hidden=!reverse;
        source.value=rows.map(r=>r.text).filter(Boolean).join('\n\n');
        const first=rows.find(r=>r.image)?.image;image.hidden=!first;if(first&&image.getAttribute('src')!==first.url)image.src=first.url;image.alt=first?.name||'参考图片';imageText.hidden=!!first;imageBox.classList.toggle('has-image',!!first);
        source.disabled=instruction.disabled=select.disabled=disabled;
        instruction.readOnly=saved().slotInstruction!==undefined;
        for(const b of root.querySelectorAll('[data-mode]'))b.disabled=disabled;
        const valid=availableModes(rows)[mode];
        run.disabled=disabled||!!error||!valid;run.title='通过 Slot 读取输入，串行生成建议；应用后输出';run.lastChild.textContent=busy?'生成中…':'生成';run.setAttribute('aria-busy',String(busy));
        const d=saved().ioResult,stamp=signature(),stale=d?.signature!==stamp,isApplied=!!d?.requestId&&saved().appliedIO?.requestId===d.requestId;
        paragraph.textContent=d?.rows.map(r=>r.result).filter(Boolean).join('\n\n')||'';
        apply.disabled=disabled||!d?.complete||stale||isApplied;apply.hidden=isApplied;
        undo.disabled=disabled||!saved().ioUndo;undo.hidden=!saved().ioUndo;regenerate.disabled=run.disabled||!d;
        status.textContent=error||(d&&stale?'输入已改变，请重新生成':message|| (d?`${d.provider==='qwen'?'本地 Qwen 结果':d.provider==='deepseek'?'DeepSeek 结果':'示例结果 · 未调用模型'}${isApplied?' · 已应用':' · 待应用'}`:rows.length&&!valid?'当前连线输入不支持此模式':rows.length?`${rows.length} 项输入 · 等待生成`:'请通过 Slot 连接输入'));
        task=[...generationTask.snapshot(),...(!busy&&error?[{id:'llm-input',label:waiting?'等待输入':'输入异常',state:waiting?'queued':'error',detail:error}]:[])];
        try{node.setOutputData?.(0,outputText(node));}catch{node.setOutputData?.(0,null);}
    }
    on(select,'change',()=>{message='';changed();});on(instruction,'input',()=>{message='';changed();});
    for(const b of root.querySelectorAll('[data-mode]'))on(b,'click',()=>{message='';changed();});
    on(run,'click',async()=>{
        if(run.disabled||node.mode)return;
        const state=saved(),graph=node.graph,stamp=signature();busy=true;message='';render();
        const current=()=>!disposed&&node.graph===graph&&saved()===state&&!node.mode&&signature()===stamp;
        try{
            const rows=slotRows(node),provider=state.model;
            generationTask.start(rows.length,state.mode,provider);render();
            const proposal={version:1,requestId:crypto.randomUUID(),rows:[],mode:state.mode,instruction:state.instruction||'',signature:stamp,provider,complete:false};state.ioResult=proposal;
            if(['qwen','deepseek'].includes(provider))for(const row of rows){
                if(!current())throw new Error('输入或节点状态已改变，已停止后续提交');
                message=`${provider==='qwen'?'本地 Qwen':'DeepSeek'} 处理中 ${proposal.rows.length+1}/${rows.length} · 并发 1`;render();
                const output=await optimizeRow(row,state.mode,row.instruction??state.instruction??'',{model:provider});
                if(!current())throw new Error('输入或节点状态已改变，结果未应用');
                proposal.rows.push(output);generationTask.completeRow();graph?.change?.();render();
            }else {proposal.rows=simulateRows(rows,state.mode,state.instruction||'');for(const row of proposal.rows)generationTask.completeRow();}
            if(current()){proposal.complete=true;message='';generationTask.finish();graph?.change?.();}
        }catch(e){message='异常：'+e.message;generationTask.fail(e.message);}finally{busy=false;render();}
    });
    const timer=setInterval(()=>{if(root.isConnected)render();},500);render();
    const release=()=>{disposed=true;clearInterval(timer);for(const off of listeners)off();};release.sync=render;release.tasks=()=>task;return release;
}
