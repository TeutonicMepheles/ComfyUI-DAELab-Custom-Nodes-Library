import {createTableButton as button} from './table_controls.mjs?v=20260930-inline4';
import {isColumnPrompt,effectivePrompt,toColumnPrompt,validateColumnPrompt,resolveColumnPrompt,setColumnTemplate} from './table_prompt_template.mjs?v=20260930-inline4';
const el=(tag,parent,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;};
export function readPromptSegments(box,kind='column') {
 const segments=[];const walk=node=>{if(node.nodeType===3){segments.push({type:'text',text:node.textContent});return;}
 const id=node.dataset?.[kind==='column'?'fieldId':'refId'];if(id){segments.push(kind==='column'?{type:'column',fieldId:id}:{type:'ref',refId:id});return;}
 if(node.nodeName==='BR'){segments.push({type:'text',text:'\n'});return;}for(const child of node.childNodes)walk(child);
 if(['DIV','P'].includes(node.nodeName)&&node!==box)segments.push({type:'text',text:'\n'});};walk(box);return segments;
}
export function openColumnPromptEditor({getTable,editor,fieldId,recordId,column=false,toggle=false,drawSegments}) {
 const before=getTable(),field=before.fields.find(f=>f.id===fieldId),row=before.records.find(r=>r.id===recordId)||before.records[0];if(!field||!row)return;
 const original=column?field.promptTemplate||effectivePrompt(before,row,fieldId):effectivePrompt(before,row,fieldId);
 const snapshot=JSON.stringify(before);
 editor.openTextSide(column?'column-template':row.id,fieldId,column?`${field.name} · 整列模板`:`${field.name} · 本行`,d=>{
  const draft=toColumnPrompt(original);let range=null,composing=false;
  el('p',d,column?'模板应用于所有未单独覆盖的行。输入 @ 选择列，执行时读取同一行的单元格。':(row.values[fieldId]?'本行使用单独覆盖。':'本行沿用整列模板。保存本行将创建独立覆盖。'));
  const box=el('div',d);box.className='dae-prompt-edit';box.contentEditable='true';box.setAttribute('role','textbox');box.setAttribute('aria-label',column?'整列提示词模板':'本行提示词模板');box.setAttribute('aria-multiline','true');drawSegments(box,draft,row);
  const choices=el('div',d);choices.className='dae-prompt-choices';choices.hidden=true;
  const remember=()=>{const selection=getSelection();if(selection.rangeCount&&box.contains(selection.anchorNode))range=selection.getRangeAt(0).cloneRange();};
  const insert=node=>{box.focus();if(!range||!box.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(box);range.collapse(false);}range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);remember();};
  for(const f of before.fields.filter(f=>!f.readonly&&f.presentation!=='prompt'&&['assets','content','text','longtext','select','number','checkbox'].includes(f.type))){const choose=button('@'+f.name,()=>{
   if(range?.startContainer.nodeType===3&&range.startOffset&&range.startContainer.textContent[range.startOffset-1]==='@')range.setStart(range.startContainer,range.startOffset-1);
   const container=document.createElement('div');drawSegments(container,{kind:'column-template',version:1,segments:[{type:'column',fieldId:f.id}]},row);insert(container.firstChild);choices.hidden=true;refreshPreview();
  });choose.onpointerdown=e=>e.preventDefault();choices.append(choose);}
  const preview=el('div',d);preview.className='dae-template-resolved';preview.setAttribute('aria-label','本行组装预览');
  const read=()=>({...draft,segments:readPromptSegments(box)});
  function refreshPreview(){preview.replaceChildren();el('strong',preview,'本行组装预览');try{const doc=resolveColumnPrompt(read(),getTable(),getTable().records.find(r=>r.id===row.id)||row);el('p',preview,doc.segments.map(s=>s.type==='text'?s.text:'@'+doc.assets.find(a=>a.fieldId===doc.references.find(r=>r.refId===s.refId)?.fieldId)?.fieldName).join(''));for(const a of doc.assets){const media=el(a.kind==='video'?'video':'img',preview);media.src=a.url;media.setAttribute('aria-label',a.fieldName);if(a.kind==='video')media.controls=true;else media.alt=a.fieldName;}}catch(e){el('p',preview,e.message);}}
  box.oncompositionstart=()=>composing=true;box.oncompositionend=()=>{composing=false;remember();refreshPreview();};box.onkeyup=remember;box.onmouseup=remember;
  box.oninput=()=>{if(composing)return;remember();if(range?.startContainer.nodeType===3&&range.startContainer.textContent[range.startOffset-1]==='@')choices.hidden=false;refreshPreview();};
  box.onpaste=e=>{e.preventDefault();remember();insert(document.createTextNode(e.clipboardData.getData('text/plain')));refreshPreview();};
  box.onkeydown=e=>{e.stopPropagation();if(composing)return;if(e.key==='Enter'){e.preventDefault();remember();insert(document.createTextNode('\n'));refreshPreview();}if(e.key==='Escape'&&!choices.hidden){e.preventDefault();choices.hidden=true;}};
  let replace=null;if(column){const label=el('label',d);replace=el('input',label);replace.type='checkbox';replace.setAttribute('aria-label','同时替换已有单行覆盖');label.append(' 同时替换已有单行覆盖（默认保留）');}
  const error=el('p',d);error.className='dae-prompt-error';error.setAttribute('role','status');
  const check=()=>{if(JSON.stringify(getTable())!==snapshot)throw new Error('编辑期间表格已变化，草稿已保留，请重新打开后保存');};
  d.append(button('插入 @ 列',()=>{choices.hidden=!choices.hidden;}),button('取消',()=>d.close()),button(column?'保存整列模板':'保存本行覆盖',()=>{try{if(composing)return;check();const doc=validateColumnPrompt(read());editor.change(t=>{if(column)setColumnTemplate(t,fieldId,doc,{replaceRows:replace.checked});else {t.records.find(r=>r.id===row.id).values[fieldId]=doc;t.meta.prompt_mode='reviewed';}});d.close();}catch(e){error.textContent=e.message;}},true));
  if(!column){d.append(button('编辑整列模板',()=>{d.close();openColumnPromptEditor({getTable,editor,fieldId,recordId:row.id,column:true,drawSegments});}));if(field.promptTemplate&&row.values[fieldId])d.append(button('恢复使用整列模板',()=>{try{check();editor.change(t=>t.records.find(r=>r.id===row.id).values[fieldId]='');d.close();}catch(e){error.textContent=e.message;}}));}
  refreshPreview();
 },{toggle});
}
