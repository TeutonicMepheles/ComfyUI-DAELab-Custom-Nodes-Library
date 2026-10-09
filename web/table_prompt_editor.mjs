import {bindInlineEditor,deletePromptReference} from './table_inline_editor.mjs?v=20261001-table-perf';
import {columnReferenceOptions,createReferenceMenu,materialReferenceLabel} from './table_reference_menu.mjs?v=20261001-table-perf';
import {isColumnPrompt,effectivePrompt,columnValue,toColumnPrompt} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';
import {openColumnPromptEditor,readPromptSegments} from './table_prompt_template_editor.mjs?v=20261009-progress-r4';
import {clone} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {tableButton as button} from './data_table_editor.mjs?v=20261009-progress-r4';
import {promptConfig,promptField,promptAssets,tableAssets,resolvePromptAsset,promptText,promptState,isPrompt,validatePrompt,applyPromptResults,PromptRequests} from './table_prompt_model.mjs?v=20261001-frame-tags-dedup';

const el=(tag,parent,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;};
const roleLabel=role=>({first:'首帧',last:'尾帧',reference:'参考素材'})[role]||role;
export function createPromptEditor({getTable,editor,request,notify,renderFrame,getDefaults=()=>({}),onStatus=()=>{}}){
 const requests=new PromptRequests();requests.observe(getTable());let hover=null,timer=null,closeTimer=null,parsing=false,alive=true;
 const style=document.createElement('style');style.textContent=`
.dae-prompt-preview{white-space:pre-wrap;max-height:72px;overflow:auto;line-height:1.6}.dae-prompt-ref{display:inline-block;border-radius:4px;background:#254b45;color:#b9f4dc;padding:1px 5px;margin:0 2px;cursor:pointer}.dae-prompt-ref[data-invalid=true]{background:#542e36;color:#ffd1d1}.dae-prompt-active{outline:2px solid #9ce8c4!important;outline-offset:2px}.dae-prompt-edit{white-space:pre-wrap;min-height:140px;max-height:340px;overflow:auto;padding:12px;border:1px solid #596a78;border-radius:6px;line-height:1.7;outline-offset:2px}.dae-prompt-dialog{width:min(860px,92vw)}.dae-prompt-assets{max-height:240px;overflow:auto}.dae-prompt-assets img{width:60px;height:45px;object-fit:contain}.dae-prompt-hover{position:fixed;z-index:100000;background:#202b31;color:#e5ecef;border:1px solid #82ad9d;padding:10px;border-radius:8px;width:260px;box-shadow:0 8px 30px #0008;font:14px/1.6 var(--dae-font-family,sans-serif)}.dae-prompt-hover img{width:100%;height:160px;object-fit:contain}.dae-prompt-status{display:block;font-size:11px;color:#9ec4b4}.dae-prompt-error{color:#ffadad;white-space:pre-wrap}.dae-prompt-choices{display:flex;gap:5px;flex-wrap:wrap;max-height:180px;overflow:auto}.dae-prompt-choices button{display:flex;align-items:center}.dae-prompt-choices img{width:44px;height:34px;object-fit:contain}.dae-prompt-diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}.dae-prompt-diff pre{white-space:pre-wrap;max-height:45vh;overflow:auto}
.dae-prompt-cell{display:flex;flex-direction:column;gap:4px;height:auto;min-width:0}
.dae-prompt-cell .dae-prompt-preview{flex:none;min-height:21px;max-height:none;overflow:visible;overflow-wrap:anywhere;line-height:21px}
.dae-prompt-cell .dae-prompt-status{flex:none;line-height:16px}
.dae-prompt-actions{display:flex;flex-wrap:wrap;gap:6px;flex:none}
.dae-table .dae-prompt-actions>button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;min-width:32px;margin:0!important;padding:6px;box-sizing:border-box}
.dae-prompt-actions>button svg{width:18px;height:18px;pointer-events:none}
.dae-prompt-ref{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}
`;document.head.append(style);
 function closeHover(){clearTimeout(timer);timer=null;clearTimeout(closeTimer);hover?.remove();hover=null;document.querySelectorAll('.dae-prompt-active').forEach(e=>e.classList.remove('dae-prompt-active'));}
 function highlight(row,id){for(const e of document.querySelectorAll('[data-prompt-owner]'))if(e.dataset.promptOwner===owner&&e.dataset.promptRow===row&&e.dataset.promptAsset===id)e.classList.add('dae-prompt-active');}
 const owner=crypto.randomUUID();
 function identity(e,row,id){e.dataset.promptOwner=owner;e.dataset.promptRow=row;e.dataset.promptAsset=id;}
 function preview(target,row,ref){
  closeHover();highlight(row.id,ref.assetId);timer=setTimeout(()=>{
   if(!target.isConnected)return;const asset=resolvePromptAsset(getTable(),getTable().records.find(r=>r.id===row.id)||row,ref);
   hover=el('aside',target.closest('dialog')||document.body);hover.className='dae-ui dae-prompt-hover';hover.setAttribute('role','tooltip');
   if(asset){const image=el('img',hover);image.src=asset.url;image.alt=asset.name;el('div',hover,`${asset.name} · ${asset.fieldName} · ${roleLabel(ref.role)}`);hover.append(button('定位素材',()=>{editor.focusCell(row.id,ref.fieldId);closeHover();}));}
   else el('p',hover,'素材已删除或绑定失效');
   const box=target.getBoundingClientRect();hover.style.left=Math.max(8,Math.min(innerWidth-290,box.left))+'px';hover.style.top=Math.max(8,Math.min(innerHeight-260,box.bottom+5))+'px';
   hover.onpointerenter=()=>clearTimeout(closeTimer);hover.onpointerleave=()=>{closeTimer=setTimeout(closeHover,180);};
  },200);
 }
 function decorate(target,row,ref){identity(target,row.id,ref.assetId);target.onpointerenter=()=>preview(target,row,ref);target.onpointerleave=()=>{closeTimer=setTimeout(closeHover,180);};target.onfocus=()=>preview(target,row,ref);target.onblur=()=>{closeTimer=setTimeout(closeHover,180);};target.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeHover();}});}
 function chip(row,ref){const assets=tableAssets(getTable(),row),asset=assets.find(a=>a.id===ref?.assetId&&a.fieldId===ref.fieldId),index=asset?row.values[asset.fieldId].findIndex(a=>a.id===asset.id):-1;const span=el('span',null,'@'+(asset?`${asset.fieldName} · ${materialReferenceLabel(asset,index)}`:'失效引用'));span.className='dae-prompt-ref';span.dataset.refId=ref?.refId||'';span.dataset.invalid=String(!asset);span.tabIndex=0;span.contentEditable='false';span.title=asset?`${asset.fieldName} · ${materialReferenceLabel(asset,index)} · ${roleLabel(ref.role)}`:'素材不存在';if(ref)decorate(span,row,ref);return span;}
 function drawSegments(container,doc,row){for(const s of doc?.segments||[]){if(s.type==='frame'){const token=renderFrame?.(s,row);if(token)container.append(token);}else if(s.type==='text')container.append(document.createTextNode(s.text));else if(s.type==='column'){
 const f=getTable().fields.find(f=>f.id===s.fieldId),span=el('span',container,'@'+(f?.name||'已删除列'));span.className='dae-prompt-ref';span.dataset.fieldId=s.fieldId;if(s.assetIndex!==undefined)span.dataset.assetIndex=String(s.assetIndex);if(s.assetId)span.dataset.assetId=s.assetId;span.contentEditable='false';span.tabIndex=0;
 try{const value=columnValue(getTable(),row,s.fieldId,s.assetIndex,s.assetId);span.title=value.asset?materialReferenceLabel(value.asset,value.assetIndex):value.text;if(value.asset){span.dataset.fieldId=value.field.id;span.dataset.assetId=value.asset.id;span.dataset.assetIndex=String(value.assetIndex);span.textContent='@'+value.field.name+' · '+materialReferenceLabel(value.asset,value.assetIndex);const media=document.createElement(value.asset.kind==='video'?'video':'img');media.src=value.asset.url;media.className='dae-ref-thumb';media.setAttribute('aria-hidden','true');media.draggable=false;if(value.asset.kind==='video')media.preload='metadata';span.prepend(media);decorate(span,row,{assetId:value.asset.id,fieldId:value.field.id,role:'reference'});}}catch(e){span.dataset.invalid='true';span.textContent+=' · 失效引用';span.title=e.message;}
 }else container.append(chip(row,doc.references.find(r=>r.refId===s.refId)));}}
 function compareColumn(container,title,doc,row){const column=el('div',container);el('strong',column,title);el('pre',column,promptText(doc,getTable(),row));const assets=tableAssets(getTable(),row);for(const [i,ref] of (doc?.references||[]).entries()){const line=el('div',column),asset=assets.find(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId);line.style.cssText='display:flex;gap:8px;align-items:center;margin:6px 0';if(asset){const img=el('img',line);img.src=asset.url;img.alt=asset.name;img.style.cssText='width:54px;height:40px;object-fit:contain';}el('span',line,`${i+1}. ${asset?.name||'失效引用'} · ${roleLabel(ref.role)} · ${ref.included?'参与':'排除'}`);}}
 async function call(table,ids,operation='parse',documents={}){return request({table,recordIds:ids,defaults:getDefaults(),operation,documents});}
 async function parse(ids=null,compare=false){
  if(parsing)return;parsing=true;
  const report=state=>{if(alive)onStatus(state);};
  try{
   closeHover();const before=getTable(),selected=ids||before.records.filter(r=>r.selected).map(r=>r.id),field=promptField(before);
   const pending=selected.filter(id=>compare||before.records.find(r=>r.id===id)?.values[field]?.editOrigin!=='edited'),skipped=selected.length-pending.length;
   if(!pending.length){report({busy:false,message:`跳过 ${skipped} 条手工结果`});return;}if(pending.length>100)throw new Error('每次最多解析 100 行');
   report({busy:true,message:`正在解析 ${pending.length} 行…`});
   const token=requests.begin(before,pending),result=await call(clone(before),pending);const good=[],bad=[],expired=[];if(!alive)return;
   for(const r of result.results){if(!requests.matches(getTable(),token,r.recordId))expired.push(r);else if(r.error)bad.push(r);else good.push(r);}
   report({busy:false,error:Boolean(bad.length||expired.length),message:`解析完成：成功 ${good.length} · 手工跳过 ${skipped} · 失败 ${bad.length} · 过期 ${expired.length}`});
   if(compare&&good.length){const item=good[0],row=getTable().records.find(r=>r.id===item.recordId),d=editor.openDialog('重新解析：比较结果');d.classList.add('dae-prompt-dialog');const diff=el('div',d);diff.className='dae-prompt-diff';compareColumn(diff,'当前结果',row.values[promptField(getTable())],row);compareColumn(diff,'新结果',item.document,row);const error=el('p',d);error.className='dae-prompt-error';d.append(button('取消',()=>d.remove()),button('替换解析结果',()=>{if(!requests.matches(getTable(),token,item.recordId)){error.textContent='比较期间数据已变化，请取消并重新解析';return;}editor.change(t=>applyPromptResults(t,[item]));d.remove();},true));return;}
   const wasReviewed=getTable().meta.prompt_mode==='reviewed';if(good.length)editor.change(t=>applyPromptResults(t,good));
   notify(`解析完成：成功 ${good.length}，手工跳过 ${skipped}，失败 ${bad.length}，过期丢弃 ${expired.length}${!wasReviewed&&good.length?'。后续生成使用最终提示词，其他行需先解析。':''}`);
   if(bad.length||expired.length){const d=editor.openDialog('解析结果');for(const r of [...bad,...expired]){el('p',d,`${r.recordId}：${r.error||'期间有修改，请重试'}`);d.append(button('定位记录',()=>{editor.focusCell(r.recordId,promptField(getTable())||promptConfig(getTable()).bindings?.image_prompt);d.remove();}));}d.append(button('关闭',()=>d.remove()));}
  }catch(e){report({busy:false,error:true,message:e.message});if(alive)notify(e.message,'error');}finally{parsing=false;}
 }
 function editTemplate(fieldId=promptField(getTable()),recordId=getTable().records[0]?.id){openColumnPromptEditor({getTable,editor,fieldId,recordId,column:true,drawSegments});}
 function edit(recordId,{toggle=false,fieldId=promptField(getTable())}={}){
  const current=getTable(),active=current.records.find(r=>r.id===recordId),value=effectivePrompt(current,active,fieldId);
  if(isColumnPrompt(value)||typeof value==='string'||!value){openColumnPromptEditor({getTable,editor,fieldId,recordId,toggle,drawSegments});return;}
  const table=getTable(),row=table.records.find(r=>r.id===recordId),original=row?.values[promptField(table)];if(!original){editor.openTextSide(recordId,promptField(table),'最终提示词',d=>{el('p',d,'尚未解析最终提示词。');d.append(button('解析此行',async()=>{await parse([recordId],false);if(getTable().records.find(r=>r.id===recordId)?.values[promptField(getTable())]){d.close();edit(recordId);}}));},{toggle});return;}
  if(original.version!==1||original.compilerVersion!==1||!Array.isArray(original.segments)||!Array.isArray(original.references)){notify('不支持的提示词版本，请保留原数据或明确重新解析','error');return;}
  editor.openTextSide(recordId,promptField(table),'最终提示词',d=>{
  let draft=clone(original),composing=false,range=null;const token=requests.begin(table,[recordId]);
  const status=el('p',d,`${promptState(table,row).error||promptState(table,row).label} · 删除 @ 仅移除文字引用，素材参与状态在下方管理。`),box=el('div',d);box.className='dae-prompt-edit';box.contentEditable='true';box.setAttribute('role','textbox');box.setAttribute('aria-label','最终提示词正文');box.setAttribute('aria-multiline','true');drawSegments(box,draft,row);
  const choices=el('div',d);choices.hidden=true;let referencePicker=null;
  d.addEventListener('scroll',()=>referencePicker?.layout(),true);
  function remember(){const s=getSelection();if(s.rangeCount&&box.contains(s.anchorNode))range=s.getRangeAt(0).cloneRange();}
  function insert(node){box.focus();if(!range||!box.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(box);range.collapse(false);}range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);remember();}
  function read(){draft.segments=readPromptSegments(box,'ref');return draft;}
  const list=el('div',d);list.className='dae-prompt-assets';el('strong',list,'参与生成的素材');
  const assets=promptAssets(table,row);for(const a of assets)if(!draft.references.some(r=>r.assetId===a.id))draft.references.push({refId:'ref-'+a.id,assetId:a.id,fieldId:a.fieldId,role:'reference',included:false});
  function drawList(){list.querySelectorAll('label').forEach(e=>e.remove());choices.replaceChildren();const cfg=promptConfig(table),mode=row.values[cfg.generation_fields?.mode]||cfg.defaults?.mode||'',included=assets.filter(a=>draft.references.some(r=>r.assetId===a.id&&r.included));for(const ref of draft.references){const a=resolvePromptAsset(table,row,ref),eligible=assets.some(a=>a.id===ref.assetId&&a.fieldId===ref.fieldId),label=el('label',list),check=el('input',label);check.type='checkbox';check.checked=ref.included;check.setAttribute('aria-label',`参与生成 ${a?.name||'失效素材'}`);if(a){const img=el('img',label);img.src=a.url;img.alt=a.name;}const index=included.indexOf(a),nextRole=index<0?'不参与':['frames2video','首尾帧'].includes(mode)?(index===0?'首帧':index===1?'尾帧':'超出首尾帧数量'):['singleImage2video','首帧生视频'].includes(mode)?(index===0?'首帧':'超出首帧数量'):'参考素材';el('span',label,a?`${a.name} · ${a.fieldName} · ${roleLabel(ref.role)} → ${nextRole}`:'失效引用');check.onchange=()=>{read();if(check.checked&&!eligible){check.checked=false;error.textContent='此素材列尚未选为生成参考';return;}if(!check.checked&&draft.segments.some(s=>s.type==='ref'&&s.refId===ref.refId)){check.checked=true;error.textContent='请先移除正文中的对应引用';return;}ref.included=check.checked;drawList();};
    if(!a)label.append(button('移除失效引用',()=>{read();draft.references=draft.references.filter(r=>r!==ref);draft.segments=draft.segments.filter(s=>s.refId!==ref.refId);box.replaceChildren();drawSegments(box,draft,row);drawList();}));
   }
   const options=columnReferenceOptions(table,row).filter(f=>assets.some(a=>a.fieldId===f.id));
   referencePicker=createReferenceMenu({options,onChoose:option=>{const ref=draft.references.find(r=>r.fieldId===option.id&&r.assetId===option.asset.id);ref.included=true;if(range?.startContainer.nodeType===Node.TEXT_NODE&&range.startOffset&&range.startContainer.textContent[range.startOffset-1]==='@')range.setStart(range.startContainer,range.startOffset-1);insert(chip(row,ref));choices.hidden=true;drawList();}});referencePicker.root.dataset.embedded='true';choices.append(referencePicker.root);
  }
  const error=el('p',d);error.className='dae-prompt-error';drawList();
  box.oncompositionstart=()=>composing=true;box.oncompositionend=()=>{composing=false;remember();};box.onkeyup=remember;box.onmouseup=remember;
  box.oninput=()=>{if(composing)return;remember();if(range?.startContainer.nodeType===Node.TEXT_NODE&&range.startContainer.textContent[range.startOffset-1]==='@')choices.hidden=false;};
  box.onpaste=e=>{e.preventDefault();remember();insert(document.createTextNode(e.clipboardData.getData('text/plain')));};
  box.onkeydown=e=>{e.stopPropagation();if(composing||e.isComposing)return;if(deletePromptReference(box,e)){remember();choices.hidden=true;return;}if(!choices.hidden&&referencePicker?.keydown(e.key)){e.preventDefault();return;}if(e.key==='Enter'){e.preventDefault();remember();insert(document.createTextNode('\n'));}if(e.key==='Escape'){e.preventDefault();if(!choices.hidden)choices.hidden=true;else editor.collapseTextSide();closeHover();}};
  async function save(review){try{if(composing)return;read();validatePrompt(draft);if(!requests.matches(getTable(),token,recordId))throw new Error('编辑期间表格已变化，请取消后重新打开，草稿尚未覆盖原内容');const result=await call(clone(getTable()),[recordId],review?'review':'validate',{[recordId]:draft});if(!requests.matches(getTable(),token,recordId))throw new Error('保存期间表格已变化，请重新打开');const r=result.results[0];if(r.error)throw new Error(r.error);r.document.editOrigin='edited';editor.change(t=>applyPromptResults(t,[r]));closeHover();d.close();}catch(e){error.textContent=e.message;}}
  d.append(button('编辑整列模板',()=>{d.close();editTemplate(promptField(table),recordId);}),...(table.fields.find(f=>f.id===promptField(table))?.promptTemplate?[button('恢复使用整列模板',()=>{editor.change(t=>t.records.find(r=>r.id===recordId).values[promptField(t)]='');d.close();})]:[]),button('插入 @ 素材',()=>{choices.hidden=!choices.hidden;}),button('撤销正文编辑',()=>{box.focus();document.execCommand('undo');}),button('取消',()=>{closeHover();d.close();}),button('重新解析并比较',()=>{d.close();void parse([recordId],true);}),button('保存',()=>save(false),true),button('核对素材后确认复核',()=>save(true)));
  status.textContent+=' 复核将保留正文并确认当前素材顺序及首尾帧角色；新增素材默认排除，请逐项核对。';box.focus();
  },{toggle});
 }
 function renderCell({cell,row,field,onCleanup}){
  if(!isPrompt(field))return false;
  mountEditor({cell,row,field,onCleanup});return true;
 }
 function mountEditor({cell,row,field,onCleanup,change=editor.change}){
  const container=el('div',cell);container.className='dae-prompt-cell';const preview=el('div',container);preview.className='dae-prompt-preview';preview.tabIndex=0;preview.setAttribute('aria-label',`${field.name}正文`);
  const currentRow=()=>getTable().records.find(r=>r.id===row.id),current=()=>effectivePrompt(getTable(),currentRow(),field.id);
  drawSegments(preview,toColumnPrompt(current(),row),row);
  if(!field.readonly){let original,expected,group,draft;
   const binding=bindInlineEditor({cell,box:preview,label:`编辑 ${field.name}`,onCleanup,notify,
    draw:()=>{closeHover();original=clone(currentRow()?.values[field.id]??'');expected=JSON.stringify(original);group=crypto.randomUUID();draft=toColumnPrompt(current(),currentRow()||row);preview.replaceChildren();drawSegments(preview,draft,currentRow()||row);},
    read:()=>({...draft,segments:readPromptSegments(preview)}),
    write:doc=>{if(!currentRow()||!getTable().fields.some(f=>f.id===field.id&&!f.readonly))throw new Error('提示词行或列已删除或不可编辑');const actual=currentRow().values[field.id]??'';if(JSON.stringify(actual)!==expected)throw new Error('提示词已被更新，请重新编辑');change(t=>{t.records.find(r=>r.id===row.id).values[field.id]=doc;t.meta.prompt_mode='reviewed';},{render:false,group});expected=JSON.stringify(doc);},
    reset:()=>{if(currentRow()&&JSON.stringify(currentRow().values[field.id]??'')===expected)change(t=>t.records.find(r=>r.id===row.id).values[field.id]=original,{render:false,group});},
    columns:()=>columnReferenceOptions(getTable(),currentRow()||row),
    getColumnChip:f=>{const box=document.createElement('div');drawSegments(box,{segments:[{type:'column',fieldId:f.id,...(f.assetIndex!==undefined?{assetIndex:f.assetIndex}:{}),...(f.asset?{assetId:f.asset.id}:{})}]},currentRow()||row);return box.firstChild;}
   });
   return {...binding,dispose(){binding.dispose();closeHover();}};
  }
 }

 function decorateAsset(item,row,asset,field){identity(item,row.id,asset.id);}
 const escape=e=>{if(e.key==='Escape'&&(hover||timer)){e.preventDefault();e.stopImmediatePropagation();closeHover();}};document.addEventListener('keydown',escape,true);
 return {parse,edit,editTemplate,renderCell,mountEditor,decorateAsset,observe:()=>requests.observe(getTable()),invalidate:()=>requests.invalidate(),close:closeHover,destroy(){alive=false;requests.invalidate();closeHover();style.remove();document.removeEventListener('keydown',escape,true);}};
}
