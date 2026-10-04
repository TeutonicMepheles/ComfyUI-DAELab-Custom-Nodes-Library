import {addField,addRecord,emptyValue,normalizeTable,uid} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {addGenerationColumn} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';

export function createMaterialTable(){
    const table=normalizeTable({meta:{material_columns:true}});
    addField(table,{name:'图片/视频',type:'content',width:260});
    const generation=addGenerationColumn(table,{name:'生成'});
    table.fields.find(f=>f.id===generation.generation.promptFieldId).width=420;
    for(let i=0;i<3;i++)addRecord(table,Object.fromEntries(table.fields.map(f=>[f.id,emptyValue(f)]))).selected=false;
    return table;
}

// An explicit drop copies an ordered snapshot. It never establishes a hidden
// runtime graph input or changes reviewed values again when the source changes.
const accepts=field=>field&&!field.hidden&&!field.readonly&&['assets','content'].includes(field.type);
function materialSnapshot(collection){
    const assets=collection?.assets;
    if(!Array.isArray(assets))throw new Error('素材组数据无效，未修改表格');
    if(assets.some(a=>a.missing||!a.filename||!['image','video'].includes(a.kind)))throw new Error('素材组中有缺失或不支持的素材，未修改表格');
    return assets.map(asset=>({id:uid(),url:'/view?'+new URLSearchParams({filename:asset.filename,subfolder:asset.subfolder||'',type:asset.type||'input'}),name:asset.name||asset.filename,kind:asset.kind,sourceNodeId:asset.nodeId}));
}
export function fillMaterialColumn(table,fieldId,collection){
    const field=table.fields.find(f=>f.id===fieldId);
    if(!accepts(field))throw new Error('此列不能接收素材');
    const assets=materialSnapshot(collection);
    if(assets.length>500)throw new Error('每张表最多 500 行');
    while(table.records.length<assets.length)addRecord(table);
    assets.forEach((asset,index)=>{
        const old=table.records[index].values[fieldId]?.[0];
        table.records[index].values[fieldId]=[{...asset,id:old?.url===asset.url?old.id:asset.id}];
    });
}
export function fillMaterialCell(table,recordId,fieldId,collection){
    const row=table.records.find(r=>r.id===recordId),field=table.fields.find(f=>f.id===fieldId);
    if(!row||!accepts(field))throw new Error('此单元格不能接收素材');
    const assets=materialSnapshot(collection);if(!assets.length)return;
    const previous=row.values[fieldId];
    if(field.type==='assets'&&field.maxItems===1&&assets.length+(Array.isArray(previous)?previous.length:0)>1)throw new Error('此列仅支持单个素材，请拖到列头填充');
    row.values[fieldId]=[...(Array.isArray(previous)?previous:[]),...assets];
}
export function fillMaterialRow(table,recordId,collection){
    const row=table.records.find(r=>r.id===recordId);if(!row)throw new Error('此行已不存在');
    const assets=materialSnapshot(collection),fields=table.fields.filter(accepts);
    if(table.fields.length+Math.max(0,assets.length-fields.length)>64)throw new Error('表格最多 64 列，请减少横向填充的素材');
    while(fields.length<assets.length)fields.push(addField(table,{name:`列 ${table.fields.length+1}`,type:'content',width:260}));
    assets.forEach((asset,index)=>{const id=fields[index].id,old=row.values[id]?.[0];row.values[id]=[{...asset,id:old?.url===asset.url?old.id:asset.id}];});
}
