import {addField,uid} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {effectivePrompt,isColumnPrompt,resolveColumnPrompt,columnValue,toColumnPrompt} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';

export const LOCAL_VIDEO_MODEL='MiniMax H3 FL（本地）';
export const GENERATION_MODELS={image:['Lib Image','Lib Image 2.5 Pro','Lib Image 2.5 Fast'],video:['Seedance 2.0','Seedance 2.5','Minimax H3',LOCAL_VIDEO_MODEL]};
export const isGeneration=field=>field?.presentation==='generation';
export const rowGenerationConfig=(row,fieldId,defaults)=>row?.meta?.generationSettings?.[defaults?.promptFieldId]?.[fieldId]||defaults;
export function setRowGenerationConfig(row,fieldId,config){
 row.meta||={};row.meta.generationSettings||={};row.meta.generationSettings[config.promptFieldId]||={};
 row.meta.generationSettings[config.promptFieldId][fieldId]=structuredClone(config);
}
export const promptColumns=table=>table.fields.filter(f=>!f.readonly&&(['text','longtext'].includes(f.type)||f.presentation==='prompt'));
export function generationConfigField(table,fieldId,promptFieldId){
 const field=table.fields.find(f=>f.id===fieldId);if(!isGeneration(field))return field;
 const source=promptFieldId??field.generation.promptFieldId,prompt=table.fields.find(f=>f.id===source);
 if(!prompt)return field;
 const linked=table.fields.filter(f=>isGeneration(f)&&f.generation.promptFieldId===source);
 return linked.find(f=>f.id===prompt?.generationConfigFieldId)||linked[0]||field;
}
export function syncGenerationConfigOwners(table,before=table){
 for(const prompt of promptColumns(table)){
  const linked=table.fields.filter(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id);if(!linked.length)continue;
  const previous=before.fields.find(f=>f.id===prompt.id)?.generationConfigFieldId||before.fields.find(f=>isGeneration(f)&&f.generation.promptFieldId===prompt.id)?.id;
  const owner=linked.find(f=>f.id===previous)||linked[0];prompt.generationConfigFieldId=owner.id;
  if(previous&&owner.id!==previous){
   const old=before.fields.find(f=>f.id===previous);
   if(old?.generation)owner.generation={...structuredClone(old.generation),promptFieldId:prompt.id};
   for(const row of table.records){
    const oldRow=before.records.find(r=>r.id===row.id),settings=oldRow?.meta?.generationSettings?.[prompt.id]?.[previous];
    if(settings)setRowGenerationConfig(row,owner.id,{...settings,promptFieldId:prompt.id});
    for(const key of ['generationFrames','generationFrameTags'])if(oldRow?.meta?.[key]?.[previous]!==undefined){row.meta||={};row.meta[key]||={};row.meta[key][owner.id]=structuredClone(oldRow.meta[key][previous]);}
   }
  }
  for(const doc of [prompt.promptTemplate,...table.records.map(row=>row.values[prompt.id])])if(doc?.segments?.some(s=>s.type==='frame'&&s.generationFieldId!==owner.id&&(s.generationFieldId===previous||linked.some(f=>f.id===s.generationFieldId)))){
   const roles=new Set();doc.segments=doc.segments.filter(s=>{
    if(s.type!=='frame'||!(s.generationFieldId===previous||linked.some(f=>f.id===s.generationFieldId)))return true;
    s.generationFieldId=owner.id;if(roles.has(s.role))return false;roles.add(s.role);return true;
   });
  }
 }
}
export function syncGenerationPromptSource(table,before,config){
 const source=config.promptFieldId;
 if(!source||table.fields.some(f=>f.id===source)||!before.fields.some(f=>f.id===source))return false;
 config.promptFieldId=promptColumns(table)[0]?.id||'';
 return true;
}
export function enableColumnPrompt(table,fieldId){
 const field=table.fields.find(f=>f.id===fieldId);
 if(!field||field.readonly)throw new Error('提示词列不可编辑');
 if(field.presentation==='prompt')return;
 if(!promptColumns(table).some(f=>f.id===fieldId))throw new Error('请选择文本列');
 field.type='json';field.presentation='prompt';field.generationPrompt=true;
 for(const row of table.records){const text=row.values[fieldId];row.values[fieldId]=isColumnPrompt(text)?text:typeof text==='string'&&text?{kind:'column-template',version:1,segments:[{type:'text',text}]}:'';}
}
export function addGenerationColumn(table,spec={}){
 const field=addField(table,{...spec,type:'content',presentation:'generation',readonly:true,width:340,generation:{version:1,kind:'image',model:'Lib Image',promptFieldId:'',mode:'',settings:{}}});
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
function generationPrompt(table,row,promptFieldId){
 const source=table.fields.find(f=>f.id===promptFieldId);
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
 return document;
}
export const generationFrameRoles=config=>config.kind!=='video'?[]:config.mode==='frames2video'?['first','last']:config.mode==='singleImage2video'?['first']:[];
export const generationFrameTagKey=config=>JSON.stringify([config.promptFieldId,generationFrameRoles(config)]);
export function syncGenerationFrameTags(table,fieldId,defaults,recordId=null){
 const changed=new Set();
 for(const row of table.records){
  if(recordId!==null&&row.id!==recordId)continue;
  const config=rowGenerationConfig(row,fieldId,defaults),roles=generationFrameRoles(config),key=generationFrameTagKey(config);
  const previous=row.meta?.generationFrameTags?.[fieldId];if(previous===key||!previous&&!roles.length)continue;
  if(roles.length)enableColumnPrompt(table,config.promptFieldId);
  let frames;try{frames=generationFrames(table,row,fieldId,config);}catch{frames=[];}
  const current=row.values[config.promptFieldId];if(isColumnPrompt(current)&&current.segments.some(s=>s.type==='frame'&&s.generationFieldId===fieldId)){current.segments=current.segments.filter(s=>s.type!=='frame'||s.generationFieldId!==fieldId);changed.add(config.promptFieldId);}
  row.meta||={};row.meta.generationFrameTags||={};row.meta.generationFrameTags[fieldId]=key;
  if(!roles.length)continue;
  row.meta.generationFrames||={};row.meta.generationFrames[fieldId]||=Object.fromEntries(frames.filter(f=>f.asset).map(f=>[f.role,{assetId:f.asset.id,fieldId:f.asset.fieldId}]));
  const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
  doc.segments=doc.segments.filter(s=>s.type!=='frame'||s.generationFieldId!==fieldId);
  doc.segments.unshift(...roles.map(role=>({type:'frame',generationFieldId:fieldId,role})));
  row.values[config.promptFieldId]=doc;changed.add(config.promptFieldId);
 }
 return changed;
}
export function syncGenerationPromptMode(table,before,fieldId,defaults){
 const oldRows=new Map(before.records.map(row=>[row.id,row]));
 for(const row of table.records){
  const old=oldRows.get(row.id);if(!old)continue;
  const config=rowGenerationConfig(row,fieldId,defaults),previous=rowGenerationConfig(old,fieldId,defaults);
  if(config.kind!=='video'||generationFrameTagKey(config)!==generationFrameTagKey(previous)||row.meta?.generationFrameTags?.[fieldId]!==old.meta?.generationFrameTags?.[fieldId])continue;
  const roles=(table,row)=>(effectivePrompt(table,row,config.promptFieldId)?.segments||[]).filter(s=>s.type==='frame'&&s.generationFieldId===fieldId).map(s=>s.role);
  const oldRoles=roles(before,old),remaining=roles(table,row);
  if(oldRoles.length===remaining.length&&oldRoles.every(role=>remaining.includes(role)))continue;
  const mode=remaining.includes('last')?'frames2video':remaining.includes('first')?'singleImage2video':'text2video';
  if(mode===config.mode)continue;
  const updated={...config,mode};setRowGenerationConfig(row,fieldId,updated);
  row.meta.generationFrameTags||={};row.meta.generationFrameTags[fieldId]=generationFrameTagKey(updated);
 }
}
export function generationFrames(table,row,fieldId,config){
 const roles=generationFrameRoles(config),bound=row?.meta?.generationFrames?.[fieldId];
 if(!roles.length||!row)return [];
 if(!bound){
  const doc=generationPrompt(table,row,config.promptFieldId),assets=[];
  for(const s of doc.segments)if(s.type==='ref'){const ref=doc.references.find(r=>r.refId===s.refId&&r.included!==false),asset=ref&&doc.assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);if(asset&&!assets.some(a=>a.id===asset.id))assets.push(asset);}
  return roles.map((role,index)=>assets[index]?.kind==='video'||assets[index]?.kind==='audio'?{role,error:'首尾帧请选择图片'}:{role,asset:assets[index]});
 }
 return roles.map(role=>{
  if(row.meta?.generationFrameTags?.[fieldId]&&!effectivePrompt(table,row,config.promptFieldId)?.segments?.some(s=>s.type==='frame'&&s.generationFieldId===fieldId&&s.role===role))return {role};
  const ref=bound[role];if(!ref)return {role};
  try{const value=columnValue(table,row,ref.fieldId,undefined,ref.assetId);if(value.asset?.kind==='video'||!value.asset)throw new Error('请选择图片');if(value.field.id===fieldId)throw new Error('不能引用当前生成列');return {role,asset:value.asset};}
  catch(error){return {role,error:error.message};}
 });
}
export function generationInput(table,fieldId,recordId){
 const field=table.fields.find(f=>f.id===fieldId),row=table.records.find(r=>r.id===recordId);
 if(!isGeneration(field)||!row)throw new Error('生成列或记录已删除');
 const owner=generationConfigField(table,fieldId),config=rowGenerationConfig(row,owner.id,owner.generation),document=generationPrompt(table,row,config.promptFieldId);
 if(!document.segments.some(s=>s.type==='ref'||s.text?.trim()))throw new Error('本行提示词为空');
 const assets=[],frameBindings=row.meta?.generationFrames?.[owner.id];
 if(frameBindings)for(const frame of generationFrames(table,row,owner.id,config)){
  if(!frame.asset)throw new Error((frame.role==='first'?'首帧':'尾帧')+'：'+(frame.error||'请选择本行图片'));
  const a=frame.asset;if(a.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');assets.push({id:a.id,fieldId:a.fieldId,kind:a.kind||'image',url:a.url});
 }
 const segments=document.segments.map(s=>{
  if(s.type==='text')return {type:'text',text:s.text};
  const ref=document.references.find(r=>r.refId===s.refId&&r.included!==false);
  if(ref?.fieldId===fieldId)throw new Error('生成列不能引用自身结果，请引用其他已完成的生成列');
  const asset=ref&&document.assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);
  if(!asset)throw new Error('提示词引用的素材已不存在');
  let index=assets.findIndex(a=>a.id===asset.id&&a.fieldId===asset.fieldId);
  if(index<0){if(frameBindings&&generationFrameRoles(config).length)throw new Error('正文引用的素材未选为首尾帧，请调整图片选择或正文引用');index=assets.length;assets.push({id:asset.id,fieldId:asset.fieldId,kind:asset.kind,url:asset.url});}
  return {type:'asset',index};
 });
 return {recordId,fieldId,config:structuredClone(config),project:config.model===LOCAL_VIDEO_MODEL?'':table.meta.generationProject||'',segments,assets};
}
export const inputStamp=input=>JSON.stringify(input);
export function appendGenerationResult(table,row,fieldId,requestId,result,model){
 const field=table.fields.find(f=>f.id===fieldId);if(!field||!row)return;
 delete field.maxItems;
 const values=Array.isArray(row.values[fieldId])?row.values[fieldId]:[];
 if(!values.some(a=>a.provenance?.requestId===requestId||a.url===result.url))values.push({...result,id:uid(),provenance:{requestId,model}});
 row.values[fieldId]=values;
}
export function applyGenerationResult(table,fieldId,recordId,requestId,stamp,result){
 const row=table.records.find(r=>r.id===recordId),state=row?.meta?.generationColumns?.[fieldId];
 if(!state||state.requestId!==requestId)return false;
 try{if(inputStamp(generationInput(table,fieldId,recordId))!==stamp){state.phase='stale';state.error='输入已变化，结果保留在历史中';state.result=result;return false;}}
 catch{state.phase='stale';state.result=result;return false;}
 appendGenerationResult(table,row,fieldId,requestId,result,state.input?.config?.model);state.result=result;state.phase='complete';delete state.error;return true;
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
