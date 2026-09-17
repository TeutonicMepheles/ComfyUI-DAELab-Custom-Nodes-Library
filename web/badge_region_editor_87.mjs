import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { readLocalRegions87, writeLocalRegions87 } from './badge_local_regions_87_model.mjs?v=20260917-metal-color-1';
import { createRegionConfigAdapter } from './badge_material_region_v1.js';
import { createCompactColorControl, createCompactThresholdControl } from './compact_color_group_controls.mjs?v=20260916-content-1';
import { addMaterialRegionAfter, normalizeMaterialRegionConfig } from './badge_material_region_v1_model.mjs?v=20260917-target87-1';

import { LIST_EDITOR_ICONS, createIconButton } from './list_editor_controls.mjs?v=20260901-1';

const text = (key, values) => badgeText(`regions.${key}`, values);
const element = (tag, label, parent) => { const e = document.createElement(tag); if (label) e.textContent = label; parent?.append(e); return e; };

// One compact list, using the same color, threshold, material and toolbar controls as build mode.
export function createRegionEditor87(graph, root, {onPreview, onChange, live}) {
    const selection = element('section'); selection.className = 'badge-region-editor badge-region-selection';
    const materials = element('section'); materials.className = 'badge-region-editor badge-region-materials';
    const owner = createRegionConfigAdapter(graph, () => readLocalRegions87(graph), config => writeLocalRegions87(graph, config));
    const node = () => owner;
    const api = () => owner.daelabRegionEditor;
    let signature = '', selected = null, targetKey = '';
    const read = () => {
        const config = normalizeMaterialRegionConfig(api()?.read() || {});
        config.groups.forEach((g, i) => { g.name ||= text('name', {n:i + 1}); });
        return config;
    };
    function select(id, preview = true) {
        selected = id; node()._badgeMaterialRegionV1SelectedId = id;
        for (const row of materials.querySelectorAll('[data-region-id]')) { row.dataset.selected = String(row.dataset.regionId === id); row.setAttribute('aria-selected', String(row.dataset.regionId === id)); }
        if (preview) onPreview(id);
    }
    function commit(config) {
        if (!live() || !api()) return;
        config = normalizeMaterialRegionConfig({...config, overlap_policy: 'error'});
        if (JSON.stringify(config) === JSON.stringify(read())) return;
        const top = root.scrollTop;
        api().commit(config);
        signature = ''; update(targetKey); root.scrollTop = top; onChange();
    }
    function patch(id, changes) { const config = read(); Object.assign(config.groups.find(g => g.id === id), changes); commit(config); }
    function update(key) {
        if (targetKey !== key) { targetKey = key; selected = null; signature = ''; }
        if (!api()) return;
        const config = read(), next = JSON.stringify(config);
        if (next === signature) return;
        signature = next;
        selected = config.groups.some(g => g.id === selected) ? selected : config.groups[0].id;
        selection.replaceChildren(); materials.replaceChildren();
        const panel = element('div', '', materials); panel.className = 'badge-region-compact-panel';
        const toolbar = element('div', '', panel); toolbar.className = 'badge-region-toolbar';
        toolbar.append(createIconButton(LIST_EDITOR_ICONS.addRoot, '添加层', () => {
            const next = addMaterialRegionAfter(read(), selected);
            const added = next.config.groups.find(g => g.id === next.selectedId);
            let index = 1;
            while (read().groups.some(g => g.name === text('name', {n:index}))) index++;
            added.name = text('name', {n:index}); added.samples = []; added.material_pending = true;
            selected = added.id; commit(next.config);
        }, config.groups.length >= 16));
        toolbar.append(createIconButton(LIST_EDITOR_ICONS.remove, '删除层', () => {
            const next = read(); next.groups = next.groups.filter(g => g.id !== selected); commit(next);
        }, config.groups.length === 1));
        const count = element('span', `${config.groups.length}/16`, toolbar); count.style.marginLeft = 'auto';
        const list = element('div', '', panel); list.className = 'badge-region-compact-list'; list.setAttribute('role','listbox'); list.setAttribute('aria-label','颜色与材质对应列表');
        for (const [index, group] of config.groups.entries()) {
            const name = group.name || text('name', {n: index + 1});
            const row = element('div', '', list); row.className = 'badge-region-row'; row.dataset.regionId = group.id;
            row.tabIndex = 0; row.setAttribute('role','option');
            row.onclick = () => select(group.id);
            row.onfocusin = () => select(group.id, false);
            row.onkeydown = e => { if(e.target === row && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); select(group.id);} };
            const heading = element('div', '', row); heading.className = 'badge-region-first';
            const title = element('span', name, heading); title.className = 'badge-region-label';
            const primary = createCompactColorControl({color:group.color, label:text('sample'), onDraft:value=>value, onCommit:value=>{patch(group.id,{color:value});return value;}, getCurrentColor:()=>read().groups.find(g=>g.id===group.id)?.color});
            const thresholdControl = createCompactThresholdControl({threshold:group.threshold,onCommit:value=>patch(group.id,{threshold:value})});
            thresholdControl.querySelector('input').style.userSelect = 'text';
            heading.append(primary, thresholdControl);
            const controls = element('div', '', row); controls.className = 'badge-region-material-controls';
            const picker = api().materialControl(group);
            if (group.material_pending) { picker.trigger.querySelector('span').textContent = text('pending'); picker.preview.hidden = true; }
            controls.append(picker.label, picker.preview, picker.trigger);

        }
        select(selected, false);
    }
    return {selection, materials, update, get selectedId() { return selected; }, dispose() { api()?.close(); selection.remove(); materials.remove(); }};
}

export const REGION_EDITOR_CSS = `
.badge-region-selection{display:none!important;}
.badge-region-editor.badge-region-materials{flex:none;box-sizing:border-box;min-width:0;margin:0 8px;padding:4px 12px;border-inline:1px solid #46535d;background:#20282e;}
.badge-region-editor[hidden],.badge-region-editor [hidden]{display:none!important;}
.badge-region-compact-panel{border:1px solid #36393f;border-radius:6px;background:#202226;overflow:hidden;min-width:0;}
.badge-region-toolbar{display:flex;align-items:center;gap:6px;padding:4px 6px;flex-wrap:wrap;font-size:11px;}
.badge-region-toolbar button:not([style]){padding:3px 6px;border:1px solid #4b4b4b;border-radius:4px;background:#2b2b2b;color:#c9c9c9;cursor:pointer;font:inherit;}
.badge-region-toolbar button:disabled{opacity:.35;cursor:default;}
.badge-region-compact-list{display:flex;flex-direction:column;gap:2px;padding:4px 6px;min-width:0;}
.badge-region-row{min-width:0;padding:3px 6px;border:1px solid #3f4248;border-radius:6px;background:#23262a;display:grid;grid-template-columns:40px minmax(110px,1fr) 78px 24px 26px minmax(100px,1fr);align-items:center;gap:6px;box-sizing:border-box;}
.badge-region-row[data-selected=true]{border-color:#62a7d7;background:#28353f;box-shadow:inset 3px 0 #62a7d7;}
.badge-region-first{display:contents;}
.badge-region-label{font:11px sans-serif;color:#c5c9cf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.badge-region-material-controls{display:contents;}
.badge-region-material-controls .daelab-badge-material-trigger{width:100%;min-width:0;}
`;
