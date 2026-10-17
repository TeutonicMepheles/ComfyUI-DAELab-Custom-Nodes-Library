import {createMaterialTable} from './table_material_columns.mjs?v=20261002-shared-prompt-generation-config';
import {addField,addRecord,uid,normalizeTable} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {LOCAL_VIDEO_MODEL,GENERATION_MODELS,isGeneration,promptColumns,rowGenerationConfig,setRowGenerationConfig,generationConfigField,syncGenerationFrameTags,applyPromptContent} from './table_generation_model.mjs?v=20261017-sync-frames';
import {effectivePrompt,toColumnPrompt,promptContent} from './table_prompt_template.mjs?v=20261017-sync-frames';
import {generationMaterials} from './table_material_output.mjs?v=20261017-task-groups';

export const activeVideoTask=row=>Object.values(row?.meta?.generationColumns||{}).some(s=>['waiting','running','pausing'].includes(s.phase));
export function taskConfig(config={},promptFieldId){
 if(GENERATION_MODELS[config.kind]?.includes(config.model))return {...structuredClone(config),promptFieldId};
 return {version:1,kind:'video',model:LOCAL_VIDEO_MODEL,promptFieldId,mode:'text2video',settings:{width:768,height:448,duration:2,turbo:true,seed:-1}};
}
export function createVideoTasks(values={}){
 const table=createMaterialTable(),field=table.fields.find(isGeneration),row=table.records[0];table.records=[row];
 const model=GENERATION_MODELS.video.includes(values.model)?values.model:LOCAL_VIDEO_MODEL;
 field.generation=model===LOCAL_VIDEO_MODEL?taskConfig({},field.generation.promptFieldId):{version:1,kind:'video',model,promptFieldId:field.generation.promptFieldId,mode:values.mode||'text2video',settings:{duration:Number(values.duration)||5,resolution:values.resolution||'720p',ratio:values.ratio||'16:9',...(model==='Minimax H3'?{}:{enableSound:values.sound?'on':'off'})}};
 table.meta.generationProject=values.project_uuid||'';
 row.values[field.generation.promptFieldId]=toColumnPrompt(values.prompt||'',row);
 syncGenerationFrameTags(table,field.id,field.generation);
 return {version:1,table,fieldId:field.id,currentId:row.id};
}
export function importVideoTasks(source,promptId,previous){
 const table=normalizeTable(source),prompt=promptColumns(table).find(f=>f.id===promptId)||promptColumns(table)[0];
 if(!prompt)throw new Error('表格中没有提示词列');
 const linked=table.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id),owner=linked&&structuredClone(generationConfigField(table,linked.id));
 const fieldId=owner?.id||uid(),defaults=taskConfig(owner?.generation||previous?.table.fields.find(f=>f.id===previous.fieldId)?.generation,prompt.id);
 for(const field of table.fields){if(isGeneration(field)){field.presentation='content';field.readonly=false;delete field.generation;}delete field.generationConfigFieldId;}
 let output=table.fields.find(f=>f.id===fieldId);
 if(!output)output=addField(table,{id:fieldId,name:'生成结果',type:'content',readonly:true});
 output.presentation='generation';output.readonly=true;output.generation=defaults;prompt.generationConfigFieldId=fieldId;
 for(const row of table.records){
  const old=source.records.find(r=>r.id===row.id),config=taskConfig(owner?rowGenerationConfig(old,owner.id,owner.generation):defaults,prompt.id);
  row.selected=false;row.name||=`任务${table.records.indexOf(row)+1}`;
  for(const column of promptColumns(table)){
   row.values[column.id]=toColumnPrompt(effectivePrompt(source,old,column.id),old);
   for(const segment of row.values[column.id].segments)if(segment.type==='frame')segment.generationFieldId=fieldId;
  }
  const frames=owner&&old.meta?.generationFrames?.[owner.id];
  row.meta={...(frames?{generationFrames:{[fieldId]:structuredClone(frames)}}:{})};
  setRowGenerationConfig(row,fieldId,config);row.values[fieldId]=[];
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
 const sourceRows=new Map(source.records.map(row=>[row.id,row])),oldRows=new Map(previous.records.map(row=>[row.id,row]));
 const prompts=new Set(promptColumns(source).map(field=>field.id));
 for(const field of state.table.fields){
  if(field.id===state.fieldId)continue;
  const incoming=source.fields.find(f=>f.id===field.id);if(!incoming)continue;
  field.name=incoming.name;
  for(const row of state.table.records){
   const origin=sourceRows.get(row.id),old=oldRows.get(row.id);if(!origin||!old)continue;
   if(prompts.has(field.id)){
    const segments=promptContent(source,origin,field.id);
    const mapped=segments.map(s=>s.type==='frame'?{...s,generationFieldId:state.fieldId}:s);
    if(JSON.stringify(segments)===JSON.stringify(promptContent(previous,old,field.id))&&JSON.stringify(mapped)===JSON.stringify(promptContent(state.table,row,field.id)))continue;
    applyPromptContent(state.table,row,field.id,segments,state.fieldId);
   }else if(JSON.stringify(origin.values[field.id])!==JSON.stringify(old.values[field.id]))row.values[field.id]=structuredClone(origin.values[field.id]);
  }
 }
 for(const row of state.table.records){const origin=sourceRows.get(row.id),old=oldRows.get(row.id);if(origin&&old&&origin.name!==old.name)row.name=origin.name;}
}
