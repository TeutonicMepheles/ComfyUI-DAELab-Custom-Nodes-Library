// Pure named operations. No DOM, keyboard events, network, or shared current node.
import {clone,uid,normalizeTable} from './data_table_model.mjs';

export const ROLE_LABELS={shot_no:'镜号',time_range:'时间',scene:'画面',narration:'旁白',subtitle:'字幕',notes:'备注',chapter:'章节',reference:'参考说明',other:'其他原文'};
export const KIND_LABELS={task:'任务',title:'标题 / 章节',header:'表头',blank:'空白',review:'待确认'};
const ACTIVE=new Set(['waiting','running','queued','preparing','submitting','recovering','pausing']);
export const hasActiveGeneration=table=>table.records.some(r=>Object.values(r.meta?.generationColumns||{}).some(s=>ACTIVE.has(s.phase)));
export function assertLimits(table){
 if(table.records.length>500||table.fields.length>64)throw new Error(`任务表 ${table.records.length} 行 / ${table.fields.length} 列，超过 500 行或 64 列限制，未提交`);
 const fields=new Set(),records=new Set();
 for(const f of table.fields){if(!f.id||fields.has(f.id))throw new Error('字段 ID 缺失或重复');fields.add(f.id);}
 for(const r of table.records){if(!r.id||records.has(r.id))throw new Error('任务 ID 缺失或重复');records.add(r.id);}
 return table;
}
export function assertTransition(current,next,{restoring=false}={}){
 assertLimits(next);
 if(hasActiveGeneration(current)){
  const identity=t=>JSON.stringify([t.meta.script_parser?.documents?.map(d=>d.document_id),t.records.map(r=>r.id)]);
  if(identity(current)!==identity(next))throw new Error('任务正在排队、运行或恢复，暂不能替换、删除或撤销任务结构');
  const rows=new Map(next.records.map(r=>[r.id,r]));
  for(const row of current.records)for(const [fieldId,state] of Object.entries(row.meta?.generationColumns||{})){
   if(!ACTIVE.has(state.phase))continue;
   const target=rows.get(row.id)?.meta?.generationColumns?.[fieldId];
   // Receipts bind remote work to its row; normal polling may change the phase,
   // but history must not roll an active receipt back to a terminal snapshot.
   const receipt=s=>JSON.stringify([s.requestId,s.stamp,s.input,s.forceNew===true]);
   if(!target||receipt(state)!==receipt(target)||(restoring&&state.phase!==target.phase))throw new Error('任务正在排队、运行或恢复，暂不能撤销或替换生成任务凭据');
  }
 }
}
export function emptyScriptTable(){
 const bindings=Object.fromEntries(Object.keys(ROLE_LABELS).map(r=>[r,'sp-'+r]));Object.assign(bindings,{source:'sp-source',original:'sp-original',issues:'sp-issues'});
 return {version:1,fields:[],records:[],view:'table',meta:{material_columns:true,video_reference_version:1,script_parser:{version:1,field_policy:'nonempty',created_roles:[],bindings,reference_fields:[],documents:[]}}};
}
const present=value=>typeof value==='string'?!!value.trim():Array.isArray(value)?value.length>0:value!=null;
function ensureRole(table,role){
 const meta=table.meta.script_parser,fid=meta.bindings[role];
 let field=table.fields.find(f=>f.id===fid);
 if(!field){
  if(meta.field_policy!=='nonempty'||meta.created_roles?.includes(role))throw new Error(`${ROLE_LABELS[role]||role} 字段已删除，请恢复后导入`);
  field={id:fid,name:ROLE_LABELS[role]||'待补充项',type:['scene','notes','narration','other'].includes(role)?'longtext':'text',width:role==='scene'?360:180,hidden:false,...(role==='issues'?{readonly:true}:{})};
  table.fields.push(field);(meta.created_roles||=[]).push(role);
 }
 if(!['text','longtext','select'].includes(field.type))throw new Error(`${field.name} 字段类型冲突`);
 return fid;
}
export function enableGeneration(table,kind){
 if(!['image','video'].includes(kind))throw new Error('未知生成类型');
 const promptId=`sp-${kind}-prompt`,resultId=`sp-${kind}-result`,scene=table.meta.script_parser.bindings.scene;
 if(!table.fields.some(f=>f.id===promptId))table.fields.push({id:promptId,name:kind==='image'?'图片提示词':'视频提示词',type:'json',presentation:'prompt',generationPrompt:true,width:300,promptTemplate:{kind:'column-template',version:1,segments:table.fields.some(f=>f.id===scene)?[{type:'column',fieldId:scene}]:[]}});
 if(!table.fields.some(f=>f.id===resultId))table.fields.push({id:resultId,name:kind==='image'?'图片结果':'视频结果',type:'content',presentation:'generation',readonly:true,width:300,generation:{version:1,kind,model:kind==='image'?'Lib Image':'Seedance 2.5',promptFieldId:promptId,mode:'',settings:{}}});
 assertLimits(table);
}
export function readScriptTable(raw){
 if(!raw)return emptyScriptTable();
 const table=normalizeTable(raw);
 if(table.meta.script_parser?.version!==1)throw new Error('不支持的解析器数据版本');
 // Keep existing field and media identities; only lift the old cardinality cap.
 for(const f of table.fields)if(f.type==='content')delete f.maxItems;
 return assertLimits(table);
}
export function initialChoices(inventory){
 return {tables:Object.fromEntries(inventory.tables.map(t=>[t.id,{header:t.header,mapping:clone(t.mapping),rows:{}}])),images:{}};
}
export function importTasks(current,normalized,{mode='append',allowUnresolved=true}={}){
 if(!['append','replace'].includes(mode))throw new Error('未知提交模式');
 if(mode==='replace'&&hasActiveGeneration(current))throw new Error('生成排队、运行或恢复中，禁止替换');
 if(hasActiveGeneration(current))throw new Error('生成排队、运行或恢复中，暂不能导入或调整解析');
 if(normalized.unassigned.some(i=>i.disposition==='待分配')&&!allowUnresolved)throw new Error('仍有图片待分配；请分配、排除或明确保留待补充');
 const table=mode==='replace'?emptyScriptTable():clone(current),meta=table.meta.script_parser;
 const existing=new Set(table.records.map(r=>r.meta?.script_source?.source_key).filter(Boolean));
 const incoming=normalized.tasks.filter(r=>!existing.has(r.source_key));
 if(new Set(normalized.tasks.map(r=>r.source_key)).size!==normalized.tasks.length)throw new Error('解析结果包含重复来源行');
 const skipped=normalized.tasks.length-incoming.length;
 // Semantic bindings refer to stable IDs. Renaming/reordering is harmless;
 // deletion or changing a field type requires explicit user repair.
 for(const role of [...Object.keys(ROLE_LABELS),'issues'])if(incoming.some(task=>present(role==='chapter'?task.chapter:role==='issues'?task.issues.join('；'):task.values[role])))ensureRole(table,role);
 const hasImages=incoming.some(r=>r.images.some(o=>normalized.assets[o.asset_id]?.url&&!normalized.assets[o.asset_id]?.error));
 for(let i=0;i<(hasImages?1:0);i++){
  let fid=meta.reference_fields[i];
  if(fid){const f=table.fields.find(f=>f.id===fid);if(!f||!['assets','content'].includes(f.type))throw new Error(`参考 ${i+1} 列缺失或类型冲突`);}
  else{fid=uid();meta.reference_fields.push(fid);const position=table.fields.findIndex(f=>f.id==='sp-image-prompt');table.fields.splice(position<0?table.fields.length:position,0,{id:fid,name:'参考图',type:'content',video_reference:false,width:300});}
 }
 if(table.records.length+incoming.length>500||table.fields.length>64)throw new Error(`追加后 ${table.records.length+incoming.length} 行 / ${table.fields.length} 列，超过 500 行或 64 列限制`);
 for(const task of incoming){
  const values={},issues=clone(task.issues);for(const [role,value] of Object.entries({...task.values,chapter:task.chapter}))if(table.fields.some(f=>f.id===meta.bindings[role]))values[meta.bindings[role]]=value;
  const source={source_key:task.source_key,document_id:normalized.document_id,filename:normalized.filename,row_id:task.row_id,table_id:task.table_id,issues,sources:clone(task.sources),context:clone(task.context)};
  if(table.fields.some(f=>f.id===meta.bindings.original))values[meta.bindings.original]=clone(task.original_cells);
  for(const [i,occurrence] of task.images.entries()){
   const asset=normalized.assets[occurrence.asset_id];
   if(!asset?.url||asset.error){issues.push(`${occurrence.id} 图片无法读取，待补充`);continue;}
   (values[meta.reference_fields[0]]||=[]).push({id:uid(),url:asset.url,kind:'image',name:`${task.row_id} · 参考 ${i+1}`,filename:asset.filename,subfolder:asset.subfolder,type:'input',provenance:{document_id:normalized.document_id,occurrence_id:occurrence.id,source_cell:occurrence.cell_id,asset_id:asset.id}});
  }
  if(issues.length)values[ensureRole(table,'issues')]=issues.join('；');
  if(table.fields.some(f=>f.id===meta.bindings.source))values[meta.bindings.source]=clone(source);
  table.records.push({id:uid(),selected:false,values,meta:{script_source:source,script_original:clone(task.original_cells),script_import_values:clone(values)}});
 }
 const same=meta.documents.find(d=>d.document_id===normalized.document_id);
 if(same&&!same.assets)same.assets=clone(normalized.assets);
 if(same&&normalized.inventory&&!same.inventory){same.inventory=clone(normalized.inventory);same.choices=clone(normalized.choices);}
 if(!same)meta.documents.push({document_id:normalized.document_id,filename:normalized.filename,audit:clone(normalized.audit),paragraphs:clone(normalized.paragraphs),tables:clone(normalized.tables),assets:clone(normalized.assets),unassigned:clone(normalized.unassigned),...(normalized.inventory?{inventory:clone(normalized.inventory),choices:clone(normalized.choices)}:{})});
 assertLimits(table);
 return {table,added:incoming.length,skipped,newVersion:meta.documents.some(d=>d.filename===normalized.filename&&d.document_id!==normalized.document_id)};
}

