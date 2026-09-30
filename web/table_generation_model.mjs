import {addField,uid} from './data_table_model.mjs?v=20260930-inline4';
import {effectivePrompt,isColumnPrompt,resolveColumnPrompt} from './table_prompt_template.mjs?v=20260930-inline4';

export const GENERATION_MODELS={image:['Lib Image','Lib Image 2.5 Pro','Lib Image 2.5 Fast'],video:['Seedance 2.0','Seedance 2.5','Minimax H3']};
export const isGeneration=field=>field?.presentation==='generation';
export const promptColumns=table=>table.fields.filter(f=>!f.readonly&&(['text','longtext'].includes(f.type)||f.presentation==='prompt'||f.type==='content'&&table.records.every(r=>typeof r.values[f.id]==='string'||!r.values[f.id]?.length)));
export function enableColumnPrompt(table,fieldId){
 const field=table.fields.find(f=>f.id===fieldId);
 if(!field||field.readonly)throw new Error('提示词列不可编辑');
 if(field.presentation==='prompt')return;
 if(!promptColumns(table).some(f=>f.id===fieldId))throw new Error('请选择文本列');
 field.type='json';field.presentation='prompt';field.generationPrompt=true;
 for(const row of table.records){const text=row.values[fieldId];row.values[fieldId]=typeof text==='string'&&text?{kind:'column-template',version:1,segments:[{type:'text',text}]}:'';}
}
export function addGenerationColumn(table,spec={}){
 const field=addField(table,{...spec,type:'content',presentation:'generation',readonly:true,maxItems:1,width:340,generation:{version:1,kind:'image',model:'Lib Image',promptFieldId:'',mode:'',settings:{}}});
 const prompts=promptColumns(table);
 if(prompts.length===1)field.generation.promptFieldId=prompts[0].id;
 else if(!prompts.length)field.generation.promptFieldId=createGenerationPrompt(table,field.id).id;
 for(const row of table.records)row.values[field.id]=[];
 return field;
}
export function createGenerationPrompt(table,fieldId){
 const target=table.fields.find(f=>f.id===fieldId);if(!target)throw new Error('生成列已删除');
 const prompt=addField(table,{name:'提示词',type:'json',presentation:'prompt',generationPrompt:true,width:360});
 table.fields.splice(table.fields.indexOf(prompt),1);table.fields.splice(table.fields.indexOf(target),0,prompt);
 for(const row of table.records)row.values[prompt.id]='';
 target.generation.promptFieldId=prompt.id;return prompt;
}
export function generationRows(table,fieldId){
 const selected=table.records.filter(r=>r.selected);
 return selected.length?selected:table.records.filter(r=>!r.values[fieldId]?.length);
}
export function generationInput(table,fieldId,recordId){
 const field=table.fields.find(f=>f.id===fieldId),row=table.records.find(r=>r.id===recordId);
 if(!isGeneration(field)||!row)throw new Error('生成列或记录已删除');
 const config=field.generation,source=table.fields.find(f=>f.id===config.promptFieldId);
 if(!source)throw new Error('请选择提示词列');
 const value=effectivePrompt(table,row,source.id);
 let document;
 if(typeof value==='string')document={segments:[{type:'text',text:value}],references:[],assets:[]};
 else if(isColumnPrompt(value))document=resolveColumnPrompt(value,table,row);
 else if(value?.segments){
  const references=value.references||[];
  document={...value,assets:references.filter(r=>r.included!==false).map(ref=>{
   const asset=row.values[ref.fieldId]?.find?.(a=>a.id===ref.assetId);
   if(!asset)throw new Error('提示词引用的素材已不存在');return {...asset,fieldId:ref.fieldId};
  })};
 }else throw new Error('本行提示词为空');
 if(!document.segments.some(s=>s.type==='ref'||s.text?.trim()))throw new Error('本行提示词为空');
 const assets=[],segments=document.segments.map(s=>{
  if(s.type==='text')return {type:'text',text:s.text};
  const ref=document.references.find(r=>r.refId===s.refId&&r.included!==false);
  if(ref?.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');
  const asset=ref&&document.assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);
  if(!asset)throw new Error('提示词引用的素材已不存在');
  let index=assets.findIndex(a=>a.id===asset.id&&a.fieldId===asset.fieldId);
  if(index<0){index=assets.length;assets.push({id:asset.id,fieldId:asset.fieldId,kind:asset.kind,url:asset.url});}
  return {type:'asset',index};
 });
 return {recordId,fieldId,config:structuredClone(config),project:table.meta.generationProject||'',segments,assets};
}
export const inputStamp=input=>JSON.stringify(input);
export function applyGenerationResult(table,fieldId,recordId,requestId,stamp,result){
 const row=table.records.find(r=>r.id===recordId),state=row?.meta?.generationColumns?.[fieldId];
 if(!state||state.requestId!==requestId)return false;
 try{if(inputStamp(generationInput(table,fieldId,recordId))!==stamp){state.phase='stale';state.error='输入已变化，结果未覆盖当前单元格';state.result=result;return false;}}
 catch{state.phase='stale';state.result=result;return false;}
 row.values[fieldId]=[{...result,id:uid()}];state.result=result;state.phase='complete';delete state.error;return true;
}

export function generationReportNeedsApply(table,job,report){
 if(report.phase!=='complete')return job.phase!==report.phase||job.error!==report.error;
 if(job.phase==='stale'&&job.result?.url===report.result?.url){
  try{return inputStamp(generationInput(table,job.fieldId,job.recordId))===job.stamp;}catch{return false;}
 }
 const row=table.records.find(r=>r.id===job.recordId);
 return job.phase!=='complete'||Boolean(job.error)||!row?.values[job.fieldId]?.some(a=>a.url===report.result?.url);
}
export function generationReceipt(job,previous){
 const history=structuredClone(previous?.history||[]);
 if(previous?.input&&previous.requestId!==job.requestId&&!history.some(item=>item.requestId===previous.requestId))history.push({requestId:previous.requestId,input:previous.input,phase:previous.phase,...(previous.result?{result:previous.result}:{})});
 return {requestId:job.requestId,input:structuredClone(job.input),forceNew:job.forceNew===true,stamp:inputStamp(job.input),phase:'waiting',...(history.length?{history}: {})};
}
export function recoveryJob(receipt){
 if(!receipt?.input)throw new Error('Original task snapshot is missing');
 return {requestId:receipt.requestId,input:receipt.input,forceNew:receipt.forceNew===true,recovery:true};
}
