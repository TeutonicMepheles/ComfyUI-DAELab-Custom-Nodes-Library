// Column relationships remain stable; concrete media are resolved per row at use time.
export const isColumnPrompt = doc => doc?.kind === 'column-template';
export function validateColumnPrompt(doc) {
 if(!isColumnPrompt(doc)||doc.version!==1||!Array.isArray(doc.segments)||doc.segments.length>10000)throw new Error('列模板格式无效');
 for(const s of doc.segments)if(s.type==='text'?typeof s.text!=='string':s.type!=='column'||typeof s.fieldId!=='string'||!s.fieldId)throw new Error('列模板引用格式无效');
 if(!doc.segments.some(s=>s.type==='column'||s.text.trim()))throw new Error('提示词模板为空');
 return doc;
}
export function effectivePrompt(table,row,fieldId) {
 const field=table.fields.find(f=>f.id===fieldId);
 return row?.values[fieldId] || field?.promptTemplate || null;
}
export function columnValue(table,row,fieldId) {
 const field=table.fields.find(f=>f.id===fieldId);
 if(!field)throw new Error('引用列已删除');
 if(field.presentation==='prompt'||field.readonly)throw new Error(`不能引用提示词或生成结果列：${field.name}`);
 const value=row.values[fieldId];
 if(Array.isArray(value)){
  if(!['assets','content'].includes(field.type))throw new Error(`不支持的引用列：${field.name}`);
  if(!value.length)throw new Error(`本行缺少参考素材：${field.name}`);
  if(value.length!==1)throw new Error(`引用列每格只能有一个素材：${field.name}`);
  const a=value[0];if(!a?.id||!a.url?.startsWith('/view?'))throw new Error(`素材无效：${field.name}`);
  return {field,asset:{...a,fieldId:field.id,fieldName:field.name}};
 }
 if(!['text','longtext','select','number','checkbox','content'].includes(field.type))throw new Error(`不支持的引用列：${field.name}`);
 if(value==null||String(value).trim()==='')throw new Error(`本行缺少文字：${field.name}`);
 return {field,text:typeof value==='boolean'?(value?'是':'否'):String(value)};
}
export function resolveColumnPrompt(doc,table,row) {
 validateColumnPrompt(doc);const segments=[],references=[],assets=[];
 for(const s of doc.segments){if(s.type==='text'){segments.push({...s});continue;}
  const value=columnValue(table,row,s.fieldId);
  if(value.asset){let ref=references.find(r=>r.fieldId===s.fieldId);
   if(!ref){const a=value.asset;ref={refId:'column-'+s.fieldId,fieldId:s.fieldId,assetId:a.id,included:true,role:'reference'};references.push(ref);assets.push(a);}
   segments.push({type:'ref',refId:ref.refId});
  }else segments.push({type:'text',text:value.text});
 }
 return {version:1,compilerVersion:1,segments,references,assets};
}
export function toColumnPrompt(doc) {
 if(isColumnPrompt(doc))return structuredClone(doc);
 const refs=new Map((doc?.references||[]).map(r=>[r.refId,r]));
 return {kind:'column-template',version:1,segments:(doc?.segments||[]).map(s=>s.type==='text'?{...s}:{type:'column',fieldId:refs.get(s.refId)?.fieldId||''})};
}
export function columnPromptStamp(doc,table,row) {
 return JSON.stringify([{kind:doc?.kind,version:doc?.version,segments:doc?.segments},(doc?.segments||[]).filter(s=>s.type==='column').map(s=>[s.fieldId,table.fields.find(f=>f.id===s.fieldId)?.type,row.values[s.fieldId]])]);
}
export function setColumnTemplate(table,fieldId,doc,{replaceRows=false}={}) {
 validateColumnPrompt(doc);const field=table.fields.find(f=>f.id===fieldId);if(!field)throw new Error('提示词列已删除');
 field.promptTemplate=structuredClone(doc);
 if(replaceRows)for(const row of table.records)row.values[fieldId]='';
 table.meta.prompt_config||=structuredClone(table.meta.storyboard||{});table.meta.prompt_config.bindings||={};table.meta.prompt_config.bindings.final_prompt=fieldId;table.meta.prompt_mode='reviewed';
}
