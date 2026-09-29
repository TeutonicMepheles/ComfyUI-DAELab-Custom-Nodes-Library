import {bindInlineEditor} from './table_inline_editor.mjs?v=20260930-inline4';
import {applyPromptToColumn} from './table_prompt_template.mjs?v=20260930-inline4';
import {isPrompt,promptField} from './table_prompt_model.mjs?v=20260930-inline4';
import {addField,addRecord,removeField,clone,uid,setValue,emptyValue} from './data_table_model.mjs?v=20260930-inline4';
import {createTableButton as button} from './table_controls.mjs?v=20260930-inline4';

const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};

export function renderContentCell(cell,row,field,{change,upload,notify,getTable,onCleanup}){
    cell.classList.add('content-cell');
    const value=row.values[field.id],asset=Array.isArray(value)?value[0]:null;
    const display=el('div','content-display');cell.append(display);
    if(asset){const media=el(asset.kind==='video'?'video':'img');media.src=asset.url;
        if(asset.kind==='video'){media.controls=true;media.preload='metadata';}else media.alt=asset.name||'图片';
        media.draggable=false;display.append(media,el('small','content-caption',asset.name));
    }else{display.classList.add('content-text');display.textContent=typeof value==='string'?value:'';}
    if(!field.readonly){
        let original=null,expected=null,group=null;
        const current=()=>getTable().records.find(r=>r.id===row.id)?.values[field.id]??'';
        bindInlineEditor({cell,box:display,label:`编辑 ${field.name}`,onCleanup,notify,allowDoubleClick:!asset,
            draw:editing=>{display.replaceChildren();const live=current(),mediaAsset=Array.isArray(live)?live[0]:null;display.classList.toggle('content-text',editing||!mediaAsset);if(!editing&&mediaAsset){const media=el(mediaAsset.kind==='video'?'video':'img');media.src=mediaAsset.url;if(mediaAsset.kind==='video')media.controls=true;else media.alt=mediaAsset.name||'图片';display.append(media,el('small','content-caption',mediaAsset.name));}else display.textContent=typeof live==='string'?live:'';original=live;expected=JSON.stringify(original);group=uid();},
            read:()=>display.innerText,
            write:value=>{if(JSON.stringify(current())!==expected)throw new Error('单元格已被更新，请重新编辑');change(t=>setValue(t,row.id,field.id,value),{render:false,group});expected=JSON.stringify(value);},
            reset:()=>{if(JSON.stringify(current())===expected)change(t=>setValue(t,row.id,field.id,original),{render:false,group});}
        });
    }
    const picker=el('input');picker.type='file';picker.accept='.png,.jpg,.jpeg,.webp';picker.hidden=true;cell.append(picker);if(field.type==='content'&&!field.readonly){const add=button(asset?'替换图片':'添加图片',()=>picker.click());add.className='content-native-add';cell.append(add);}
    picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;const before=JSON.stringify(row.values[field.id]);
        try{const url=await upload(file);change(t=>{const current=t.records.find(r=>r.id===row.id);if(!current||JSON.stringify(current.values[field.id])!==before)throw new Error('单元格已变化，未覆盖当前内容');setValue(t,row.id,field.id,[{id:uid(),url,name:file.name,kind:'image'}]);});}catch(error){notify(error.message);}};
cell.addEventListener('dae-upload',()=>picker.click());
    if(asset)cell.addEventListener('dblclick',e=>{if(e.target.closest('video'))return;e.stopPropagation();cell.dispatchEvent(new CustomEvent('dae-preview',{bubbles:true,detail:asset}));});
}

