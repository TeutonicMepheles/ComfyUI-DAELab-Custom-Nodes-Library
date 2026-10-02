export const materialReferenceLabel=(asset,index)=>`${asset.kind==='video'?'视频':'图片'}${index+1}${asset.name?' · '+asset.name:''}`;
export function columnReferenceOptions(table,row){
    return table.fields.filter(f=>(!f.readonly||f.presentation==='generation')&&f.presentation!=='prompt'&&['assets','content'].includes(f.type)&&Array.isArray(row?.values[f.id])&&row.values[f.id].length).map(f=>{
        const value=row.values[f.id];
        if(value.length===1)return {...f,assetIndex:0,asset:value[0]};
        return {...f,children:value.map((asset,assetIndex)=>({...f,assetIndex,asset}))};
    });
}

// Both inline prompts and the expanded editor use the same column/ordinal picker.
export function createReferenceMenu({options,onChoose,onLayout=()=>{}}){
    const root=document.createElement('div');root.className='dae-ui dae-inline-columns';root.id='columns-'+crypto.randomUUID();root.setAttribute('role','menu');root.setAttribute('aria-label','引用列');
    const columns=document.createElement('div'),items=document.createElement('div');columns.className='dae-reference-columns';items.className='dae-reference-items';items.hidden=true;items.setAttribute('role','menu');items.setAttribute('aria-label','素材序号');root.append(columns,items);
    let index=0,child=-1,opened=-1,activeColumn=null,expandedColumn=null,activeItem=null;
    function layout(){
        if(items.hidden||!root.getClientRects().length)return;
        const bounds=root.getBoundingClientRect(),anchor=columns.children[opened].getBoundingClientRect(),width=items.getBoundingClientRect().width;
        const left=bounds.right+width<=innerWidth-8?bounds.right:bounds.left-width;
        items.style.left=Math.max(8,Math.min(left,innerWidth-width-8))+'px';
        items.style.top=Math.max(8,Math.min(anchor.top,innerHeight-items.getBoundingClientRect().height-8))+'px';
    }
    columns.addEventListener('scroll',layout);
    function mark(){
        const column=columns.children[index],expanded=columns.children[opened],item=items.children[child];
        if(activeColumn!==column){if(activeColumn)activeColumn.dataset.active='false';if(column)column.dataset.active='true';activeColumn=column;}
        if(expandedColumn!==expanded){expandedColumn?.setAttribute('aria-expanded','false');expanded?.setAttribute('aria-expanded','true');expandedColumn=expanded;}
        if(activeItem!==item){if(activeItem)activeItem.dataset.active='false';if(item)item.dataset.active='true';activeItem=item;}
    }
    function show(i){
        index=i;child=-1;if(opened===i){mark();return;}const children=options[i]?.children;opened=children?i:-1;items.replaceChildren();items.hidden=!children;
        if(children){
            children.forEach((option,n)=>{const b=makeButton(materialReferenceLabel(option.asset,option.assetIndex),()=>onChoose(option));b.id=root.id+'-item-'+n;b.title=option.asset.name||'素材';
                const media=document.createElement(option.asset.kind==='video'?'video':'img');if(option.asset.kind==='video')media.preload='metadata';else{media.loading='lazy';media.decoding='async';}media.src=option.asset.url;media.setAttribute('aria-hidden','true');b.prepend(media);
                b.onpointerenter=()=>{child=n;mark();};items.append(b);
            });
        }
        mark();onLayout();layout();
    }
    function makeButton(label,choose){const b=document.createElement('button');b.type='button';b.tabIndex=-1;b.setAttribute('role','menuitem');b.textContent=label;b.onpointerdown=e=>e.preventDefault();b.onclick=e=>{e.stopPropagation();choose();};return b;}
    options.forEach((option,i)=>{const b=makeButton('@'+option.name+(option.asset?' · '+materialReferenceLabel(option.asset,option.assetIndex):option.children?' ›':''),()=>{if(option.children)show(i);else onChoose(option);});b.id=root.id+'-'+i;if(option.asset)b.title=option.asset.name||'素材';if(option.children)b.setAttribute('aria-haspopup','menu');b.onpointerenter=()=>{if(index!==i||opened!==i)show(i);};columns.append(b);});
    mark();
    return {root,layout,get activeId(){return child>=0?items.children[child]?.id:columns.children[index]?.id;},keydown(key){
        if(!options.length)return false;
        if(key==='ArrowRight'){show(index);if(options[index].children?.length)child=0;mark();return true;}
        if(key==='ArrowLeft'){child=-1;items.hidden=true;opened=-1;mark();onLayout();return true;}
        if(key==='ArrowDown'||key==='ArrowUp'){
            const step=key==='ArrowDown'?1:-1;
            if(child>=0){child=(child+step+options[index].children.length)%options[index].children.length;mark();items.children[child]?.scrollIntoView({block:'nearest'});}
            else{show((index+step+options.length)%options.length);columns.children[index]?.scrollIntoView({block:'nearest'});}return true;
        }
        if(key==='Enter'){if(child>=0)onChoose(options[index].children[child]);else if(options[index].children){show(index);if(options[index].children.length)child=0;mark();}else onChoose(options[index]);return true;}
        return false;
    }};
}
