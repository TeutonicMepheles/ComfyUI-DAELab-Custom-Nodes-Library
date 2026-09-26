import {FIELD_TYPES,reorderShot,transferCell,setCell} from './daelab_storyboard_table_model.mjs?v=20260926-table1';
import {localImageFromDrop} from './badge_image_drop_87.mjs?v=20260926-table1';
import {stopCanvasPropagation} from './list_editor_controls.mjs';

const MIME='application/x-daelab-storyboard';
let activeDrag=null;
let scrollFrame=null,scrollTarget=null;
function finishDrag() {
    activeDrag=null;scrollTarget=null;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);
    scrollFrame=null;
    document.querySelectorAll('[data-storyboard-drop]').forEach(clear);
}
function trackScroll(element,event) {
    if(!activeDrag)return;
    const shell=element.closest('.daelab-storyboard-panel')?.querySelector('[data-storyboard-scroll]');
    if(!shell)return;
    scrollTarget={shell,y:event.clientY};
    if(scrollFrame!==null)return;
    const tick=()=>{
        if(!activeDrag || !scrollTarget){scrollFrame=null;return;}
        const {shell,y}=scrollTarget,rect=shell.getBoundingClientRect();
        const speed=y<rect.top+32?-12:y>rect.bottom-32?12:0;
        if(speed)shell.scrollTop+=speed;
        scrollFrame=requestAnimationFrame(tick);
    };
    scrollFrame=requestAnimationFrame(tick);
}
function owner(node) {return node.__storyboardDragOwner ??= crypto.randomUUID();}
function packet(event) {try{return JSON.parse(event.dataTransfer.getData(MIME));}catch{return null;}}
function handle(label, payload, node) {
    const button=document.createElement('button');button.type='button';button.textContent='⠿';
    button.title=label;button.setAttribute('aria-label',label);button.draggable=true;
    button.style.cssText='cursor:grab;padding:0 4px;border:1px solid #556070;border-radius:3px;background:#303947;color:#adc8df;font-size:13px';
    button.addEventListener('pointerdown',stopCanvasPropagation);
    button.addEventListener('dragstart',event=>{event.stopPropagation();activeDrag={...payload,owner:owner(node)};event.dataTransfer.setData(MIME,JSON.stringify(activeDrag));event.dataTransfer.effectAllowed='move';});
    button.addEventListener('dragend',finishDrag);
    return button;
}
function highlight(element,event) {event.preventDefault();event.stopPropagation();trackScroll(element,event);element.style.outline='2px solid #5fb9ef';element.dataset.storyboardDrop='true';}
function clear(element) {element.style.outline='';if(element.tagName==='TR'){element.style.borderTop='';element.style.borderBottom='';}delete element.dataset.storyboardDrop;}

function conflictChoice(swap) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','调整单元格');
        dialog.style.cssText="background:#252d38;color:#eee;border:1px solid #657283;border-radius:10px;padding:24px;font-family:'Alibaba PuHuiTi 3',sans-serif";
        const text=document.createElement('p');text.textContent=swap?'目标已有内容，交换两格，还是移动并替换目标？':'目标已有内容，是否替换？';dialog.append(text);
        const done=value=>{dialog.remove();resolve(value);};
        for(const [value,label] of [...(swap?[['swap','交换']]:[]),['replace',swap?'移动并替换':'替换'],[null,'取消']]) {
            const button=document.createElement('button');button.textContent=label;button.style.cssText='padding:7px 14px;margin:4px';button.onclick=()=>done(value);dialog.append(button);
        }
        dialog.oncancel=e=>{e.preventDefault();done(null);};dialog.addEventListener('pointerdown',stopCanvasPropagation);
        document.body.append(dialog);dialog.showModal();
    });
}

export function attachRowDrag(node,row,shot,index,firstCell,commit) {
    row.dataset.shotId=shot.id;
    const grip=handle(`拖动分镜第 ${index+1} 行`,{kind:'row',id:shot.id},node);grip.dataset.dragKind='row';
    grip.textContent='↕';
    const label=document.createElement('small');label.textContent=`第 ${index+1} 行 `;label.style.color='#98a8b8';
    firstCell.prepend(label,grip);
    row.addEventListener('dragover',e=>{if(activeDrag?.kind==='row' && activeDrag.owner===owner(node)){highlight(row,e);const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;row.style.borderBottom=after?'3px solid #5fb9ef':'';row.style.borderTop=after?'':'3px solid #5fb9ef';}});
    row.addEventListener('dragleave',()=>{clear(row);row.style.borderBottom='';row.style.borderTop='';});
    row.addEventListener('drop',e=>{
        const p=packet(e);if(p?.kind!=='row')return;e.preventDefault();e.stopPropagation();finishDrag();clear(row);
        if(p.owner!==owner(node))return;
        const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
        if(reorderShot(node.__daelabStoryboardState,p.id,shot.id,after))commit();
    });
}

