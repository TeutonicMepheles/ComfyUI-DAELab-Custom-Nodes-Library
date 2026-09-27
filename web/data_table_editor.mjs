import {clone,uid,addField,removeField,addRecord,duplicateSelected,reorder,setValue,transferValue,parseTSV,pasteMatrix,encodeTSV,SnapshotHistory,emptyValue,convertValue,FIELD_TYPES} from './data_table_model.mjs';
import {stopCanvasPropagation} from './list_editor_controls.mjs';
import {localImageFromDrop} from './badge_image_drop_87.mjs';
import {conflictChoice} from './table_cell_choice.mjs';

export const FIELD_LABELS={text:'文本',longtext:'多行文本',number:'数字',checkbox:'勾选',select:'单选',assets:'素材',json:'结构化原文'};
export function tableButton(label,action,primary=false) {const b=document.createElement('button');b.type='button';b.textContent=label;if(primary)b.dataset.primary='true';b.onclick=e=>{e.preventDefault();e.stopPropagation();action(e);};return b;}
const element=(tag,className,parent)=>{const e=document.createElement(tag);if(className)e.className=className;if(parent)parent.append(e);return e;};
const MIME='application/x-daelab-table';

function styles(){
 if(document.getElementById('dae-data-table-style'))return;
 const s=document.createElement('style');s.id='dae-data-table-style';s.textContent=`
.dae-table{display:flex;flex:1;min-height:0;flex-direction:column;gap:8px;container-type:inline-size}.dae-table-toolbar,.dae-table-footer{display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:none}.dae-table button{padding:5px 9px}.dae-table-scroll{flex:1;min-height:0;overflow:auto;border:1px solid #30363d;border-radius:7px;position:relative}
.dae-table table{border-collapse:separate!important;border-spacing:0;table-layout:fixed;width:max-content!important;min-width:100%!important}.dae-table thead{display:table-header-group!important;position:sticky;top:0;z-index:4}.dae-table tr{display:table-row!important}.dae-table th,.dae-table td{box-sizing:border-box;position:relative;border-right:1px solid #2b3036!important;border-bottom:1px solid #2b3036!important;padding:8px!important;vertical-align:top;overflow:hidden}.dae-table th{height:36px!important;text-align:left;font-weight:500;cursor:grab;white-space:nowrap}.dae-table td::before{display:none!important}.dae-table td{height:76px}.dae-table td:focus{outline:1px solid #a3d7c1;outline-offset:-2px}.dae-table td[data-selected=true]{box-shadow:inset 0 0 0 1px #699e8c;background:#25413633}.dae-table td>input:not([type=checkbox]),.dae-table td>textarea,.dae-table td>select{width:100%;margin:0!important;padding:6px 16px 6px 7px!important;font:inherit;background:transparent!important;border-color:transparent!important}.dae-table td>textarea{height:58px!important;line-height:1.5;resize:vertical;min-height:36px;max-height:160px}.dae-table td>input:focus,.dae-table td>textarea:focus,.dae-table td>select:focus{border-color:#699e8c!important;background:#24292e!important}.dae-table .table-choice{width:58px!important;min-width:58px;text-align:center;padding:13px 3px!important;white-space:nowrap;position:sticky;left:0;z-index:2;background:#1c2025}.dae-table th.table-choice{z-index:5;padding:8px 3px!important;cursor:default}.dae-table .table-choice input{vertical-align:middle;margin:0}.dae-table .row-grip{padding:0 3px!important;border:0!important;background:transparent!important;opacity:.5;cursor:grab}.dae-table .cell-grip{position:absolute;right:2px;top:2px!important;z-index:2;opacity:0!important;padding:0 2px!important;border:0!important;background:transparent!important;cursor:grab}.dae-table td:hover>.cell-grip,.dae-table .cell-grip:focus-visible{opacity:.65!important}.dae-table .field-settings{position:absolute!important;right:1px!important;top:6px!important;opacity:0!important;padding:0 4px!important;border:0!important;background:transparent!important}.dae-table th:hover>.field-settings,.dae-table .field-settings:focus-visible{opacity:1!important}.dae-table .field-title{display:block;overflow:hidden;text-overflow:ellipsis;padding-right:18px}.dae-table .table-assets{display:flex;gap:5px;flex-wrap:wrap}.dae-table .table-asset{position:relative;display:inline-flex;flex-direction:column;max-width:72px;cursor:grab}.dae-table .table-asset img,.dae-table .table-asset video{width:64px;height:44px;object-fit:cover;border-radius:4px}.dae-table .table-asset small{max-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;color:#98a4b2}.dae-table .asset-remove{padding:0 3px!important;position:absolute;right:0;top:0;opacity:0}.dae-table .table-asset:hover .asset-remove,.dae-table .asset-remove:focus-visible{opacity:1}.dae-table .asset-add{font-size:11px!important;padding:3px 6px!important;align-self:start}.dae-table .readonly-value{white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto;padding:6px 2px;color:#a5b2bf}.dae-table .table-count{margin-left:auto;color:#9aa4b1;white-space:nowrap;font-size:11px}.dae-table .table-empty{padding:38px;text-align:center;color:#84909e}.dae-table [data-drop=true]{outline:2px solid #7ac5aa;outline-offset:-2px}
.dae-table[data-view=cards] table{width:100%!important;min-width:0!important}.dae-table[data-view=cards] thead{display:none!important}.dae-table[data-view=cards] tr{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));padding:8px}.dae-table[data-view=cards] td{width:auto!important;height:auto;min-height:68px;border:0!important}.dae-table[data-view=cards] td::before{display:block!important;content:attr(data-label)!important;font-size:11px;color:#92a0af;margin-bottom:5px}.dae-table[data-view=cards] .table-choice{grid-column:1/-1;position:static;width:100%!important;text-align:left;min-height:0!important;padding:0 5px!important;background:transparent}.dae-table[data-view=cards] .table-choice::before{display:none!important}.dae-table[data-view=cards] .cell-grip{top:20px!important}
.dae-table-dialog{width:min(580px,90vw);max-height:85vh;overflow:auto;background:#20252b;color:#eee;border:1px solid #46515e;border-radius:10px;padding:20px;font:13px 'Alibaba PuHuiTi 3',sans-serif}.dae-table-dialog label{display:flex;align-items:center;gap:10px;margin:10px 0}.dae-table-dialog input:not([type=checkbox]),.dae-table-dialog textarea,.dae-table-dialog select{flex:1;min-width:0;padding:7px;background:#161a1f;color:#eee;border:1px solid #46515e;border-radius:5px;font:inherit}.dae-table-dialog button{margin:5px;padding:6px 12px;background:#303944;color:#eee;border:1px solid #526274;border-radius:5px}.dae-table-dialog .field-row{display:flex;align-items:center;gap:10px}.dae-table-dialog .field-row span{flex:1}.dae-table-dialog::backdrop{background:#0008}
`;document.head.append(s);
}

