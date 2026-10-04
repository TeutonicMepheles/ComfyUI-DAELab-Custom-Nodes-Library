import {createTableEditor} from './data_table_editor.mjs?v=20261004-script3';
import {createTableButton as button,tableTheme,tableHistory} from './table_controls.mjs';
import {createPromptEditor} from './table_prompt_editor.mjs?v=20260930-public-layout4';
import {attachGenerationColumns} from './table_generation_panel.mjs?v=20260930-public-layout4';
import {installContentPresentation} from './table_content_view.mjs?v=20260930-public-layout4';
import {createWorkbench} from './table_workbench.mjs';
import {workbenchTheme} from './table_workbench_theme.mjs';
import {studioTheme} from './daelab_studio_theme.mjs';
import {ROLE_LABELS,KIND_LABELS,initialChoices,importTasks,assertTransition,ParserRequests} from './script_parser_model.mjs?v=20261004-script4';

const el=(tag,parent,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;};
function select(parent,label,options,value,onChange){const wrap=el('label',parent,label),s=el('select',wrap);s.setAttribute('aria-label',label);for(const [v,n] of options)s.add(new Option(n,v));s.value=value??'';s.onchange=()=>onChange(s.value);return s;}

export function createScriptParserPanel({node,app,getTable,setTable,notify}){
 tableTheme();workbenchTheme();studioTheme();
 if(!document.getElementById('dae-script-parser-css')){const link=el('link',document.head);link.id='dae-script-parser-css';link.rel='stylesheet';link.href=new URL('./script_parser.css',import.meta.url).href;}
 const root=el('div');root.className='dae-ui dae-table-panel script-parser';root.setAttribute('aria-label','分镜剧本解析器');
 const importBar=el('nav',root);importBar.className='script-actions';
 const status=el('p',root);status.className='script-status';status.setAttribute('role','status');
 const draftBox=el('section',root);draftBox.className='script-draft';draftBox.hidden=true;
 const guard=new ParserRequests();let draft=null,choices=null,normalized=null,controller=null,alive=true,promptUI=null,generation=null,presentation=null;
 const snapshot=()=>JSON.stringify(getTable());
 function message(value,error=false){status.textContent=value;status.dataset.error=String(error);}
 function cancel(){guard.invalidate();controller?.abort();controller=null;normalized=null;draft=null;choices=null;draftBox.replaceChildren();draftBox.hidden=true;message('草稿已取消，已确认任务保持不变');}
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
 const editor=createTableEditor({getTable,setTable:t=>{assertTransition(getTable(),t);setTable(t);promptUI?.observe();},
  validateChange:assertTransition,textPanelHost:()=>root.closest('dialog[open]')||document.body,upload:uploadAsset,notify,nativeHistory:tableHistory(app),
  displayContent:()=>globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root)?.presentation==='content',
  renderCell:args=>promptUI?.renderCell(args),decorateAsset:(...args)=>promptUI?.decorateAsset(...args),
  onRestore:()=>{invalidate();promptUI?.invalidate();generation?.invalidate();message('已恢复历史版本；已有草稿需重新归一后确认');}});
 root.append(editor.root);
 promptUI=createPromptEditor({getTable,editor,notify,request:()=>{throw new Error('请在文档预览中归类原文');}});
 presentation=installContentPresentation({root,editor,getTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)});
 generation=attachGenerationColumns({editor,getTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)});
 const picker=el('input',importBar);picker.type='file';picker.accept='.docx';picker.hidden=true;picker.setAttribute('aria-label','上传 DOCX 文档');
 picker.onchange=()=>{const file=picker.files?.[0];picker.value='';if(file)void actions.uploadDocument(file);};
 importBar.append(button('上传 DOCX',()=>picker.click(),true),button('查看已确认来源',()=>showSources()),button('显示字段',()=>editor.manageFields()),button('图片整列模板',()=>promptUI.editTemplate('sp-image-prompt')),button('视频整列模板',()=>promptUI.editTemplate('sp-video-prompt')));
 const actions={
  async classify(){
   if(!draft)return;invalidate();const ticket=guard.begin(snapshot()),choiceStamp=JSON.stringify(choices);controller=new AbortController();message('AI 仅归类文字来源；不发送图片，不提交任务表…');
   try{const result=await request('classify',{body:{document_id:draft.document_id,choices},signal:controller.signal});if(!guard.valid(ticket,snapshot())||choiceStamp!==JSON.stringify(choices))return;choices=result.choices;renderDraft();message('AI 来源校验通过，请核对每个单元格归类后归一');}
   catch(e){if(e.name!=='AbortError'&&guard.owns(ticket))message(e.message,true);}
  },
  async uploadDocument(file){
   invalidate();const ticket=guard.begin(snapshot());controller=new AbortController();message('正在读取文档和准备图片…');
   try{const result=await request('document',{file,signal:controller.signal});if(!guard.valid(ticket,snapshot())){if(guard.owns(ticket))message('上传期间任务表已变化，未应用旧草稿');return;}
    draft=result;choices=initialChoices(draft);normalized=null;renderDraft();message(`${file.name} · ${draft.tables.length} 张表 · ${draft.occurrences.length} 次图片出现。草稿刷新后不保留。`);
   }catch(e){if(e.name!=='AbortError'&&guard.owns(ticket)){message(e.message,true);notify(e.message,'error');}}
  },
  async normalize(){
   if(!draft)return;invalidate();const ticket=guard.begin(snapshot()),choiceStamp=JSON.stringify(choices);controller=new AbortController();message('按已选表头与映射归一…');
   try{const result=await request('normalize',{body:{document_id:draft.document_id,choices},signal:controller.signal});if(!guard.valid(ticket,snapshot())||choiceStamp!==JSON.stringify(choices)){if(guard.owns(ticket))message('表格或映射已变化，旧预览已放弃');return;}
    normalized={...result,baseSnapshot:ticket.snapshot};renderPreview();message(`预览 ${result.tasks.length} 条任务 · ${result.unassigned.filter(x=>x.disposition==='待分配').length} 张图片待分配；尚未修改任务表`);
   }catch(e){if(e.name!=='AbortError'&&guard.owns(ticket))message(e.message,true);}
  },
  commit(mode,allowUnresolved){
   if(!normalized)return;
   try{if(snapshot()!==normalized.baseSnapshot)throw new Error('预览期间任务表已变化，请重新归一核对');
    const result=importTasks(getTable(),normalized,{mode,allowUnresolved});
    editor.change(t=>{for(const key of Object.keys(t))delete t[key];Object.assign(t,result.table);});
    cancel();message(`已${mode==='replace'?'替换':'追加'} ${result.added} 条任务，跳过 ${result.skipped} 条重复来源${result.newVersion?'；同名文档内容已变化，作为新版本保留':''}。可一步撤销。`);
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
  draftBox.hidden=false;draftBox.replaceChildren();el('h3',draftBox,'选表、表头与原文映射');el('p',draftBox,'每个原始行保留去向。仅归类原文，不自动拆镜。修改后点击“归一并对照”。草稿刷新后不保留。');
  const controls=el('div',draftBox);controls.className='script-actions';controls.append(button('归一并对照',()=>actions.normalize(),true),button('AI 归类（可选）',()=>actions.classify()),button('取消草稿',cancel));
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
 function renderPreview(){
  draftBox.querySelector('.script-confirm')?.remove();const area=el('section',draftBox);area.className='script-confirm';el('h3',area,'对照预览 · 尚未提交');
  el('p',area,normalized.audit.reduce((acc,r)=>{acc[r.kind]=(acc[r.kind]||0)+1;return acc;},{}));
  area.lastChild.textContent=Object.entries(normalized.audit.reduce((acc,r)=>{acc[r.kind]=(acc[r.kind]||0)+1;return acc;},{})).map(([k,n])=>`${KIND_LABELS[k]||'未选表'} ${n}`).join(' · ');
  for(const task of normalized.tasks){const d=el('details',area);el('summary',d,`${task.row_id} · ${task.values.shot_no||'缺镜号'} · ${task.images.length} 张参考 · ${task.issues.join('；')||'待核对'}`);
   const columns=el('div',d);columns.className='script-compare';const original=el('div',columns);el('strong',original,'原文单元格');for(const c of task.original_cells)el('pre',original,`${c.id}${c.anchor?' ← '+c.anchor:''}\n${c.text}`);
   const mapped=el('div',columns);el('strong',mapped,'归一结果');for(const [role,value] of Object.entries(task.values))if(value)el('pre',mapped,`${ROLE_LABELS[role]}\n${value}`);
   const images=el('div',d);images.className='script-images';task.images.forEach(o=>imagePreview(images,o));
  }
  const unresolved=normalized.unassigned.filter(o=>o.disposition==='待分配');
  const label=el('label',area),accept=el('input',label);accept.type='checkbox';accept.setAttribute('aria-label','保留未分配图片为待补充');label.append(document.createTextNode(`保留 ${unresolved.length} 张未分配图片为待补充，不猜测任务归属（来源中可查看）`));label.hidden=!unresolved.length;
  const acknowledge=el('label',area),checked=el('input',acknowledge);checked.type='checkbox';checked.setAttribute('aria-label','已核对原文和待补充项');acknowledge.append(document.createTextNode('已核对原文、行去向、图片顺序和待补充项'));
  const commit=(mode)=>{if(!checked.checked){message('请先核对并勾选确认原文和待补充项',true);return;}actions.commit(mode,accept.checked);};
  const bar=el('div',area);bar.className='script-actions';bar.append(button('确认追加',()=>commit('append'),true),button('确认替换',()=>commit('replace')),button('取消草稿',cancel));
 }
 function showSources(){
  const d=editor.openDialog('已确认原文与来源');d.classList.add('script-parser');for(const doc of getTable().meta.script_parser.documents){const s=el('details',d);s.open=true;el('summary',s,doc.filename);el('p',s,`文档指纹 ${doc.document_id}`);
   for(const r of doc.audit)el('p',s,`${r.row_id} · ${KIND_LABELS[r.kind]||'未选表'} · ${r.reason}`);
   for(const t of doc.tables)for(const r of t.rows){const row=el('details',s);el('summary',row,r.id);for(const c of r.cells)el('pre',row,`${c.id}${c.anchor?' ← '+c.anchor:''}\n${c.text}`);}
   for(const p of doc.paragraphs)if(p.text.trim())el('pre',s,`${p.id}\n${p.text}`);
   const gallery=el('div',s);gallery.className='script-images';
   for(const o of doc.unassigned){const item=el('figure',gallery);item.style.cssText='display:inline-block;width:220px;margin:8px;vertical-align:top';const a=doc.assets?.[o.asset_id];if(a?.url){const img=el('img',item);img.src=a.url;img.alt=o.id;img.style.cssText='width:100%;height:150px;object-fit:contain';}el('figcaption',item,`${o.id} · ${o.disposition}`);}
  }d.append(button('关闭来源',()=>d.remove()));
 }
 const workbench=createWorkbench(node,root,{title:'分镜剧本解析器',onClose:()=>{promptUI.close();editor.closeDialogs();}});
 importBar.append(workbench.trigger);
 // The Canvas owns vertical browsing. Native mode keeps the shared workbench.
 const stop=e=>{if((e.type==='wheel'&&e.ctrlKey)||(['pointerdown','mousedown'].includes(e.type)&&e.button===1))return;e.stopPropagation();};
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown','drop'])root.addEventListener(event,stop);
 message('上传 DOCX 后选择表头与映射。节点执行只输出已确认任务，不调用 AI 或生成。');
 editor.render();return {root:workbench.host,surface:root,editor,height:workbench.height,actions,
  render:()=>{workbench.restoreHeight();promptUI.observe();editor.render();},
  close:()=>{invalidate();promptUI.close();presentation.close();editor.closeDialogs();},
  destroy:()=>{if(!alive)return;alive=false;guard.destroy();controller?.abort();generation.destroy();presentation.destroy();promptUI.destroy();editor.destroy();workbench.destroy();}};
}
