import {createMaterialTable} from './table_material_columns.mjs?v=20261023-h3-size-r3';
import {addField,addRecord,uid,normalizeTable} from './data_table_model.mjs?v=20261023-h3-size-r3';
import {LOCAL_VIDEO_MODEL,GENERATION_MODELS,isGeneration,promptColumns,rowGenerationConfig,setRowGenerationConfig,generationConfigField,syncGenerationFrameTags,applyPromptContent} from './table_generation_model.mjs?v=20261023-h3-size-r3';
import {effectivePrompt,toColumnPrompt,promptContent} from './table_prompt_template.mjs?v=20261023-h3-size-r3';
import {generationMaterials} from './table_material_output.mjs?v=20261023-h3-size-r3';
import {promptSourceId,requirePromptSource,setPromptSource} from './table_prompt_source.mjs';

export const activeVideoTask=row=>Object.values(row?.meta?.generationColumns||{}).some(s=>['waiting','running','pausing'].includes(s.phase));
export function taskConfig(config={},promptFieldId){
 if(config.model&&config.kind)return {...structuredClone(config),promptFieldId};
 return {version:1,kind:'video',model:LOCAL_VIDEO_MODEL,promptFieldId,mode:'text2video',settings:{width:512,height:288,duration:2,turbo:true,seed:-1}};
}
export function createVideoTasks(values={}){
 const table=createMaterialTable(),field=table.fields.find(isGeneration),row=table.records[0];table.records=[row];
 const model=values.model||LOCAL_VIDEO_MODEL;
 field.generation=model===LOCAL_VIDEO_MODEL?taskConfig({},field.generation.promptFieldId):{version:1,kind:'video',model,promptFieldId:field.generation.promptFieldId,mode:values.mode||'text2video',settings:{duration:Number(values.duration)||5,resolution:values.resolution||'720p',ratio:values.ratio||'16:9',...(model==='Minimax H3'?{}:{enableSound:values.sound?'on':'off'})}};
 table.meta.generationProject=values.project_uuid||'';
 row.values[field.generation.promptFieldId]=toColumnPrompt(values.prompt||'',row);
 syncGenerationFrameTags(table,field.id,field.generation);
 return {version:1,table,fieldId:field.id,currentId:row.id};
}
export function importVideoTasks(source,promptId,previous){
 const table=normalizeTable(source),prompt=requirePromptSource(table);
 prompt.readonly=false;setPromptSource(table,prompt.id);
 const linked=table.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id),owner=linked&&structuredClone(generationConfigField(table,linked.id));
 const fieldId=owner?.id||uid(),defaults=taskConfig(owner?.generation||previous?.table.fields.find(f=>f.id===previous.fieldId)?.generation,prompt.id);
 for(const field of table.fields){if(isGeneration(field)){field.presentation='content';field.readonly=false;delete field.generation;}delete field.generationConfigFieldId;}
 let output=table.fields.find(f=>f.id===fieldId);
 if(!output)output=addField(table,{id:fieldId,name:'生成结果',type:'content',readonly:true});
 output.presentation='generation';output.readonly=true;output.generation=defaults;prompt.generationConfigFieldId=fieldId;
 for(const row of table.records){
  const old=source.records.find(r=>r.id===row.id),config=taskConfig(owner?rowGenerationConfig(old,owner.id,owner.generation):defaults,prompt.id);
  row.selected=false;row.name||=`任务${table.records.indexOf(row)+1}`;
  for(const column of [prompt]){
   row.values[column.id]=toColumnPrompt(effectivePrompt(source,old,column.id),old);
   for(const segment of row.values[column.id].segments)if(segment.type==='frame')segment.generationFieldId=fieldId;
  }
  const frames=owner&&old.meta?.generationFrames?.[owner.id];
  row.meta={...(frames?{generationFrames:{[fieldId]:structuredClone(frames)}}:{})};
  setRowGenerationConfig(row,fieldId,config);row.values[fieldId]=[];
  const content=promptContent(source,old,prompt.id);
  if(content.some(s=>s.type==='frame'))applyPromptContent(table,row,prompt.id,content,fieldId);
 }
 syncGenerationFrameTags(table,fieldId,defaults);
 return {version:1,table,fieldId,currentId:table.records[0]?.id||''};
}
export function addVideoTask(state){
 const row=addRecord(state.table),field=state.table.fields.find(f=>f.id===state.fieldId);
 row.values[field.generation.promptFieldId]='';row.values[field.id]=[];
 syncGenerationFrameTags(state.table,field.id,field.generation,row.id);state.currentId=row.id;return row;
}
export function selectTaskPrompt(state,recordId,promptFieldId){
 if(state.table.meta?.generationInput&&promptFieldId!==promptSourceId(state.table))throw new Error('请在来源表格的列头切换提示词');
 const row=state.table.records.find(r=>r.id===recordId),field=state.table.fields.find(f=>f.id===state.fieldId);
 if(!row||!promptColumns(state.table).some(f=>f.id===promptFieldId))throw new Error('提示词来源已不存在，请重新导入表格');
 const config=rowGenerationConfig(row,field.id,field.generation);
 if(config.promptFieldId===promptFieldId)return;
 const next=row.meta?.generationSettings?.[promptFieldId]?.[field.id]||{...config,promptFieldId};
 setRowGenerationConfig(row,field.id,next);row.meta.generationPromptFields||={};row.meta.generationPromptFields[field.id]=promptFieldId;
 syncGenerationFrameTags(state.table,field.id,field.generation,row.id);
}
export function videoTaskAssets(state){
 return generationMaterials(state.table,state.fieldId);
}
export function syncVideoTaskInputs(state,source,previous){
 const normalized=normalizeTable(source),id=promptSourceId(normalized);
 state.table.meta.generationInput=structuredClone(normalized.meta.generationInput);
 const output=state.table.fields.find(f=>f.id===state.fieldId);
 const incomingIds=new Set(normalized.fields.map(f=>f.id)),previousIds=new Set(previous.fields.map(f=>f.id));
 state.table.fields=state.table.fields.filter(f=>f.id===state.fieldId||!previousIds.has(f.id)||incomingIds.has(f.id));
 for(const incoming of normalized.fields){
  if(incoming.id===state.fieldId)continue;
  let field=state.table.fields.find(f=>f.id===incoming.id);
  if(!field){field=structuredClone(incoming);state.table.fields.push(field);}
  delete field.promptTemplate;Object.assign(field,structuredClone(incoming));
  if(isGeneration(field)){field.presentation='content';field.readonly=false;delete field.generation;}
 }
 if(id&&state.table.fields.some(f=>f.id===id)){
  const field=state.table.fields.find(f=>f.id===id);field.readonly=false;setPromptSource(state.table,id);
  for(const row of state.table.records){
   const config=rowGenerationConfig(row,output.id,output.generation);
   if(config.promptFieldId!==id){setRowGenerationConfig(row,output.id,{...config,promptFieldId:id});if(row.meta?.generationPromptFields)delete row.meta.generationPromptFields[output.id];}
  }
  output.generation.promptFieldId=id;
 }
 const origins=new Map(normalized.records.map(row=>[row.id,row]));
 for(const row of state.table.records){
  const origin=origins.get(row.id);if(!origin){if(previous.records.some(r=>r.id===row.id)){row.meta||={};row.meta.generationSourceMissing=true;}continue;}
  if(row.meta)delete row.meta.generationSourceMissing;
  for(const key of Object.keys(row.values))if(key!==state.fieldId&&previousIds.has(key)&&!incomingIds.has(key))delete row.values[key];
  for(const field of normalized.fields){
   if(field.id===state.fieldId)continue;
   if(field.id===id)applyPromptContent(state.table,row,id,promptContent(normalized,origin,id),state.fieldId);
   else if(JSON.stringify(origin.values[field.id])!==JSON.stringify(previous.records.find(r=>r.id===row.id)?.values[field.id])||!previousIds.has(field.id)){
    if(Object.hasOwn(origin.values,field.id))row.values[field.id]=structuredClone(origin.values[field.id]);else delete row.values[field.id];
   }
  }
  row.name=origin.name||row.name;
 }
}
