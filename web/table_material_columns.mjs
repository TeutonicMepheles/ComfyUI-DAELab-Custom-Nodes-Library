import {addField,addRecord,normalizeTable,uid} from './data_table_model.mjs?v=20260930-inline4';

export function createMaterialTable(){
    const table=normalizeTable({meta:{material_columns:true}});
    for(let i=1;i<=2;i++)addField(table,{name:`列 ${i}`,type:'content',maxItems:1,width:260});
    for(let i=0;i<2;i++)addRecord(table,Object.fromEntries(table.fields.map(f=>[f.id,[]])));
    return table;
}

// An explicit drop copies an ordered snapshot. It never establishes a hidden
// runtime graph input or changes reviewed values again when the source changes.
export function fillMaterialColumn(table,fieldId,collection){
    const field=table.fields.find(f=>f.id===fieldId);
    if(!field||!['assets','content'].includes(field.type)||field.readonly)throw new Error('此列不能接收素材');
    const assets=collection?.assets;
    if(!Array.isArray(assets))throw new Error('素材组数据无效，未修改表格');
    if(assets.length>500)throw new Error('每张表最多 500 行');
    if(assets.some(a=>a.missing||!a.filename||!['image','video'].includes(a.kind)))throw new Error('素材组中有缺失或不支持的素材，未修改表格');
    const previous=table.records.map(r=>r.values[fieldId]?.[0]);
    while(table.records.length<assets.length)addRecord(table);
    field.maxItems=1;
    assets.forEach((asset,index)=>{
        const url='/view?'+new URLSearchParams({filename:asset.filename,subfolder:asset.subfolder||'',type:asset.type||'input'});
        const old=previous[index];
        table.records[index].values[fieldId]=[{id:old?.url===url?old.id:uid(),url,name:asset.filename,kind:asset.kind,sourceNodeId:asset.nodeId}];
    });
}
