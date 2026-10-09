import {addField,addRecord,clone,uid,removeField} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {tableButton as button} from './data_table_editor.mjs?v=20261009-review-r6';
import {localImageFromDrop} from './badge_image_drop_87.mjs';

export function addAssetGroup(table) {
    const groups=table.meta.asset_groups ||= [],field=addField(table,{name:`素材组 ${groups.length+1}`,type:'assets',width:170});
    groups.push({id:uid(),field_id:field.id,name:field.name,mode:'sequence',required:true,items:[]});return groups.at(-1);
}
export function applyAssetGroups(table) {
    const groups=(table.meta.asset_groups||[]).filter(g=>g.items.length||g.required!==false);
    if(!groups.length || groups.some(g=>!g.items.length))throw new Error('请给每个素材组添加图片');
    const count=Math.max(table.records.length,...groups.filter(g=>g.mode==='sequence').map(g=>g.items.length),1);
    if(count>500)throw new Error('每张表最多 500 行');
    for(const g of groups){if(!table.fields.some(f=>f.id===g.field_id&&f.type==='assets'&&!f.readonly))throw new Error(`“${g.name}”需要可编辑的素材字段`);if(g.mode==='sequence'&&g.required!==false&&g.items.length!==count)throw new Error(`“${g.name}”有 ${g.items.length} 张图，需要 ${count} 张；公共参考请选择“每行共用”。`);}
    while(table.records.length<count)addRecord(table);
    table.records.forEach((r,i)=>{for(const g of groups)r.values[g.field_id]=clone(g.mode==='shared'?g.items:g.items[i]?[g.items[i]]:[]);});
}
export function createAssetGroups({getTable,change,upload,notify}) {
    const owner=uid(),root=document.createElement('section');root.className='studio-groups';let busy=false;
    const groups=()=>getTable().meta.asset_groups||[];
    function edit(id,fn){change(t=>{const g=t.meta.asset_groups.find(g=>g.id===id);if(!g)throw new Error('素材组已删除');fn(g,t);});render();}
    async function addFiles(id,files){if(busy)return;busy=true;const snapshot=JSON.stringify(getTable());try{const items=[];for(const f of files){if(!/\.(png|jpe?g|webp)$/i.test(f.name))throw new Error('暂支持 PNG、JPG、WebP');items.push({id:uid(),url:await upload(f),name:f.name});}if(snapshot!==JSON.stringify(getTable()))throw new Error('表格已变化，未填入上传结果');edit(id,g=>g.items.push(...items));}catch(e){notify(e.message);}finally{busy=false;}}
    function render(){
        root.replaceChildren();const hint=document.createElement('p');hint.className='studio-hint';hint.textContent='素材组填入普通素材字段。逐行分配按图片顺序填行；每行共用将整组填入所有行。之后每格都能独立编辑。可选组允许部分行留空；逐行图数不足时，其余行留空。用于视频生成时，请在任务表列头点击图钉“标记参考”。';
        const toolbar=document.createElement('div');toolbar.className='studio-group-head';toolbar.append(button('＋ 新建素材组',()=>{change(addAssetGroup);render();}),button('填入任务表',()=>{if(getTable().records.some(r=>groups().some(g=>r.values[g.field_id]?.length))&&!window.confirm('替换素材组对应字段的所有内容？可撤销。'))return;try{change(applyAssetGroups);notify('已填入表格');}catch(e){notify(e.message);}},true));root.append(hint,toolbar);
        for(const g of groups()){
            const card=document.createElement('section');card.className='studio-group';card.dataset.groupId=g.id;const head=document.createElement('div');head.className='studio-group-head';
            const name=document.createElement('input');name.value=getTable().fields.find(f=>f.id===g.field_id)?.name||g.name;name.setAttribute('aria-label','素材组名称');name.onchange=()=>edit(g.id,(group,t)=>{group.name=name.value.trim()||'素材组';const f=t.fields.find(f=>f.id===group.field_id);if(f)f.name=group.name;});
            const mode=document.createElement('select');mode.setAttribute('aria-label','分配方式');mode.add(new Option('逐行分配','sequence'));mode.add(new Option('每行共用','shared'));mode.value=g.mode;mode.onchange=()=>edit(g.id,x=>x.mode=mode.value);
            const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.accept='.png,.jpg,.jpeg,.webp';picker.hidden=true;picker.onchange=()=>{void addFiles(g.id,[...picker.files]);};
            const required=document.createElement('select');required.setAttribute('aria-label','素材组要求');required.add(new Option('必填','required'));required.add(new Option('可选','optional'));required.value=g.required===false?'optional':'required';required.onchange=()=>edit(g.id,x=>x.required=required.value==='required');
            head.append(name,mode,required,button('＋ 图片',()=>picker.click()),button('删除组',()=>{if(!window.confirm('删除素材组及其字段？可撤销。'))return;change(t=>{removeField(t,g.field_id);});render();}),picker);card.append(head);
            const assets=document.createElement('div');assets.className='studio-assets';if(!g.items.length)assets.textContent='上传图片，或拖入 Comfy 本地图片预览';
            for(const [i,a] of g.items.entries()){
                const tile=document.createElement('div');tile.className='studio-asset';tile.draggable=true;const img=document.createElement('img');img.src=a.url;img.alt=a.name;img.draggable=false;const name=document.createElement('small');name.textContent=`${i+1} · ${a.name}`;tile.append(img,name,button('移除',()=>edit(g.id,x=>x.items=x.items.filter(v=>v.id!==a.id))));
                tile.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('application/x-daelab-group-item',JSON.stringify({owner,group:g.id,item:a.id}));};tile.ondragover=e=>e.preventDefault();tile.ondrop=e=>{const raw=e.dataTransfer.getData('application/x-daelab-group-item');if(!raw)return;e.preventDefault();e.stopPropagation();try{const p=JSON.parse(raw);if(p.owner!==owner||p.group!==g.id)return;edit(g.id,x=>{const from=x.items.findIndex(v=>v.id===p.item);if(from<0||from===i)return;const [a]=x.items.splice(from,1);x.items.splice(i,0,a);});}catch{}};assets.append(tile);
            }
            card.ondragover=e=>{e.preventDefault();e.stopPropagation();};card.ondrop=e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length){void addFiles(g.id,[...e.dataTransfer.files]);return;}const ref=localImageFromDrop(e.dataTransfer,location.href);if(ref)edit(g.id,x=>x.items.push({id:uid(),url:'/view?'+new URLSearchParams(ref),name:ref.filename}));};card.append(assets);root.append(card);
        }
    }
    render();return {root,render};
}
