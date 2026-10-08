import {effectivePrompt,columnValue,validateColumnPrompt,isColumnPrompt} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';
import {validatePrompt,resolvePromptAsset} from './table_prompt_model.mjs?v=20261001-frame-tags-dedup';
import {generationFrames,rowGenerationConfig} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
import {copiesReferenceContext,CONTEXT_COPY_REASON} from './prompt_optimization_context_copy.mjs';

export const CONTRACT_VERSION=1;
export const INSTRUCTION_VERSION='daelab.prompt-opt.v3';
export const INSTRUCTION_DIGEST='a8b481b7eb82fd5eb46ab9c2c5d34bd3f17e1299db8fe2b7f14f9fe63c90d52c';
export const INPUT_VERSION='daelab.prompt-opt.input.v1';
export const DEFAULT_REQUIREMENTS='提升清晰度和可执行性，消除重复与含混表达，保持原意，不主动扩写。';
export const NAMESPACE='daelabPromptOptimizationV1';
const copy=v=>structuredClone(v);
const uuid=()=>crypto.randomUUID();
const workflowIdentities=new Map();
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(v=>canonical(v??null)).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function digest(value){const bytes=new TextEncoder().encode(typeof value==='string'?value:canonical(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function ensureIdentity(graph,node,{duplicate=false}={}){
 graph.extra||={};const remembered=workflowIdentities.get(graph.id);
 graph.extra[NAMESPACE]||=remembered?copy(remembered.document):{version:1,documentId:uuid(),nativeWorkflowId:graph.id};node.properties||={};
 if(!duplicate&&!node.properties[NAMESPACE]&&remembered?.tables.has(node.id))node.properties[NAMESPACE]=copy(remembered.tables.get(node.id));
 if(duplicate||!node.properties[NAMESPACE])node.properties[NAMESPACE]={version:1,tableId:uuid(),revisions:{},batches:[]};
 if(graph.id){const record=remembered||{document:copy(graph.extra[NAMESPACE]),tables:new Map()};record.tables.set(node.id,copy(node.properties[NAMESPACE]));workflowIdentities.set(graph.id,record);}
 return {documentId:graph.extra[NAMESPACE].documentId,tableId:node.properties[NAMESPACE].tableId};
}
export function forkDocumentIdentity(graph){graph.extra||={};graph.extra[NAMESPACE]={version:1,documentId:uuid()};for(const node of graph._nodes||[])if(node.properties?.[NAMESPACE])node.properties[NAMESPACE]={version:1,tableId:uuid(),revisions:{},batches:[]};}
// Native 1.52.7 Save As / Duplicate generates graphData.id before this public hook.
// An unchanged serialized file retains that ID; names and file paths never decide ownership.
export function prepareWorkflowIdentity(data){
 data.extra||={};const remembered=workflowIdentities.get(data.id);
 if(!data.extra[NAMESPACE]&&remembered){data.extra[NAMESPACE]=copy(remembered.document);for(const node of data.nodes||[])if(!node.properties?.[NAMESPACE]&&remembered.tables.has(node.id)){node.properties||={};node.properties[NAMESPACE]=copy(remembered.tables.get(node.id));}}
 const old=data.extra[NAMESPACE];
 if(old?.nativeWorkflowId&&data.id&&old.nativeWorkflowId!==data.id){
  data.extra[NAMESPACE]={version:1,documentId:uuid(),nativeWorkflowId:data.id};
  for(const node of data.nodes||[])if(node.properties?.[NAMESPACE])node.properties[NAMESPACE]={version:1,tableId:uuid(),revisions:{},batches:[]};
 }else if(old&&data.id)old.nativeWorkflowId=data.id;
}
const editable=f=>f&&!f.readonly&&(f.presentation==='prompt'||['text','longtext'].includes(f.type));
const safeLabel=text=>String(text||'引用').replace(/(?:https?:\/\/|file:\/\/|[A-Z]:[\\/])\S+/gi,'[位置已隐藏]');

/** Read only. Keep editable text separate from protected structural anchors. */
export function inspectTarget(table,recordId,fieldId){
 const field=table.fields.find(f=>f.id===fieldId),row=table.records.find(r=>r.id===recordId);
 if(!editable(field)||!row)throw new Error('目标行或可编辑提示词列已删除');
 const original=effectivePrompt(table,row,fieldId);
 if(original==null||original==='')throw new Error('提示词为空');
 if(typeof original==='string'){if(!original.trim())throw new Error('提示词为空');}
 else if(isColumnPrompt(original))validateColumnPrompt(original);else validatePrompt(original);
 const segments=typeof original==='string'?[{type:'text',text:original}]:original.segments;
 const dependencies=[],anchors=[];
 for(const s of segments){
  if(s.type==='text')continue;
  let context;
  if(s.type==='column'){
   const value=columnValue(table,row,s.fieldId,s.assetIndex,s.assetId);
   dependencies.push({segment:s,field:{id:value.field.id,type:value.field.type,name:value.field.name},value:value.asset||value.text});
   context=value.asset?{kind:'asset',label:safeLabel(value.asset.name||value.field.name)}:{kind:'text',label:safeLabel(value.field.name),text:value.text};
  }else if(s.type==='ref'){
   const ref=original.references.find(r=>r.refId===s.refId),asset=resolvePromptAsset(table,row,ref);
   if(!ref?.included||!asset)throw new Error('引用素材已删除或已排除');
   dependencies.push({ref,asset});context={kind:'asset',label:safeLabel(asset.name)};
  }else if(s.type==='frame'){
   const generation=table.fields.find(f=>f.id===s.generationFieldId);
   if(!generation?.generation)throw new Error('首尾帧生成配置已删除');
   const config=rowGenerationConfig(row,generation.id,generation.generation),frame=generationFrames(table,row,generation.id,config).find(f=>f.role===s.role);
   if(!frame?.asset||frame.error)throw new Error((s.role==='first'?'首帧':'尾帧')+'引用不完整');
   dependencies.push({segment:s,generation:config,asset:frame.asset,frames:row.meta?.generationFrames?.[s.generationFieldId]??null,tags:row.meta?.generationFrameTags?.[s.generationFieldId]??null});
   context={kind:'frame',label:s.role==='first'?'首帧':'尾帧',role:s.role};
  }else throw new Error('不支持的提示词结构');
  anchors.push({segment:copy(s),context});
 }
 const configs=table.fields.filter(f=>f.generation?.promptFieldId===fieldId).map(f=>({id:f.id,config:row.meta?.generationSettings?.[fieldId]?.[f.id]||f.generation}));
 const kinds=new Set(configs.map(f=>f.config.kind));const purpose=kinds.size===1&&['image','video'].includes([...kinds][0])?[...kinds][0]:'general';
 const content={field:{id:field.id,type:field.type,presentation:field.presentation,readonly:!!field.readonly},hasOverride:!!row.values[fieldId],overridePresent:Object.hasOwn(row.values,fieldId),original,template:field.promptTemplate??null,dependencies,configs,purpose};
 return {original:copy(original),segments:copy(segments),anchors,content,stamp:canonical(content),purpose};
}

/** Registry lives outside table and native history. Saved counters are only lower bounds. */
export class OptimizationRevisions{
 constructor(saved={}){this.entries=new Map(Object.entries(saved).map(([k,v])=>[k,{...v}]));}
 key(recordId,fieldId){return JSON.stringify([recordId,fieldId]);}
 observe(table){
  const live=new Set();for(const row of table.records)for(const field of table.fields.filter(editable)){
   const key=this.key(row.id,field.id);live.add(key);let stamp;try{stamp=inspectTarget(table,row.id,field.id).stamp;}catch(e){stamp='invalid:'+e.message;}
   const old=this.entries.get(key);if(!old||old.stamp!==stamp)this.entries.set(key,{stamp,revision:(old?.revision||0)+1,requestSeq:old?.requestSeq||0});
  }
  for(const [key,old] of this.entries)if(!live.has(key)&&old.stamp!=='deleted')this.entries.set(key,{...old,stamp:'deleted',revision:old.revision+1});
 }
 current(table,r,f){this.observe(table);return this.entries.get(this.key(r,f));}
 begin(table,r,f){const item=this.current(table,r,f);if(!item)throw new Error('目标不存在');item.requestSeq++;return {...item};}
 merge(saved){for(const [key,value] of Object.entries(saved||{})){const old=this.entries.get(key);if(!old)this.entries.set(key,{...value});else{if((value.revision||0)>old.revision)old.stamp=value.stamp;old.revision=Math.max(old.revision,value.revision||0);old.requestSeq=Math.max(old.requestSeq,value.requestSeq||0);}}}
 serialize(){return Object.fromEntries([...this.entries].map(([k,v])=>[k,{...v}]));}
}

export async function freezeSnapshot(table,target,revisions,{model='gpt-4.1-mini',requirements='',maxOutputTokens=1024,begin=false,nonce=uuid().replaceAll('-','')}={}){
 const local=inspectTarget(table,target.recordId,target.fieldId),revision=(begin?revisions.begin(table,target.recordId,target.fieldId):revisions.current(table,target.recordId,target.fieldId));
 if(canonical(local.content).includes(`DAE_REF_${nonce}_`))throw new Error('保护标记与输入冲突');
 let n=0;const protected_tokens=[],reference_context=[],mapping=[];
 const prompt_text=local.segments.map(s=>{if(s.type==='text')return s.text;const token=`⟦DAE_REF_${nonce}_${String(++n).padStart(4,'0')}⟧`,anchor=local.anchors[n-1];protected_tokens.push(token);reference_context.push({token,...anchor.context});mapping.push({token,segment:anchor.segment});return token;}).join('');
 const req=requirements.trim()||DEFAULT_REQUIREMENTS;
 const input={purpose:local.purpose,optimization_requirements:req,prompt_text,protected_tokens,reference_context};
 const base={contractVersion:1,target:copy(target),revision:revision.revision,requestSeq:revision.requestSeq,model,requirements:req,purpose:local.purpose,instructionVersion:INSTRUCTION_VERSION,instructionDigest:INSTRUCTION_DIGEST,inputVersion:INPUT_VERSION,maxOutputTokens,input,inputText:JSON.stringify(input)};
 const snapshotDigest=await digest({content:local.content,...base});
 return {wire:{...base,snapshotDigest},local:{...local,mapping,display:displaySuggestion({wire:{input},local:{mapping}},prompt_text)}};
}

export function displaySuggestion(frozen,text){
 let display=text;for(let i=0;i<frozen.wire.input.protected_tokens.length;i++){const token=frozen.wire.input.protected_tokens[i],context=frozen.wire.input.reference_context[i];display=display.split(token).join('@'+context.label);}
 return display;
}
export function restoreSuggestion(frozen,text,{status='completed'}={}){
 if(status!=='completed')throw new Error('模型输出未完整完成');
 if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('结果为空或过长');
 if(/^\s*```/.test(text)||/^\s*[{[]/.test(text)||/@(?:image|video|audio)_\d+\b|\{\{\s*Node\b/i.test(text))throw new Error('结果格式或保留语法无效');
 const {wire,local}=frozen;const expected=wire.input.protected_tokens;
 const actual=text.match(/⟦DAE_REF_[^⟦⟧]*⟧/g)||[];
 if(canonical(actual)!==canonical(expected))throw new Error('保护标记数量、内容或次序被改变');
 let remainder=text;for(const token of expected)remainder=remainder.replace(token,'');
 if(/DAE_REF_|⟦|⟧/.test(remainder))throw new Error('结果包含伪造或残缺保护标记');
 if(text===wire.input.prompt_text)return {status:'unchanged',document:copy(local.original),text};
 if(copiesReferenceContext(wire.input,text))throw new Error(CONTEXT_COPY_REASON);
 if(typeof local.original==='string')return {status:'valid',document:text,text};
 const segments=[];let pos=0;for(const {token,segment} of local.mapping){const index=text.indexOf(token,pos);if(index>pos)segments.push({type:'text',text:text.slice(pos,index)});segments.push(copy(segment));pos=index+token.length;}if(pos<text.length)segments.push({type:'text',text:text.slice(pos)});
 const document={...copy(local.original),segments};
 if(isColumnPrompt(document))validateColumnPrompt(document);else validatePrompt(document);
 // Metadata, inclusion, reference identity and frame anchors are never model-owned.
 const before=local.segments.filter(s=>s.type!=='text'),after=document.segments.filter(s=>s.type!=='text');
 if(canonical(before)!==canonical(after))throw new Error('引用结构发生变化');
 return {status:canonical(document)===canonical(local.original)?'unchanged':'valid',document,text};
}
export function matchesSnapshot(table,identity,revisions,frozen){
 const s=frozen.wire;if(s.target.documentId!==identity.documentId||s.target.tableId!==identity.tableId)return false;
 try{const now=revisions.current(table,s.target.recordId,s.target.fieldId);return now.revision===s.revision&&now.requestSeq===s.requestSeq&&inspectTarget(table,s.target.recordId,s.target.fieldId).stamp===frozen.local.stamp;}catch{return false;}
}
export function applySuggestions({table,identity,revisions,items,change}){
 const candidates=[],conflicts=[];for(const item of items){
  if(item.applied||item.suggestion?.status!=='valid'||!matchesSnapshot(table,identity,revisions,item.frozen)){conflicts.push({requestId:item.requestId,reason:'建议已应用、无改动或目标已变化'});continue;}
  const checked=restoreSuggestion(item.frozen,item.suggestion.text);if(checked.status==='valid')candidates.push({...item,document:checked.document});
 }
 if(!candidates.length)return {applied:[],conflicts};
 const applied=[];change(next=>{for(const item of candidates){if(!matchesSnapshot(next,identity,revisions,item.frozen)){conflicts.push({requestId:item.requestId,reason:'应用前目标已变化'});continue;}const s=item.frozen.wire.target;next.records.find(r=>r.id===s.recordId).values[s.fieldId]=copy(item.document);applied.push(item.requestId);}});
 return {applied,conflicts};
}
