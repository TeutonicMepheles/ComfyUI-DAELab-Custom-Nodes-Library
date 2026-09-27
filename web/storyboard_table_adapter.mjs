import {normalizeTable,clone,addField,uid} from './data_table_model.mjs';
import {normalizeStoryboard,durationFromTimeRange} from './daelab_storyboard_model.mjs?v=20260926-batch1';

export const STORYBOARD_ROLES={shot_no:'镜号',time_range:'剧本时长',image_prompt:'画面描述',camera_notes:'镜头备注',image_url:'参考素材',source:'导入来源',original_fields:'原文字段',generation_status:'生成状态',video_result:'视频结果'};
const specs={shot_no:['text',100],time_range:['text',120],image_prompt:['longtext',300],camera_notes:['longtext',230],image_url:['assets',170],source:['json',240],original_fields:['json',260],generation_status:['text',130],video_result:['assets',180]};
const raw=value=>String(value??'');
const asset=url=>url?[{id:uid(),url,name:'参考素材'}]:[];
const meta=table=>table.meta.storyboard;
export function newStoryboardTable() {
    return normalizeTable({fields:Object.entries(STORYBOARD_ROLES).map(([id,name])=>({id,name,type:specs[id][0],width:specs[id][1],hidden:['source','original_fields'].includes(id),readonly:['source','original_fields','generation_status','video_result'].includes(id)})),records:[],meta:{asset_groups:[],storyboard:{bindings:Object.fromEntries(Object.keys(STORYBOARD_ROLES).map(k=>[k,k])),asset_groups:[],group_fields:{},document_title:'',source_filename:''}}});
}
export function readStoryboard(value) {
    const source=typeof value==='string'?JSON.parse(value||'{}'):value||{};
    if(source.table){const table=normalizeTable(source.table);table.meta.storyboard={bindings:{},group_fields:{},...table.meta.storyboard};return table;}
    const legacy=normalizeStoryboard(source),table=newStoryboardTable();
    const order=legacy.column_order;
    table.fields.sort((a,b)=>(order.includes(a.id)?order.indexOf(a.id):100)-(order.includes(b.id)?order.indexOf(b.id):100));
    applyLegacy(table,legacy);return table;
}
export function projectStoryboard(table) {
    const m=meta(table)||{bindings:{},asset_groups:[],group_fields:{}},fields=new Set(table.fields.map(f=>f.id));
    const get=(row,role)=>fields.has(m.bindings[role])?row.values[m.bindings[role]]:undefined;
    const groups=(table.meta.asset_groups||[]).filter(g=>fields.has(g.field_id)).sort((a,b)=>table.fields.findIndex(f=>f.id===a.field_id)-table.fields.findIndex(f=>f.id===b.field_id)).map(g=>({...clone(g),name:table.fields.find(f=>f.id===g.field_id).name}));
    return {schema_version:4,document_title:m.document_title||'',source_filename:m.source_filename||'',asset_groups:groups,column_order:table.fields.map(f=>f.id),shots:table.records.map((r,i)=>{
        const refs=get(r,'image_url')||[],prompt=raw(get(r,'image_prompt'));
        return {id:r.id,selected:r.selected,input_changed:Boolean(r.meta?.input_changed),shot_no:raw(get(r,'shot_no')) || String(i+1).padStart(2,'0'),time_range:raw(get(r,'time_range')),duration:durationFromTimeRange(get(r,'time_range')),prompt,image_prompt:prompt,camera_notes:raw(get(r,'camera_notes')),image_url:Array.isArray(refs)?refs[0]?.url||'':'',additional_reference_images:Array.isArray(refs)?refs.slice(1).map(a=>a.url):[],source:get(r,'source')||null,original_fields:get(r,'original_fields')||[],group_refs:Object.fromEntries(groups.map(g=>[g.id,clone(r.values[g.field_id]||[])]))};
    })};
}
export function serializeStoryboardTable(table) {return JSON.stringify({...projectStoryboard(table),table});}
export function applyLegacy(table,legacy) {
    const m=meta(table),previous=new Map(table.records.map(r=>[r.id,r]));
    const groups=legacy.asset_groups||[];
    for(const g of groups) {
        m.group_fields||={};
        let field=table.fields.find(f=>f.id===(g.field_id||m.group_fields[g.id]));
        if(!field){field=addField(table,{id:'group:'+g.id,name:g.name,type:'assets',width:170});m.group_fields[g.id]=field.id;}
        m.group_fields[g.id]=field.id;
        field.name=g.name;
    }
    const removed=(m.asset_groups||[]).filter(g=>!groups.some(n=>n.id===g.id));
    for(const g of removed){const id=m.group_fields[g.id];table.fields=table.fields.filter(f=>f.id!==id);for(const r of table.records)delete r.values[id];delete m.group_fields[g.id];}
    m.asset_groups=clone(groups);table.meta.asset_groups=groups.map(g=>({...clone(g),field_id:m.group_fields[g.id]}));m.document_title=legacy.document_title||'';m.source_filename=legacy.source_filename||'';
    table.records=(legacy.shots||[]).map((s,i)=>{
        const row={id:s.id||uid(),selected:s.selected!==false,values:clone(previous.get(s.id)?.values||{}),meta:{...clone(previous.get(s.id)?.meta||{}),input_changed:Boolean(s.input_changed)}};
        for(const role of ['shot_no','time_range','image_prompt','camera_notes','image_url','source','original_fields']) {
            const f=table.fields.find(f=>f.id===m.bindings[role]);if(!f)continue;
            row.values[f.id]=role==='image_url'?[...asset(s.image_url),...(s.additional_reference_images||[]).flatMap(asset)]:clone(s[role]??(role==='original_fields'?[]:role==='source'?null:''));
        }
        for(const g of groups)row.values[m.group_fields[g.id]]=clone(s.group_refs?.[g.id]||[]);
        return row;
    });
}
export function importRows(table,result,mode) {
    const m=meta(table),current=projectStoryboard(table);
    if(!table.fields.some(f=>f.id===m.bindings.image_prompt))throw new Error('请先在“字段映射”中绑定画面描述字段');
    // Import reuses mapped fields and common record creation; custom columns remain intact.
    const shots=result.shots.map(s=>({...s,id:s.id||uid()}));
    const ids=new Set(current.shots.map(s=>s.id));for(const shot of shots){if(ids.has(shot.id))shot.id=uid();ids.add(shot.id);}
    applyLegacy(table,{...current,document_title:result.document_title,source_filename:result.filename,shots:mode==='replace'?shots:[...current.shots,...shots]});
}
export function writeGenerationResults(table,report) {
    const m=meta(table);if(!m)return;
    const exists=id=>table.fields.some(f=>f.id===id);
    for(const result of report.rows||[]) {
        const row=table.records.find(r=>r.id===result.shot_id);if(!row)continue;
        if(exists(m.bindings.generation_status))row.values[m.bindings.generation_status]=({complete:'已完成',running:'处理中',needs_recovery:'待恢复',waiting:'尚未提交'})[result.phase]||result.phase;
        if(result.url && exists(m.bindings.video_result))row.values[m.bindings.video_result]=[{id:result.request_id||result.shot_id,url:result.url,name:`分镜 ${result.shot_no} · ${report.batch_id}`,kind:'video'}];
    }
}
