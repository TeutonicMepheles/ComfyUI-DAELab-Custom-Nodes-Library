import {attachCellSelection} from './table_cell_selection.mjs?v=20261002-table-module-responsibilities';
import {attachTableStructure} from './table_structure.mjs?v=20261002-generation-pause';
import {createTextSide} from './table_text_side.mjs?v=20261004-pr24-parser';
import {renderContentCell,bindMaterialThumbnail} from './table_content_view.mjs?v=20261002-table-module-responsibilities';
import {clone,uid,addField,removeField,addRecord,duplicateSelected,reorder,setValue,transferValue,parseTSV,pasteMatrix,encodeTSV,SnapshotHistory,emptyValue,convertValue,FIELD_TYPES,COLUMN_MINIMUM_WIDTH} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {stopCanvasPropagation} from './list_editor_controls.mjs';
import {localImageFromDrop} from './badge_image_drop_87.mjs';
import {conflictChoice} from './table_cell_choice.mjs';
import {isPrompt,promptText} from './table_prompt_model.mjs?v=20261001-frame-tags-dedup';
import {attachColumnSplitters} from './table_column_splitters.mjs?v=20261001-frame-tags-dedup';
import {videoReferenceFields,setVideoReference} from './table_video_references.mjs?v=20260929-refs3';
import {bindColumnAssets} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';

let copiedRegion=null;
export const FIELD_LABELS={content:'内容',text:'文本',longtext:'多行文本',number:'数字',checkbox:'勾选',select:'单选',assets:'素材',json:'结构化原文'};
export {createTableButton as tableButton} from './table_controls.mjs?v=20261002-generation-pause';
import {createTableButton as tableButton,tableTheme,tableIcon} from './table_controls.mjs?v=20261002-generation-pause';
const element=(tag,className,parent)=>{const e=document.createElement(tag);if(className)e.className=className;if(parent)parent.append(e);return e;};
const MIME='application/x-daelab-table';

function styles(){
 if(document.getElementById('dae-data-table-style'))return;
 const s=document.createElement('style');s.id='dae-data-table-style';s.textContent=`
.dae-table{display:flex;flex:1;min-height:0;flex-direction:column;gap:8px;container-type:inline-size}.dae-table-toolbar,.dae-table-footer{display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:none}.dae-table button{padding:5px 9px}.dae-table-scroll{flex:1;min-height:0;overflow:auto;border:1px solid #30363d;border-radius:7px;position:relative}
.video-reference-toggle{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-width:24px;padding:3px!important;margin:0 5px 0 0;border:1px solid transparent!important;border-radius:5px;background:transparent!important;color:#89939e;vertical-align:middle;cursor:pointer}.video-reference-toggle svg{width:16px;height:16px;pointer-events:none}.video-reference-toggle[aria-pressed=true]{color:#9be0c4;background:#24483c!important;border-color:#487c66!important}.video-reference-toggle:hover,.video-reference-toggle:focus-visible{outline:1px solid #a3d7c1;outline-offset:1px}.dae-table th>.video-reference-toggle{float:left;margin-top:-2px}.dae-table th[data-video-reference=true]{box-shadow:inset 0 -2px #6aad91}.dae-table[data-view=cards] td>.video-reference-toggle{position:absolute;right:7px;top:4px}.dae-table[data-view=cards] td:has(>.video-reference-toggle)::before{padding-right:35px}
.dae-table table{border-collapse:separate!important;border-spacing:0;table-layout:fixed;width:max-content!important;min-width:100%!important}.dae-table thead{display:table-header-group!important;position:sticky;top:0;z-index:4}.dae-table tr{display:table-row!important}.dae-table th,.dae-table td{box-sizing:border-box;position:relative;border-right:1px solid #2b3036!important;border-bottom:1px solid #2b3036!important;padding:8px!important;vertical-align:top;overflow:hidden}.dae-table th{height:36px!important;text-align:left;font-weight:500;cursor:grab;white-space:nowrap}.dae-table td::before{display:none!important}.dae-table td{height:76px}.dae-table td:focus{outline:1px solid #a3d7c1;outline-offset:-2px}.dae-table td[data-selected=true]{box-shadow:inset 0 0 0 1px #699e8c;background:#25413633}.dae-table td>input:not([type=checkbox]),.dae-table td>textarea,.dae-table td>select{width:100%;margin:0!important;padding:6px 16px 6px 7px!important;font:inherit;background:transparent!important;border-color:transparent!important}.dae-table td>textarea{height:58px!important;line-height:1.5;resize:vertical;min-height:36px;max-height:160px}.dae-table td>input:focus,.dae-table td>textarea:focus,.dae-table td>select:focus{border-color:#699e8c!important;background:#24292e!important}.dae-table .table-choice{width:58px!important;min-width:58px;text-align:center;padding:13px 3px!important;white-space:nowrap;position:sticky;left:0;z-index:2;background:#1c2025}.dae-table th.table-choice{z-index:5;padding:8px 3px!important;cursor:default}.dae-table .table-choice input{vertical-align:middle;margin:0}.dae-table .row-grip{padding:0 3px!important;border:0!important;background:transparent!important;opacity:.5;cursor:grab}.dae-table .cell-grip{position:absolute;right:2px;top:2px!important;z-index:2;opacity:0!important;padding:0 2px!important;border:0!important;background:transparent!important;cursor:grab}.dae-table td:hover>.cell-grip,.dae-table .cell-grip:focus-visible{opacity:.65!important}.dae-table .field-settings{position:absolute!important;right:1px!important;top:6px!important;opacity:0!important;padding:0 4px!important;border:0!important;background:transparent!important}.dae-table th:hover>.field-settings,.dae-table .field-settings:focus-visible{opacity:1!important}.dae-table .field-title{display:block;overflow:hidden;text-overflow:ellipsis;padding-right:18px}.dae-table .table-assets{display:flex;gap:5px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;min-width:0;padding-bottom:4px}.dae-table .asset-count{position:absolute;top:4px;right:20px;z-index:3;font-size:10px;padding:1px 4px;border-radius:4px;background:#182329dd;color:#b6d5c7;pointer-events:none}.dae-table .table-asset{position:relative;display:inline-flex;flex:0 0 auto;flex-direction:column;max-width:72px;cursor:grab}.dae-table .table-asset img,.dae-table .table-asset video{width:64px;height:44px;object-fit:cover;border-radius:4px}.dae-table .table-asset small{max-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;color:#98a4b2}.dae-table .asset-remove{padding:0 3px!important;position:absolute;right:0;top:0;opacity:0}.dae-table .table-asset:hover .asset-remove,.dae-table .asset-remove:focus-visible{opacity:1}.dae-table .asset-add{font-size:11px!important;padding:3px 6px!important;align-self:start}.dae-table .readonly-value{white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto;padding:6px 2px;color:#a5b2bf}.dae-table .table-count{margin-left:auto;color:#9aa4b1;white-space:nowrap;font-size:11px}.dae-table .table-empty{padding:38px;text-align:center;color:#84909e}.dae-table [data-drop=true]{outline:2px solid #7ac5aa;outline-offset:-2px}
.dae-table[data-view=cards] table{width:100%!important;min-width:0!important}.dae-table[data-view=cards] thead{display:none!important}.dae-table[data-view=cards] tr{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));padding:8px}.dae-table[data-view=cards] td{width:auto!important;height:auto;min-height:68px;border:0!important}.dae-table[data-view=cards] td::before{display:block!important;content:attr(data-label)!important;font-size:11px;color:#92a0af;margin-bottom:5px}.dae-table[data-view=cards] .table-choice{grid-column:1/-1;position:static;width:100%!important;text-align:left;min-height:0!important;padding:0 5px!important;background:transparent}.dae-table[data-view=cards] .table-choice::before{display:none!important}.dae-table[data-view=cards] .cell-grip{top:20px!important}
.dae-table-dialog{width:min(580px,90vw);max-height:85vh;overflow:auto;background:#20252b;color:#eee;border:1px solid #46515e;border-radius:10px;padding:20px;font:13px 'Alibaba PuHuiTi 3',sans-serif}.dae-table-dialog label{display:flex;align-items:center;gap:10px;margin:10px 0}.dae-table-dialog input:not([type=checkbox]),.dae-table-dialog textarea,.dae-table-dialog select{flex:1;min-width:0;padding:7px;background:#161a1f;color:#eee;border:1px solid #46515e;border-radius:5px;font:inherit}.dae-table-dialog button{margin:5px;padding:6px 12px;background:#303944;color:#eee;border:1px solid #526274;border-radius:5px}.dae-table-dialog .field-row{display:flex;align-items:center;gap:10px}.dae-table-dialog .field-row span{flex:1}.dae-table-dialog::backdrop{background:#0008}
.dae-table td>textarea{position:absolute;inset:8px;width:calc(100% - 17px);height:calc(100% - 17px)!important;min-height:0;max-height:none;box-sizing:border-box;resize:none;overflow:auto;overflow-wrap:anywhere}
.dae-table[data-view=cards] td:has(>textarea){min-height:var(--dae-text-card-height,116px)}
.dae-table[data-view=cards] td>textarea{top:29px;height:calc(100% - 38px)!important}
.dae-table :is(textarea,.dae-prompt-preview,.readonly-value){scrollbar-width:thin;scrollbar-color:#718b87 #20282b;scrollbar-gutter:stable}
.dae-table :is(textarea,.dae-prompt-preview,.readonly-value)::-webkit-scrollbar{display:block!important;width:8px;height:8px}
.dae-table :is(textarea,.dae-prompt-preview,.readonly-value)::-webkit-scrollbar-thumb{background:#718b87;border-radius:4px}
.dae-table :is(textarea,.dae-prompt-preview,.readonly-value)::-webkit-scrollbar-track{background:#20282b}
.dae-table table{width:var(--dae-table-width,max-content)!important}
.dae-table[data-view=cards] colgroup{display:none}
`;document.head.append(s);
}

