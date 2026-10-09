import {createTableEditor} from './data_table_editor.mjs?v=20261009-instructions-v5';
import {createTableButton as button,tableTheme,tableHistory} from './table_controls.mjs?v=20261009-instructions-v5';
import {createPromptEditor} from './table_prompt_editor.mjs?v=20261009-instructions-v5';
import {attachGenerationColumns} from './table_generation_panel.mjs?v=20261009-instructions-v5';
import {installContentPresentation} from './table_context_menu.mjs?v=20261009-instructions-v5';
import {createWorkbench} from './table_workbench.mjs?v=20261009-instructions-v5';
import {workbenchTheme} from './table_workbench_theme.mjs';
import {createSettingsPopover} from './table_prompt_settings.mjs?v=20261009-instructions-v5';
import {studioTheme} from './daelab_studio_theme.mjs';
import {ROLE_LABELS,KIND_LABELS,initialChoices,importTasks,reviseImport,hasActiveGeneration,assertTransition,ParserRequests} from './script_parser_model.mjs?v=20261008-auto-import';

const el=(tag,parent,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;};
function select(parent,label,options,value,onChange){const wrap=el('label',parent,label),s=el('select',wrap);s.setAttribute('aria-label',label);for(const [v,n] of options)s.add(new Option(n,v));s.value=value??'';s.onchange=()=>onChange(s.value);return s;}

