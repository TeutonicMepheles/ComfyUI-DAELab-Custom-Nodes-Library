// Optional shared controls. Business tables remain usable without Creative Canvas.
let shared = null;
try { shared = await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_button.mjs'); } catch {}
let sharedHistory = null;
try { sharedHistory = await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_history.mjs'); } catch {}

export function tableHistory(app) {
    return sharedHistory?.canvasHistory(app) || null;
}

export function createTableButton(label, action, primary = false) {
    const invoke = e => { e.preventDefault(); e.stopPropagation(); return action(e); };
    const button = shared?.createCreativeButton(label, invoke) || document.createElement('button');
    if (!shared) { button.type = 'button'; button.textContent = label; button.onclick = invoke; }
    if (primary) button.dataset.primary = 'true';
    return button;
}

export function tableTheme() {
    if (document.getElementById('dae-table-ui-css')) return;
    const sheet = document.createElement('link');
    sheet.id = 'dae-table-ui-css'; sheet.rel = 'stylesheet';
    sheet.href = new URL('./table_ui.css?v=20261001-selection-clear', import.meta.url).href;
    document.head.append(sheet);
}

export function tableIcon(button, name, label) {
    button.title = label; button.setAttribute('aria-label', label);
    if (!shared && !['check-line','error-warning-line','restart-line','play-line','folder-image-line'].includes(name)) { button.textContent = label; return button; }
    const icon = document.createElement('span');icon.className='dae-table-icon';icon.setAttribute('aria-hidden','true');
    icon.style.setProperty('--table-icon', `url("${['draggable','settings-3-line','check-line','error-warning-line','restart-line','play-line','folder-image-line'].includes(name)?new URL('./vendor/remixicon/'+name+'.svg',import.meta.url).href:'/extensions/ComfyUI-DAELab-Creative-Canvas/vendor/remixicon/'+name+'.svg'}")`);
    button.replaceChildren(icon); return button;
}