export function tableDialog(title){const d=element('dialog','dae-table-dialog');d.setAttribute('aria-label',title);const h=element('h3','',d);h.textContent=title;d.addEventListener('pointerdown',stopCanvasPropagation);d.oncancel=()=>d.remove();document.body.append(d);d.showModal();return d;}

// The very same editor is used by every template. Integrations only supply data and upload I/O.
export function createTableEditor({getTable,setTable,upload,notify=()=>{}}) {
 styles();const owner=uid(),history=new SnapshotHistory(),root=element('section','dae-table'),toolbar=element('nav','dae-table-toolbar',root),shell=element('div','dae-table-scroll',root),footer=element('nav','dae-table-footer',root);
 shell.dataset.storyboardScroll='true';let anchor=null,end=null,busy=false,editGroup=null,drag=null,raf=null;
 const fields=()=>getTable().fields.filter(f=>!f.hidden);
 const packet=e=>{try{return JSON.parse(e.dataTransfer.getData(MIME));}catch{return null;}};
 function change(fn,{render:draw=true,group=null}={}) {const before=JSON.stringify(getTable()),next=clone(getTable());fn(next);const after=JSON.stringify(next);history.record(before,after,group);setTable(next);if(draw)render();else updateFooter();}
 function safely(fn){try{return fn();}catch(e){notify(e.message);return null;}}
 function restore(redo=false){const value=history.restore(JSON.stringify(getTable()),redo);if(value){setTable(value);render();}}
 const undo=tableButton('撤销',()=>restore()),redo=tableButton('重做',()=>restore(true)),count=element('span','table-count');
 function updateFooter(){undo.disabled=!history.undoStack.length;redo.disabled=!history.redoStack.length;count.textContent=`${getTable().records.filter(r=>r.selected).length} / ${getTable().records.length} 行已选`;}
 function selection(){if(!anchor||!end)return [];const t=getTable(),fs=fields(),a=t.records.findIndex(r=>r.id===anchor.record),b=t.records.findIndex(r=>r.id===end.record),c=fs.findIndex(f=>f.id===anchor.field),d=fs.findIndex(f=>f.id===end.field);if(Math.min(a,b,c,d)<0)return [];return t.records.slice(Math.min(a,b),Math.max(a,b)+1).map(row=>fs.slice(Math.min(c,d),Math.max(c,d)+1).map(field=>({row,field})));}
 function mark(){const selected=new Set(selection().flat().map(x=>x.row.id+'|'+x.field.id));shell.querySelectorAll('td[data-field]').forEach(td=>td.dataset.selected=String(selected.has(td.dataset.record+'|'+td.dataset.field)));}
 function choose(record,field,extend=false){if(!extend||!anchor)anchor={record,field};end={record,field};mark();}
 function dragEnd(){drag=null;if(raf)cancelAnimationFrame(raf);raf=null;shell.querySelectorAll('[data-drop]').forEach(e=>delete e.dataset.drop);}
 function dragOver(e,target){e.preventDefault();e.stopPropagation();shell.querySelectorAll('[data-drop]').forEach(el=>delete el.dataset.drop);target.dataset.drop='true';if(raf)cancelAnimationFrame(raf);const rect=shell.getBoundingClientRect(),dy=e.clientY<rect.top+28?-10:e.clientY>rect.bottom-28?10:0,dx=e.clientX<rect.left+28?-10:e.clientX>rect.right-28?10:0;const tick=()=>{shell.scrollBy(dx,dy);raf=requestAnimationFrame(tick);};if(dx||dy)raf=requestAnimationFrame(tick);}
 function draggable(el,data){el.draggable=true;el.addEventListener('dragstart',e=>{e.stopPropagation();drag={...data,owner};e.dataTransfer.setData(MIME,JSON.stringify(drag));e.dataTransfer.effectAllowed='move';});el.addEventListener('dragend',dragEnd);}
 function editField(id=null){
    const field=getTable().fields.find(f=>f.id===id),d=tableDialog(field?'设置字段':'新增字段');
    function input(label,tag,value){const l=element('label','',d);l.append(document.createTextNode(label));const e=element(tag,'',l);e.setAttribute('aria-label',label);if(tag!=='select')e.value=value??'';return e;}
    const name=input('字段名称','input',field?.name),type=input('字段类型','select');for(const t of FIELD_TYPES)type.add(new Option(FIELD_LABELS[t],t));type.value=field?.type||'text';type.disabled=Boolean(field?.readonly);
    const options=input('单选选项（每行一个）','textarea',(field?.options||[]).join('\n')),width=input('列宽','input',field?.width||180);width.type='number';width.min=100;width.max=600;
    const error=element('p','',d);
    d.append(tableButton('取消',()=>d.remove()),tableButton('保存字段',()=>{
      try {if(!name.value.trim())throw new Error('请输入字段名称');change(t=>{const existing=t.fields.find(f=>f.id===id),spec={name:name.value.trim(),type:type.value,options:options.value.split('\n').map(v=>v.trim()).filter(Boolean),width:Math.max(100,Math.min(600,Number(width.value)||180))};if(existing){if(existing.type!==spec.type || spec.type==='select')for(const r of t.records)r.values[id]=convertValue(spec,r.values[id]);Object.assign(existing,spec);}else addField(t,spec);});d.remove();}catch(e){error.textContent=e.message;}
    }));
    if(field)d.append(tableButton('删除字段',()=>{if(window.confirm(`删除“${field.name}”及其所有单元格内容？可撤销。`)){change(t=>removeField(t,id));d.remove();}}));
 }
 function manageFields(){const d=tableDialog('显示字段');const draw=()=>{d.querySelectorAll('.field-row').forEach(e=>e.remove());for(const f of getTable().fields){const row=element('div','field-row',d),check=element('input','',row);check.type='checkbox';check.checked=!f.hidden;check.setAttribute('aria-label',`显示 ${f.name}`);check.onchange=()=>change(t=>{t.fields.find(x=>x.id===f.id).hidden=!check.checked;});const title=element('span','',row);title.textContent=`${f.name} · ${FIELD_LABELS[f.type]}`;row.append(tableButton('设置',()=>{d.remove();editField(f.id);}));}};d.append(tableButton('关闭',()=>d.remove()));draw();}
 const view=element('select');view.setAttribute('aria-label','表格视图');view.add(new Option('表格视图','table'));view.add(new Option('卡片视图','cards'));view.onchange=()=>change(t=>t.view=view.value);
 toolbar.append(tableButton('＋ 字段',()=>editField()),tableButton('显示字段',manageFields),view);
 const help=element('span','table-count',toolbar);help.textContent='Shift 选择区域 · 支持表格粘贴';
 footer.append(tableButton('＋ 新增记录',()=>change(t=>addRecord(t))),tableButton('复制选中',()=>change(duplicateSelected)),tableButton('删除选中',()=>{if(getTable().records.some(r=>r.selected)&&window.confirm('删除选中的记录？可撤销。'))change(t=>t.records=t.records.filter(r=>!r.selected));}),undo,redo,count);
 async function uploadInto(record,field,files){
    if(busy)return;busy=true;const snapshot=JSON.stringify(getTable());
    try{const additions=[];for(const file of files){if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('上传暂支持 PNG、JPG、WebP');additions.push({id:uid(),url:await upload(file),name:file.name});}if(JSON.stringify(getTable())!==snapshot)throw new Error('上传期间表格已变化，未覆盖当前数据');change(t=>{const r=t.records.find(r=>r.id===record);setValue(t,record,field,[...(r.values[field]||[]),...additions]);});}catch(e){notify(e.message);}finally{busy=false;}
 }
 async function dropCell(e,record,field,index=null){
    const p=packet(e);if(p?.kind==='row'||p?.kind==='column')return;
    if(!p&&/\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(e.dataTransfer.files?.[0]?.name||''))return;
    e.preventDefault();e.stopPropagation();dragEnd();if(busy||field.readonly)return;
    try{
      if(p){if(p.owner!==owner)throw new Error('请在同一张表内拖动');
        if(p.kind==='asset'){
          if(field.type!=='assets')throw new Error('请拖到素材字段');
          change(t=>{const from=t.records.find(r=>r.id===p.record),to=t.records.find(r=>r.id===record.id),source=t.fields.find(f=>f.id===p.field);if(!source||source.readonly||!from||!to)throw new Error('来源已不可编辑');const items=from.values[p.field]||[],at=items.findIndex(a=>a.id===p.asset);if(at<0)return;const [asset]=items.splice(at,1);to.values[field.id]||=[];to.values[field.id].splice(index??to.values[field.id].length,0,asset);});return;
        }
        const snapshot=JSON.stringify(getTable()),target=getTable().records.find(r=>r.id===record.id)?.values[field.id],occupied=Array.isArray(target)?target.length:target!==''&&target!=null&&target!==false;
        busy=true;const mode=occupied?await conflictChoice(true):'move';if(mode){if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，请重新拖动');change(t=>transferValue(t,p,{record:record.id,field:field.id},mode));}return;
      }
      if(e.dataTransfer.files.length){if(field.type!=='assets')throw new Error('请拖到素材字段');await uploadInto(record.id,field.id,[...e.dataTransfer.files]);return;}
      const ref=localImageFromDrop(e.dataTransfer,location.href);
      if(ref){if(field.type!=='assets')throw new Error('请拖到素材字段');change(t=>setValue(t,record.id,field.id,[...(t.records.find(r=>r.id===record.id).values[field.id]||[]),{id:uid(),url:'/view?'+new URLSearchParams(ref),name:ref.filename}]));return;}
      const text=e.dataTransfer.getData('text/plain');if(text){
        const snapshot=JSON.stringify(getTable()),value=getTable().records.find(r=>r.id===record.id)?.values[field.id];
        busy=true;if(value!==''&&value!=null&&!(await conflictChoice(false)))return;
        if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，请重新拖动');
        change(t=>setValue(t,record.id,field.id,text));
      }
    }catch(error){notify(error.message);}finally{busy=false;}
 }
 function render(){
    const focused=document.activeElement?.closest?.('td[data-field]'),focus=focused&&root.contains(focused)?{record:focused.dataset.record,field:focused.dataset.field,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,editing:document.activeElement!==focused}:null;
    const scroll=[shell.scrollLeft,shell.scrollTop],t=getTable(),fs=fields();root.dataset.view=t.view;view.value=t.view;shell.replaceChildren();
    const table=element('table','',shell);table.setAttribute('role','grid');table.setAttribute('aria-label','数据表');
    const head=element('tr','',element('thead','',table)),selectionHead=element('th','table-choice',head),all=element('input','',selectionHead);all.type='checkbox';all.setAttribute('aria-label','选择全部记录');all.checked=!!t.records.length&&t.records.every(r=>r.selected);all.indeterminate=t.records.some(r=>r.selected)&&!all.checked;all.onchange=()=>change(n=>n.records.forEach(r=>r.selected=all.checked));
    for(const f of fs){const th=element('th','',head);th.dataset.column=f.id;th.style.width=f.width+'px';const title=element('span','field-title',th);title.textContent=f.name;title.title=`${f.name} · ${FIELD_LABELS[f.type]}${f.readonly?' · 来源字段':''}`;const settings=tableButton('⋯',()=>editField(f.id));settings.className='field-settings';settings.setAttribute('aria-label',`设置字段 ${f.name}`);th.append(settings);draggable(th,{kind:'column',field:f.id});th.ondragover=e=>{if(drag?.kind==='column')dragOver(e,th);};th.ondrop=e=>{const p=packet(e);if(p?.owner!==owner||p.kind!=='column')return;e.preventDefault();e.stopPropagation();dragEnd();change(n=>reorder(n.fields,p.field,f.id));};}
    const body=element('tbody','',table);
    for(const [ri,r] of t.records.entries()){
      const row=element('tr','',body);row.dataset.recordId=r.id;row.dataset.shotId=r.id;
      const select=element('td','table-choice',row),grip=tableButton('↕',()=>{});grip.className='row-grip';grip.dataset.dragKind='row';grip.title=`拖动第 ${ri+1} 行`;draggable(grip,{kind:'row',record:r.id});select.append(grip);
      const check=element('input','',select);check.type='checkbox';check.checked=r.selected;check.setAttribute('aria-label',`选择第 ${ri+1} 行`);check.onchange=()=>change(n=>n.records.find(x=>x.id===r.id).selected=check.checked);
      row.ondragover=e=>{if(drag?.kind==='row')dragOver(e,row);};row.ondrop=e=>{const p=packet(e);if(p?.owner!==owner||p.kind!=='row')return;e.preventDefault();e.stopPropagation();const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;dragEnd();change(n=>reorder(n.records,p.record,r.id,after));};
      for(const f of fs){
        const cell=element('td','',row);cell.dataset.field=f.id;cell.dataset.record=r.id;cell.dataset.label=f.name;cell.style.width=f.width+'px';cell.tabIndex=0;cell.setAttribute('role','gridcell');
        cell.addEventListener('mousedown',e=>{if(e.shiftKey){e.preventDefault();choose(r.id,f.id,true);}else choose(r.id,f.id);});cell.addEventListener('focus',()=>choose(r.id,f.id));
        cell.ondragover=e=>{if(drag?.kind!=='row'&&drag?.kind!=='column')dragOver(e,cell);};cell.ondrop=e=>dropCell(e,r,f);
        const value=r.values[f.id]??emptyValue(f);
        if(f.type==='assets'){
          const assets=element('div','table-assets',cell);
          for(const [i,a] of (Array.isArray(value)?value:[]).entries()){
            const item=element('span','table-asset',assets),video=a.kind==='video'||/\.(mp4|webm|mov)(?:&|$)/i.test(a.url);
            const preview=element(video?'video':'img','',item);preview.src=a.url;if(video){preview.controls=true;preview.preload='metadata';}else{preview.alt=a.name;preview.draggable=false;}
            const name=element('small','',item);name.textContent=a.name;name.title=a.name;
            if(!f.readonly){draggable(item,{kind:'asset',record:r.id,field:f.id,asset:a.id});item.ondrop=e=>dropCell(e,r,f,i);const remove=tableButton('×',()=>change(n=>{const values=n.records.find(x=>x.id===r.id).values[f.id];values.splice(values.findIndex(x=>x.id===a.id),1);}));remove.className='asset-remove';remove.title='移除素材';item.append(remove);}
          }
          if(!f.readonly){const picker=element('input','',cell);picker.type='file';picker.multiple=true;picker.accept='.png,.jpg,.jpeg,.webp';picker.hidden=true;picker.onchange=()=>uploadInto(r.id,f.id,[...picker.files]);const add=tableButton(value.length?'＋':'＋ 素材',()=>picker.click());add.className='asset-add';add.title='上传素材';assets.append(add);}
        }else if(f.readonly || f.type==='json') {const text=element('div','readonly-value',cell);text.textContent=typeof value==='object'?JSON.stringify(value,null,2):String(value);if(!f.readonly){const edit=tableButton('编辑 JSON',()=>{const next=window.prompt('JSON 内容',JSON.stringify(value));if(next!==null)safely(()=>change(n=>setValue(n,r.id,f.id,next)));});cell.append(edit);}}
        else{
          const input=element(f.type==='longtext'?'textarea':f.type==='select'?'select':'input','',cell);input.setAttribute('aria-label',`${f.name} · 第 ${ri+1} 行`);
          if(f.type==='select'){input.add(new Option('',''));for(const option of f.options||[])input.add(new Option(option,option));}
          if(f.type==='checkbox'){input.type='checkbox';input.checked=Boolean(value);}else{if(f.type==='number')input.type='number';input.value=value??'';}
          input.onfocus=()=>{choose(r.id,f.id);editGroup=uid();};input.onblur=()=>editGroup=null;
          input.addEventListener(['checkbox','select'].includes(f.type)?'change':'input',()=>safely(()=>change(n=>setValue(n,r.id,f.id,f.type==='checkbox'?input.checked:input.value),{render:false,group:editGroup})));
          input.onkeydown=e=>{if(e.key==='Escape'){input.blur();cell.focus();}if(e.key==='Tab'){e.preventDefault();focusNext(r.id,f.id,0,e.shiftKey?-1:1);}};
        }
        if(!f.readonly){const grip=tableButton('⠿',()=>{});grip.className='cell-grip';grip.dataset.dragKind='cell';grip.title='拖动单元格';grip.setAttribute('aria-label','拖动单元格');draggable(grip,{kind:'cell',record:r.id,field:f.id});cell.append(grip);}
      }
    }
    if(!t.records.length){const empty=element('div','table-empty',shell);empty.textContent='暂无记录。新增记录，或通过导入工具填入数据。';}
    shell.scrollLeft=scroll[0];shell.scrollTop=scroll[1];updateFooter();mark();
    if(focus){const td=[...shell.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===focus.record&&e.dataset.field===focus.field);const input=focus.editing?td?.querySelector('input:not([type=file]),textarea,select'):td;if(input){input.focus({preventScroll:true});if(focus.start!=null&&input.setSelectionRange&&input.type!=='number')input.setSelectionRange(focus.start,focus.end);}}
 }
 function focusNext(record,field,dy,dx){const fs=fields(),rs=getTable().records,ri=rs.findIndex(r=>r.id===record),ci=fs.findIndex(f=>f.id===field),index=Math.max(0,Math.min(rs.length*fs.length-1,ri*fs.length+ci+dy*fs.length+dx)),r=rs[Math.floor(index/fs.length)],f=fs[index%fs.length];if(!r||!f)return;const td=[...shell.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===r.id&&e.dataset.field===f.id);td?.focus();td?.scrollIntoView({block:'nearest',inline:'nearest'});}
 root.addEventListener('copy',e=>{if(e.target.matches('input,textarea')&&e.target.selectionStart!==e.target.selectionEnd)return;const region=selection();if(!region.length)return;e.preventDefault();e.clipboardData.setData('text/plain',encodeTSV(region.map(row=>row.map(({row,field})=>row.values[field.id]??emptyValue(field)))));});
 root.addEventListener('paste',e=>{const text=e.clipboardData.getData('text/plain');if(!anchor || e.target.matches('input,textarea')&&!/[\t\n\r]/.test(text))return;e.preventDefault();safely(()=>change(t=>pasteMatrix(t,anchor.record,anchor.field,parseTSV(text))));});
 root.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restore(e.shiftKey);return;}
    if(!end)return;
    const offsets={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Tab:[0,e.shiftKey?-1:1]};
    if(offsets[e.key]){e.preventDefault();focusNext(end.record,end.field,...offsets[e.key]);}
    if(e.key==='Enter'){e.preventDefault();e.target.querySelector('input:not([type=file]),textarea,select')?.focus();}
    if(['Delete','Backspace'].includes(e.key)){e.preventDefault();safely(()=>change(t=>{for(const {row,field} of selection().flat())setValue(t,row.id,field.id,emptyValue(field));}));}
 });
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown'])root.addEventListener(event,stopCanvasPropagation);
 render();return {root,render,change,history,destroy:dragEnd};
}
