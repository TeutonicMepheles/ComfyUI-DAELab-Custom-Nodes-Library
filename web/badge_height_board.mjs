import { refinedBadge87 } from './badge_refinement_87.mjs?v=20260916-height-1';
import { migrateHeightBoard, heightBoardPreview, heightAlpha, moveHeightColors, insertHeightTier, deleteHeightTier, fixedHeightBoard87, MAX_HEIGHT_SOLID_TIERS_87 } from './badge_height_board_model.mjs?v=20260916-height-1';

// Prototype-only state: the execution widget and its fixed six-level schema remain untouched.
export function createHeightBoard(graph, live, onPreview, onEdit) {
    const meta = () => graph.extra.daelabBadgePrototypeV1;
    let initial; try { initial = JSON.parse(graph.getNodeById(3)?.widgets?.find(w => w.name === 'badge_height_layer_v1_panel')?.value || '{}'); } catch { initial = {}; }
    const refined = refinedBadge87(graph);
    let board = structuredClone(meta().heightBoard || migrateHeightBoard(initial));
    if (refined) {
        board = fixedHeightBoard87(!meta().heightBoard && !initial.groups?.length ? undefined : board);
        meta().heightBoard = structuredClone(board);
    }
    let undo = null, dragging = null;
    const element = document.createElement('section'); element.className = 'badge-height-board';
    const el = (tag, text, parent) => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
    const btn = (text, parent, action) => { const b = el('button', text, parent); b.type = 'button'; b.onclick = action; return b; };
    const title = tier => refined ? (tier === 0 ? '0 · 镂空 / 无实体' : String(tier)) : tier === 0 ? '镂空 / 无实体' : tier === board.count ? '最高层' : tier === 1 ? '最低层' : `第 ${tier} 层`;
    function commit(next) {
        if (!live()) return;
        undo = structuredClone(board); graph.beforeChange?.(); board = refined ? fixedHeightBoard87(next) : next;
        meta().heightBoard = structuredClone(board); graph.afterChange?.(); render(); onEdit();
    }
    function change(id, patch) { commit({ ...board, groups: board.groups.map(g => g.id === id ? { ...g, ...patch } : g) }); }
    function tierOptions(select) { for (let tier = board.count; tier >= 0; tier--) { const o = el('option', title(tier), select); o.value = tier; } }
    let ghost = null;
    function clearDrag() { ghost?.remove(); ghost=null; dragging=null; element.querySelectorAll('[data-over]').forEach(r=>{delete r.dataset.over; delete r.dataset.dropLabel;}); }
    function bindDrag(handle, tier, groups, move) {
        let start=null;
        handle.style.touchAction='none'; handle.style.cursor='grab';
        handle.onpointerdown=e=>{if(e.button!==0)return;start=[e.clientX,e.clientY];handle.setPointerCapture(e.pointerId);e.preventDefault();};
        handle.onpointermove=e=>{
            if(!start || Math.hypot(e.clientX-start[0],e.clientY-start[1])<5)return;
            dragging=true;
            if(!ghost){ghost=el('div','',document.body);ghost.className='badge-height-drag-ghost';
                for(const g of groups){const s=el('span','',ghost);s.style.background=g.color;}
                el('b',`${move ? '交换整组' : '移入颜色'} · ${groups.length} 个颜色`,ghost);
            }
            ghost.style.left=`${e.clientX+16}px`;ghost.style.top=`${e.clientY+16}px`;
            element.querySelectorAll('[data-over]').forEach(r=>{delete r.dataset.over;delete r.dataset.dropLabel;});
            const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.badge-height-tier');
            if(target&&element.contains(target)&&(!move || Number(target.dataset.tier)>0)){
                target.dataset.over=move?'swap':'add';target.dataset.dropLabel=`${move ? '与' : '移入'}${title(Number(target.dataset.tier))}${move ? '交换全部颜色' : '，保留已有颜色'} · ${refined ? '高度值' : 'Alpha'} ${Math.round(heightAlpha(board,Number(target.dataset.tier))*100/255)}%`;
            }
            const scroller=element.closest('[data-badge-build]')||element,bounds=scroller.getBoundingClientRect();
            if(e.clientY>bounds.bottom-30)scroller.scrollTop+=12;
            if(e.clientY<bounds.top+30)scroller.scrollTop-=12;
        };
        handle.onpointerup=e=>{
            const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.badge-height-tier');
            const valid=dragging&&target&&element.contains(target),to=Number(target?.dataset.tier);start=null;clearDrag();
            if(valid&&to!==tier&&(!move||to>0)){if(move)commit(moveHeightColors(board,tier,to));else change(groups[0].id,{tier:to});}
        };
        handle.onpointercancel=()=>{start=null;clearDrag();};
        handle.onkeydown=e=>{if(e.key==='Escape'){start=null;clearDrag();}};
    }
    function render() {
        element.replaceChildren();
        const introduction = el('p','标注徽章的结构层次',element); introduction.className='badge-height-introduction';
        const header = el('div', '', element); header.className = 'badge-height-board-header';
        const count = el('div', '', header); count.className = 'badge-height-count'; count.setAttribute('role','group'); count.setAttribute('aria-label',refined ? '高度层数（含 0 层）' : '实体层数');
        el('span', `${board.count + (refined ? 1 : 0)} 层`, count);
        if (refined && board.count > MAX_HEIGHT_SOLID_TIERS_87) el('p', '最多六层（含顶层和 0 层）。请移动颜色并删除多余中间层，整理后才能生成。', element).setAttribute('role','alert');
        const u = btn('撤销', header, () => { if (undo) { const previous = undo; commit(previous); undo = null; render(); } }); u.disabled = !undo;
        const preview = btn('预览遮罩', header, onPreview); preview.className = 'badge-build-mask-preview'; preview.dataset.heightPreview = '';
        const fallbackLabel = el('label', '未分配区域 ', element); fallbackLabel.className = 'badge-height-fallback';
        const fallback = el('select', '', fallbackLabel); tierOptions(fallback); fallback.value = board.fallback;
        fallback.onchange = () => commit({ ...board, fallback: Number(fallback.value) });
        el('span', '整组拖动：交换两层颜色；单项拖动：加入目标层', fallbackLabel);
        for (let tier = board.count; tier >= 0; tier--) {
            const row = el('div', '', element); row.className = 'badge-height-tier'; row.dataset.tier = tier;
            const heading = el('div', '', row); heading.className = 'badge-height-tier-title';
            const swatch = el('span', '', heading); const gray = heightAlpha(board,tier); swatch.style.background = `rgb(${gray} ${gray} ${gray})`;
            el('strong', title(tier), heading);
            const alphaLabel = el('label', refined ? '高度值 ' : 'Alpha ', heading); alphaLabel.className = 'badge-height-alpha';
            const track = el('span','',alphaLabel); track.className = 'badge-height-alpha-track';
            const alpha = el('input', '', track); alpha.type = 'range'; alpha.min = tier === 0 ? 0 : 1; alpha.max = 10; alpha.step = 1; alpha.value = tier === 0 ? 0 : Math.max(1,Math.round(gray*10/255));
            const ticks = el('span','',track); ticks.className = 'badge-height-alpha-ticks'; ticks.setAttribute('aria-hidden','true');
            for(let i=0;i<10;i++) el('i','',ticks);
            alpha.setAttribute('aria-label', `${title(tier)} ${refined ? '高度值' : 'Alpha'}`); alpha.disabled = tier === 0 || (refined && tier === board.count);
            const alphaValue = el('output', '', alphaLabel); alphaValue.className = 'badge-height-alpha-value';
            const describe = () => { const text = `${Number(alpha.value)*10}%`; alphaValue.textContent = text; alpha.setAttribute('aria-valuetext',text); alpha.title = tier === 0 ? '镂空区域固定为 0%' : refined && tier === board.count ? '顶层固定为 100%' : `${refined ? '高度值' : 'Alpha'} ${text}`; };
            describe(); alpha.oninput = () => { describe(); const value=Math.round(Number(alpha.value)*255/10); swatch.style.background=`rgb(${value} ${value} ${value})`; };
            alpha.onchange = () => commit({...board, alphas:{...board.alphas,[tier]:Math.round(Number(alpha.value)*255/10)}});
            if(tier>0){
                const actions=el('div','',heading);actions.className='badge-height-tier-actions';
                const icon=(button,name)=>{const image=document.createElement('img');image.src=new URL(`./vendor/remixicon/${name}.svg`,import.meta.url).href;image.alt='';button.prepend(image);};
                const insert=btn(tier===1 && board.count>1?'向上插入一层':'向下插入一层',actions,()=>commit(insertHeightTier(board,tier,refined ? MAX_HEIGHT_SOLID_TIERS_87 : 6)));icon(insert,tier===1 && board.count>1?'arrow-up-line':'arrow-down-line');insert.disabled=board.count>=(refined ? MAX_HEIGHT_SOLID_TIERS_87 : 6);
                const remove=btn('',actions,()=>commit(deleteHeightTier(board,tier)));icon(remove,'delete-bin-line');remove.title=refined && tier===board.count?'顶层不可删除':'删除当前层';remove.setAttribute('aria-label',`删除${title(tier)}`);remove.disabled=refined ? tier===board.count : board.count<=2;
            }
            const cards = el('div', '', row); cards.className = 'badge-height-cards';
            const controls = el('div','',cards); controls.className='badge-height-color-actions';
            const colorList = el('div','',cards); colorList.className='badge-height-color-list';
            const tierGroups=board.groups.filter(g=>g.tier===tier);
            if(tier>0){const all=btn('⇅',controls,()=>{});all.className='badge-height-circle';all.setAttribute('aria-label','交换本层全部颜色');all.title=`拖到另一实体层：交换两层全部颜色，${refined ? '高度值' : 'Alpha'} 保持固定`;all.disabled=!tierGroups.length;bindDrag(all,tier,tierGroups,true);}
            for (const group of board.groups.filter(g => g.tier === tier)) {
                const card = el('div', '', colorList); card.className = 'badge-height-color';
                const handle = el('span', '⋮⋮', card); handle.title = '拖入目标层：仅移动此颜色，保留目标层已有颜色'; handle.style.cursor = 'grab'; handle.style.touchAction = 'none';
                bindDrag(handle,tier,[group],false);
                const color = el('input', '', card); color.type = 'color'; color.value = group.color; color.setAttribute('aria-label', '区域颜色');
                const hex = el('input', '', card); hex.value = group.color; hex.className = 'height-hex'; hex.setAttribute('aria-label', '色号');
                function setColor(value) {
                    if (!/^#[0-9a-f]{6}$/i.test(value)) { hex.value = group.color; return; }
                    if (board.groups.some(g => g.id !== group.id && g.color.toLowerCase() === value.toLowerCase())) { hex.setCustomValidity('此颜色已存在，请移动已有颜色'); hex.reportValidity(); color.value = group.color; return; }
                    hex.setCustomValidity(''); change(group.id, { color: value });
                }
                color.onchange = () => setColor(color.value); hex.onchange = () => setColor(hex.value); hex.oninput = () => hex.setCustomValidity('');
                const tolerance = el('label', '阈值 ', card); const threshold = el('input', '', tolerance); threshold.type = 'number'; threshold.min = 0; threshold.max = 441; threshold.value = group.threshold;
                threshold.onchange = () => change(group.id, { threshold: Math.max(0, Math.min(441, Number(threshold.value) || 0)) });
                btn('×', card, () => commit({ ...board, groups: board.groups.filter(g => g.id !== group.id) })).setAttribute('aria-label', `删除颜色 ${group.color}`);
            }
            const add = btn('＋', controls, () => {
                let n = 0xffffff; const used = new Set(board.groups.map(g => g.color.toLowerCase()));
                while (used.has(`#${n.toString(16).padStart(6, '0')}`)) n--;
                commit({ ...board, groups: [...board.groups, { id: crypto.randomUUID(), color: `#${n.toString(16).padStart(6, '0')}`, threshold: 30, tier }] });
            }); add.className='badge-height-circle'; add.title='添加颜色'; add.setAttribute('aria-label',`${title(tier)}添加颜色`); add.disabled = board.groups.length >= 16;
            if(!tierGroups.length) el('span','暂无颜色',colorList).className='badge-height-empty';
        }
    }
    render();
    return { element, config: () => heightBoardPreview(board), setAvailable(available) { element.querySelector('[data-height-preview]').disabled = !available; }, dispose() { clearDrag(); element.remove(); } };
}