export function tableDialog(title){tableTheme();const d=element('dialog','dae-ui dae-table-dialog');d.setAttribute('aria-label',title);const h=element('h3','',d);h.textContent=title;d.addEventListener('pointerdown',stopCanvasPropagation);d.oncancel=()=>d.remove();document.body.append(d);d.showModal();return d;}

// The very same editor is used by every template. Integrations only supply data and upload I/O.
export function createTableEditor({getTable,setTable,upload,notify=()=>{},getRowState=null,renderCell=null,decorateAsset=null,onRestore=()=>{},displayContent=()=>false,nativeHistory=null,promptColumnsOnly=false,validateChange=()=>{},textPanelHost=undefined}) {
 const cleanups=new Set(),cellBindings=new WeakMap();const clearBindings=()=>{for(const fn of cleanups)fn();cleanups.clear();};
 const dialogs=new Set();const openDialog=title=>{const d=tableDialog(title);dialogs.add(d);return d;};const closeDialogs=()=>{textSide.closeAll();for(const d of dialogs){d.querySelectorAll('video').forEach(v=>v.pause());d.remove();}dialogs.clear();};
 styles();const owner=uid(),history=new SnapshotHistory(),root=element('section','dae-table'),toolbar=element('nav','dae-table-toolbar',root),shell=element('div','dae-table-scroll',root),footer=element('nav','dae-table-footer',root);
 const textSide=createTextSide({root,getHost:textPanelHost});
 const expandedAssets=new Set();
 shell.dataset.storyboardScroll='true';let busy=false,editGroup=null,drag=null,raf=null,splitters=null,structure=null,materialSort=null;
 const fields=()=>getTable().fields.filter(f=>!f.hidden);
 const packet=e=>{try{return JSON.parse(e.dataTransfer.getData(MIME));}catch{return null;}};
 function change(fn,{render:draw=true,group=null}={}) {const before=JSON.stringify(getTable()),next=JSON.parse(before);fn(next);validateChange(getTable(),next);const after=JSON.stringify(next);history.record(before,after,group);const boundary=nativeHistory&&displayContent()&&before!==after&&!group;if(boundary)nativeHistory.begin();try{setTable(next);if(draw)render();else updateFooter();}finally{if(boundary)nativeHistory.end();}}
 function safely(fn){try{return fn();}catch(e){notify(e.message);return null;}}
 function clearCells(cells=selection().flat()){safely(()=>change(t=>{const fields=new Map(t.fields.map(f=>[f.id,f])),records=new Map(t.records.map(r=>[r.id,r]));for(const {row,field} of cells){const f=fields.get(field.id),r=records.get(row.id);if(!f||!r||f.readonly)continue;r.values[f.id]=f.promptTemplate?{kind:'column-template',version:1,segments:[]}:emptyValue(f);}}));}
 function restore(redo=false){const pending=(redo?history.redoStack:history.undoStack).at(-1);if(pending){try{validateChange(getTable(),JSON.parse(pending),{restoring:true});}catch(e){notify(e.message);return;}}const value=history.restore(JSON.stringify(getTable()),redo);if(value){const boundary=nativeHistory&&displayContent();if(boundary)nativeHistory.begin();try{onRestore();setTable(value);render();}finally{if(boundary)nativeHistory.end();}}}
 const undo=tableButton('撤销',()=>restore()),redo=tableButton('重做',()=>restore(true)),count=element('span','table-count');
 function updateFooter(){const table=getTable(),selected=table.records.filter(r=>r.selected).length;selectionActions.hidden=!selected;refreshStates();undo.disabled=!history.undoStack.length;redo.disabled=!history.redoStack.length;const label=`${selected} / ${table.records.length} 行已选`;if(count.textContent!==label)count.textContent=label;}
 const cellSelection=attachCellSelection({root,shell,getTable}),{selection,choose,mark}=cellSelection;
 function clearDropHints(){shell.querySelectorAll('[data-drop],[data-material-drop-side]').forEach(e=>{delete e.dataset.drop;delete e.dataset.materialDropSide;});}
 function dragEnd(){drag=null;if(raf)cancelAnimationFrame(raf);raf=null;clearDropHints();clearMaterialSort();}
 function dragOver(e,target){e.preventDefault();e.stopPropagation();clearDropHints();target.dataset.drop='true';if(raf)cancelAnimationFrame(raf);const rect=shell.getBoundingClientRect(),dy=e.clientY<rect.top+28?-10:e.clientY>rect.bottom-28?10:0,dx=e.clientX<rect.left+28?-10:e.clientX>rect.right-28?10:0;const tick=()=>{shell.scrollBy(dx,dy);raf=requestAnimationFrame(tick);};if(dx||dy)raf=requestAnimationFrame(tick);}
 function draggable(el,data){el.draggable=true;if(data.kind==='asset')el.dataset.materialId=data.asset;el.addEventListener('dragstart',e=>{e.stopPropagation();drag={...data,owner};e.dataTransfer.setData(MIME,JSON.stringify(drag));e.dataTransfer.effectAllowed='move';});el.addEventListener('dragend',dragEnd);}
 function assetDropPosition(e,record,field){
    const sorting=previewMaterialSort(e,record,field);if(sorting)return sorting;
    const item=e.target.closest('.dae-table-material[data-material-id]');if(!item)return null;
    const values=getTable().records.find(r=>r.id===record.id)?.values[field.id],index=Array.isArray(values)?values.findIndex(a=>a.id===item.dataset.materialId):-1;if(index<0)return null;
    const bounds=item.getBoundingClientRect(),after=e.clientX>=bounds.left+bounds.width/2;
    return {item,index:index+(after?1:0),side:after?'after':'before'};
 }
 function clearMaterialSort(){
    if(!materialSort)return;
    for(const {item} of materialSort.slots){item.style.removeProperty('--material-shift-x');item.style.removeProperty('--material-shift-y');delete item.dataset.materialSortSource;}
    materialSort.placeholder?.remove();if(materialSort.containerClass!==undefined)materialSort.container.className=materialSort.containerClass;
    materialSort=null;
 }
 function previewMaterialSort(e,record,field){
    if(drag?.kind!=='asset'||drag.owner!==owner||field.readonly||!['assets','content'].includes(field.type)){clearMaterialSort();return null;}
    const cell=e.target.closest('td[data-field]');if(!cell)return null;
    if(materialSort?.cell!==cell){
      clearMaterialSort();
      const items=[...cell.querySelectorAll('.dae-table-material[data-material-id]')],values=getTable().records.find(r=>r.id===record.id)?.values[field.id];
      if(!Array.isArray(values)||items.length!==values.length)return null;
      const same=drag.record===record.id&&drag.field===field.id,count=items.length;
      let from=same?items.findIndex(item=>item.dataset.materialId===drag.asset):count;if(same&&from<0)return null;
      const container=items[0]?.parentElement||cell.querySelector('.content-display,.table-assets');if(!container)return null;
      let placeholder=null,containerClass;
      if(!same){
        if(!items.length&&container.classList.contains('content-display')){containerClass=container.className;container.classList.remove('content-text');container.classList.add('content-materials');}
        placeholder=element('div','dae-table-material');placeholder.setAttribute('aria-hidden','true');placeholder.style.pointerEvents='none';container.insertBefore(placeholder,items.at(-1)?.nextSibling||null);items.push(placeholder);
      }
      const bounds=cell.getBoundingClientRect(),scale=bounds.width/cell.offsetWidth;
      const slots=items.map(item=>{const rect=item.getBoundingClientRect(),shift=new DOMMatrixReadOnly(getComputedStyle(item).transform);return {item,x:(rect.left-bounds.left)/scale-shift.m41,y:(rect.top-bounds.top)/scale-shift.m42,width:rect.width/scale,height:rect.height/scale};});
      materialSort={cell,slots,from,container,placeholder,containerClass,count,scrollX:container.scrollLeft,scrollY:container.scrollTop,index:-1};
      items[from].dataset.materialSortSource='true';
    }
    const state=materialSort,bounds=cell.getBoundingClientRect(),scale=bounds.width/cell.offsetWidth;
    const x=(e.clientX-bounds.left)/scale+state.container.scrollLeft-state.scrollX,y=(e.clientY-bounds.top)/scale+state.container.scrollTop-state.scrollY;
    // Hit the original slots, not the thumbnails moving out of the way.
    let nearest=0,distance=Infinity;
    state.slots.forEach((slot,i)=>{const d=(x-slot.x-slot.width/2)**2+(y-slot.y-slot.height/2)**2;if(d<distance){distance=d;nearest=i;}});
    const slot=state.slots[nearest],last=state.slots.at(-1),after=x>=slot.x+slot.width/2;
    const boundary=y>=last.y+last.height||y>=last.y&&x>=last.x+last.width?state.slots.length:nearest+(after?1:0);
    const index=boundary-(state.from<boundary?1:0);
    if(state.index!==index){
      state.index=index;const order=state.slots.filter((_,i)=>i!==state.from);order.splice(index,0,state.slots[state.from]);
      order.forEach((entry,i)=>{entry.item.style.setProperty('--material-shift-x',state.slots[i].x-entry.x+'px');entry.item.style.setProperty('--material-shift-y',state.slots[i].y-entry.y+'px');});
    }
    return {item:slot.item,index:Math.min(boundary,state.count),side:after?'after':'before',sorting:true};
 }
 function editField(id=null){
    const field=getTable().fields.find(f=>f.id===id),d=openDialog(field?'设置字段':'新增字段');
    function input(label,tag,value){const l=element('label','',d);l.append(document.createTextNode(label));const e=element(tag,'',l);e.setAttribute('aria-label',label);if(tag!=='select')e.value=value??'';return e;}
    const name=input('字段名称','input',field?.name),type=input('字段类型','select');for(const t of FIELD_TYPES.filter(t=>!promptColumnsOnly||!['text','longtext','number'].includes(t)))type.add(new Option(promptColumnsOnly&&t==='json'?'提示词':FIELD_LABELS[t],t));type.value=field?.type||(promptColumnsOnly?'json':getTable().meta.material_columns?'assets':'text');type.disabled=Boolean(field?.readonly||isPrompt(field));
    const options=input('单选选项（每行一个）','textarea',(field?.options||[]).join('\n')),width=input('列宽','input',field?.width||180);width.type='number';width.min=100;width.max=600;
    const error=element('p','',d);
    d.append(tableButton('取消',()=>d.remove()),tableButton('保存字段',()=>{
      try {if(!name.value.trim())throw new Error('请输入字段名称');change(t=>{const existing=t.fields.find(f=>f.id===id),spec={name:name.value.trim(),type:type.value,...(promptColumnsOnly&&type.value==='json'?{presentation:'prompt',generationPrompt:true}:{}),options:options.value.split('\n').map(v=>v.trim()).filter(Boolean),width:Math.max(100,Math.min(600,Number(width.value)||180))};if(existing&&existing.type!==spec.type)spec.video_reference=false;if(existing){if(existing.type!==spec.type || spec.type==='select')for(const r of t.records)r.values[id]=convertValue(spec,r.values[id]);Object.assign(existing,spec);}else addField(t,spec);});d.remove();}catch(e){error.textContent=e.message;}
    }));
    if(field)d.append(tableButton('删除字段',()=>{if(window.confirm(`删除“${field.name}”及其所有单元格内容？可撤销。`)){change(t=>removeField(t,id));d.remove();}}));
 }
 function referenceButton(t,f){
    const b=t.meta.prompt_config?.bindings||t.meta.storyboard?.bindings||{};if(f.type!=='assets'||f.id===b.video_result)return null;
    const marked=videoReferenceFields(t).some(v=>v.id===f.id),button=tableButton('',()=>change(n=>setVideoReference(n,f.id,!marked)));
    button.className='video-reference-toggle';button.dataset.fieldId=f.id;button.setAttribute('aria-pressed',String(marked));button.setAttribute('aria-label',`${marked?'取消参考':'标记参考'}：${f.name}`);
    button.title=marked?'已标记参考 · 点击取消；本列图片参与视频生成':'标记参考 · 本列图片才会参与视频生成';
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z"/><path d="M12 15v6"/></svg>';
    button.onpointerdown=e=>e.stopPropagation();button.ondragstart=e=>{e.preventDefault();e.stopPropagation();};return button;
 }
 function manageFields(){const d=openDialog('显示字段');const draw=()=>{d.querySelectorAll('.field-row').forEach(e=>e.remove());for(const f of getTable().fields){const row=element('div','field-row',d),check=element('input','',row);check.type='checkbox';check.checked=!f.hidden;check.setAttribute('aria-label',`显示 ${f.name}`);check.onchange=()=>change(t=>{t.fields.find(x=>x.id===f.id).hidden=!check.checked;});const title=element('span','',row);title.textContent=`${f.name} · ${isPrompt(f)?'提示词':FIELD_LABELS[f.type]}`;row.append(tableButton('设置',()=>{d.remove();editField(f.id);}));const ref=referenceButton(getTable(),f);if(ref){ref.addEventListener('click',draw);row.append(ref);}}};d.append(tableButton('关闭',()=>d.remove()));draw();}
 const density=element('select');density.setAttribute('aria-label','行高');density.add(new Option('舒适行高','comfortable'));density.add(new Option('紧凑行高','compact'));density.onchange=()=>change(t=>{t.meta.density=density.value;});
 const view=element('select');view.setAttribute('aria-label','表格视图');view.add(new Option('表格视图','table'));view.add(new Option('卡片视图','cards'));view.onchange=()=>change(t=>t.view=view.value);
 toolbar.append(tableButton('＋ 字段',()=>editField()),tableButton('显示字段',manageFields),view,density);
 const help=element('span','table-count',toolbar);help.classList.add('table-help');help.textContent='操作说明';help.tabIndex=0;help.title='Shift 选择区域 · 支持表格粘贴 · Enter 编辑 · Escape 返回单元格 · Tab 下一格';
 const selectionActions=element('div','table-selection-actions');
 selectionActions.append(tableButton('复制选中',()=>change(duplicateSelected)),tableButton('删除选中',()=>{if(getTable().records.some(r=>r.selected)&&window.confirm('删除选中的记录？可撤销。'))change(t=>t.records=t.records.filter(r=>!r.selected));}));
 footer.append(tableButton('＋ 新增记录',()=>change(t=>addRecord(t))),selectionActions,undo,redo,count);
 function refreshStates(){if(!getRowState)return;const table=getTable(),rows=new Map([...shell.querySelectorAll('tr[data-record-id]')].map(tr=>[tr.dataset.recordId,tr]));for(const row of table.records){const state=getRowState(table,row),tr=rows.get(row.id);if(!tr)continue;if(tr.title!==state.hint)tr.title=state.hint;for(const cell of tr.querySelectorAll('td[data-field]')){const issue=state.issues.find(i=>i.field===cell.dataset.field),invalid=String(Boolean(issue)),title=issue?.message||'';if(cell.dataset.invalid!==invalid)cell.dataset.invalid=invalid;if(cell.title!==title)cell.title=title;if(cell.dataset.field===state.field){let badge=cell.querySelector('.task-badge');if(!badge){cell.replaceChildren();badge=element('span','task-badge readonly-value',cell);}if(badge.textContent!==state.label)badge.textContent=state.label;if(badge.dataset.state!==state.key)badge.dataset.state=state.key;if(badge.title!==state.hint)badge.title=state.hint;}}}}
 async function uploadInto(record,field,files){
    if(busy)return;busy=true;const snapshot=JSON.stringify(getTable());
    try{const targetField=getTable().fields.find(f=>f.id===field);if(targetField?.maxItems===1&&files.length>1)throw new Error('每个单元格最多一个图片或视频');const additions=[];for(const file of files){if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('上传暂支持 PNG、JPG、WebP');additions.push({id:uid(),url:await upload(file),name:file.name});}if(JSON.stringify(getTable())!==snapshot)throw new Error('上传期间表格已变化，未覆盖当前数据');change(t=>{const r=t.records.find(r=>r.id===record);setValue(t,record,field,[...(targetField?.maxItems===1||!Array.isArray(r.values[field])?[]:r.values[field]),...additions]);});}catch(e){notify(e.message);}finally{busy=false;}
 }
 async function dropCell(e,record,field){
    const p=packet(e);if(p?.kind==='row'||p?.kind==='column')return;
    const index=p?.kind==='asset'?assetDropPosition(e,record,field)?.index??null:null;
    if(!p&&/\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(e.dataTransfer.files?.[0]?.name||''))return;
    e.preventDefault();e.stopPropagation();dragEnd();if(busy||field.readonly)return;
    try{
      if(p){if(p.owner!==owner)throw new Error('请在同一张表内拖动');
        if(p.kind==='asset'){
          if(!['assets','content'].includes(field.type))throw new Error('请拖到素材字段');
          const snapshot=JSON.stringify(getTable()),value=getTable().records.find(r=>r.id===record.id)?.values[field.id];
          if(value&&!Array.isArray(value)){busy=true;if(!(await conflictChoice(false)))return;if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，请重新拖动');}
          let movedId=p.asset,moved=false;const referenceCells=new Map();
          change(t=>{
            const from=t.records.find(r=>r.id===p.record),to=t.records.find(r=>r.id===record.id),source=t.fields.find(f=>f.id===p.field);if(!source||source.readonly||!from||!to)throw new Error('来源已不可编辑');
            const items=from.values[p.field]||[],at=items.findIndex(a=>a.id===p.asset);if(at<0)return;
            const same=from===to&&p.field===field.id;let insert=index??(Array.isArray(to.values[field.id])?to.values[field.id].length:0);
            if(same&&at<insert)insert--;if(same&&at===insert)return;
            const references=bindColumnAssets(t,p.record,p.field);
            if(!same)references.push(...bindColumnAssets(t,record.id,field.id));
            for(const ref of references)referenceCells.set(ref.row.id+'|'+ref.fieldId,{recordId:ref.row.id,fieldId:ref.fieldId});
            const [asset]=items.splice(at,1);
            if(from.id!==to.id&&t.fields.some(f=>['assets','content'].includes(f.type)&&Array.isArray(to.values[f.id])&&to.values[f.id].some(a=>a.id===asset.id)))asset.id=uid();
            movedId=asset.id;
            if(field.maxItems===1&&to.values[field.id]?.length)throw new Error('目标单元格已有素材，请先移除或拖动整个单元格交换');
            if(!Array.isArray(to.values[field.id]))to.values[field.id]=[];to.values[field.id].splice(insert,0,asset);moved=true;
          },{render:false});
          if(moved){
            const table=getTable();
            referenceCells.set(p.record+'|'+p.field,{recordId:p.record,fieldId:p.field});referenceCells.set(record.id+'|'+field.id,{recordId:record.id,fieldId:field.id});
            for(const recordId of new Set([p.record,record.id])){
              const row=table.records.find(r=>r.id===recordId),changedFields=new Set();
              if(recordId===p.record)changedFields.add(p.field);
              if(recordId===record.id)changedFields.add(field.id);
              for(const f of table.fields){
                const doc=row.values[f.id]||f.promptTemplate;
                if(changedFields.has(f.id)||doc?.references?.some(ref=>changedFields.has(ref.fieldId)))referenceCells.set(recordId+'|'+f.id,{recordId,fieldId:f.id});
              }
            }
            for(const {recordId,fieldId} of referenceCells.values())refreshCells(recordId,fieldId);
          }
          const targetCell=[...shell.querySelectorAll('td[data-field]')].find(cell=>cell.dataset.record===record.id&&cell.dataset.field===field.id);
          [...(targetCell?.querySelectorAll('.dae-table-material[data-material-id]')||[])].find(item=>item.dataset.materialId===movedId)?.click();return;
        }
        const snapshot=JSON.stringify(getTable()),target=getTable().records.find(r=>r.id===record.id)?.values[field.id],occupied=Array.isArray(target)?target.length:target!==''&&target!=null&&target!==false;
        busy=true;const mode=occupied?await conflictChoice(true):'move';if(mode){if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，请重新拖动');change(t=>transferValue(t,p,{record:record.id,field:field.id},mode));}return;
      }
      if(e.dataTransfer.files.length){if(!['assets','content'].includes(field.type))throw new Error('请拖到素材字段');await uploadInto(record.id,field.id,[...e.dataTransfer.files]);return;}
      const ref=localImageFromDrop(e.dataTransfer,location.href);
      if(ref){if(!['assets','content'].includes(field.type))throw new Error('请拖到素材字段');change(t=>setValue(t,record.id,field.id,[...(field.maxItems===1||!Array.isArray(t.records.find(r=>r.id===record.id).values[field.id])?[]:t.records.find(r=>r.id===record.id).values[field.id]),{id:uid(),url:'/view?'+new URLSearchParams(ref),name:ref.filename}]));return;}
      const text=e.dataTransfer.getData('text/plain');if(text){
        const snapshot=JSON.stringify(getTable()),value=getTable().records.find(r=>r.id===record.id)?.values[field.id];
        busy=true;if(value!==''&&value!=null&&!(await conflictChoice(false)))return;
        if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，请重新拖动');
        change(t=>setValue(t,record.id,field.id,text));
      }
    }catch(error){notify(error.message);}finally{busy=false;}
 }
 function refreshCells(recordId,fieldId){
    const t=getTable(),f=t.fields.find(f=>f.id===fieldId);if(!f)return;
    for(const cell of shell.querySelectorAll('td[data-field]')){
      if(cell.dataset.field!==fieldId||recordId&&cell.dataset.record!==recordId)continue;
      const ri=t.records.findIndex(r=>r.id===cell.dataset.record);if(ri<0)continue;
      cellBindings.get(cell)?.();const fragment=document.createDocumentFragment();
      createCell(fragment,t.records[ri],f,ri,t);cell.replaceWith(fragment);
    }
    const table=shell.querySelector('table');if(table)table.dataset.cellsRevision=String(Number(table.dataset.cellsRevision||0)+1);
    if(isPrompt(f)){
      const header=[...shell.querySelectorAll('th[data-column]')].find(th=>th.dataset.column===fieldId),icon=header?.querySelector('.field-kind-icon');
      if(header)delete header.dataset.materialColumn;
      if(icon&&icon.title!=='提示词')tableIcon(icon,'edit-line','提示词');
    }
    refreshStates();mark();
 }
 function createCell(parent,r,f,ri,t){
    const cell=element('td','',parent),bindings=[];
    const dispose=()=>{for(const fn of bindings)fn();cleanups.delete(dispose);};
    cellBindings.set(cell,dispose);cleanups.add(dispose);const onCleanup=fn=>bindings.push(fn);
    cell.dataset.field=f.id;cell.dataset.record=r.id;cell.dataset.label=f.name;cell.style.width=f.width+'px';cell.tabIndex=0;cell.setAttribute('role','gridcell');
    cell.addEventListener('mousedown',e=>{if(e.target.isContentEditable||e.target.closest('[contenteditable=true]'))return;if(e.shiftKey){e.preventDefault();choose(r.id,f.id,true);}else choose(r.id,f.id);});cell.addEventListener('focus',()=>{if(!cellSelection.dragging)choose(r.id,f.id);});
    cell.ondragenter=cell.ondragover=e=>{if(drag?.kind==='asset'&&(f.readonly||!['assets','content'].includes(f.type)))return;if(drag?.kind!=='row'&&drag?.kind!=='column'){dragOver(e,cell);if(drag?.kind==='asset'){const target=assetDropPosition(e,r,f);if(target&&!target.sorting)target.item.dataset.materialDropSide=target.side;}}};cell.ondrop=e=>dropCell(e,r,f);
    cell.ondragleave=e=>{if(!cell.contains(document.elementFromPoint(e.clientX,e.clientY))){delete cell.dataset.drop;cell.querySelectorAll('[data-material-drop-side]').forEach(item=>delete item.dataset.materialDropSide);if(materialSort?.cell===cell)clearMaterialSort();}};
    const value=r.values[f.id]??emptyValue(f);
    if(f.type==='content'){if(!displayContent())draggable(cell,{kind:'cell',record:r.id,field:f.id});renderContentCell(cell,r,f,{change,upload,notify,getTable,onCleanup,bindAssetDrag:(element,asset)=>draggable(element,{kind:'asset',record:r.id,field:f.id,asset:asset.id})});}
    else if(renderCell?.({cell,row:r,field:f,onCleanup})){}
    else if(f.type==='assets'){
      if(t.view==='cards'){const ref=referenceButton(t,f);if(ref)cell.append(ref);}
      const assets=element('div','table-assets',cell);
      // A definite width prevents intrinsic media width from expanding the table.
      assets.style.width=Math.max(80,f.width-18)+'px';assets.style.maxWidth='100%';assets.tabIndex=0;assets.setAttribute('aria-label',`${f.name} · ${value.length} 个素材，横向滚动查看`);assets.title=`${value.length} 个素材，横向滚动查看`;
      if(value.length>1){const count=element('span','asset-count',cell);count.textContent=`${value.length} 个`;}
      const assetKey=`${r.id}:${f.id}`;
      for(const [i,a] of (Array.isArray(value)?value:[]).entries()){
        if(i>=2&&!expandedAssets.has(assetKey))continue;
        const item=element('span','table-asset',assets),video=a.kind==='video'||/\.(mp4|webm|mov)(?:&|$)/i.test(a.url);
        decorateAsset?.(item,r,a,f);
        const preview=element(video?'video':'img');preview.src=a.url;if(!video)preview.alt=a.name;
        item.setAttribute('aria-label',`第 ${i+1} 个素材：${a.name}${f.readonly?'':'，Delete 移除'}`);
        onCleanup(bindMaterialThumbnail(item,preview,i,{cell,bindDrag:f.readonly?null:element=>draggable(element,{kind:'asset',record:r.id,field:f.id,asset:a.id}),remove:f.readonly?null:()=>change(n=>{const values=n.records.find(x=>x.id===r.id).values[f.id];values.splice(values.findIndex(x=>x.id===a.id),1);})}));
        item.ondblclick=e=>{e.stopPropagation();previewAsset(a);};
        item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();previewAsset(a);}});
      }
      if(value.length>2){const more=tableButton(expandedAssets.has(assetKey)?'收起':`+${value.length-2}`,()=>{if(expandedAssets.has(assetKey))expandedAssets.delete(assetKey);else expandedAssets.add(assetKey);render();});more.title=expandedAssets.has(assetKey)?'收起素材列表':`显示全部 ${value.length} 个素材`;more.setAttribute('aria-label',more.title);more.setAttribute('aria-expanded',String(expandedAssets.has(assetKey)));assets.append(more);}
      if(!f.readonly){const picker=element('input','',cell);picker.type='file';picker.multiple=f.maxItems!==1;picker.accept='.png,.jpg,.jpeg,.webp';picker.hidden=true;picker.onchange=()=>uploadInto(r.id,f.id,[...picker.files]);const add=tableButton(value.length?'＋':'＋ 素材',()=>picker.click());add.className='asset-add';add.title='上传素材';add.setAttribute('aria-label','上传素材');assets.append(add);}
    }else if(f.readonly || f.type==='json') {const text=element('div','readonly-value',cell);text.textContent=typeof value==='object'?JSON.stringify(value,null,2):String(value);if(!f.readonly){const edit=tableButton('编辑 JSON',()=>{const next=window.prompt('JSON 内容',JSON.stringify(value));if(next!==null)safely(()=>change(n=>setValue(n,r.id,f.id,next)));});cell.append(edit);}}
    else{
      const input=element(f.type==='longtext'?'textarea':f.type==='select'?'select':'input','',cell);input.setAttribute('aria-label',`${f.name} · 第 ${ri+1} 行`);if(['text','longtext','number'].includes(f.type))input.placeholder=f.readonly?'':'点击填写';
      if(f.type==='select'){input.add(new Option('',''));for(const option of f.options||[])input.add(new Option(option,option));}
      if(f.type==='checkbox'){input.type='checkbox';input.checked=Boolean(value);}else{if(f.type==='number')input.type='number';input.value=value??'';}
      input.onfocus=()=>{choose(r.id,f.id);editGroup=uid();};input.onblur=()=>editGroup=null;
      input.addEventListener(['checkbox','select'].includes(f.type)?'change':'input',()=>safely(()=>change(n=>setValue(n,r.id,f.id,f.type==='checkbox'?input.checked:input.value),{render:false,group:editGroup})));
      input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Escape'){input.blur();cell.focus();}if(e.key==='Tab'){e.preventDefault();focusNext(r.id,f.id,0,e.shiftKey?-1:1);}};
    }
    if(isPrompt(f)||['text','longtext'].includes(f.type)||f.type==='content'&&(!Array.isArray(value)||!value.length))cell.dataset.textCell='true';
    if(!f.readonly){const grip=tableButton('⠿',()=>{});grip.className='cell-grip';grip.dataset.dragKind='cell';grip.title='拖动单元格';grip.setAttribute('aria-label','拖动单元格');draggable(grip,{kind:'cell',record:r.id,field:f.id});cell.append(grip);}
 }
 function render(){cellSelection.resetLayout();clearMaterialSort();clearBindings();
    structure?.dispose();structure=null;
    splitters?.dispose();splitters=null;
    const focused=document.activeElement?.closest?.('td[data-field]'),focus=focused&&root.contains(focused)?{record:focused.dataset.record,field:focused.dataset.field,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,editing:document.activeElement!==focused}:null;
    const scroll=[shell.scrollLeft,shell.scrollTop],t=getTable(),fs=fields().map(f=>({...f,width:Math.max(f.width,COLUMN_MINIMUM_WIDTH)}));root.dataset.view=t.view;root.dataset.fieldCount=String(fs.length);root.style.setProperty('--dae-card-columns',String(Math.max(1,Math.min(3,fs.length))));view.value=t.view;root.dataset.density=t.meta.density||'comfortable';density.value=root.dataset.density;shell.replaceChildren();
    const table=element('table','',shell);table.setAttribute('role','grid');table.setAttribute('aria-label','数据表');
    table.style.setProperty('--dae-table-width',((displayContent()?116:58)+fs.reduce((sum,f)=>sum+f.width,0))+'px');
    const fluid=Boolean(globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root)),choiceWidth=displayContent()?68:58,totalWidth=fs.reduce((sum,f)=>sum+f.width,0);table.dataset.fluid=String(fluid);table.dataset.choiceWidth=String(choiceWidth);
    table.style.setProperty('--dae-table-min-width',(choiceWidth+fs.length*100+(displayContent()?48:0))+'px');
    const cols=element('colgroup','',table);element('col','',cols).style.width=choiceWidth+'px';for(const f of fs)element('col','',cols).style.width=fluid?`${100*f.width/(totalWidth+choiceWidth)}%`:f.width+'px';
    const head=element('tr','',element('thead','',table)),selectionHead=element('th','table-choice',head),all=element('input','',selectionHead);all.type='checkbox';all.setAttribute('aria-label','选择全部记录');all.checked=!!t.records.length&&t.records.every(r=>r.selected);all.indeterminate=t.records.some(r=>r.selected)&&!all.checked;all.onchange=()=>change(n=>n.records.forEach(r=>r.selected=all.checked));
    for(const f of fs){const th=element('th','',head);th.dataset.column=f.id;if(['assets','content'].includes(f.type)&&!f.readonly){th.dataset.materialColumn=f.id;}th.style.width=f.width+'px';const ref=referenceButton(t,f);if(ref){th.append(ref);th.dataset.videoReference=ref.getAttribute('aria-pressed');}const title=element('span','field-title',th);const bindings=t.meta.prompt_config?.bindings||t.meta.storyboard?.bindings||{},kind=isPrompt(f)?'提示词':f.id===bindings.video_result||f.readonly&&['assets','content'].includes(f.type)?'生成结果':['assets','content'].includes(f.type)?'素材':'文本';
 const icon=element('span','field-kind-icon',title);tableIcon(icon,{'提示词':'edit-line','生成结果':'video-line','素材':'image-line','文本':'list-ordered'}[kind],kind);icon.setAttribute('aria-hidden','true');const name=element('span','field-name',title);name.textContent=f.name;title.tabIndex=0;if(f.goal==='image'){const goal=element('span','content-goal',th);goal.textContent='图像生成';}title.title=`${f.name} · ${FIELD_LABELS[f.type]}${f.readonly?' · 来源字段':''}`;const settings=tableIcon(tableButton('设置',()=>editField(f.id)),'edit-line',`设置字段 ${f.name}`);settings.className='field-settings';settings.setAttribute('aria-label',`设置字段 ${f.name}`);th.append(settings);draggable(th,{kind:'column',field:f.id});th.ondragover=e=>{if(drag?.kind==='column')dragOver(e,th);};th.ondrop=e=>{const p=packet(e);if(p?.owner!==owner||p.kind!=='column')return;e.preventDefault();e.stopPropagation();dragEnd();change(n=>reorder(n.fields,p.field,f.id));};}
    const body=element('tbody','',table);
    for(const [ri,r] of t.records.entries()){
      const row=element('tr','',body);row.dataset.recordId=r.id;row.dataset.shotId=r.id;if(t.view!=='cards'&&Number(r.meta?.height)>0)row.style.height=Number(r.meta.height)+'px';
      const select=element('td','table-choice',row),grip=tableButton('↕',()=>{});grip.className='row-grip';grip.dataset.dragKind='row';grip.title=`拖动第 ${ri+1} 行`;draggable(grip,{kind:'row',record:r.id});select.dataset.contentRow=r.id;select.append(grip);const rowNumber=element('span','content-row-number',select);rowNumber.textContent=String(ri+1);
      const check=element('input','',select);check.type='checkbox';check.checked=r.selected;check.setAttribute('aria-label',`选择第 ${ri+1} 行`);check.onchange=()=>change(n=>n.records.find(x=>x.id===r.id).selected=check.checked);
      row.ondragover=e=>{if(drag?.kind==='row')dragOver(e,row);};row.ondrop=e=>{const p=packet(e);if(p?.owner!==owner||p.kind!=='row')return;e.preventDefault();e.stopPropagation();const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;dragEnd();change(n=>reorder(n.records,p.record,r.id,after));};
      for(const f of fs){
        createCell(row,r,f,ri,t);
      }
    }
    if(!t.records.length){const empty=element('div','table-empty',shell);empty.textContent='暂无记录。新增记录，或通过导入工具填入数据。';}
    shell.scrollLeft=scroll[0];shell.scrollTop=scroll[1];updateFooter();mark();
    if(displayContent()&&t.view!=='cards')structure=attachTableStructure({root,shell,table,getTable,change,notify});
    if(t.view!=='cards'&&fs.length>1)splitters=attachColumnSplitters({root,shell,table,fields:fs,change,button:tableButton});
    if(focus){const td=[...shell.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===focus.record&&e.dataset.field===focus.field);const input=focus.editing?td?.querySelector('input:not([type=file]),textarea,select'):td;if(input){input.focus({preventScroll:true});if(focus.start!=null&&input.setSelectionRange&&input.type!=='number')input.setSelectionRange(focus.start,focus.end);}}
 }
 function previewAsset(asset){const d=openDialog(asset.name||'素材预览');d.classList.add('dae-media-dialog');const video=asset.kind==='video'||/\.(mp4|webm|mov)(?:&|$)/i.test(asset.url),media=element(video?'video':'img','',d);media.src=asset.url;if(video){media.controls=true;media.preload='metadata';media.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();},true);}else media.alt=asset.name||'素材';const close=()=>{if(video)media.pause();d.remove();};d.oncancel=close;d.append(tableButton('关闭预览',close));}
 function focusNext(record,field,dy,dx){const fs=fields(),rs=getTable().records,ri=rs.findIndex(r=>r.id===record),ci=fs.findIndex(f=>f.id===field),index=Math.max(0,Math.min(rs.length*fs.length-1,ri*fs.length+ci+dy*fs.length+dx)),r=rs[Math.floor(index/fs.length)],f=fs[index%fs.length];if(!r||!f)return;const td=[...shell.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===r.id&&e.dataset.field===f.id);td?.focus();td?.scrollIntoView({block:'nearest',inline:'nearest'});}
 root.addEventListener('copy',e=>{if(e.target.isContentEditable||e.target.matches('input,textarea')&&e.target.selectionStart!==e.target.selectionEnd)return;const region=selection();if(!region.length)return;e.preventDefault();e.clipboardData.setData('text/plain',encodeTSV(region.map(row=>row.map(({row,field})=>isPrompt(field)?promptText(row.values[field.id],getTable(),row):row.values[field.id]??emptyValue(field)))));e.clipboardData.setData('application/x-daelab-table-cells',JSON.stringify(region.map(row=>row.map(({row,field})=>row.values[field.id]??emptyValue(field)))));});
 root.addEventListener('paste',e=>{
    if(e.target.isContentEditable||e.target.matches('.content-edit'))return;
    const anchor=cellSelection.anchor,text=e.clipboardData.getData('text/plain'),structured=e.clipboardData.getData('application/x-daelab-table-cells');
    if(!anchor||e.target.matches('input,textarea')&&!/[\t\n\r]/.test(text))return;
    e.preventDefault();safely(()=>{
      const matrix=structured?JSON.parse(structured):copiedRegion?.text===text?clone(copiedRegion.matrix):parseTSV(text);
      const region=selection(),textOnly=matrix.every(row=>row.every(value=>typeof value==='string'||Array.isArray(value?.segments)));
      change(t=>{
        if(!promptColumnsOnly||!textOnly){pasteMatrix(t,anchor.record,anchor.field,matrix);return;}
        if(region.flat().length>1){
          region.forEach((cells,i)=>cells.forEach(({row,field},j)=>{
            if(isPrompt(field)&&!field.readonly){const values=matrix[i%matrix.length];if(values.length)setValue(t,row.id,field.id,values[j%values.length]);}
          }));
          return;
        }
        const fs=t.fields.filter(f=>!f.hidden),ri=t.records.findIndex(r=>r.id===anchor.record),ci=fs.findIndex(f=>f.id===anchor.field);
        if(!isPrompt(fs[ci]))return;
        if(ri+matrix.length>500)throw new Error('每张表最多 500 行');
        matrix.forEach((values,i)=>values.forEach((value,j)=>{
          const field=fs[ci+j];if(!isPrompt(field)||field.readonly)return;
          while(t.records.length<=ri+i)addRecord(t);
          setValue(t,t.records[ri+i].id,field.id,value);
        }));
      });
    });
 });
 root.addEventListener('keydown',e=>{
    if(e.target.isContentEditable||e.target.matches('input,textarea,select'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(!nativeHistory||!displayContent())restore(e.shiftKey);return;}
    if(e.target.closest('button,[role=separator]'))return;
    const end=cellSelection.end;if(!end)return;
    const offsets={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Tab:[0,e.shiftKey?-1:1]};
    if(offsets[e.key]){e.preventDefault();focusNext(end.record,end.field,...offsets[e.key]);}
    if(e.key==='Enter'){e.preventDefault();e.target.querySelector('input:not([type=file]),textarea,select')?.focus();}
    if(['Delete','Backspace'].includes(e.key)){e.preventDefault();clearCells();}
 });
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown'])root.addEventListener(event,e=>{if(event==='wheel'&&e.ctrlKey||event==='pointerdown'&&e.button===1||event==='mousedown'&&e.button===1)return;stopCanvasPropagation(e);});
 render();return {manageFields,addColumn:(target=null,before=false,anchor=root)=>root.dispatchEvent(new CustomEvent('dae-add-column',{detail:{target,before,anchor}})),addRow:(target=null,before=false)=>root.dispatchEvent(new CustomEvent('dae-add-row',{detail:{target,before}})),root,toolbar,selectionActions,selection,restore,copySelection:async()=>{const matrix=selection().map(cells=>cells.map(({row,field})=>clone(row.values[field.id]??emptyValue(field)))),text=encodeTSV(matrix);await navigator.clipboard.writeText(text);copiedRegion={text,matrix};},selectColumn:cellSelection.selectColumn,clearSelection:cellSelection.clear,render,refreshCells,change,clearCells,history,openDialog,closeDialogs,openTextSide:textSide.open,collapseTextSide:textSide.hide,focusCell:(record,field)=>{const cell=[...shell.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===record&&e.dataset.field===field);cell?.focus();cell?.scrollIntoView({block:'nearest',inline:'nearest'});},destroy:()=>{cellSelection.destroy();clearBindings();structure?.dispose();splitters?.dispose();dragEnd();closeDialogs();textSide.destroy();}};
}
