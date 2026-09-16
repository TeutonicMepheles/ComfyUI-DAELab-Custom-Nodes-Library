import { normalizeImageSelection, buildImageViewPath } from './app_mode_load_image_preview_model.mjs';
import { uploadBadgeImage } from './badge_image_upload.mjs';

export function paletteReference(graph) {
    return normalizeImageSelection(graph?.extra?.daelabBadgePrototypeV1?.paletteReference);
}

export function createPaletteReferencePanel(graph, api, live) {
    const element = document.createElement('section');
    element.setAttribute('aria-label', '配色参考图');
    element.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:12px;min-width:0';
    const help = document.createElement('p');
    help.textContent = '上传后，各生成阶段优先使用此图作为配色参考。清除后恢复使用已处理镂空和背景的平面图。';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const upload = document.createElement('button'); upload.type = 'button'; upload.textContent = '上传 / 替换配色参考图';
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '清除配色参考图';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const preview = document.createElement('img'); preview.alt = '当前配色参考图';
    preview.style.cssText = 'width:100%;max-height:420px;object-fit:contain';
    let revision = 0, disposed = false, shown;
    const current = () => !disposed && live() && element.isConnected;
    function refresh() {
        const selection = paletteReference(graph), key = JSON.stringify(selection);
        clear.disabled = !selection;
        if (shown === key) return;
        shown = key; preview.hidden = !selection;
        if (selection) preview.src = api.apiURL(buildImageViewPath(selection));
        else preview.removeAttribute('src');
        status.textContent = selection ? `当前配色参考：${selection.filename}` : '未上传，使用默认平面图配色。';
    }
    function set(value) {
        graph.beforeChange?.(); graph.extra.daelabBadgePrototypeV1.paletteReference = value;
        graph.afterChange?.(); refresh();
    }
    async function receive(blob) {
        if (!current()) return;
        const token = ++revision, previous = JSON.stringify(paletteReference(graph));
        status.textContent = '正在上传…';
        try {
            const value = await uploadBadgeImage(api, blob);
            if (!current() || revision !== token || previous !== JSON.stringify(paletteReference(graph))) return;
            set(value);
        } catch (error) { if (current() && revision === token) status.textContent = error.message; }
        finally { if (revision === token) file.value = ''; }
    }
    upload.onclick = () => file.click();
    clear.onclick = () => { if (current()) { ++revision; file.value = ''; set(null); } };
    file.onchange = () => { if (file.files[0]) void receive(file.files[0]); };
    element.ondragover = event => event.preventDefault();
    element.ondrop = event => { event.preventDefault(); if (event.dataTransfer.files[0]) void receive(event.dataTransfer.files[0]); };
    preview.onerror = () => { preview.hidden = true; status.textContent = '配色参考图加载失败，请重新上传。'; };
    actions.append(upload, clear); element.append(help, actions, file, status, preview); refresh();
    return { element, refresh, dispose() { disposed = true; ++revision; element.remove(); } };
}
