// Pure named operations. No DOM, keyboard events, network, or shared current node.
import {clone,uid,normalizeTable} from './data_table_model.mjs';

export const ROLE_LABELS={shot_no:'镜号',time_range:'时间',scene:'画面',narration:'旁白',subtitle:'字幕',notes:'备注',chapter:'章节',reference:'参考说明',other:'其他原文'};
export const KIND_LABELS={task:'任务',title:'标题 / 章节',header:'表头',blank:'空白',review:'待确认'};
const ACTIVE=new Set(['waiting','running','queued','preparing','submitting','recovering']);
export const hasActiveGeneration=table=>table.records.some(r=>Object.values(r.meta?.generationColumns||{}).some(s=>ACTIVE.has(s.phase)));
export function assertLimits(table){
 if(table.records.length>500||table.fields.length>64)throw new Error(`任务表 ${table.records.length} 行 / ${table.fields.length} 列，超过 500 行或 64 列限制，未提交`);
 const fields=new Set(),records=new Set();
 for(const f of table.fields){if(!f.id||fields.has(f.id))throw new Error('字段 ID 缺失或重复');fields.add(f.id);}
 for(const r of table.records){if(!r.id||records.has(r.id))throw new Error('任务 ID 缺失或重复');records.add(r.id);}
 return table;
}
export function assertTransition(current,next){
 assertLimits(next);
 if(hasActiveGeneration(current)){
  const identity=t=>JSON.stringify([t.meta.script_parser?.documents?.map(d=>d.document_id),t.records.map(r=>r.id)]);
  if(identity(current)!==identity(next))throw new Error('任务正在排队、运行或恢复，暂不能替换、删除或撤销任务结构');
 }
}
export function emptyScriptTable(){
 const fields=Object.entries(ROLE_LABELS).map(([role,name])=>({id:'sp-'+role,name,type:role==='scene'||role==='notes'||role==='narration'?'longtext':'text',width:role==='scene'?360:180,hidden:['reference','other','subtitle','time_range'].includes(role)}));
 fields.push({id:'sp-issues',name:'待补充项',type:'text',readonly:true,width:180},
  {id:'sp-source',name:'来源',type:'json',readonly:true,width:180,hidden:true},
  {id:'sp-original',name:'原文单元格',type:'json',readonly:true,width:300,hidden:true});
 const bindings=Object.fromEntries(Object.keys(ROLE_LABELS).map(r=>[r,'sp-'+r]));Object.assign(bindings,{source:'sp-source',original:'sp-original',issues:'sp-issues'});
 for(const kind of ['image','video']){
  fields.push({id:`sp-${kind}-prompt`,name:kind==='image'?'图片提示词':'视频提示词',type:'json',presentation:'prompt',generationPrompt:true,width:300,promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:bindings.scene}]}},
   {id:`sp-${kind}-result`,name:kind==='image'?'图片结果':'视频结果',type:'content',presentation:'generation',readonly:true,maxItems:1,width:300,generation:{version:1,kind,model:kind==='image'?'Lib Image':'Seedance 2.5',promptFieldId:`sp-${kind}-prompt`,mode:'',settings:{}}});
 }
 return {version:1,fields,records:[],view:'table',meta:{material_columns:true,video_reference_version:1,script_parser:{version:1,bindings,reference_fields:[],documents:[]}}};
}
export function readScriptTable(raw){
 if(!raw)return emptyScriptTable();
 const table=normalizeTable(raw);
 if(table.meta.script_parser?.version!==1)throw new Error('不支持的解析器数据版本');
 return assertLimits(table);
}
export function initialChoices(inventory){
 return {tables:Object.fromEntries(inventory.tables.map(t=>[t.id,{header:t.header,mapping:clone(t.mapping),rows:{}}])),images:{}};
}
export function importTasks(current,normalized,{mode='append',allowUnresolved=false}={}){
 if(!['append','replace'].includes(mode))throw new Error('未知提交模式');
 if(mode==='replace'&&hasActiveGeneration(current))throw new Error('生成排队、运行或恢复中，禁止替换');
 if(normalized.unassigned.some(i=>i.disposition==='待分配')&&!allowUnresolved)throw new Error('仍有图片待分配；请分配、排除或明确保留待补充');
 const table=mode==='replace'?emptyScriptTable():clone(current),meta=table.meta.script_parser;
 const existing=new Set(table.records.map(r=>r.meta?.script_source?.source_key).filter(Boolean));
 const incoming=normalized.tasks.filter(r=>!existing.has(r.source_key));
 if(new Set(normalized.tasks.map(r=>r.source_key)).size!==normalized.tasks.length)throw new Error('解析结果包含重复来源行');
 const skipped=normalized.tasks.length-incoming.length;
 // Semantic bindings refer to stable IDs. Renaming/reordering is harmless;
 // deletion or changing a field type requires explicit user repair.
 for(const [role,fid] of Object.entries(meta.bindings)){
  const f=table.fields.find(f=>f.id===fid);
  if(!f||(['source','original'].includes(role)?f.type!=='json':!['text','longtext','select'].includes(f.type)))throw new Error(`${ROLE_LABELS[role]||role} 字段已删除或类型冲突，请恢复后追加`);
 }
 const maxImages=Math.max(0,...incoming.map(r=>r.images.length));
 for(let i=0;i<maxImages;i++){
  let fid=meta.reference_fields[i];
  if(fid){const f=table.fields.find(f=>f.id===fid);if(!f||!['assets','content'].includes(f.type))throw new Error(`参考 ${i+1} 列缺失或类型冲突`);}
  else{fid=uid();meta.reference_fields.push(fid);const position=table.fields.findIndex(f=>f.id==='sp-image-prompt');table.fields.splice(position<0?table.fields.length:position,0,{id:fid,name:`参考 ${i+1}`,type:'content',maxItems:1,video_reference:false,width:240});}
 }
 if(table.records.length+incoming.length>500||table.fields.length>64)throw new Error(`追加后 ${table.records.length+incoming.length} 行 / ${table.fields.length} 列，超过 500 行或 64 列限制`);
 for(const task of incoming){
  const values={};for(const [role,value] of Object.entries(task.values))values[meta.bindings[role]]=value;
  values[meta.bindings.chapter]=task.chapter;
  const source={source_key:task.source_key,document_id:normalized.document_id,filename:normalized.filename,row_id:task.row_id,table_id:task.table_id,issues:clone(task.issues),sources:clone(task.sources),context:clone(task.context)};
  values[meta.bindings.source]=clone(source);values[meta.bindings.original]=clone(task.original_cells);values[meta.bindings.issues]=task.issues.join('；');
  for(const [i,occurrence] of task.images.entries()){
   const asset=normalized.assets[occurrence.asset_id];
   if(!asset?.url||asset.error)throw new Error(`${task.row_id} ${occurrence.id} 图片准备失败，未提交`);
   values[meta.reference_fields[i]]=[{id:uid(),url:asset.url,kind:'image',name:`${task.row_id} · 参考 ${i+1}`,filename:asset.filename,subfolder:asset.subfolder,type:'input',provenance:{document_id:normalized.document_id,occurrence_id:occurrence.id,source_cell:occurrence.cell_id,asset_id:asset.id}}];
  }
  table.records.push({id:uid(),selected:false,values,meta:{script_source:source}});
 }
 const same=meta.documents.find(d=>d.document_id===normalized.document_id);
 if(same&&!same.assets)same.assets=clone(normalized.assets);
 if(!same)meta.documents.push({document_id:normalized.document_id,filename:normalized.filename,audit:clone(normalized.audit),paragraphs:clone(normalized.paragraphs),tables:clone(normalized.tables),assets:clone(normalized.assets),unassigned:clone(normalized.unassigned)});
 assertLimits(table);
 return {table,added:incoming.length,skipped,newVersion:meta.documents.some(d=>d.filename===normalized.filename&&d.document_id!==normalized.document_id)};
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
