// Pure shared contract; no ComfyUI, DOM or provider calls.
import {videoReferenceFields,videoReferenceSpecs} from './table_video_references.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
export const promptConfig=t=>t.meta.prompt_config||t.meta.storyboard||{};
export const promptField=t=>promptConfig(t).bindings?.final_prompt;
export const isPrompt=f=>f?.type==='json'&&f?.presentation==='prompt';
export function promptAssets(t,row){
 return videoReferenceFields(t).flatMap(f=>Array.isArray(row.values[f.id])?row.values[f.id].map(a=>({...a,fieldId:f.id,fieldName:f.name})):[]);
}
export function sourceStamp(t,row,defaults=promptConfig(t).defaults||{}){
 const cfg=promptConfig(t),b=cfg.bindings||{},gf=cfg.generation_fields||{};
 return JSON.stringify([['image_prompt','camera_notes','image_url'].map(k=>[b[k]||'',t.fields.find(f=>f.id===b[k])?.type||'',k==='image_url'?(videoReferenceFields(t).some(f=>f.id===b[k])?null:'unmarked'):row.values[b[k]]??'']),
  videoReferenceSpecs(t).filter(s=>s.field.id!==b.image_url).map(s=>[s.field.id,s.required,s.field.type]),
  promptAssets(t,row).map(a=>[a.id,a.fieldId,a.url]),row.values[gf.mode]||defaults.mode||'']);
}
export function promptFingerprint(t,row){
 const cfg=promptConfig(t),doc=row.values[promptField(t)],gf=cfg.generation_fields||{};
 return JSON.stringify([sourceStamp(t,row),doc?.segments||[],doc?.references||[],cfg.defaults||{},row.values[gf.duration]??null]);
}
export function validatePrompt(doc){
 if(!doc||doc.version!==1||doc.compilerVersion!==1)throw new Error('尚未解析或不支持的提示词版本');
 if(!Array.isArray(doc.segments)||!Array.isArray(doc.references))throw new Error('提示词结构无效');
 const refs=new Map(),assets=new Set();
 for(const r of doc.references){if(!r.refId||refs.has(r.refId)||!r.assetId||assets.has(r.assetId)||typeof r.included!=='boolean')throw new Error('引用重复或参与状态无效');refs.set(r.refId,r);assets.add(r.assetId);}
 let textRun='';for(const s of doc.segments){if(s.type==='text'){if(typeof s.text!=='string')throw new Error('正文必须是文字');textRun+=s.text;if(/@(image|video|audio)_\d+\b|\{\{\s*Node\b/i.test(textRun))throw new Error('正文含保留引用语法，请用素材选择器绑定');}else{if(s.type!=='ref'||!refs.get(s.refId)?.included)throw new Error('引用不存在或素材已排除');textRun='';}}
 if(!doc.segments.some(s=>s.type==='ref'||s.text?.trim()))throw new Error('最终提示词为空');return doc;
}
export function promptText(doc,t,row){
 const assets=new Map(promptAssets(t,row).map(a=>[a.id,a])),refs=new Map((doc?.references||[]).map(r=>[r.refId,r]));
 return (doc?.segments||[]).map(s=>s.type==='text'?s.text:'@'+(assets.get(refs.get(s.refId)?.assetId)?.name||'失效引用')).join('');
}
export function promptState(t,row){
 const doc=row.values[promptField(t)];
 if(!doc)return {key:'unparsed',label:'未解析',error:'请先解析最终提示词'};
 try{validatePrompt(doc);const assets=promptAssets(t,row);for(const r of doc.references)if(!assets.some(a=>a.id===r.assetId&&a.fieldId===r.fieldId))throw new Error('引用失效，请移除或重新绑定');}
 catch(e){return {key:'invalid',label:'引用/结果无效',error:e.message};}
 if(doc.sourceState!==sourceStamp(t,row))return {key:'stale',label:'待复核',error:'源内容或生成方式已变化，请先复核'};
 return {key:doc.editOrigin==='edited'?'edited':'parsed',label:doc.editOrigin==='edited'?'已编辑':'已解析',error:''};
}
export function applyPromptResults(table,results){
 const good=results.filter(r=>r.document&&!r.error);if(!good.length)return;
 table.meta.prompt_config||=clone(promptConfig(table));const cfg=table.meta.prompt_config;cfg.bindings||={};
 let f=table.fields.find(f=>f.id===cfg.bindings.final_prompt);
 if(f&&!isPrompt(f))throw new Error('最终提示词绑定字段类型不兼容');
 if(!f){if(table.fields.length>=64)throw new Error('表格最多 64 列，请先删除无用字段');f={id:crypto.randomUUID(),name:'最终提示词',type:'json',presentation:'prompt',width:360,hidden:false};table.fields.push(f);cfg.bindings.final_prompt=f.id;}
 for(const result of good){const row=table.records.find(r=>r.id===result.recordId);if(!row)continue;row.values[f.id]=clone(result.document);row.values[f.id].sourceState=sourceStamp(table,row);row.values[f.id].editorFingerprint=promptFingerprint(table,row);}
 table.meta.prompt_mode='reviewed';
}
// Monotonic revisions are deliberately outside serialized data and undo snapshots.
export class PromptRequests{
 constructor(){this.epoch=0;this.seq=0;this.rows=new Map();this.latest=new Map();}
 invalidate(){this.epoch++;this.latest.clear();}
 observe(t){const live=new Set();for(const r of t.records){live.add(r.id);const stamp=JSON.stringify([sourceStamp(t,r),r.values[promptField(t)],promptConfig(t).defaults||{},promptField(t),t.meta.prompt_mode]);const old=this.rows.get(r.id);if(!old||old.stamp!==stamp)this.rows.set(r.id,{stamp,revision:(old?.revision||0)+1});}for(const id of this.rows.keys())if(!live.has(id)){this.rows.delete(id);this.invalidate();}}
 begin(t,ids){this.observe(t);const token={epoch:this.epoch,seq:++this.seq,rows:new Map(ids.map(id=>[id,this.rows.get(id)?.revision]))};for(const id of ids)this.latest.set(id,token.seq);return token;}
 matches(t,token,id){this.observe(t);return token.epoch===this.epoch&&this.latest.get(id)===token.seq&&this.rows.get(id)?.revision===token.rows.get(id);}
}