export function attachCellDrag(node,cell,shot,field,{commit,upload,notify}) {
    cell.dataset.field=field;
    const grip=handle(`拖动${field==='image_url'?'参考图':'单元格内容'}`,{kind:'cell',id:shot.id,field},node);
    grip.dataset.dragKind='cell';cell.prepend(grip);
    cell.addEventListener('dragover',e=>{
        if(activeDrag?.kind==='row')return;
        if(activeDrag?.kind==='column')return;
        if(activeDrag && (activeDrag.owner!==owner(node)||FIELD_TYPES[activeDrag.field]!==FIELD_TYPES[field]))return;
        highlight(cell,e);
    });
    cell.addEventListener('dragleave',()=>clear(cell));
    cell.addEventListener('drop',async e=>{
        const p=packet(e);if(p?.kind==='row'||p?.kind==='column')return;
        if(!p && /\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(e.dataTransfer.files?.[0]?.name || ''))return;
        e.preventDefault();e.stopPropagation();finishDrag();clear(cell);
        if(node.__storyboardDropBusy)return;
        const state=node.__daelabStoryboardState,snapshot=JSON.stringify(state);
        const unchanged=()=>node.graph && node.__daelabStoryboardState===state && JSON.stringify(state)===snapshot;
        try {
            if(p) {
                if(p.owner!==owner(node)||FIELD_TYPES[p.field]!==FIELD_TYPES[field])throw new Error('请在同一张表的同类型单元格之间拖动');
                if(p.id===shot.id && p.field===field)return;
                const source=state.shots.find(s=>s.id===p.id);
                if(!source?.[p.field])return;
                node.__storyboardDropBusy=true;
                const mode=shot[field]?await conflictChoice(true):'move';
                if(!mode)return;
                if(!unchanged())throw new Error('表格已变化，请重新拖动');
                if(transferCell(state,p.id,p.field,shot.id,field,mode))commit();
                return;
            }
            const files=Array.from(e.dataTransfer.files || []);
            if(files.length>1)throw new Error('每格请拖入一张图片');
            const local=localImageFromDrop(e.dataTransfer,location.href);
            let value=null,file=files[0];
            if(field==='image_url') {
                if(file && !file.type.startsWith('image/'))throw new Error('参考图单元格只接受图片');
                if(local)value='/view?'+new URLSearchParams(local);
                if(!file && !local)throw new Error('请拖入本地图片文件或 ComfyUI 图片预览');
            } else {
                if(file || local)throw new Error('请把图片拖到参考图单元格');
                value=e.dataTransfer.getData('text/plain');if(!value)return;
            }
            node.__storyboardDropBusy=true;
            if(shot[field] && !await conflictChoice(false))return;
            if(!unchanged())throw new Error('表格已变化，请重新拖动');
            if(file)value=await upload(file);
            if(!unchanged())throw new Error('上传期间表格已变化，未替换内容，请重试');
            setCell(shot,field,value);commit();
        } catch(error) {notify(String(error.message || error));}
        finally {node.__storyboardDropBusy=false;}
    });
}

export function attachColumnDrag(node,header,field,commit) {
    header.dataset.column=field;header.prepend(handle('拖动列标题',{kind:'column',field},node));
    header.addEventListener('dragover',e=>{if(activeDrag?.kind==='column' && activeDrag.owner===owner(node))highlight(header,e);});
    header.addEventListener('dragleave',()=>clear(header));
    header.addEventListener('drop',e=>{
        const p=packet(e);if(p?.kind!=='column')return;e.preventDefault();e.stopPropagation();finishDrag();clear(header);
        if(p.owner!==owner(node)||p.field===field)return;
        const order=node.__daelabStoryboardState.column_order;
        if(!order.includes(p.field)||!order.includes(field))return;
        order.splice(order.indexOf(p.field),1);order.splice(order.indexOf(field),0,p.field);commit();
    });
}
