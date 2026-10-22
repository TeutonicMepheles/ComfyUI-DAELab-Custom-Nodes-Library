import {normalizeTable} from './data_table_model.mjs';

// A linked table is a selection/view over its source, not an exported copy.
// Keep row IDs and image objects unchanged so approvals survive save/reload.
export function projectTableSource(local, source) {
    local=normalizeTable(local); source=normalizeTable(source);
    const settings=local.meta.liveSource||{}, previous=new Map(local.records.map(r=>[r.id,r]));
    const bindings=source.meta.script_parser?.bindings;
    const mapping=settings.fields||Object.fromEntries(source.fields.map(f=>[f.id,f.id]));
    const fields=Object.entries(mapping).map(([id,origin])=>{
        const upstream=source.fields.find(f=>f.id===origin);
        if(!upstream)throw new Error('上游字段已删除，请重新连接表格');
        const saved=local.fields.find(f=>f.id===id);
        const hidden=saved?.hidden??(bindings?origin!==bindings.scene&&!source.meta.script_parser?.reference_fields?.includes(origin):upstream.hidden);
        return {...upstream,...saved,id,type:['text','longtext','assets'].includes(upstream.type)?'content':upstream.type,readonly:true,hidden};
    });
    return normalizeTable({...local,fields,meta:{...local.meta,material_columns:true,liveSource:{...settings,fields:mapping}},records:source.records.map(row=>({
        ...row,selected:previous.get(row.id)?.selected===true,
        values:Object.fromEntries(Object.entries(mapping).map(([id,origin])=>[id,structuredClone(row.values[origin]??'')]))
    }))});
}

export function selectedTableOutput(table) {
    const result=normalizeTable(table);
    result.records=result.records.filter(row=>row.selected);
    return result;
}
