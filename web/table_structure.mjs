import {addGenerationColumn} from './table_generation_model.mjs';
import {addField,addRecord,emptyValue} from './data_table_model.mjs?v=20260930-inline4';
import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20260930-structure9';
import {moveRows,moveColumn} from './table_structure_model.mjs';

const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;};

// Instance-owned UI; all writes go through the editor's existing transaction.
export function attachTableStructure({root,shell,table,getTable,change,notify}) {
    root.dataset.structure='true';
    const events=new AbortController(),listen=(node,type,fn,options={})=>node.addEventListener(type,fn,{...options,signal:events.signal});
    let drag=null,frame=0,popup=null,disposed=false;
    const rows=()=>[...table.querySelectorAll('tbody>tr[data-record-id]')];
    const headers=()=>[...table.querySelectorAll('th[data-column]')];
    const control=(label,action,cls)=>{const node=button(label,action);node.classList.add('table-structure-control',cls);return node;};
    const focusCell=(record,field)=>queueMicrotask(()=>{
        const cell=[...root.querySelectorAll('td[data-field]')].find(node=>node.dataset.record===record&&node.dataset.field===field);
        cell?.focus({preventScroll:true});cell?.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    const restoreHandle=(kind,id)=>queueMicrotask(()=>{
        const handle=[...root.querySelectorAll('[data-structure-kind]')].find(node=>node.dataset.structureKind===kind&&node.dataset.structureId===id);
        handle?.focus({preventScroll:true});
    });
    function addRow(target=null,before=false){
        let id,field;
        try{change(t=>{
            if(t.records.length>=500)throw new Error('每张表最多 500 行');
            if(target&&!t.records.some(row=>row.id===target))throw new Error('目标行已变化，请重试');
            const row=addRecord(t,Object.fromEntries(t.fields.map(f=>[f.id,emptyValue(f)])));
            row.selected=false;id=row.id;field=t.fields.find(f=>!f.hidden&&!f.readonly)?.id;
            if(target)moveRows(t,[id],target,!before);
        });focusCell(id,field);}catch(error){notify(error.message);}
    }
    function closeColumn(restore=false){
        if(!popup)return;const {node,anchor}=popup;popup=null;delete root.dataset.structurePopup;node.remove();
        if(restore&&anchor.isConnected)anchor.focus({preventScroll:true});
    }
    function positionColumn(){
        if(!popup)return;const {node,anchor}=popup;
        if(!anchor.isConnected||!root.getClientRects().length){closeColumn();return;}
        const r=anchor.getBoundingClientRect(),w=node.offsetWidth,h=node.offsetHeight;
        node.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';
        node.style.top=Math.max(12,Math.min(r.bottom+8,innerHeight-h-12))+'px';
    }
    function openColumn(anchor,target=null,before=false){
        closeColumn();const node=el('form','dae-ui table-column-popover');node.popover='auto';
        node.setAttribute('role','dialog');node.setAttribute('aria-label','新增列');
        const title=el('strong','',target?(before?'在左侧插入列':'在右侧插入列'):'新增列');
        const name=el('input',''),type=el('select','');name.required=true;name.maxLength=100;name.value=`列 ${getTable().fields.length+1}`;name.setAttribute('aria-label','列名称');
        for(const [value,label] of [['content','内容 · 文字或单个素材'],['generation','生成'],['text','文本'],['number','数字'],['checkbox','勾选']])type.add(new Option(label,value));
        type.setAttribute('aria-label','列类型');
        const label=(text,input)=>{const item=el('label','',text);item.append(input);return item;};
        const error=el('p','table-column-error');error.setAttribute('role','status');
        const actions=el('div','table-column-actions');
        const create=button('创建',()=>save(),true),cancel=button('取消',()=>closeColumn(true));actions.append(cancel,create);
        node.append(title,label('列名称',name),label('列类型',type),error,actions);
        function save(){
            if(!name.value.trim()){error.textContent='请输入列名称';name.focus();return;}
            let id,record;
            try{change(t=>{
                if(target&&!t.fields.some(f=>f.id===target))throw new Error('目标列已被删除，请重新选择位置');
                const spec={name:name.value.trim(),type:type.value,width:300,...(type.value==='content'?{maxItems:1}:{})};const f=type.value==='generation'?addGenerationColumn(t,spec):addField(t,spec);id=f.id;
                if(target)moveColumn(t,id,target,!before);
                for(const row of t.records)row.values[id]=emptyValue(f);
                record=t.records[0]?.id;
            });closeColumn();if(record)focusCell(record,id);else restoreHandle('column',id);if(type.value==='generation')root.dispatchEvent(new CustomEvent('dae-generation-created',{detail:{fieldId:id}}));}catch(e){error.textContent=e.message;}
        }
        node.onsubmit=e=>{e.preventDefault();save();};
        node.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeColumn(true);}else if(e.key==='Enter'&&e.target===name&&!e.isComposing){e.preventDefault();save();}};
        node.onpointerdown=e=>e.stopPropagation();
        node.addEventListener('toggle',e=>{if(e.newState==='closed'&&popup?.node===node)closeColumn();});
        document.body.append(node);popup={node,anchor};root.dataset.structurePopup='true';node.showPopover();positionColumn();name.focus();name.select();
    }
    listen(root,'dae-add-column',e=>{e.stopPropagation();openColumn(e.detail.anchor,e.detail.target,e.detail.before);});
    listen(root,'dae-add-row',e=>{e.stopPropagation();addRow(e.detail?.target,e.detail?.before);});
    listen(window,'resize',positionColumn);listen(document,'scroll',positionColumn,{capture:true,passive:true});

    const trailing=el('th','table-add-column');trailing.scope='col';
    const addColumn=control('＋',e=>openColumn(e.currentTarget),'table-add-column-button');addColumn.title='新增列';addColumn.setAttribute('aria-label','新增列');trailing.append(addColumn);table.tHead.rows[0].append(trailing);
    const col=el('col','');col.style.width='48px';table.querySelector('colgroup').append(col);
    for(const row of rows())row.append(el('td','table-trailing-cell'));
    const foot=table.createTFoot(),footRow=foot.insertRow(),footCell=footRow.insertCell();footCell.colSpan=headers().length+2;footCell.className='table-add-row-cell';
    footCell.append(control('＋ 新增行',()=>addRow(),'table-add-row'));
    // Keep terminal actions inside the visible canvas intersection, even when
    // the canvas pans a full-height table rather than scrolling its contents.
    let pinFrame=0,columnOffset={x:0,y:0},rowOffset=0;
    function pinActions(){
        if(disposed)return;
        if(root.getClientRects().length){
            const view=root.closest('.dae-creative')?.getBoundingClientRect();
            const bounds=shell.getBoundingClientRect(),scale=bounds.width/shell.offsetWidth||1;
            const left=Math.max(bounds.left,view?.left||0),right=Math.min(bounds.right,view?.right||innerWidth,innerWidth);
            const top=Math.max(bounds.top,view?.top||0),bottom=Math.min(bounds.bottom,(view?.bottom||innerHeight)-64,innerHeight-12);
            const c=trailing.getBoundingClientRect(),f=footCell.getBoundingClientRect();
            const naturalRight=c.right-columnOffset.x*scale,naturalTop=c.top-columnOffset.y*scale;
            const naturalBottom=f.bottom-rowOffset*scale;
            columnOffset={x:Math.min(0,(right-naturalRight)/scale),y:Math.max(0,(top-naturalTop)/scale)};
            rowOffset=Math.min(0,(bottom-naturalBottom)/scale);
            const visible=right-left>80&&bottom-top>90;
            trailing.style.transform=visible?`translate(${columnOffset.x}px,${columnOffset.y}px)`:'';
            footCell.style.transform=visible?`translateY(${rowOffset}px)`:'';
            if(!visible){columnOffset={x:0,y:0};rowOffset=0;}
        }
        pinFrame=requestAnimationFrame(pinActions);
    }
    pinFrame=requestAnimationFrame(pinActions);

    const corner=table.querySelector('th.table-choice');corner.querySelector('input').title='选择全部行';
    for(const row of rows()){
        const id=row.dataset.recordId,number=getTable().records.findIndex(r=>r.id===id)+1,gutter=row.querySelector('.table-choice'),old=row.querySelector('.row-grip');
        old?.remove();gutter.dataset.structureGutter='true';row.dataset.rowSelected=String(!!getTable().records.find(r=>r.id===id)?.selected);
        const handle=makeHandle('row',id,`移动第 ${number} 行`);gutter.prepend(handle);
    }
    for(const header of headers()){
        header.draggable=false;header.ondragover=header.ondrop=null;
        const id=header.dataset.column,field=getTable().fields.find(f=>f.id===id);
        header.prepend(makeHandle('column',id,`移动列 ${field.name}`));
        const old=header.querySelector('.field-settings');old?.remove();
        const menu=control('列操作',()=>{header.querySelector('.field-title')?.focus();root.dispatchEvent(new CustomEvent('dae-column-menu',{bubbles:true,detail:{field:id}}));},'table-column-menu');
        tableIcon(menu,'arrow-down-line',`${field.name} 列操作`);header.append(menu);
    }
    function makeHandle(kind,id,label){
        const handle=control('',()=>{},'table-move-handle');tableIcon(handle,'draggable',label);
        handle.dataset.structureKind=kind;handle.dataset.structureId=id;handle.title=label+' · 拖动，或 Alt + 方向键';handle.draggable=false;
        listen(handle,'pointerdown',e=>start(e,kind,id,handle));
        listen(handle,'keydown',e=>{
            const keys=kind==='row'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
            if(!e.altKey||!keys.includes(e.key))return;e.preventDefault();e.stopPropagation();
            const t=getTable(),items=kind==='row'?t.records:t.fields.filter(f=>!f.hidden),ids=kind==='row'&&items.find(r=>r.id===id)?.selected?items.filter(r=>r.selected).map(r=>r.id):[id];
            const direction=e.key===keys[0]?-1:1,positions=items.flatMap((item,i)=>ids.includes(item.id)?[i]:[]),at=direction<0?Math.min(...positions)-1:Math.max(...positions)+1,target=items[at];
            if(target){change(next=>kind==='row'?moveRows(next,ids,target.id,direction>0):moveColumn(next,id,target.id,direction>0));restoreHandle(kind,id);}
        });return handle;
    }
    const guide=el('div','dae-ui table-structure-guide'),ghost=el('div','dae-ui table-structure-ghost');guide.hidden=ghost.hidden=true;document.body.append(guide,ghost);
    function start(e,kind,id,handle){
        if(e.button!==0||drag)return;e.preventDefault();e.stopPropagation();closeColumn();handle.focus({preventScroll:true});
        const t=getTable(),ids=kind==='row'&&t.records.find(row=>row.id===id)?.selected?t.records.filter(row=>row.selected).map(row=>row.id):[id];
        drag={kind,id,ids,handle,pointer:e.pointerId,x:e.clientX,y:e.clientY,initialX:e.clientX,initialY:e.clientY,snapshot:JSON.stringify(t),moving:false,target:null,last:performance.now()};
        handle.setPointerCapture(e.pointerId);frame=requestAnimationFrame(tick);
    }
    function updateTarget(){
        guide.hidden=true;drag.target=null;
        const r=table.getBoundingClientRect(),s=shell.getBoundingClientRect();
        if(drag.x<Math.max(0,s.left)||drag.x>Math.min(innerWidth,s.right)||drag.y<Math.max(0,s.top)||drag.y>Math.min(innerHeight,s.bottom))return;
        const candidates=(drag.kind==='row'?rows():headers()).filter(node=>!drag.ids.includes(node.dataset.recordId||node.dataset.column));
        if(!candidates.length)return;
        let target=candidates.find(node=>{const b=node.getBoundingClientRect();return drag.kind==='row'?drag.y<b.top+b.height/2:drag.x<b.left+b.width/2;}),after=false;
        if(!target){target=candidates.at(-1);after=true;}
        const b=target.getBoundingClientRect();drag.target={id:target.dataset.recordId||target.dataset.column,after};guide.dataset.axis=drag.kind;
        if(drag.kind==='row'){
            guide.style.left=Math.max(s.left,0)+'px';guide.style.top=(after?b.bottom:b.top)+'px';guide.style.width=Math.max(0,Math.min(s.right,innerWidth)-Math.max(s.left,0))+'px';guide.style.height='2px';
        }else{
            guide.style.left=(after?b.right:b.left)+'px';guide.style.top=Math.max(r.top,0)+'px';guide.style.width='2px';guide.style.height=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0))+'px';
        }guide.hidden=false;
    }
    function tick(now){
        if(!drag||disposed)return;
        if(!root.getClientRects().length||root.closest('[inert],[hidden]')||JSON.stringify(getTable())!==drag.snapshot){finish(true);return;}
        const elapsed=Math.min(0.04,(now-drag.last)/1000);drag.last=now;
        if(drag.moving){
            const r=shell.getBoundingClientRect(),edge=36,speed=(value,low,high)=>value<low+edge?-Math.min(1,(low+edge-value)/edge):value>high-edge?Math.min(1,(value-high+edge)/edge):0;
            const dx=speed(drag.x,Math.max(0,r.left),Math.min(innerWidth,r.right))*elapsed*520,dy=speed(drag.y,Math.max(0,r.top),Math.min(innerHeight,r.bottom))*elapsed*520;
            if(drag.kind==='column')shell.scrollLeft+=dx;
            if(drag.kind==='row'&&dy){if(shell.scrollHeight>shell.clientHeight+2)shell.scrollTop+=dy;else root.closest('.dae-creative')?.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,bubbles:true,cancelable:true}));}
            ghost.style.left=Math.min(innerWidth-ghost.offsetWidth-8,Math.max(8,drag.x+16))+'px';ghost.style.top=Math.min(innerHeight-ghost.offsetHeight-8,Math.max(8,drag.y+16))+'px';updateTarget();
        }frame=requestAnimationFrame(tick);
    }
    listen(document,'pointermove',e=>{
        if(!drag||e.pointerId!==drag.pointer)return;drag.x=e.clientX;drag.y=e.clientY;
        if(!drag.moving&&Math.hypot(drag.x-drag.initialX,drag.y-drag.initialY)>5){
            drag.moving=true;root.dataset.structureDragging='true';ghost.replaceChildren();
            const t=getTable(),row=t.records.find(r=>r.id===drag.id),field=t.fields.find(f=>f.id===drag.id);
            const text=drag.kind==='row'?`移动 ${drag.ids.length} 行`:field.name;
            const asset=row&&Object.values(row.values).flat().find(value=>value&&typeof value==='object'&&value.kind==='image'&&value.url);
            if(asset){const image=el('img','');image.src=asset.url;image.alt='';ghost.append(image);}
            ghost.append(el('span','',text));ghost.hidden=false;
            (drag.kind==='row'?rows():headers()).filter(node=>drag.ids.includes(node.dataset.recordId||node.dataset.column)).forEach(node=>node.dataset.structureMoving='true');
        }
    },{capture:true});
    function finish(cancel=false){
        if(!drag)return;const state=drag;drag=null;cancelAnimationFrame(frame);frame=0;guide.hidden=ghost.hidden=true;delete root.dataset.structureDragging;
        table.querySelectorAll('[data-structure-moving]').forEach(node=>delete node.dataset.structureMoving);
        if(state.handle.hasPointerCapture(state.pointer))state.handle.releasePointerCapture(state.pointer);
        if(!cancel&&state.moving&&state.target&&JSON.stringify(getTable())===state.snapshot){
            try{change(t=>state.kind==='row'?moveRows(t,state.ids,state.target.id,state.target.after):moveColumn(t,state.id,state.target.id,state.target.after));restoreHandle(state.kind,state.id);}catch(e){notify(e.message);}
        }
    }
    listen(document,'pointerup',e=>{if(drag&&e.pointerId===drag.pointer){drag.x=e.clientX;drag.y=e.clientY;updateTarget();finish();}},{capture:true});
    listen(document,'pointercancel',()=>finish(true),{capture:true});
    listen(root,'lostpointercapture',()=>finish(true));
    listen(document,'keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}},{capture:true});
    listen(window,'blur',()=>finish(true));
    return {dispose(){disposed=true;cancelAnimationFrame(pinFrame);finish(true);closeColumn();events.abort();guide.remove();ghost.remove();delete root.dataset.structure;}};
}