// Reconcile parser-owned cells by source identity. Edited cells and generation results stay intact.
export function reviseImport(current,normalized){
 if(hasActiveGeneration(current))throw new Error('生成排队、运行或恢复中，暂不能调整解析');
 const document=current.meta.script_parser.documents.find(d=>d.document_id===normalized.document_id);
 if(!document)throw new Error('该文档已移除，请重新上传');
 const original=clone(current),base=clone(current);
 const previousAssets=new Map(current.records.filter(r=>r.meta?.script_source?.document_id===normalized.document_id).flatMap(r=>current.meta.script_parser.reference_fields.flatMap(fid=>Array.isArray(r.values[fid])?r.values[fid]:[])).filter(a=>a.provenance?.occurrence_id).map(a=>[a.provenance.occurrence_id,a]));
 base.records=base.records.filter(r=>r.meta?.script_source?.document_id!==normalized.document_id);
 base.meta.script_parser.documents=base.meta.script_parser.documents.filter(d=>d.document_id!==normalized.document_id);
 const {table}=importTasks(base,normalized),incoming=new Map(table.records.filter(r=>r.meta?.script_source?.document_id===normalized.document_id).map(r=>[r.meta.script_source.source_key,r]));
 const conflicts=[],removed=[];
 const equal=(a,b)=>JSON.stringify(a??'')===JSON.stringify(b??'');
 const reconciled=original.records.flatMap(row=>{
  if(row.meta?.script_source?.document_id!==normalized.document_id)return [row];
  const next=incoming.get(row.meta.script_source.source_key),baseline=row.meta.script_import_values;
  if(!next){
   const edited=!baseline||Object.entries(row.values).some(([fid,v])=>!equal(v,baseline[fid])&&present(v));
   if(edited||Object.keys(row.meta.generationColumns||{}).length){conflicts.push(`${row.meta.script_source.row_id} 已编辑，保留原记录`);return [row];}
   removed.push(row.id);return [];
  }
  incoming.delete(row.meta.script_source.source_key);
  for(const fid of table.meta.script_parser.reference_fields){
   for(const asset of next.values[fid]||[]){const match=previousAssets.get(asset.provenance?.occurrence_id);if(match)asset.id=match.id;}
  }
  const values=clone(row.values),fresh=clone(next.values);
  for(const fid of new Set([...Object.keys(baseline||{}),...Object.keys(fresh)])){
   if(baseline?equal(row.values[fid],baseline[fid]):!present(row.values[fid]))values[fid]=fresh[fid]??(['assets','content'].includes(table.fields.find(f=>f.id===fid)?.type)?[]:'');
   else if(!equal(row.values[fid],fresh[fid]))conflicts.push(`${row.meta.script_source.row_id} · ${table.fields.find(f=>f.id===fid)?.name||fid} 已编辑，保留当前内容`);
  }
  return [{...row,values,meta:{...row.meta,script_source:next.meta.script_source,script_original:next.meta.script_original,script_import_values:fresh}}];
 });
 table.records=[...reconciled,...incoming.values()];
 const updated=table.meta.script_parser.documents.find(d=>d.document_id===normalized.document_id);updated.conflicts=conflicts;
 assertLimits(table);return {table,conflicts,removed:removed.length};
}

// Each operation ticket is scoped to this owner, source choices and table state.
export class ParserRequests {
 epoch=0;alive=true;
 begin(snapshot){return {epoch:++this.epoch,snapshot};}
 owns(ticket){return this.alive&&ticket.epoch===this.epoch;}
 valid(ticket,snapshot){return this.owns(ticket)&&ticket.snapshot===snapshot;}
 invalidate(){this.epoch++;}
 destroy(){this.alive=false;this.invalidate();}
}
