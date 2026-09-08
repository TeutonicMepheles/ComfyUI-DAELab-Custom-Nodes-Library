import { catalogEntries, makeCatalogThumbnailUrl } from './thumbnail_selector.mjs';

let catalogPromise;
export function attachMaterialStrip(root, graph, live) {
    let opened = null, token = 0;
    const labels = new Map();
    const compact = new Map();
    function compactCards() {
        for (const [card] of compact) if (!card.isConnected) compact.delete(card);
        root.querySelectorAll('[data-material-region-id]').forEach(card => {
            if (compact.has(card)) return;
            const rows = [...card.children].slice(0, 3);
            if (rows.length !== 3) return;
            const children = rows.map(row => [...row.children]);
            const [[region, color, threshold], [materialLabel, image, trigger, policy], [strengthLabel, strength, value]] = children;
            if (!strength || strength.type !== 'range' || !trigger?.matches('.daelab-badge-material-trigger')) return;
            const line = document.createElement('div'); line.className = 'badge-material-compact-line';
            const material = document.createElement('div'); material.className = 'badge-material-compact-target';
            material.append(materialLabel, trigger); trigger.prepend(image);
            const strengthBox = document.createElement('label'); strengthBox.className = 'badge-material-compact-strength';
            strengthBox.append(strengthLabel, strength, value);
            const more = document.createElement('button'); more.type = 'button'; more.className = 'badge-material-compact-more';
            more.textContent = '⋯'; more.setAttribute('aria-label', '区域更多设置'); more.setAttribute('aria-expanded', 'false');
            const extra = document.createElement('div'); extra.className = 'badge-material-compact-extra'; extra.hidden = true;
            const policyLabel = document.createElement('label'); policyLabel.textContent = '颜色策略 '; policyLabel.append(policy); extra.append(policyLabel);
            more.onclick = () => {extra.hidden = !extra.hidden;more.setAttribute('aria-expanded',String(!extra.hidden));};
            line.append(region, color, threshold, material, strengthBox, more);
            card.replaceChildren(line, extra); card.dataset.badgeMaterialCompact = 'true';
            compact.set(card, () => {
                rows.forEach((row,i) => row.replaceChildren(...children[i]));
                card.replaceChildren(...rows); card.removeAttribute('data-badge-material-compact');
            });
        });
    }
    const close = (focus = false) => {
        token++;
        if (!opened) return;
        const {trigger, strip, card} = opened;
        trigger.setAttribute('aria-expanded', 'false');
        strip.remove(); card.removeAttribute('data-badge-material-open'); opened = null;
        if (focus && trigger.isConnected) trigger.focus();
    };
    async function open(trigger) {
        if (opened?.trigger === trigger) { close(true); return; }
        close();
        const card = trigger.closest('[data-material-region-id]');
        const node = graph.getNodeById(49);
        const widget = node?.widgets?.find(w => w.name === 'badge_material_region_v1_panel');
        if (!card || !widget || !live()) return;
        const groupId = card.dataset.materialRegionId;
        const strip = document.createElement('div'); strip.className = 'badge-material-strip';
        strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', '选择目标材质');
        card.dataset.badgeMaterialOpen = 'true'; card.append(strip);
        trigger.setAttribute('aria-expanded', 'true');
        opened = {trigger, card, strip};
        const request = token;
        strip.textContent = '正在加载材质…';
        try {
            catalogPromise ??= fetch(new URL('./materials.json', import.meta.url)).then(r => {if (!r.ok) throw new Error(); return r.json();}).catch(e => {catalogPromise = null; throw e;});
            const entries = catalogEntries(await catalogPromise);
            if (request !== token || !live() || !strip.isConnected) return;
            const config = JSON.parse(widget.value), group = config.groups.find(g => g.id === groupId);
            if (!group) {close(); return;}
            strip.replaceChildren();
            const rail = document.createElement('div'); rail.className = 'badge-material-strip-rail';
            rail.setAttribute('role', 'listbox'); rail.setAttribute('aria-label', '目标材质缩略图');
            const nav = (text, delta) => {
                const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
                b.setAttribute('aria-label', delta < 0 ? '向左浏览材质' : '向右浏览材质');
                b.onclick = () => rail.scrollBy({left:delta, behavior:'smooth'}); return b;
            };
            strip.append(nav('‹', -220), rail, nav('›', 220));
            const buttons = entries.map(entry => {
                const b = document.createElement('button'); b.type = 'button';
                b.className = 'badge-material-strip-card'; b.setAttribute('role', 'option');
                b.setAttribute('aria-selected', String(entry.id === group.material_id));
                const img = document.createElement('img'); img.alt = ''; img.src = makeCatalogThumbnailUrl(entry, new URL('./material_thumbs/', import.meta.url), 'strip-1');
                const name = document.createElement('span'); name.textContent = entry.label || entry.id;
                b.append(img, name);
                if (entry.id === group.material_id) { const mark = document.createElement('span'); mark.textContent = '✓'; mark.className = 'badge-material-strip-check'; mark.setAttribute('aria-hidden', 'true'); b.append(mark); }
                b.onclick = event => {
                    event.stopPropagation();
                    if (!live() || !strip.isConnected) return;
                    const current = JSON.parse(widget.value), row = current.groups.find(g => g.id === groupId);
                    if (!row) { close(); return; }
                    row.material_id = entry.id;
                    if (!entry.intrinsic_color_hex) row.color_policy = 'preserve';
                    close(); graph.beforeChange?.();
                    node._badgeMaterialRegionV1SelectedId = groupId;
                    widget.value = JSON.stringify(current); graph.afterChange?.();
                    root.querySelector(`[data-material-region-id="${CSS.escape(groupId)}"] .daelab-badge-material-trigger`)?.focus();
                };
                rail.append(b); return b;
            });
            rail.onkeydown = event => {
                const index = buttons.indexOf(document.activeElement);
                if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus();
            };
            buttons.find(b => b.getAttribute('aria-selected') === 'true')?.focus();
        } catch { if (request === token) strip.textContent = '材质加载失败，请收起后重试。'; }
    }
    const click = event => {
        const trigger = event.target.closest?.('.daelab-badge-material-trigger');
        if (!trigger || !live()) return;
        event.preventDefault(); event.stopImmediatePropagation(); void open(trigger);
    };
    const key = event => {
        if (event.key === 'Escape' && opened) {event.preventDefault();event.stopImmediatePropagation();close(true);return;}
        if (['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key) && event.target.matches?.('.daelab-badge-material-trigger')) click(event);
    };
    const outside = event => {if (opened && !opened.strip.contains(event.target) && !opened.trigger.contains(event.target)) close();};
    root.addEventListener('click', click, true); root.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside, true);
    return {update(){
        compactCards();
        if (opened && (!live() || !opened.trigger.isConnected || !opened.trigger.getClientRects().length)) close();
        for (const [trigger] of labels) if (!trigger.isConnected) labels.delete(trigger);
        root.querySelectorAll('.daelab-badge-material-trigger').forEach(trigger => {
            if (labels.has(trigger)) return;
            labels.set(trigger, [trigger.getAttribute('aria-label'), trigger.title]);
            trigger.setAttribute('aria-label', '目标材质；点击展开横向缩略图列表');
            trigger.title = '点击选择材质，选中后自动收起';
        });
    }, dispose(){
        close();
        for (const restore of compact.values()) restore(); compact.clear();
        for (const [trigger, [label, title]] of labels) {trigger.setAttribute('aria-label',label);trigger.title=title;}
        labels.clear();root.removeEventListener('click',click,true);root.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',outside,true);
    }};
}
