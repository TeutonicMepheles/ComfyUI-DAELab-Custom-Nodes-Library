import {pairInputs,tableInput} from './llm_io_model.mjs?v=20261023-h3-size-r3';
import {readTableSnapshot} from './table_exchange.mjs?v=20261023-h3-size-r3';
const API=Symbol.for('DAELAB.CreativeCanvas.API.v1');
export function slotRows(node,seen=new Set()){
    if(seen.has(node))throw new Error('输入连线形成循环');
    seen=new Set(seen).add(node);
    const snapshots=[];
    for(const input of node.inputs||[]){
        if(input.link==null)continue;
        const link=node.graph?.links[input.link],upstream=node.graph?.getNodeById(link?.origin_id);
        if(!upstream||upstream.mode)throw new Error('输入节点不可用或已停用');
        let snapshot;
        if(upstream.type==='DAELAB.LLMStylePreviewB')snapshot=appliedSnapshot(upstream,seen);
        else if(upstream.type==='DAELAB.Table')snapshot=tableInput(readTableSnapshot(upstream));
        else snapshot=globalThis[API]?.inputSnapshot?.(upstream);
        // Native node widget schemas are public; no business panel internals.
        if(!snapshot&&['PrimitiveString','PrimitiveStringMultiline'].includes(upstream.type))snapshot={version:1,texts:[String(upstream.widgets?.find(w=>w.name==='value')?.value??'')]};
        if(!snapshot&&upstream.type==='LoadImage'){
            const filename=upstream.widgets?.find(w=>w.name==='image')?.value;
            if(filename)snapshot={version:1,assets:[{kind:'image',filename,type:'input'}]};
        }
        if(!snapshot){const data=upstream.getOutputData?.(link.origin_slot);if(typeof data==='string')snapshot={version:1,texts:[data]};}
        if(snapshot?.ready===false){const e=new Error('等待上游生成并应用结果');e.waiting=true;throw e;}
        if(!snapshot&&upstream.type?.startsWith('DAELAB.')&&typeof globalThis[API]?.inputSnapshot!=='function')throw new Error('画布素材接口尚未加载，请保存工作流并刷新页面后重试');
        if(!snapshot)throw new Error(`无法解析 ${upstream.title||upstream.type}（${upstream.type}）的输入，请连接可用文字、图片或素材表格`);
        if(!snapshot.texts&&!snapshot.assets&&!snapshot.rows)throw new Error('无法解析此输入类型');
        snapshots.push(snapshot);
    }
    if(!snapshots.length) return [];
    return pairInputs(snapshots);
}
export function slotSignature(node,seen){const s=node.properties?.llmStylePreview||{};return JSON.stringify([slotRows(node,seen),s.mode||'polish',s.instruction||'',s.model||'qwen']);}
export function appliedSnapshot(node,seen){
    const a=node.properties?.llmStylePreview?.appliedIO;
    if(node.mode||!a?.complete||a.signature!==slotSignature(node,seen))return {version:1,ready:false,texts:[]};
    return {version:1,ready:true,texts:a.rows.map(r=>r.result||''),rows:a.rows.map((r,i)=>({id:r.id||`input-${i+1}`,index:i+1,text:r.result||'',image:r.image||null}))};
}
export function outputText(node){const snapshot=appliedSnapshot(node);if(!snapshot.ready)throw new Error('LLM 优化结果尚未应用，或输入已改变');return snapshot.texts.join('\n\n');}

export function outputRows(node){const snapshot=appliedSnapshot(node);if(!snapshot.ready)throw new Error('LLM 优化结果尚未应用，或输入已改变');return JSON.stringify(snapshot);}