export function createScriptParserPanel({node,app,getTable,setTable,notify}){
 tableTheme();workbenchTheme();studioTheme();
 if(!document.getElementById('dae-script-parser-css')){const link=el('link',document.head);link.id='dae-script-parser-css';link.rel='stylesheet';link.href=new URL('./script_parser.css?v=20261008-simple-state',import.meta.url).href;}
 const root=el('div');root.className='dae-ui dae-table-panel script-parser';root.setAttribute('aria-label','分镜剧本解析器');
 const empty=el('section',root);empty.className='script-empty';
 const emptyTitle=el('p',empty,'上传分镜文档，生成多维表格');
 const feedback=el('div',root);feedback.className='script-feedback';feedback.hidden=true;
 const status=el('p',feedback);status.className='script-status';status.setAttribute('role','status');
 const notice=button('',()=>showIssues());notice.className='script-notice';notice.hidden=true;root.append(notice);
 const draftBox=el('section');draftBox.className='script-draft';draftBox.hidden=true;
 const guard=new ParserRequests();let draft=null,choices=null,normalized=null,controller=null,alive=true,promptUI=null,generation=null,presentation=null,detailsDialog=null,uploadMode='append',adjusting=false,menu=null,statusTimer=null,busy=false,workbench=null;
 const snapshot=()=>JSON.stringify(getTable());
 function message(value,error=false){
  clearTimeout(statusTimer);status.textContent=value;status.dataset.error=String(error);feedback.hidden=!value&&!busy;
  const local=detailsDialog?.querySelector('.script-status');if(local){local.textContent=value;local.dataset.error=String(error);}
  if(value&&!error&&!busy)statusTimer=setTimeout(()=>{status.textContent='';feedback.hidden=true;},4500);
 }
 function updatePending(){
  const t=getTable(),docs=t.meta.script_parser.documents;
  const hasTable=Boolean(t.fields.length||t.records.length||docs.length);
  if(!hasTable&&root.dataset.expanded==='true')workbench?.close();
  root.dataset.empty=String(!hasTable);empty.hidden=hasTable;editor.root.hidden=!hasTable;
  if(!hasTable)empty.append(feedback);else root.insertBefore(feedback,editor.root);
  emptyTitle.hidden=busy;uploadButton.hidden=busy;cancelButton.hidden=!busy;
  root.setAttribute('aria-busy',String(busy));
  const count=docs.reduce((n,d)=>n+d.unassigned.filter(o=>o.disposition==='待分配').length+(d.conflicts?.length||0),0)
   +t.records.filter(r=>r.meta?.script_source?.issues?.some(i=>i.includes('图片无法读取'))).length;
  notice.hidden=!hasTable||!count;
  const label=`有 ${count} 项图片或导入问题待处理`;if(notice.textContent!==label)notice.textContent=label;
 }
 function cancel(){guard.invalidate();controller?.abort();controller=null;busy=false;normalized=null;draft=null;choices=null;adjusting=false;draftBox.replaceChildren();draftBox.hidden=true;detailsDialog?.remove();detailsDialog=null;menu?.close();}
 function invalidate(){guard.invalidate();controller?.abort();normalized=null;draftBox.querySelector('.script-confirm')?.remove();}
 async function request(path,{body,file,signal}={}){
  let data=body?JSON.stringify(body):undefined,headers=body?{'Content-Type':'application/json'}:{};
  if(file){data=new FormData();data.append('file',file,file.name);}
  const r=await app.api.fetchApi('/daelab/script-parser/'+path,{method:data?'POST':'GET',body:data,headers,signal});
  const result=await r.json();if(!r.ok)throw new Error(result.error||'解析服务不可用，请重启 ComfyUI');return result;
 }
 async function uploadAsset(file){
  const body=new FormData();body.append('image',file,crypto.randomUUID()+'.'+file.name.split('.').at(-1));body.append('type','input');body.append('subfolder','DAELAB/script-parser');
  const r=await app.api.fetchApi('/upload/image',{method:'POST',body});if(!r.ok)throw new Error('素材上传失败');const a=await r.json();return '/view?'+new URLSearchParams({filename:a.name,subfolder:a.subfolder||'',type:a.type||'input'});
 }
 const editor=createTableEditor({getTable,setTable:t=>{assertTransition(getTable(),t);generation?.syncPromptChanges(t,getTable());setTable(t);updatePending();promptUI?.observe();},
  validateChange:assertTransition,textPanelHost:()=>root.closest('dialog[open]')||document.body,upload:uploadAsset,notify,nativeHistory:tableHistory(app),
  displayContent:()=>globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root)?.presentation==='content',
  renderCell:args=>promptUI?.renderCell(args),decorateAsset:(...args)=>promptUI?.decorateAsset(...args),
  onRestore:()=>{cancel();promptUI?.invalidate();generation?.invalidate();updatePending();message('已恢复历史版本');}});
 root.append(editor.root);
 promptUI=createPromptEditor({renderFrame:(segment,row)=>generation?.renderFrame(segment,row),getTable,editor,notify,request:()=>{throw new Error('请在文档预览中归类原文');}});
 presentation=installContentPresentation({root,editor,getTable,notify,enabled:()=>root.dataset.empty!=='true',editPromptTemplate:id=>promptUI.editTemplate(id)});
 generation=attachGenerationColumns({editor,getTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)});
 const picker=el('input',root);picker.type='file';picker.accept='.docx';picker.hidden=true;picker.setAttribute('aria-label','上传 DOCX 文档');
 picker.onchange=()=>{const file=picker.files?.[0];picker.value='';if(file)void actions.uploadDocument(file,{mode:uploadMode});};
 function pick(mode){if(hasActiveGeneration(getTable())){message('生成任务进行中，请完成或暂停后再导入',true);return;}uploadMode=mode;picker.click();}
 const uploadButton=button('上传 DOCX',()=>pick('append'),true);empty.append(uploadButton);
 const cancelButton=button('取消导入',()=>{cancel();updatePending();message('已取消导入');});cancelButton.hidden=true;feedback.append(cancelButton);
 function openMenu(anchor){
  if(menu){menu.close();return;}
  menu=createSettingsPopover(anchor,'表格与导入',()=>{menu=null;});
  menu.root.classList.add('script-table-menu');
  const add=(label,action)=>menu.root.append(button(label,()=>{menu.close();action();}));
  add('追加 DOCX',()=>pick('append'));add('查看导入来源',showSources);add('查看待处理项',showIssues);
  add('显示字段',()=>editor.manageFields());
  add(root.dataset.expanded==='true'?'返回节点':'展开工作台',()=>root.dataset.expanded==='true'?workbench.close():workbench.open());
  menu.root.querySelector('button')?.focus();
 }
 function decorate(){
  const head=editor.root.querySelector('thead .table-choice');if(!head||head.querySelector('.script-more'))return;
  const more=button('更多',e=>openMenu(e.currentTarget));more.className='script-more';more.title='表格与导入选项';more.setAttribute('aria-label','表格与导入选项');more.setAttribute('aria-haspopup','dialog');head.append(more);
 }
 const observer=new MutationObserver(decorate);observer.observe(editor.root,{childList:true,subtree:true});
 const actions={
  async classify(){
   if(!draft)return;invalidate();const ticket=guard.begin(snapshot()),choiceStamp=JSON.stringify(choices);controller=new AbortController();message('AI 仅归类文字来源；不发送图片，不提交任务表…');
   try{const result=await request('classify',{body:{document_id:draft.document_id,choices},signal:controller.signal});if(!guard.valid(ticket,snapshot())||choiceStamp!==JSON.stringify(choices))return;choices=result.choices;renderDraft();message('AI 来源校验通过，请核对每个单元格归类后归一');}
   catch(e){if(e.name!=='AbortError'&&guard.owns(ticket))message(e.message,true);}
  },
  async uploadDocument(file,{mode='append'}={}){
   if(hasActiveGeneration(getTable())){message('生成任务进行中，暂不能导入',true);return;}
   cancel();const ticket=guard.begin(snapshot());controller=new AbortController();busy=true;updatePending();message('正在读取文档和准备图片…');
    try{const result=await request('document',{file,signal:controller.signal});if(!guard.valid(ticket,snapshot())){if(guard.owns(ticket))message('上传期间任务表已变化，未应用旧草稿');return;}
    if(!result.tables.length)throw new Error('文档中没有可解析的表格。请使用含分镜表格的 DOCX，原文不会被自动拆镜。');
    draft=result;choices=initialChoices(draft);normalized=null;message('正在整理字段与图片，完成后自动入表…');
    const parsed=await request('normalize',{body:{document_id:draft.document_id,choices},signal:controller.signal});
    if(!guard.valid(ticket,snapshot())){if(guard.owns(ticket))message('导入期间表格已变化，请重新上传；未覆盖当前编辑',true);return;}
    normalized={...parsed,inventory:draft,choices,baseSnapshot:ticket.snapshot};actions.commit(mode,true);
    }catch(e){if(e.name!=='AbortError'&&guard.owns(ticket)){message(e.message,true);notify(e.message,'error');}}
   finally{if(!controller||guard.owns(ticket)){controller=null;busy=false;updatePending();}}
  },
  async normalize(){
   if(!draft)return;invalidate();const ticket=guard.begin(snapshot()),choiceStamp=JSON.stringify(choices);controller=new AbortController();message('按已选表头与映射归一…');
   try{const result=await request('normalize',{body:{document_id:draft.document_id,choices,inventory:draft},signal:controller.signal});if(!guard.valid(ticket,snapshot())||choiceStamp!==JSON.stringify(choices)){if(guard.owns(ticket))message('表格或映射已变化，请重新应用调整');return;}
    normalized={...result,inventory:draft,choices,baseSnapshot:ticket.snapshot};actions.commit(adjusting?'revise':'append',true);
   }catch(e){if(e.name!=='AbortError'&&guard.owns(ticket))message(e.message,true);}
  },
  commit(mode,allowUnresolved){
   if(!normalized)return;
   try{if(snapshot()!==normalized.baseSnapshot)throw new Error('预览期间任务表已变化，请重新归一核对');
    const filename=normalized.filename,result=mode==='revise'?reviseImport(getTable(),normalized):importTasks(getTable(),normalized,{mode,allowUnresolved});
    editor.change(t=>{for(const key of Object.keys(t))delete t[key];Object.assign(t,result.table);});
    cancel();updatePending();message(mode==='revise'?`已应用解析调整；保留 ${result.conflicts.length} 项手工编辑，可在导入详情查看。`:`${filename} · 已导入 ${result.added} 条记录${result.skipped?`，跳过 ${result.skipped} 条重复来源`:''}${result.newVersion?'；同名文档已作为新版本追加':''}。可撤销。`);
   }catch(e){message(e.message,true);notify(e.message,'error');}
  }
 };
 function changed(){invalidate();const preview=draftBox.querySelector('.script-confirm');preview?.remove();}
 function imagePreview(parent,occurrence){
  const asset=draft.assets[occurrence.asset_id],fig=el('figure',parent);fig.className='script-image';
  if(asset?.url){const img=el('img',fig);img.src=asset.url;img.alt=occurrence.id;img.loading='lazy';}
  el('figcaption',fig,`${occurrence.id}${asset?.error?' · '+asset.error:occurrence.issue?' · '+occurrence.issue:''}`);
  return fig;
 }
 function renderDraft(){
  draftBox.hidden=false;draftBox.replaceChildren();el('h3',draftBox,'调整原文映射');el('p',draftBox,'修改后应用到当前文档，保留已手工编辑的单元格与生成结果。');
  const feedback=el('p',draftBox);feedback.className='script-status';feedback.setAttribute('role','status');
  const controls=el('div',draftBox);controls.className='script-actions';controls.append(button('应用解析调整',()=>actions.normalize(),true),button('AI 归类（可选）',()=>actions.classify()),button('关闭调整',cancel));
  for(const table of draft.tables){
   const section=el('details',draftBox);section.open=true;const summary=el('summary',section,`表 ${table.order+1} · ${table.rows.length} 原始行${table.nested?' · 嵌套表需确认':''}`);
   const choose=el('input',summary);choose.type='checkbox';choose.checked=!!choices.tables[table.id];choose.setAttribute('aria-label',`选择表 ${table.order+1}`);choose.onclick=e=>e.stopPropagation();choose.onchange=()=>{changed();if(choose.checked)choices.tables[table.id]={header:table.header,mapping:structuredClone(table.mapping),rows:{}};else delete choices.tables[table.id];renderDraft();};
   const spec=choices.tables[table.id];if(!spec)continue;
   select(section,`表 ${table.order+1} 表头`,[['','无表头'],...table.rows.map(r=>[r.id,`原始第 ${r.index} 行 · ${r.cells.map(c=>c.text).join(' / ').slice(0,70)}`])],spec.header,value=>{spec.header=value||null;changed();});
   const mapping=el('div',section);mapping.className='script-mapping';
   for(let col=0;col<table.columns;col++){const head=table.rows.find(r=>r.id===spec.header)?.cells.find(c=>c.column===col)?.text||`第 ${col+1} 列`;
    select(mapping,`${table.id} 第 ${col+1} 列（${head}）`,Object.entries(ROLE_LABELS),spec.mapping[col]||'other',value=>{spec.mapping[col]=value;for(const r of table.rows)for(const c of r.cells)if(c.column===col&&spec.cell_roles)delete spec.cell_roles[c.id];changed();});}
   for(const row of table.rows){const detail=el('details',section);detail.className='script-source-row';const title=el('summary',detail,`${row.id} · ${KIND_LABELS[spec.rows[row.id]||row.kind]} · ${row.cells.map(c=>c.text).filter(Boolean).join(' / ').slice(0,95)}`);
    select(detail,`${row.id} 去向`,Object.entries(KIND_LABELS),spec.rows[row.id]||row.kind,value=>{spec.rows[row.id]=value;changed();title.textContent=`${row.id} · ${KIND_LABELS[value]}`;});
    el('p',detail,row.reason);
    for(const cell of row.cells){const group=el('div',detail);el('strong',group,`${cell.id}${cell.anchor?' · 引用 '+cell.anchor:''}${cell.colspan>1||cell.rowspan>1?` · 合并 ${cell.rowspan} 行 × ${cell.colspan} 列`:''}`);el('pre',group,cell.text);select(group,`${cell.id} 字段归类`,[['','沿用列映射'],...Object.entries(ROLE_LABELS)],spec.cell_roles?.[cell.id]||'',value=>{spec.cell_roles||={};if(value)spec.cell_roles[cell.id]=value;else delete spec.cell_roles[cell.id];changed();});}
    const images=el('div',detail);images.className='script-images';for(const id of row.images)imagePreview(images,draft.occurrences.find(o=>o.id===id));
   }
  }
  const images=el('details',draftBox);images.open=draft.occurrences.some(o=>o.issue||!o.row_id);el('summary',images,`图片归属 · ${draft.occurrences.length} 次出现（可逐张改派或排除）`);
  const targets=draft.tables.filter(t=>choices.tables[t.id]).flatMap(t=>t.rows.filter(r=>['task','review'].includes(choices.tables[t.id].rows[r.id]||r.kind)).map(r=>[r.id,r.id+' · '+r.cells.map(c=>c.text).filter(Boolean).join(' ').slice(0,45)]));
  const grid=el('div',images);grid.className='script-images';
  for(const occurrence of draft.occurrences){const fig=imagePreview(grid,occurrence);select(fig,`${occurrence.id} 所属行`,[['','自动 / 待分配'],['exclude','确认不入任务'],...targets],choices.images[occurrence.id]||'',value=>{if(value)choices.images[occurrence.id]=value;else delete choices.images[occurrence.id];changed();});}
  const paragraphs=el('details',draftBox);el('summary',paragraphs,`表外原文 / 章节 · ${draft.paragraphs.length} 段`);for(const p of draft.paragraphs)if(p.text.trim())el('pre',paragraphs,`${p.id}\n${p.text}`);
 }
 function editDocument(doc){
  if(!doc.inventory){message('此旧版导入未保存映射信息，请重新上传原文件以恢复调整入口',true);return;}
  cancel();draft=structuredClone(doc.inventory);choices=structuredClone(doc.choices||initialChoices(draft));adjusting=true;
  detailsDialog=editor.openDialog('调整解析');detailsDialog.classList.add('script-parser','script-import-dialog');
  detailsDialog.append(draftBox);detailsDialog.oncancel=cancel;renderDraft();
 }
 function showSources(){
  const d=editor.openDialog('导入详情');d.classList.add('script-parser','script-import-dialog');
  const docs=getTable().meta.script_parser.documents;
  if(!docs.length)el('p',d,'上传 DOCX 后自动生成表格。');
  for(const doc of docs){const s=el('details',d);el('summary',s,doc.filename);
   s.append(button('调整字段与图片归属',()=>{d.remove();editDocument(doc);}));
   for(const conflict of doc.conflicts||[])el('p',s,conflict);
   for(const r of doc.audit)el('p',s,`${r.row_id} · ${KIND_LABELS[r.kind]||'未选表'} · ${r.reason}`);
   for(const t of doc.tables)for(const r of t.rows){const row=el('details',s);el('summary',row,r.id);for(const c of r.cells)el('pre',row,`${c.id}${c.anchor?' ← '+c.anchor:''}\n${c.text}`);}
   for(const p of doc.paragraphs)if(p.text.trim())el('pre',s,`${p.id}\n${p.text}`);
   const gallery=el('div',s);gallery.className='script-images';
   for(const o of doc.unassigned){const item=el('figure',gallery);item.className='script-image';const a=doc.assets?.[o.asset_id];if(a?.url){const img=el('img',item);img.src=a.url;img.alt=o.id;}el('figcaption',item,`${o.id} · ${o.disposition}${a?.error?' · '+a.error:''}`);}
  }
  d.append(button('替换导入 DOCX',()=>{const confirm=editor.openDialog('替换当前表格');el('p',confirm,'选择新文档后替换当前表格。可一步撤销。');confirm.append(button('选择替换文档',()=>{confirm.remove();d.remove();pick('replace');}),button('取消',()=>confirm.remove()));}),button('关闭详情',()=>d.remove()));
 }
 function showIssues(){
  const d=editor.openDialog('待处理项');d.classList.add('script-parser');let count=0;
  for(const row of getTable().records){const source=row.meta?.script_source;if(!source?.issues?.length)continue;count++;
   const item=el('div',d);el('p',item,`${source.filename} · ${source.row_id} · ${source.issues.join('；')}`);
   item.append(button('定位记录',()=>{d.remove();const field=getTable().fields.find(f=>!f.hidden);if(field)editor.focusCell(row.id,field.id);}));
  }
  for(const doc of getTable().meta.script_parser.documents){const pending=doc.unassigned.filter(o=>o.disposition==='待分配');if(!pending.length)continue;count+=pending.length;
   el('p',d,`${doc.filename} · ${pending.length} 张图片待分配`);d.append(button('分配图片',()=>{d.remove();editDocument(doc);}));
  }
  for(const doc of getTable().meta.script_parser.documents)for(const conflict of doc.conflicts||[]){count++;el('p',d,`${doc.filename} · ${conflict}`);}
  if(!count)el('p',d,'没有待处理项。');d.append(button('关闭待处理项',()=>d.remove()));
 }
 workbench=createWorkbench(node,root,{title:'分镜剧本解析器',onClose:()=>{menu?.close();promptUI.close();editor.closeDialogs();}});
 editor.toolbar.append(workbench.trigger);
 // The Canvas owns vertical browsing. Native mode keeps the shared workbench.
 const stop=e=>{if((e.type==='wheel'&&e.ctrlKey)||(['pointerdown','mousedown'].includes(e.type)&&e.button===1))return;e.stopPropagation();};
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown','drop'])root.addEventListener(event,stop);
 updatePending();editor.render();decorate();return {root:workbench.host,surface:root,editor,height:workbench.height,actions,
  render:()=>{workbench.restoreHeight();promptUI.observe();editor.render();updatePending();decorate();},
  close:()=>{cancel();clearTimeout(statusTimer);message('');updatePending();promptUI.close();presentation.close();editor.closeDialogs();},
  destroy:()=>{if(!alive)return;alive=false;clearTimeout(statusTimer);observer.disconnect();menu?.close();guard.destroy();controller?.abort();detailsDialog?.remove();draftBox.remove();generation.destroy();presentation.destroy();promptUI.destroy();editor.destroy();workbench.destroy();}};
}
