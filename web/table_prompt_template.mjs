import {isTextColumn} from './table_prompt_source.mjs';
// Row references bind media identity; column templates select media for each row.
export const isColumnPrompt = doc => doc?.kind === 'column-template';
export function validateColumnPrompt(doc) {
 if(!isColumnPrompt(doc)||doc.version!==1||!Array.isArray(doc.segments)||doc.segments.length>10000)throw new Error('列模板格式无效');
 for(const s of doc.segments)if(s.type==='text'?typeof s.text!=='string':s.type==='frame'?typeof s.generationFieldId!=='string'||!s.generationFieldId||!['first','last'].includes(s.role):s.type!=='column'||typeof s.fieldId!=='string'||!s.fieldId)throw new Error('列模板引用格式无效');
 for(const s of doc.segments)if(s.type==='column'&&s.assetIndex!==undefined&&(!Number.isInteger(s.assetIndex)||s.assetIndex<0))throw new Error('素材序号无效');
 for(const s of doc.segments)if(s.type==='column'&&s.assetId!==undefined&&(typeof s.assetId!=='string'||!s.assetId))throw new Error('素材引用无效');
 for(const s of doc.segments)if(s.valueType!==undefined&&s.valueType!=='text')throw new Error('引用值类型无效');
 if(!doc.segments.some(s=>s.type==='column'||s.type==='frame'||s.text.trim()))throw new Error('提示词模板为空');
 return doc;
}
export function effectivePrompt(table,row,fieldId) {
 const field=table.fields.find(f=>f.id===fieldId);
 const value=row?.values[fieldId];
 return value==null||value===''?field?.promptTemplate??value??null:value;
}
export function promptContent(table,row,fieldId){
 return toColumnPrompt(effectivePrompt(table,row,fieldId),row).segments.map(s=>s.type==='frame'?{...s,binding:structuredClone(row.meta?.generationFrames?.[s.generationFieldId]?.[s.role]||null)}:s);
}
export function columnValue(table,row,fieldId,assetIndex,assetId,valueType) {
 if(valueType==='text'&&!isTextColumn(table,table.fields.find(f=>f.id===fieldId)))throw new Error('引用的文本列已删除或类型已变化');
 const field=assetId?table.fields.find(f=>['assets','content'].includes(f.type)&&Array.isArray(row.values[f.id])&&row.values[f.id].some(a=>a.id===assetId)):table.fields.find(f=>f.id===fieldId);
 if(assetId&&!field)throw new Error('引用的素材已删除或移到其他行');
 if(!field)throw new Error('引用列已删除');
 let value=effectivePrompt(table,row,field.id);
 // Old generic text columns used literal rich documents. Never recurse into references.
 if(isColumnPrompt(value)){
  if(value.version!==1||!Array.isArray(value.segments)||value.segments.some(s=>s.type!=='text'||typeof s.text!=='string'))throw new Error(`不能嵌套引用提示词单元格：${field.name}`);
  value=value.segments.map(s=>s.text).join('');
 }
 if(Array.isArray(value)){
  if(!['assets','content'].includes(field.type))throw new Error(`不支持的引用列：${field.name}`);
  if(!value.length)throw new Error(`本行缺少参考素材：${field.name}`);
  const index=assetId?value.findIndex(a=>a.id===assetId):assetIndex??0;
  if(!Number.isInteger(index)||index<0||index>=value.length)throw new Error(`本行缺少第 ${index+1} 个素材：${field.name}`);
  const a=value[index];if(!a?.id||!a.url?.startsWith('/view?'))throw new Error(`素材无效：${field.name}`);
  return {field,asset:{...a,fieldId:field.id,fieldName:field.name},assetIndex:index};
 }
 if(assetId||assetIndex!==undefined)throw new Error(`引用的素材已删除或移到其他行：${field.name}`);
 if(!['text','longtext','select','number','checkbox','content'].includes(field.type)&&field.presentation!=='prompt')throw new Error(`不支持的引用列：${field.name}`);
 if(value!=null&&!['string','number','boolean'].includes(typeof value))throw new Error(`文字单元格格式无效：${field.name}`);
 if(value==null||String(value).trim()==='')throw new Error(`本行缺少文字：${field.name}`);
 return {field,text:typeof value==='boolean'?(value?'是':'否'):String(value)};
}
export function resolveColumnPrompt(doc,table,row,fieldId) {
 validateColumnPrompt(doc);const segments=[],references=[],assets=[];
 for(const s of doc.segments){if(s.type==='frame')continue;if(s.type==='text'){segments.push({...s});continue;}
  if(fieldId&&s.fieldId===fieldId)throw new Error('提示词不能引用自身');
  let value;try{value=columnValue(table,row,s.fieldId,s.assetIndex,s.assetId,s.valueType);}catch(error){throw new Error(`${row.name||row.id}：${error.message}`);}
  if(value.asset){let ref=references.find(r=>r.assetId===value.asset.id);
   if(!ref){const a=value.asset;ref={refId:'column-'+a.fieldId+(s.assetId?'-asset-'+s.assetId:s.assetIndex?'-item-'+(s.assetIndex+1):''),fieldId:a.fieldId,assetId:a.id,included:true,role:'reference'};references.push(ref);assets.push(a);}
   segments.push({type:'ref',refId:ref.refId});
  }else segments.push({type:'text',text:value.text});
 }
 return {version:1,compilerVersion:1,segments,references,assets};
}
export function toColumnPrompt(doc,row) {
 if(typeof doc==='string')return {kind:'column-template',version:1,segments:[{type:'text',text:doc}]};
 if(isColumnPrompt(doc)){const copy=structuredClone(doc),frames=new Set();copy.segments=copy.segments.filter(s=>{if(s.type!=='frame')return true;const key=JSON.stringify([s.generationFieldId,s.role]);if(frames.has(key))return false;frames.add(key);return true;});for(const s of copy.segments){const items=row?.values[s.fieldId];if(s.type==='column'&&!s.assetId&&Array.isArray(items)&&items[s.assetIndex??0]?.id)s.assetId=items[s.assetIndex??0].id;}return copy;}
 const refs=new Map((doc?.references||[]).map(r=>[r.refId,r]));
 return {kind:'column-template',version:1,segments:(doc?.segments||[]).map(s=>{if(s.type==='text')return {...s};const ref=refs.get(s.refId);return {type:'column',fieldId:ref?.fieldId||'',...(ref?.assetId?{assetId:ref.assetId}:{})};})};
}
export function bindColumnAssets(table,recordId,fieldId) {
 const references=[],row=table.records.find(r=>r.id===recordId);if(!row)return references;
 const items=row.values[fieldId],ids=new Set(Array.isArray(items)?items.map(a=>a.id):[]);
 for(const field of table.fields){
  const doc=effectivePrompt(table,row,field.id);
  if(!isColumnPrompt(doc)||!doc.segments.some(s=>s.type==='column'&&(s.fieldId===fieldId||ids.has(s.assetId))))continue;
  const bound=row.values[field.id]||toColumnPrompt(doc,row);row.values[field.id]=bound;
  for(const s of bound.segments){const items=row.values[s.fieldId];if(s.type==='column'&&!s.assetId&&Array.isArray(items)&&items[s.assetIndex??0]?.id)s.assetId=items[s.assetIndex??0].id;}
  for(const segment of bound.segments)if(segment.type==='column'&&(segment.fieldId===fieldId||ids.has(segment.assetId)))references.push({segment,row,fieldId:field.id});
 }
 return references;
}
export function columnPromptStamp(doc,table,row) {
 return JSON.stringify([{kind:doc?.kind,version:doc?.version,segments:doc?.segments},(doc?.segments||[]).filter(s=>s.type==='column').map(s=>{try{const value=columnValue(table,row,s.fieldId,s.assetIndex,s.assetId,s.valueType);return [value.field.id,value.field.type,value.asset||value.text];}catch(e){return [s.fieldId,e.message];}})]);
}
export function setColumnTemplate(table,fieldId,doc,{replaceRows=false,recordId}={}) {
 validateColumnPrompt(doc);const field=table.fields.find(f=>f.id===fieldId);if(!field)throw new Error('提示词列已删除');
 field.promptTemplate=structuredClone(doc);
 for(const s of field.promptTemplate.segments)if(s.type==='column'&&s.assetId){const value=columnValue(table,table.records.find(r=>r.id===recordId),s.fieldId,s.assetIndex,s.assetId);s.fieldId=value.field.id;s.assetIndex=value.assetIndex;delete s.assetId;}
 if(replaceRows)for(const row of table.records)row.values[fieldId]='';
 if(field.generationPrompt)return;
 table.meta.prompt_config||=structuredClone(table.meta.storyboard||{});table.meta.prompt_config.bindings||={};table.meta.prompt_config.bindings.final_prompt=fieldId;table.meta.prompt_mode='reviewed';
}

// Fill the column with relationships, never with the source row's resolved media.
export function applyPromptToColumn(table,fieldId,recordId) {
 const field=table.fields.find(f=>f.id===fieldId),row=table.records.find(r=>r.id===recordId);
 if(!field||field.presentation!=='prompt'||field.readonly||!row)throw new Error('请选择可编辑的提示词单元格');
 const doc=validateColumnPrompt(toColumnPrompt(effectivePrompt(table,row,fieldId),row));
 setColumnTemplate(table,fieldId,doc,{replaceRows:true,recordId});
}
