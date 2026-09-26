import { applyGroups } from './daelab_storyboard_groups.mjs?v=20260926-batch1';
import { localImageFromDrop } from './badge_image_drop_87.mjs';

export function groupsPanel({getState, commit, upload, button, notify}) {
    const owner=crypto.randomUUID();
    const root = document.createElement('div'); root.className = 'studio-groups';
    const render = () => {
        root.replaceChildren();
        const state = getState();
        const hint = document.createElement('div'); hint.className = 'studio-hint';
        hint.textContent = '逐行分配：第 1 张给第 1 行。每行共用：整组图片用于所有行。\n调整后点击“填入任务表”才会改变任务；之后拖动整行，素材会跟着分镜走。';
        const tools = document.createElement('div'); tools.className = 'studio-group-head';
        tools.append(button('＋ 新建素材组', () => {state.asset_groups.push({id:crypto.randomUUID(), name:`素材组 ${state.asset_groups.length+1}`, mode:'sequence', items:[]});commit();}),
            button('填入任务表', () => {
                if (state.shots.some(s=>Object.keys(s.group_refs || {}).length) && !window.confirm('用当前素材组重新填入所有行？原有素材组分配会被替换，可撤销。')) return;
                try {applyGroups(state);commit();notify('已填入任务表，可切回检查每一行。');} catch(e){notify(e.message);}
            },true));
        root.append(hint,tools);
        for (const [gi,g] of state.asset_groups.entries()) {
            const card = document.createElement('section');card.className='studio-group';card.dataset.groupId=g.id;
            const head=document.createElement('div');head.className='studio-group-head';
            const name=document.createElement('input');name.value=g.name;name.setAttribute('aria-label','素材组名称');name.onchange=()=>{g.name=name.value.trim()||'素材组';commit();};
            const mode=document.createElement('select');mode.setAttribute('aria-label','分配方式');mode.add(new Option('逐行分配','sequence'));mode.add(new Option('每行共用','shared'));mode.value=g.mode;mode.onchange=()=>{g.mode=mode.value;commit();};
            const picker=document.createElement('input');picker.type='file';picker.accept='.png,.jpg,.jpeg,.webp';picker.multiple=true;picker.hidden=true;
            let busy=false;
            async function add(files) {
                if(busy)return;busy=true;
                const snapshot=JSON.stringify(state.asset_groups);uploadButton.disabled=true;
                try {
                    const added=[];
                    for(const file of files){if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('素材组目前支持 PNG、JPG、WebP 图片');added.push({id:crypto.randomUUID(),url:await upload(file),name:file.name});}
                    if(getState()!==state||JSON.stringify(state.asset_groups)!==snapshot)throw new Error('素材组已变化，未填入上传结果，请重试');
                    g.items.push(...added);commit();
                }catch(e){notify(e.message);}finally{busy=false;uploadButton.disabled=false;picker.value='';}
            }
            const uploadButton=button('＋ 图片',()=>picker.click());picker.onchange=()=>add([...picker.files]);
            const remove=button('删除组',()=>{if(state.shots.some(s=>s.group_refs?.[g.id]?.length)&&!window.confirm('删除该组及任务表中对应的素材列？可撤销。'))return;state.asset_groups.splice(gi,1);for(const s of state.shots)delete s.group_refs?.[g.id];commit();});
            const left=button('←',()=>{if(gi){[state.asset_groups[gi-1],state.asset_groups[gi]]=[g,state.asset_groups[gi-1]];commit();}});left.title='素材列前移';left.disabled=!gi;
            head.append(name,mode,uploadButton,left,remove,picker);card.append(head);
            const assets=document.createElement('div');assets.className='studio-assets';
            if(!g.items.length){assets.textContent='上传多张图片，或把 Comfy 图片预览拖到这里';assets.classList.add('studio-hint');}
            for(const [ai,a] of g.items.entries()){
                const tile=document.createElement('div');tile.className='studio-asset';tile.draggable=true;
                const image=document.createElement('img');image.src=a.url;image.draggable=false;image.alt=a.name;
                const label=document.createElement('small');label.textContent=`${ai+1} · ${a.name}`;label.title=a.name;
                const actions=document.createElement('nav');const up=button('←',()=>{[g.items[ai-1],g.items[ai]]=[a,g.items[ai-1]];commit();});up.disabled=!ai;up.title='图片前移';
                actions.append(up,button('移除',()=>{g.items.splice(ai,1);commit();}));tile.append(image,label,actions);
                tile.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('application/x-daelab-group-item',JSON.stringify({owner,group:g.id,item:a.id}));};
                tile.ondragover=e=>e.preventDefault();
                tile.ondrop=e=>{const raw=e.dataTransfer.getData('application/x-daelab-group-item');if(!raw)return;e.preventDefault();e.stopPropagation();try{const from=JSON.parse(raw);if(from.owner!==owner||from.group!==g.id)return;const at=g.items.findIndex(i=>i.id===from.item);if(at<0||at===ai)return;const [moved]=g.items.splice(at,1);g.items.splice(ai,0,moved);commit();}catch{}};
                assets.append(tile);
            }
            card.ondragover=e=>{e.preventDefault();e.stopPropagation();};
            card.ondrop=e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length){void add([...e.dataTransfer.files]);return;}const ref=localImageFromDrop(e.dataTransfer,location.href);if(ref){g.items.push({id:crypto.randomUUID(),url:'/view?'+new URLSearchParams(ref),name:ref.filename});commit();}};
            card.append(assets);root.append(card);
        }
    };
    return {root,render};
}