// One instance-owned contextual menu; the existing editor remains the transaction
// owner. This module never reads another plugin's node or private application state.
export function installContentPresentation({root,editor,getTable,notify,editPromptTemplate}){
    const toolbar=el('aside','dae-ui content-context');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','表格选中操作');toolbar.hidden=true;document.body.append(toolbar);
    let selected=null,signature='',disposed=false;
    const card=()=>root.closest('.dae-creative-card');
    const active=()=>!!root.closest('.dae-creative')&&root.isConnected&&!card()?.closest('[hidden]');
    const findCell=()=>[...root.querySelectorAll('td[data-field]')].find(e=>e.dataset.field===selected?.field&&e.dataset.record===selected?.record);
    const field=()=>getTable().fields.find(f=>f.id===selected?.field);
    const mutate=fn=>{try{editor.change(fn);signature='';tick();}catch(e){notify(e.message);}};
    function rename(){const f=field();if(!f)return;const d=editor.openDialog('重命名列'),input=el('input');input.value=f.name;input.setAttribute('aria-label','列名称');const save=()=>{if(!input.value.trim())return;mutate(t=>t.fields.find(x=>x.id===f.id).name=input.value.trim());d.remove();};d.append(input,button('保存',save),button('取消',()=>d.remove()));input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)save();};input.focus();input.select();}
    function preview(asset){const d=editor.openDialog(asset.name||'素材预览'),media=el(asset.kind==='video'?'video':'img');media.src=asset.url;media.style.cssText='display:block;max-width:100%;max-height:70vh;object-fit:contain';if(asset.kind==='video')media.controls=true;const close=()=>{media.pause?.();d.remove();};d.append(media,button('关闭预览',close));d.oncancel=close;}
    function build(){
        toolbar.replaceChildren();const label=el('span','content-context-label',selected.kind==='table'?'表格':selected.kind==='column'?field()?.name:selected.kind==='row'?'行':'单元格');toolbar.append(label);
        if(selected.kind==='table'){
            toolbar.append(button('提示词模板',()=>{let id=promptField(getTable());if(!getTable().fields.some(f=>f.id===id)){mutate(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});}editPromptTemplate?.(id);}),button('撤销',()=>{editor.restore();signature='';}),button('重做',()=>{editor.restore(true);signature='';}));
            const density=el('select');density.setAttribute('aria-label','内容显示');for(const [v,n] of [['comfortable','舒适'],['compact','紧凑']])density.add(new Option(n,v));density.value=getTable().meta.density||'comfortable';density.onchange=()=>mutate(t=>t.meta.density=density.value);toolbar.append(density);
        }else if(selected.kind==='column'){
            toolbar.append(button('重命名',rename));if(isPrompt(field()))toolbar.append(button('编辑整列模板',()=>editPromptTemplate?.(selected.field)));const target=el('select');target.setAttribute('aria-label','列目标');for(const [v,n] of [['','无目标'],['image','图像生成']])target.add(new Option(n,v));target.value=field()?.goal||'';target.onchange=()=>mutate(t=>t.fields.find(f=>f.id===selected.field).goal=target.value);toolbar.append(target);
            toolbar.append(button('复制列',()=>mutate(t=>{const old=t.fields.find(f=>f.id===selected.field),next=addField(t,{...clone(old),id:uid(),name:old.name+' 副本'});for(const r of t.records){r.values[next.id]=clone(r.values[old.id]??emptyValue(old));if(Array.isArray(r.values[next.id]))for(const a of r.values[next.id])a.id=uid();}selected={kind:'column',field:next.id};})),button('清空列',()=>mutate(t=>{for(const r of t.records)r.values[selected.field]=emptyValue(field());})),button('删除列',()=>mutate(t=>{removeField(t,selected.field);selected={kind:'table'};})));
        }else if(selected.kind==='row'){
            toolbar.append(button('删除行',()=>mutate(t=>{t.records=t.records.filter(r=>r.id!==selected.record);selected={kind:'table'};})));
        }else{
            const f=field(),value=getTable().records.find(r=>r.id===selected.record)?.values[f?.id],asset=Array.isArray(value)?value[0]:null;
            const region=editor.selection().flat(),many=region.length>1;
            if(!many&&['content','text','longtext'].includes(f?.type))toolbar.append(button(asset?'改为文字':'编辑文字',()=>findCell()?.dispatchEvent(new Event('dae-edit-text'))),...(f.type==='content'?[button(asset?'替换图片':'添加图片',()=>findCell()?.dispatchEvent(new Event('dae-upload')))]:[]));
            if(asset&&!many){toolbar.append(button('预览',()=>preview(asset)));const a=el('a','', '下载');a.href=asset.url;a.download=asset.name||'素材';toolbar.append(a);}
            toolbar.append(button('复制',()=>editor.copySelection()));
            if(!many&&isPrompt(f)&&!f.readonly){const fill=button('应用到整列',()=>mutate(t=>applyPromptToColumn(t,selected.field,selected.record)));fill.title='覆盖本列所有行的提示词；@列引用仍读取各自行的素材，可撤销';toolbar.append(fill);}
            toolbar.append(button(many?'清空选区':'清空',()=>mutate(t=>{for(const {row,field:f} of region.length?region:[{row:{id:selected.record},field:f}])setValue(t,row.id,f.id,emptyValue(f));})));
            toolbar.append(button('列操作',()=>{selected={kind:'column',field:selected.field};signature='';tick();}),button('表格操作',()=>{selected={kind:'table'};signature='';tick();}));
        }
    }
    function choose(e){
        if(toolbar.contains(e.target)||e.target.closest('dialog,.table-text-side,.table-column-popover,.table-structure-control,.table-choice input'))return;
        if(e.type==='focusin'&&!root.contains(e.target))return;
        if(!active()||!card()?.contains(e.target)){selected=null;toolbar.hidden=true;return;}
        if(e.target.closest('[data-inline-editing=true]')){selected=null;editor.clearSelection();toolbar.hidden=true;root.querySelectorAll('[data-column-selected]').forEach(e=>delete e.dataset.columnSelected);return;}
        const cell=e.target.closest('td[data-field]'),th=e.target.closest('th[data-column]'),row=e.target.closest('.table-choice[data-content-row]');
        selected=cell?{kind:'cell',field:cell.dataset.field,record:cell.dataset.record}:th?{kind:'column',field:th.dataset.column}:row?{kind:'row',record:row.dataset.contentRow}:{kind:'table'};
        if(selected.kind!=='cell')editor.clearSelection();signature='';queueMicrotask(tick);
    }
    function tick(){
        if(disposed)return;const showing=String(active());if(root.dataset.contentPresentation!==showing){root.dataset.contentPresentation=showing;editor.render();}
        if(root.querySelector('[data-inline-editing=true],[data-structure-dragging],[data-structure-popup]')){toolbar.hidden=true;return;}
        if(!active()||!selected||card()?.dataset.selected==='false'||card()?.dataset.inactive==='true'){toolbar.hidden=true;return;}
        const key=JSON.stringify([selected,getTable().fields,editor.selection().flat().length]);if(key!==signature){signature=key;build();}
        let anchor=selected.kind==='cell'?findCell():selected.kind==='column'?[...root.querySelectorAll('th[data-column]')].find(e=>e.dataset.column===selected.field):card();
        if(!anchor){selected={kind:'table'};signature='';return;}
        toolbar.hidden=false;const r=anchor.getBoundingClientRect(),bounds=card().closest('.dae-creative').getBoundingClientRect();toolbar.style.boxSizing='border-box';toolbar.style.maxWidth=Math.max(160,Math.min(bounds.width,document.documentElement.clientWidth)-32)+'px';const h=toolbar.getBoundingClientRect().height,w=toolbar.getBoundingClientRect().width;
        if(r.bottom<bounds.top||r.top>bounds.bottom){toolbar.hidden=true;return;}
        toolbar.style.left=Math.max(bounds.left+8,Math.min(r.left,Math.min(bounds.right,document.documentElement.clientWidth)-w-16))+'px';toolbar.style.top=Math.max(bounds.top+8,Math.min(r.top-h-10>=bounds.top?r.top-h-10:r.bottom+10,bounds.bottom-h-8))+'px';
        root.querySelectorAll('[data-column-selected]').forEach(e=>delete e.dataset.columnSelected);
        if(selected.kind==='column')root.querySelectorAll('th[data-column],td[data-field]').forEach(e=>e.dataset.columnSelected=String((e.dataset.column||e.dataset.field)===selected.field));
    }
    const double=e=>{if(e.target.closest('button,input,.dae-column-divider'))return;const th=e.target.closest('th[data-column]');if(th&&root.contains(th)&&active()){selected={kind:'column',field:th.dataset.column};rename();}};
    const showPreview=e=>preview(e.detail);
    const columnMenu=e=>{selected={kind:'column',field:e.detail.field};signature='';tick();};
    root.addEventListener('dae-column-menu',columnMenu);
    const escape=e=>{if(e.key==='Escape'&&!e.target.matches('input,textarea,select')){selected=null;toolbar.hidden=true;}};
    for(const type of ['pointerdown','focusin'])document.addEventListener(type,choose,true);
    document.addEventListener('keydown',escape,true);root.addEventListener('dblclick',double);root.addEventListener('dae-preview',showPreview);
    const timer=setInterval(tick,100);
    return {close(){selected=null;toolbar.hidden=true;},destroy(){disposed=true;clearInterval(timer);toolbar.remove();for(const type of ['pointerdown','focusin'])document.removeEventListener(type,choose,true);document.removeEventListener('keydown',escape,true);root.removeEventListener('dblclick',double);root.removeEventListener('dae-preview',showPreview);root.removeEventListener('dae-column-menu',columnMenu);}};
}
