import {normalizeTable} from './data_table_model.mjs?v=20261023-h3-size-r3';
export const MODE_LABELS={polish:'提示词润色',reverse:'图片反推',custom:'自定义'};
export function tableInput(table){
    const fields=table.fields.filter(f=>!f.hidden), images=fields.filter(f=>['assets','content'].includes(f.type)&&table.records.some(r=>Array.isArray(r.values[f.id])&&r.values[f.id].length)), texts=fields.filter(f=>['text','longtext','content'].includes(f.type)&&table.records.some(r=>typeof r.values[f.id]==='string'&&r.values[f.id].trim()));
    if(images.length>1||texts.length>1)throw new Error('本轮请使用一列图片和一列文本的表格');
    return {version:1,rows:table.records.map((r,i)=>{
        const assets=images[0]?r.values[images[0].id]||[]:[];
        if(!Array.isArray(assets)||assets.length>1)throw new Error(`第 ${i+1} 行请只放一张图片`);
        return {id:r.id,index:i+1,text:texts[0]?String(r.values[texts[0].id]??''):'',image:assets[0]||null};
    })};
}
export function imageReference(asset){
    if(asset.missing||asset.kind!=='image')throw new Error('输入含缺失素材或非图片，请先修正');
    const url=asset.url||('/view?'+new URLSearchParams({filename:asset.filename,subfolder:asset.subfolder||'',type:asset.type||'input'}));
    if((!url.startsWith('/view?')&&!/^data:image\/(png|jpeg|webp);base64,/.test(url))||(!asset.url&&!asset.filename))throw new Error('请使用 ComfyUI 本地图片');
    return {...asset,url,name:asset.name||asset.filename||'图片'};
}
export function pairInputs(snapshots,manual=''){
    const texts=[],images=[],rows=[];
    for(const snapshot of snapshots){
        if(!snapshot||snapshot.version!==1)throw new Error('输入来源不可用，请刷新或重新选择');
        if(snapshot.inputMode==='image-instructions'){
            const instruction=(snapshot.texts||[]).filter(t=>t.trim()).join('\n\n');
            rows.push(...(snapshot.assets||[]).map((asset,i)=>({id:`group-${rows.length+i+1}`,text:'',image:imageReference(asset),instruction})));
            continue;
        }
        if(snapshot.rows){rows.push(...snapshot.rows.map(r=>({...r,image:r.image?imageReference(r.image):null})));continue;}
        texts.push(...(snapshot.texts||[]));
        images.push(...(snapshot.assets||[]).map(imageReference));
    }
    if(manual.trim())texts.push(...manual.split(/\n\s*\n/).map(t=>t.trim()));
    if(rows.length&&(texts.length||images.length))throw new Error('表格已按行配对，请单独处理表格，或先将其他输入整理进表格');
    if(!rows.length)for(let i=0;i<Math.max(texts.length,images.length);i++)rows.push({id:`input-${i+1}`,index:i+1,text:texts[i]||'',image:images[i]||null});
    if(rows.length>500)throw new Error('每次最多处理 500 行');
    if(!rows.some(r=>r.text.trim()||r.image))throw new Error('请先输入文字或图片');
    return rows.map((r,i)=>({...r,index:r.index||i+1}));
}
export function availableModes(rows){
    const active=rows.filter(r=>r.text.trim()||r.image);
    return {polish:!!active.length&&active.every(r=>r.text.trim()),reverse:!!active.length&&active.every(r=>r.image),custom:!!active.length};
}
export function simulateRows(rows,mode,instruction){
    if(!availableModes(rows)[mode])throw new Error('此处理方式不适用于当前输入，请切换方式或补齐对应内容');
    return rows.map(row=>({...row,result:row.text.trim()||row.image?`【模拟结果 ${row.index} · ${MODE_LABELS[mode]}】\n${row.text||`图片：${row.image.name}`}\n${instruction.trim()?`处理要求：${instruction.trim()}`:'模型处理已跳过'}`:'',status:row.text.trim()||row.image?'simulated':'empty'}));
}
export function applyIOResult(state,signature){
    if(!state.ioResult?.complete||state.ioResult.signature!==signature||state.appliedIO===state.ioResult)return false;
    if(state.appliedIO?.requestId===state.ioResult.requestId&&state.ioResult.requestId)return false;
    const next=JSON.parse(JSON.stringify(state.ioResult));
    state.ioUndo={previous:state.appliedIO||null,requestId:state.ioResult.requestId};
    state.appliedIO=next;return true;
}
export function undoIOResult(state){
    if(!state.ioUndo||state.appliedIO?.requestId!==state.ioUndo.requestId)return false;
    state.appliedIO=state.ioUndo.previous;delete state.ioUndo;return true;
}
export function outputTable(rows,mode,instruction,provider='mock'){
    return normalizeTable({meta:{material_columns:true,llmIO:{version:1,provider,mode,instruction}},fields:[{id:'image',name:'图片',type:'content',width:240},{id:'text',name:provider==='mock'?'文本 · 模拟结果':'文本 · 优化结果',type:'content',width:440}],records:rows.map(row=>({id:row.id||`row-${row.index}`,selected:false,values:{image:row.image?[row.image]:[],text:row.result},meta:{llmIO:{index:row.index,originalText:row.text,status:row.status,provider}}}))});
}
