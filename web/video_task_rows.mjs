import {addField,uid} from './data_table_model.mjs?v=20261023-h3-size-r3';
import {rowGenerationConfig,setRowGenerationConfig,applyPromptContent} from './table_generation_model.mjs?v=20261023-h3-size-r3';

const active=row=>Object.values(row.meta?.generationColumns||{}).some(s=>['waiting','running','queued','preparing','submitting','recovering','pausing'].includes(s.phase));

// Update inputs by stable source row ID. Never replace remote receipts/results.
// Deselected rows stay serialized so selecting them again restores their results.
export function syncApprovedTaskRows(state,snapshot){
    if(snapshot?.version!==1||snapshot.ready!==true||!snapshot.rows?.length)throw new Error('等待上游选行、优化并同意更改');
    const ids=new Set();
    for(const row of snapshot.rows){
        if(!row.id||ids.has(row.id)||typeof row.text!=='string'||!row.text.trim())throw new Error('逐行结果缺少有效的镜头 ID 或提示词');
        ids.add(row.id);
        if(row.image&&(row.image.kind!=='image'||!row.image.url?.startsWith('/view?')))throw new Error('逐行结果需要本地 Comfy 参考图');
    }
    if(state.table.records.some(active))throw new Error('任务正在运行，待结束后同步上游');
    const table=state.table,field=table.fields.find(f=>f.id===state.fieldId);
    if(!field)throw new Error('生成结果列已删除');
    const saved=new Map([...(state.archivedTasks||[]),...table.records].map(row=>[row.id,row]));
    const next=[];
    for(const incoming of snapshot.rows){
        let row=saved.get(incoming.id);
        if(!row){row={id:incoming.id,name:`镜头 ${incoming.index||next.length+1}`,selected:false,values:{[field.id]:[]},meta:{}};setRowGenerationConfig(row,field.id,structuredClone(field.generation));}
        const cfg=rowGenerationConfig(row,field.id,field.generation);
        let binding=null;
        if(incoming.image){
            const image=incoming.image;
            let column=table.fields.find(f=>f.id!==field.id&&Array.isArray(row.values[f.id])&&row.values[f.id].some(a=>a.id===image.id||a.url===image.url));
            column||=table.fields.find(f=>f.approvedRowReference);
            if(!column)column=addField(table,{name:'上游参考图',type:'content',approvedRowReference:true});
            const old=row.values[column.id]?.find?.(a=>a.id===image.id||a.url===image.url);
            const asset={...structuredClone(image),id:old?.id||image.id||uid()};
            row.values[column.id]=[asset];binding={fieldId:column.id,assetId:asset.id};
        }
        const segments=[...(binding?[{type:'frame',generationFieldId:field.id,role:'first',binding}]:[]),{type:'text',text:incoming.text}];
        applyPromptContent(table,row,cfg.promptFieldId,segments,field.id);
        next.push(row);
    }
    state.archivedTasks=[...saved.values()].filter(row=>!ids.has(row.id));
    table.records=next;
    if(!ids.has(state.currentId))state.currentId=next[0].id;
}
