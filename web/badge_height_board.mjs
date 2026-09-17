import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { bindCompactNumberDrag } from './compact_color_group_controls.mjs?v=20260916-content-1';
import { refinedBadge87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { migrateHeightBoard, heightBoardPreview, heightAlpha, moveHeightColors, insertHeightTier, deleteHeightTier, fixedHeightBoard87, MAX_HEIGHT_SOLID_TIERS_87, appendLowestHeightTier87 } from './badge_height_board_model.mjs?v=20260916-ui-2';

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
    const title = tier => refined ? (tier === 0 ? badgeText("height_board.text_001") : String(tier)) : tier === 0 ? badgeText("height_board.text_002") : tier === board.count ? badgeText("height_board.text_003") : tier === 1 ? badgeText("height_board.text_004") : badgeText("height_board.text_005", {p0: (tier)});
    function commit(next, revealTier = null) {
        if (!live()) return;
        const scroller = element.closest('[data-badge-build]');
        const scrollTop = scroller?.scrollTop;
        // Keep the scroll extent stable while replaceChildren rebuilds the list.
        const height = element.getBoundingClientRect().height;
        if (refined) element.style.minHeight = `${height}px`;
        undo = structuredClone(board); graph.beforeChange?.(); board = refined ? fixedHeightBoard87(next) : next;
        meta().heightBoard = structuredClone(board); graph.afterChange?.(); render(); onEdit();
        if (refined) {
            element.style.removeProperty('min-height');
            if (scroller) scroller.scrollTop = scrollTop;
            if (revealTier !== null && scroller) {
                const row = element.querySelector(`[data-tier="${revealTier}"]`);
                if (row) scroller.scrollTop += row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 32;
            }
        }
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
                el('b',badgeText("height_board.text_006", {p0: (move ? badgeText("height_board.text_007") : badgeText("height_board.text_008")), p1: (groups.length)}),ghost);
            }
            ghost.style.left=`${e.clientX+16}px`;ghost.style.top=`${e.clientY+16}px`;
            element.querySelectorAll('[data-over]').forEach(r=>{delete r.dataset.over;delete r.dataset.dropLabel;});
            const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.badge-height-tier');
            if(target&&element.contains(target)&&(!move || Number(target.dataset.tier)>0)){
                target.dataset.over=move?'swap':'add';target.dataset.dropLabel=`${move ? badgeText("height_board.text_009") : badgeText("height_board.text_010")}${title(Number(target.dataset.tier))}${move ? badgeText("height_board.text_011") : badgeText("height_board.text_012")} · ${refined ? badgeText("height_board.text_013") : 'Alpha'} ${Math.round(heightAlpha(board,Number(target.dataset.tier))*100/255)}%`;
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
        const introduction = el('p',badgeText("height_board.text_014"),element); introduction.className='badge-height-introduction';
        const header = el('div', '', element); header.className = 'badge-height-board-header';
        const count = el('div', '', header); count.className = 'badge-height-count'; count.setAttribute('role','group'); count.setAttribute('aria-label',refined ? badgeText("height_board.text_015") : badgeText("height_board.text_016"));
        el('span', badgeText("height_board.text_017", {p0: (board.count + (refined ? 1 : 0))}), count);
        if (refined && board.count > MAX_HEIGHT_SOLID_TIERS_87) el('p', badgeText("height_board.text_018"), element).setAttribute('role','alert');
        const u = btn(badgeText("height_board.text_019"), header, () => { if (undo) { const previous = undo; commit(previous); undo = null; render(); } }); u.disabled = !undo;
        const preview = btn(badgeText("height_board.text_020"), header, onPreview); preview.className = 'badge-build-mask-preview'; preview.dataset.heightPreview = '';
        const fallbackLabel = el('label', badgeText("height_board.text_021"), element); fallbackLabel.className = 'badge-height-fallback';
        const fallback = el('select', '', fallbackLabel); tierOptions(fallback); fallback.value = board.fallback;
        fallback.onchange = () => commit({ ...board, fallback: Number(fallback.value) });
        el('span', badgeText("height_board.text_022"), fallbackLabel);
        for (let tier = board.count; tier >= 0; tier--) {
            const row = el('div', '', element); row.className = 'badge-height-tier'; row.dataset.tier = tier;
            const heading = el('div', '', row); heading.className = 'badge-height-tier-title';
            const swatch = el('span', '', heading); const gray = heightAlpha(board,tier); swatch.style.background = `rgb(${gray} ${gray} ${gray})`;
            el('strong', title(tier), heading);
            const alphaLabel = el('label', refined ? badgeText("height_board.text_023") : 'Alpha ', heading); alphaLabel.className = 'badge-height-alpha';
            const track = el('span','',alphaLabel); track.className = 'badge-height-alpha-track';
            const alpha = el('input', '', track); alpha.type = 'range'; alpha.min = tier === 0 ? 0 : 1; alpha.max = 10; alpha.step = 1; alpha.value = tier === 0 ? 0 : Math.max(1,Math.round(gray*10/255));
            const ticks = el('span','',track); ticks.className = 'badge-height-alpha-ticks'; ticks.setAttribute('aria-hidden','true');
            for(let i=0;i<10;i++) el('i','',ticks);
            alpha.setAttribute('aria-label', `${title(tier)} ${refined ? badgeText("height_board.text_024") : 'Alpha'}`); alpha.disabled = tier === 0 || (refined && tier === board.count);
            const alphaValue = el('output', '', alphaLabel); alphaValue.className = 'badge-height-alpha-value';
            const describe = () => { const text = `${Number(alpha.value)*10}%`; alphaValue.textContent = text; alpha.setAttribute('aria-valuetext',text); alpha.title = tier === 0 ? badgeText("height_board.text_025") : refined && tier === board.count ? badgeText("height_board.text_026") : `${refined ? badgeText("height_board.text_027") : 'Alpha'} ${text}`; };
            describe(); alpha.oninput = () => { describe(); const value=Math.round(Number(alpha.value)*255/10); swatch.style.background=`rgb(${value} ${value} ${value})`; };
            alpha.onchange = () => commit({...board, alphas:{...board.alphas,[tier]:Math.round(Number(alpha.value)*255/10)}});
            if(tier>0){
                const actions=el('div','',heading);actions.className='badge-height-tier-actions';
                const icon=(button,name)=>{const image=document.createElement('img');image.src=new URL(`./vendor/remixicon/${name}.svg`,import.meta.url).href;image.alt='';button.prepend(image);};
                if (!refined) { const insert=btn(tier===1 && board.count>1?badgeText("height_board.text_028"):badgeText("height_board.text_029"),actions,()=>commit(insertHeightTier(board,tier,6)));icon(insert,tier===1 && board.count>1?'arrow-up-line':'arrow-down-line');insert.disabled=board.count>=6; }
                const remove=btn('',actions,()=>commit(deleteHeightTier(board,tier)));icon(remove,'delete-bin-line');remove.title=refined && tier===board.count?badgeText("height_board.text_030"):badgeText("height_board.text_031");remove.setAttribute('aria-label',badgeText("height_board.text_032", {p0: (title(tier))}));remove.disabled=refined ? tier===board.count : board.count<=2;
            }
            const cards = el('div', '', row); cards.className = 'badge-height-cards';
            const controls = el('div','',cards); controls.className='badge-height-color-actions';
            const colorList = el('div','',cards); colorList.className='badge-height-color-list';
            const tierGroups=board.groups.filter(g=>g.tier===tier);
            if(tier>0){const all=btn(refined ? '⠿' : badgeText("height_board.text_033"),controls,()=>{});all.className='badge-height-circle';all.setAttribute('aria-label',badgeText("height_board.text_034"));all.title=badgeText("height_board.text_035", {p0: (refined ? badgeText("height_board.text_036") : 'Alpha')});all.disabled=!tierGroups.length;bindDrag(all,tier,tierGroups,true);}
            for (const group of board.groups.filter(g => g.tier === tier)) {
                const card = el('div', '', colorList); card.className = 'badge-height-color';
                const handle = el('span', badgeText("height_board.text_037"), card); handle.title = badgeText("height_board.text_038"); handle.style.cursor = 'grab'; handle.style.touchAction = 'none';
                bindDrag(handle,tier,[group],false);
                const color = el('input', '', card); color.type = 'color'; color.value = group.color; color.setAttribute('aria-label', badgeText("height_board.text_039"));
                const hex = el('input', '', card); hex.value = group.color; hex.className = 'height-hex'; hex.setAttribute('aria-label', badgeText("height_board.text_040"));
                function setColor(value) {
                    if (!/^#[0-9a-f]{6}$/i.test(value)) { hex.value = group.color; return; }
                    if (board.groups.some(g => g.id !== group.id && g.color.toLowerCase() === value.toLowerCase())) { hex.setCustomValidity(badgeText("height_board.text_041")); hex.reportValidity(); color.value = group.color; return; }
                    hex.setCustomValidity(''); change(group.id, { color: value });
                }
                color.onchange = () => setColor(color.value); hex.onchange = () => setColor(hex.value); hex.oninput = () => hex.setCustomValidity('');
                const tolerance = el('label', badgeText("height_board.text_042"), card); const threshold = el('input', '', tolerance); threshold.type = 'number'; threshold.min = 0; threshold.max = 441; threshold.value = group.threshold;
                threshold.step = '1';
                threshold.style.cursor = 'ew-resize';
                threshold.style.userSelect = 'text';
                threshold.setAttribute('aria-label', '颜色匹配阈值');
                threshold.title = '按住数值左右拖动调整，或点击后输入数值';
                const commitThreshold = value => change(group.id, { threshold: Math.max(0, Math.min(441, Number(value) || 0)) });
                threshold.onchange = () => commitThreshold(threshold.value);
                bindCompactNumberDrag(threshold, { onCommit: commitThreshold });
                btn(badgeText("height_board.text_043"), card, () => commit({ ...board, groups: board.groups.filter(g => g.id !== group.id) })).setAttribute('aria-label', badgeText("height_board.text_044", {p0: (group.color)}));
            }
            const add = btn(badgeText("height_board.text_045"), controls, () => {
                let n = 0xffffff; const used = new Set(board.groups.map(g => g.color.toLowerCase()));
                while (used.has(`#${n.toString(16).padStart(6, '0')}`)) n--;
                commit({ ...board, groups: [...board.groups, { id: crypto.randomUUID(), color: `#${n.toString(16).padStart(6, '0')}`, threshold: 30, tier }] });
            }); add.className='badge-height-circle'; add.title=badgeText("height_board.text_046"); add.setAttribute('aria-label',badgeText("height_board.text_047", {p0: (title(tier))})); add.disabled = board.groups.length >= 16;
            if(!tierGroups.length) el('span',badgeText("height_board.text_048"),colorList).className='badge-height-empty';
        }
        if (refined) {
            const addTier = btn(badgeText('refinement.add_height'), element, () => commit(appendLowestHeightTier87(board), 1));
            addTier.className = 'badge-height-add-tier';
            addTier.disabled = board.count >= MAX_HEIGHT_SOLID_TIERS_87;
        }
    }
    render();
    return { element, config: () => heightBoardPreview(board), setAvailable(available) { element.querySelector('[data-height-preview]').disabled = !available; }, dispose() { clearDrag(); element.remove(); } };
}
