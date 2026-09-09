import { generateColorSelectionSource } from './badge_color_source.mjs';
import { generateGptColorMap87 } from './badge_color_map_87.mjs';
import { decorateExclusivePair } from './badge_exclusive_pair.mjs';
import { syncPolygonTarget87 } from './badge_polygon_target_87.mjs';
import { localTargets87, selectLocalSource87, setExistingTarget87 } from './badge_result_target_87.mjs';
import { drawSelectionMask } from './badge_selection_render.mjs';
import { app } from '/scripts/app.js';
import { api } from '/scripts/api.js';
import { getRootGraphSafely, isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { isBadgePrototype } from './badge_app_prototype_model.mjs?v=2';
import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs';
import { normalizeImageSelection, buildImageViewPath } from './app_mode_load_image_preview_model.mjs';
import { previewPixels } from './badge_build_preview_model.mjs';
import { attachMaterialStrip } from './badge_material_strip.mjs';
import { attachBadgeColorPicker } from './badge_color_picker.mjs';
import { attachReferenceResize } from './badge_reference_resize.mjs';
import { createHeightBoard } from './badge_height_board.mjs?v=20260908-mask-toggle';
import { run as runPrototype, getPrototypeSession } from './badge_app_prototype.js';
import { stageSnapshot, isPromptOnlyBuild } from './badge_generation_model.mjs';
import { createGenerationPanel, GENERATION_CSS } from './badge_generation_panel.mjs?v=20260909-inline-count';

const CONFIGS = {
    background: [47, 'multi_color_mask_v1_panel', '_multiColorMaskV1SelectedId'],
    material: [49, 'badge_material_region_v1_panel', '_badgeMaterialRegionV1SelectedId'],
    height: [3, 'badge_height_layer_v1_panel', '_badgeHeightLayerV1SelectedId'],
};
const HIDDEN = 'data-badge-build-hidden';
let active = null;

function mount(graph, root, tabId = 'build') {
    const local = tabId === 'local';
    const segmented = graph.extra?.daelabBadgeExecutionV1?.version === 1;
    const configs = local ? { color: [104, 'multi_color_mask_v1_panel'] } : CONFIGS;
    const workflowId = graph.id;
    const state = { imageTab: 'flat', section: local ? 'color' : null, last: { flat: null, height: null },
        background: graph.extra.daelabBadgePrototypeV1.backgroundEnabled !== false,
        heightEnabled: graph.extra.daelabBadgePrototypeV1.heightEnabled !== false,
        view: 'original', signature: '', sourceKey: '', pixels: null, preview: null,
        disposed: false, loadToken: 0, drawn: null };
    const live = () => !state.disposed && getRootGraphSafely(app) === graph && graph.id === workflowId && isBadgePrototype(graph);
    const materialStrip = attachMaterialStrip(root, graph, live);
    const invertSwitches = new Map();
    const node = id => graph.getNodeById(id);
    const hierarchy = () => readHierarchyState(node(95));
    const routeEffect = () => !local && itemValue(hierarchy(), 'badge.path.effect');
    const sourceNode = () => node(local ? graph.extra.daelabBadgePrototypeV1.localReferenceNodeId : routeEffect() ? 96 : state.imageTab === 'height' ? 2 : 1);
    const imageWidget = () => sourceNode()?.widgets?.find(w => w.name === 'image');
    const panelWidget = () => {
        const spec = configs[state.section];
        return spec && node(spec[0])?.widgets?.find(w => w.name === spec[1]);
    };
    const config = () => { if (local && state.section === 'polygon') { try { return JSON.parse(node(142)?.properties?.polygon_info || '{}'); } catch { return {}; } } if (state.section === 'height') return heightBoard.config(); try { return JSON.parse(panelWidget()?.value || '{}'); } catch { return {}; } };
    const heightBoard = local ? { element: document.createElement('div'), config: () => ({}), setAvailable() {}, dispose() {} } : createHeightBoard(graph, live, () => {
        toggleMaskPreview();
    }, () => { if (state.section === 'height') { state.preview = null; state.view = 'original'; } update(); });
    const element = document.createElement('section');
    element.className = 'badge-build-workspace';
    element.setAttribute('aria-label', local ? '局部编辑目标图工作区' : '效果图生成工作区');
    const make = (tag, text, parent = element) => {
        const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e;
    };
    const button = (text, parent, action) => {
        const e = make('button', text, parent); e.type = 'button'; e.onclick = action; return e;
    };
    if (!local) {
        const label = make('details'); label.className = 'badge-build-base-prompt'; label.open = true;
        make('summary', '基础提示词', label);
        const input = make('textarea', '', label); input.rows = 3;
        input.setAttribute('aria-label', '基础提示词');
        input.placeholder = '描述想生成的图片；也可以仅填写提示词，不上传图片';
        input.value = graph.extra.daelabBadgePrototypeV1.buildPrompt || '';
        input.oninput = () => {
            if (!live()) return;
            graph.beforeChange?.(); graph.extra.daelabBadgePrototypeV1.buildPrompt = input.value;
            graph.afterChange?.(); graph.setDirtyCanvas?.(true, true); update();
        };
    }
    const bar = make('div'); bar.className = 'badge-build-bar badge-build-upload-bar';
    if (local) make('strong', '待编辑目标图', bar);
    let targetSourceButtons = [];
    if (local && segmented) {
        const sources = make('div'); sources.className = 'badge-target-source';
        sources.setAttribute('role', 'radiogroup'); sources.setAttribute('aria-label', '编辑对象来源');
        targetSourceButtons = [['generated', '使用生成结果'], ['existing', '已有效果图']].map(([source, label], i) => {
            const control = button(label, sources, () => {
                if (!live()) return;
                imageSelections.set(imageWidget(), Symbol('source selection'));
                latestUpload = null; file.value = '';
                selectLocalSource87(graph, source, getPrototypeSession(graph, 'local')); update();
            });
            control.setAttribute('role', 'radio');
            control.onkeydown = event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = targetSourceButtons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1-i];
                next.click(); next.focus();
            };
            return control;
        });
        decorateExclusivePair(sources, targetSourceButtons, ['material', 'image']);
        const targets = localTargets87(graph);
        if (JSON.stringify(normalizeImageSelection(imageWidget()?.value)) !== JSON.stringify(targets[targets.source])) {
            selectLocalSource87(graph, targets.source, getPrototypeSession(graph, 'local'));
        }
    }
    const file = make('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const uploadActions = make('div', '', bar); uploadActions.className = 'badge-build-upload-actions';
    const filename = make('span', '', uploadActions); filename.className = 'badge-build-filename';
    const iconButton = (label, icon, action) => {
        const b = button('', uploadActions, action); b.className = 'badge-build-icon-button';
        b.setAttribute('aria-label', label); b.title = label;
        const img = make('img', '', b); img.alt = ''; img.setAttribute('aria-hidden', 'true');
        img.src = new URL(`./vendor/remixicon/${icon}.svg`, import.meta.url).href;
        return b;
    };
    const uploadButton = iconButton('上传 / 替换图片', 'upload-2-line', () => file.click());
    const existing = iconButton('浏览已上传图片', 'folder-image-line', openImages);
    existing.setAttribute('aria-haspopup', 'dialog');
    const gallery = make('dialog'); gallery.className = 'badge-build-gallery';
    gallery.setAttribute('aria-label', '选择已上传图片');
    const galleryHeader = make('div', '', gallery); galleryHeader.className = 'badge-build-bar';
    make('strong', '选择已上传图片', galleryHeader);
    button('关闭', galleryHeader, () => gallery.close());
    const search = make('input', '', gallery); search.type = 'search';
    search.placeholder = '搜索文件名'; search.setAttribute('aria-label', '搜索已上传图片');
    const count = make('p', '', gallery); count.setAttribute('role', 'status');
    const grid = make('div', '', gallery); grid.className = 'badge-build-gallery-grid';
    let galleryValues = [], gallerySource = null;
    const selectionKey = value => JSON.stringify(normalizeImageSelection(value));
    function renderImages() {
        grid.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        const values = galleryValues.filter(value => String(value).toLocaleLowerCase().includes(query));
        count.textContent = values.length ? `${values.length} 张图片 · 点击缩略图即可使用` : '没有匹配的图片';
        const current = selectionKey(imageWidget()?.value);
        for (const value of values) {
            const selected = selectionKey(value) === current;
            const card = button('', grid, () => {
                if (!live() || sourceNode() !== gallerySource) { gallery.close(); return; }
                setImage(value); gallery.close();
            });
            card.className = 'badge-build-image-card'; card.title = String(value);
            card.setAttribute('aria-pressed', String(selected));
            const thumb = make('img', '', card);
            thumb.alt = ''; thumb.loading = 'lazy'; thumb.decoding = 'async';
            thumb.src = api.apiURL(buildImageViewPath(normalizeImageSelection(value)));
            thumb.onerror = () => { thumb.hidden = true; make('span', '预览不可用', card); };
            make('span', String(value), card);
            if (selected) { const mark = make('span', '✓ 当前图片', card); mark.setAttribute('aria-hidden', 'true'); }
        }
    }
    function openImages() {
        if (!live()) return;
        gallerySource = sourceNode();
        const values = imageWidget()?.options?.values;
        galleryValues = [...new Set([imageWidget()?.value, ...(Array.isArray(values) ? values : [])].filter(Boolean))];
        search.value = ''; renderImages(); gallery.showModal(); search.focus();
    }
    search.oninput = renderImages;
    gallery.onclick = event => {
        const rect = gallery.getBoundingClientRect();
        if (event.target === gallery && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) gallery.close();
    };
    gallery.onclose = () => { if (live()) existing.focus(); };
    const imageSelections = new WeakMap();
    let latestUpload = null;
    function setImage(value) {
        const w = imageWidget(); if (!live() || !w) return;
        imageSelections.set(w, Symbol('image selection'));
        if (latestUpload?.widget === w) {
            latestUpload = null; uploadButton.disabled = false; file.value = '';
        }
        if (local && segmented) setExistingTarget87(graph, value, getPrototypeSession(graph, 'local'));
        else { graph.beforeChange?.(); w.value = value; w.callback?.(value); graph.afterChange?.(); }
        state.sourceKey = ''; update();
    }
    async function upload(blob) {
        if (!live()) return;
        if (local && segmented && localTargets87(graph).source !== 'existing') { status.textContent = '请先切换到“已有效果图”再上传图片。'; return; }
        if (!blob || !blob.type.startsWith('image/')) { status.textContent = '请选择图片文件。'; return; }
        const target = sourceNode(), w = imageWidget();
        if (!target || !w) return;
        const request = { widget: w, value: selectionKey(w.value) };
        imageSelections.set(w, request); latestUpload = request;
        const current = () => live() && node(target.id) === target
            && target.widgets?.includes(w) && imageSelections.get(w) === request
            && selectionKey(w.value) === request.value;
        uploadButton.disabled = true; status.textContent = '正在上传…';
        try {
            const form = new FormData(); form.append('image', blob); form.append('type', 'input');
            const response = await api.fetchApi('/upload/image', { method: 'POST', body: form });
            if (!response.ok) throw new Error('上传失败，请重试。');
            const data = await response.json();
            if (!current()) return;
            const value = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
            if (local && segmented) { setExistingTarget87(graph, value, getPrototypeSession(graph, 'local')); update(); return; }
            graph.beforeChange?.(); w.value = value;
            if (Array.isArray(w.options?.values) && !w.options.values.includes(value)) w.options.values.push(value);
            w.callback?.(value); target.setDirtyCanvas?.(true, true); graph.afterChange?.();
            update();
        } catch (error) {
            if (current() && latestUpload === request && sourceNode() === target) status.textContent = error.message;
        } finally {
            if (live() && latestUpload === request) {
                latestUpload = null; uploadButton.disabled = false; file.value = '';
            }
        }
    }
    file.onchange = () => void upload(file.files[0]);
    const frame = make('div'); frame.className = 'badge-build-image';
    const canvas = make('canvas', '', frame); canvas.setAttribute('aria-label', '大图预览');
    const empty = make('span', '拖入图片，或点击上方上传', frame);
    frame.ondragover = e => { e.preventDefault(); frame.dataset.drag = 'true'; };
    frame.ondragleave = () => delete frame.dataset.drag;
    frame.ondrop = e => { e.preventDefault(); delete frame.dataset.drag; void upload(e.dataTransfer.files[0]); };
    const toolbar = make('div'); toolbar.className = 'badge-build-bar';
    const view = make('select', '', toolbar); view.setAttribute('aria-label', '大图显示方式');
    view.innerHTML = '<option value="original">原图</option><option value="overlay">遮罩叠加</option><option value="mask">黑白遮罩 / 高度图</option><option value="cutout">透明剔除预览</option>';
    if (local) { view.options[2].textContent = '黑白遮罩'; view.options[3].hidden = true; }
    view.onchange = () => { state.view = view.value; update(); };
    function maskActive() { return Boolean(state.preview && state.view === 'mask' && state.signature === JSON.stringify(config())); }
    function toggleMaskPreview() {
        if (!live() || !selectionPixels() || !state.section) return;
        if (maskActive()) { state.view = 'original'; update(); return; }
        const id = local && state.section === 'polygon' ? 142 : configs[state.section]?.[0];
        for (const w of node(id)?.widgets || []) w.beforeQueued?.();
        if (local && state.section === 'polygon') node(142)?.serializePolygonInfo?.();
        state.preview = structuredClone(config()); state.signature = JSON.stringify(config()); state.view = 'mask';
        if (local) {
            node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
            confirmedSelection = selectionSignature();
        }
        update();
    }
    const preview = button('预览遮罩', document.createDocumentFragment(), toggleMaskPreview);
    preview.className = 'badge-build-mask-preview';
    const status = make('span', '', toolbar); status.setAttribute('role', 'status');
    const sections = make('div'); sections.className = 'badge-build-sections';
    let mapImage = null, mapSource = null, mapJob = 0, mapBusy = false, mapProgress = 0, mapError = '', mapShown = true;
    const usesMap = () => local && state.section === 'color' && itemValue(hierarchy(), 'badge.post.local.color_id_map');
    const selectionPixels = () => usesMap() ? (mapSource === state.pixels ? mapImage : null) : state.pixels;
    async function generateMap(regenerate = false, allowGenerate = false) {
        if (!live() || !state.pixels || mapBusy) return;
        const source = state.pixels, job = ++mapJob;
        mapSource = source; mapImage = null; mapBusy = allowGenerate || !segmented; mapProgress = 0; mapError = ''; mapShown = true;
        colorPicker.close(); state.preview = null; state.view = 'original'; confirmedSelection = null;
        node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
        update();
        try {
            const result = await (segmented ? generateGptColorMap87.bind(null, graph) : generateColorSelectionSource)(source, {
                regenerate,
                allowGenerate,
                cancelled: () => !live() || job !== mapJob || source !== state.pixels || !usesMap(),
                onProgress: value => { if (live() && job === mapJob) { mapProgress = value; update(); } },
            });
            if (!live() || job !== mapJob) return;
            mapImage = result;
        } catch (error) { mapError = error?.message || '生成失败，请重试'; }
        finally { if (live() && job === mapJob) { mapBusy = false; update(); } }
    }
    const colorPicker = attachBadgeColorPicker(root,canvas,()=>{state.view='original';mapShown=true;update();},e=>{
        if(!selectionPixels())return null;
        const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/canvas.width,r.height/canvas.height);
        const x=Math.floor((e.clientX-r.left-(r.width-canvas.width*scale)/2)/scale),y=Math.floor((e.clientY-r.top-(r.height-canvas.height*scale)/2)/scale);
        if(x<0||y<0||x>=canvas.width||y>=canvas.height)return null;
        const i=(y*canvas.width+x)*4;return '#'+[...selectionPixels().data.slice(i,i+3)].map(v=>v.toString(16).padStart(2,'0')).join('');
    },live);
    const sectionButtons = {};
    for (const [key, title] of local ? [] : [['background', '背景 / 镂空剔除'], ['material', '材质分区'], ['height', '高度建立']]) {
        const group = make('div', '', sections); group.className = 'badge-build-capsule';
        const b = button(title, group, () => {
            colorPicker.close();
            state.section = state.section === key ? null : key;
            state.imageTab = key === 'height' ? 'height' : 'flat';
            state.last[state.imageTab] = state.section;
            state.preview = null; state.view = 'original'; update();
        });
        const toggle = make('input', '', group); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `${title}启用`);
        toggle.className = 'badge-build-capsule-switch';
        toggle.onchange = () => {
            if (key === 'background') {
                graph.beforeChange?.(); state.background = toggle.checked;
                graph.extra.daelabBadgePrototypeV1.backgroundEnabled = toggle.checked; graph.afterChange?.();
            } else if (key === 'height') {
                graph.beforeChange?.(); state.heightEnabled = toggle.checked;
                graph.extra.daelabBadgePrototypeV1.heightEnabled = toggle.checked; graph.afterChange?.();
                state.preview = null; state.view = 'original';
            } else node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.path.flat_height.special_material', toggle.checked);
            update();
        };

        sectionButtons[key] = { group, b, toggle };
    }
    function draw() {
        view.value = state.view;
        if (!state.pixels) return;
        const source = usesMap() && ((!mapShown || (segmented && !selectionPixels())) && state.view === 'original') ? state.pixels : selectionPixels();
        canvas.hidden = !source; empty.hidden = Boolean(source);
        if (!source) { empty.textContent = mapError || (mapBusy ? segmented ? 'GPT 色彩分区图生成中…' : `正在生成色彩分区图 ${mapProgress}%` : '色彩分区图尚未就绪'); return; }
        const key = [source, state.preview, state.view, state.section];
        if (state.drawn?.every((v, i) => v === key[i])) return;
        state.drawn = key;
        let data;
        if (state.section === 'polygon' && state.preview && state.view !== 'original') {
            const maskCanvas = document.createElement('canvas'); maskCanvas.width = canvas.width; maskCanvas.height = canvas.height;
            const context = maskCanvas.getContext('2d'); drawSelectionMask(context, state.preview, canvas.width, canvas.height);
            data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            if (state.view === 'overlay') {
                const mask = data; data = new Uint8ClampedArray(state.pixels.data);
                for (let i = 0; i < data.length; i += 4) if (mask[i]) {
                    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * .55 + [20, 220, 180][c] * .45);
                }
            }
        } else data = state.view === 'original' || !state.preview ? source.data
            : previewPixels(source.data, state.preview, state.section, state.view);
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), canvas.width, canvas.height), 0, 0);
    }
    async function load(selection, key) {
        const token = ++state.loadToken;
        if (local && segmented) { ++mapJob; mapBusy = false; mapImage = null; mapSource = null; mapError = ''; confirmedSelection = null; }
        state.pixels = null; state.preview = null; state.view = 'original';
        canvas.hidden = true; empty.hidden = false; empty.textContent = selection ? '正在加载图片…' : local ? '尚未上传目标图 · 拖入图片，或使用右上角上传 / 图库按钮' : state.imageTab === 'height' ? '尚未上传高度图 · 拖入图片，或使用右上角上传 / 图库按钮' : '尚未上传材质图 · 拖入图片，或使用右上角上传 / 图库按钮';
        if (!selection && local && segmented && localTargets87(graph).source === 'generated') empty.textContent = '暂无生成结果 · 请先在“效果图生成”中生成图片';
        if (!selection) return;
        const image = new Image(); image.src = api.apiURL(buildImageViewPath(selection));
        try {
            await image.decode();
            if (!live() || token !== state.loadToken) return;
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
            state.pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            canvas.hidden = false; empty.hidden = true; update();
        } catch { if (token === state.loadToken) empty.textContent = '图片不可用，请重新选择或上传。'; }
    }
    function update() {
        materialStrip.update();
        if (state.preview && state.signature !== JSON.stringify(config())) {
            state.preview = null; state.view = 'original';
            if (local) { confirmedSelection = null; node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false); }
        }
        for (const b of [preview, localPreview, heightBoard.element.querySelector('[data-height-preview]')]) {
            if (b) { b.setAttribute('aria-pressed', String(maskActive())); b.title = maskActive() ? '切回原图' : '显示当前遮罩'; }
        }
        if (generation) {
            const snapshot = stageSnapshot(graph, tabId), session = getPrototypeSession(graph, tabId);
            if (session.preview && session.preview !== snapshot.fingerprint) {
                session.preview = null; session.phase = 'changed'; session.message = '当前阶段配置已变化，请重新生成。';
                if (local) node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
            }
            generation.update({ busy: session.busy, error: snapshot.error, message: session.message });
            generation.element.hidden = !isNodeAvailableInAppMode(node(local ? 146 : 1));
            if (!local && root.lastElementChild !== generation.element) root.append(generation.element);
        }
        const tabHeader=root.querySelector('[data-daelab-app-layout-owned="tabs"]');
        root.style.setProperty('--badge-tabs-height',`${tabHeader?.getBoundingClientRect().height||48}px`);
        if (local) { updateLocal(); return; }
        root.querySelectorAll('span,p,label,h3,h4').forEach(e=>{
            if(e.children.length===0&&['标注背景与镂空区域，避免模型误判','标注特殊材质的区域，默认整体为烤漆','标注徽章的结构层次'].includes(e.textContent))e.classList.add('badge-function-tip');
        });
        for (const [toggle] of invertSwitches) if (!toggle.isConnected) invertSwitches.delete(toggle);
        root.querySelectorAll('.daelab-multi-color-mask-v1-panel input[type="checkbox"]').forEach(toggle => {
            const caption = toggle.parentElement?.querySelector('span');
            if (!invertSwitches.has(toggle)) invertSwitches.set(toggle, [toggle.getAttribute('role'), toggle.getAttribute('title'), caption?.textContent]);
            if (caption && caption.textContent !== '反转输出') caption.textContent = '反转输出';
            toggle.setAttribute('role', 'switch');
            toggle.title = toggle.checked ? '反转提取结果：已开启' : '反转提取结果：已关闭';
        });
        const effect = routeEffect();
        sections.hidden = effect;
        const enabled = state.section === 'background' ? state.background : state.section === 'material'
            ? itemValue(hierarchy(), 'badge.path.flat_height.special_material') : state.section === 'height' ? state.heightEnabled : true;
        for (const [key, s] of Object.entries(sectionButtons)) {
            s.group.hidden = false;
            s.b.setAttribute('aria-expanded', String(state.section === key));
            s.toggle.checked = key === 'height' ? state.heightEnabled : (key === 'background' ? state.background : itemValue(hierarchy(), 'badge.path.flat_height.special_material'));
            s.group.dataset.enabled = String(s.toggle.checked);
            s.group.dataset.expanded = String(state.section === key);
            s.toggle.title = s.toggle.checked ? '点击禁用' : '点击启用';
        }
        const visible = !effect && state.section && enabled ? CONFIGS[state.section][0] : null;
        let previewHeader = null;
        for (const item of root.querySelectorAll(':scope > [data-testid="app-mode-widget-item"]')) {
            const id = Number(item.dataset.widgetKey?.split(':').at(-2));
            const show = id === visible && state.section !== 'height';
            item.toggleAttribute(HIDDEN, !show);
            item.toggleAttribute('data-badge-build-list', show);
            if (show) previewHeader = item.querySelector('.daelab-multi-color-mask-v1-panel, .daelab-badge-material-region-v1-panel')?.firstElementChild;
        }
        heightBoard.element.hidden = visible !== 3 || !isNodeAvailableInAppMode(node(3));
        heightBoard.setAvailable(Boolean(state.pixels));
        if (previewHeader) {
            if (preview.parentElement !== previewHeader) previewHeader.insertBefore(preview, previewHeader.lastElementChild);
        } else preview.remove();
        const selected = normalizeImageSelection(imageWidget()?.value), key = JSON.stringify([sourceNode()?.id, selected]);
        if (state.sourceKey !== key) {
            state.sourceKey = key; void load(selected, key);
            filename.textContent = selected?.filename || '未选择图片';
            filename.title = selected ? [selected.subfolder, selected.filename].filter(Boolean).join('/') : '未选择图片';
        }
        preview.disabled = !state.pixels || !state.section || !enabled || effect;
        view.options[3].disabled = state.section !== 'background';
        view.disabled = !state.preview;
        const dirty = state.preview && JSON.stringify(config()) !== state.signature;
        const missingHeight = !isPromptOnlyBuild(graph) && !effect && state.heightEnabled && !normalizeImageSelection(node(2)?.widgets?.find(w => w.name === 'image')?.value);
        const message = missingHeight ? '高度建立已开启，尚未上传高度图。请在高度建立中上传图片。' : state.imageTab === 'height' && !state.heightEnabled ? '高度建立已关闭；图片和分区配置已保留。' : !enabled ? '此功能已禁用，可通过旁边的开关启用' : dirty ? '预览待更新' : state.preview ? '预览已更新' : state.section ? '点击颜色块选色，再点击预览遮罩' : '选择下方功能展开配置';
        if (status.textContent !== message) status.textContent = message;
        draw();
    }
    let generation;
    function invalidateGeneration() {
        const session = getPrototypeSession(graph, tabId);
        session.preview = null; session.phase = 'changed'; session.message = '输出配置已修改，请重新生成。';
        if (local) node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
    }
    const localParts = [];
    let selectionRow, editRow, editEnd, selectionActions, localActions, localStatus, selectionStatus, localApply, localPreview, advanced, sourceButtons, mapActions, mapPreview, mapRegenerate, mapStatus, mapProgressBar;
    let lastMapMode = null;
    let expandedBlock = 'selection';
    let confirmedSelection = null;
    let localGenerating = false;
    const selectionSignature = () => JSON.stringify([state.sourceKey, state.section, itemValue(hierarchy(), 'badge.post.local.color_id_map'), config()]);
    const choices = [];
    function choose(suffix) {
        colorPicker.close();
        node(95)?.daelabBooleanHierarchyV1?.setItemValue(`badge.post.local.${suffix}`, true);
        node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
        if (suffix.startsWith('selection.')) { state.preview = null; state.view = 'original'; confirmedSelection = null; }
        update();
    }
    function choiceRow(title, entries, block) {
        const row = document.createElement('section'); row.className = 'badge-local-options';
        const heading = button(title, row, () => { colorPicker.close(); expandedBlock = block; update(); });
        heading.className = 'badge-local-block-heading';
        row.dataset.block = block;
        const group = segmented ? make('div', '', row) : row;
        if (segmented) { group.setAttribute('role', 'group'); group.setAttribute('aria-label', title); }
        const controls = [];
        for (const [suffix, label] of entries) {
            const b = button(label, group, () => choose(suffix)); choices.push([b, suffix]); controls.push(b);
        }
        if (segmented) decorateExclusivePair(group, controls, block === 'selection' ? ['color', 'brush'] : ['text', 'material']);
        localParts.push(row); return row;
    }
    if (local) {
        selectionRow = choiceRow('1. 编辑哪个区域', [['selection.color', '按颜色选遮罩'], ['selection.polygon', '画笔 / Polygon 选区']], 'selection');
        editRow = choiceRow('2. 对该区域做什么更改', [['semantic', '语义描述'], ['material', '预设材质 Prompt']], 'edit');
        selectionRow.classList.add('badge-local-block-start'); editRow.classList.add('badge-local-block-start');
        advanced = document.createElement('div'); advanced.className = 'badge-color-source';
        const sourceRow = make('div', '', advanced); sourceRow.className = 'badge-color-source-row';
        make('span', '取色来源', sourceRow);
        const sourceToggle = make('div', '', sourceRow); sourceToggle.className = 'badge-color-source-toggle'; sourceToggle.setAttribute('role', 'radiogroup'); sourceToggle.setAttribute('aria-label', '取色来源');
        sourceButtons = [false, true].map(useMap => {
            const control = button(useMap ? segmented ? '使用色彩分区图' : '生成色彩分区图' : '使用原图', sourceToggle, () => {
                if (!live()) return;
                node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.color_id_map', useMap);
                update();
            });
            control.setAttribute('role', 'radio');
            control.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const target = sourceButtons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : Number(!useMap)]; target.click(); target.focus(); } };
            return control;
        });
        if (segmented) decorateExclusivePair(sourceToggle, sourceButtons, ['image', 'map']);
        mapActions = make('div', '', sourceRow); mapActions.className = 'badge-color-source-actions';
        mapPreview = button('预览色彩分区图', mapActions, () => { mapShown = !(mapShown && state.view === 'original'); state.view = 'original'; update(); });
        mapRegenerate = button('↻', mapActions, () => void generateMap(Boolean(mapImage), true));
        mapRegenerate.setAttribute('aria-label', '重新生成色彩分区图'); mapRegenerate.title = '重新生成色彩分区图';
        mapRegenerate.className = 'badge-color-source-regenerate';
        mapStatus = make('span', '', advanced); mapStatus.setAttribute('role', 'status');
        mapProgressBar = make('progress', '', advanced); mapProgressBar.max = 100; mapProgressBar.setAttribute('aria-label', '色彩分区图生成进度');
        make('p', segmented ? '使用 GPT-Image-2 生成颜色编号图，保留区域结构，供取色与遮罩匹配。' : '色彩分区图为本地色彩简化预览（原型），用于演示取色与遮罩匹配。', advanced);
        localParts.push(advanced);
        selectionActions = document.createElement('section'); selectionActions.className = 'badge-local-options badge-local-block-end';
        localParts.push(selectionActions);
        editEnd = document.createElement('div'); editEnd.className = 'badge-local-options badge-local-block-end badge-local-edit-end';
        localParts.push(editEnd);
        localActions = document.createElement('section'); localActions.className = 'badge-local-options badge-local-page-actions';
        localPreview = button('预览遮罩', selectionRow, toggleMaskPreview);
        localPreview.className = 'badge-build-mask-preview';
        selectionStatus = make('p', '', selectionActions); selectionStatus.setAttribute('role', 'status');
        const generateLocal = async () => {
            if (!live() || localGenerating) return;
            localGenerating = true;
            try {
                // Keep the existing simulation confirmation contract behind one user action.
                node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
                await runPrototype(graph, 'local');
                if (!live() || confirmedSelection !== selectionSignature()) return;
                const current = stageSnapshot(graph, 'local');
                if (current.error || getPrototypeSession(graph, 'local').preview !== current.fingerprint) return;
                node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', true);
                await runPrototype(graph, 'local'); if (live()) update();
            } finally { localGenerating = false; }
        };
        generation = createGenerationPanel(graph, 'local', { live, onGenerate: generateLocal, onChange: invalidateGeneration });
        localActions.append(generation.element);
        localApply = generation.button; localStatus = generation.status;
        localParts.push(localActions);
    }
    function updateLocal() {
        if (segmented) {
            const source = localTargets87(graph).source;
            targetSourceButtons.forEach((control, i) => { const selected = (i === 0 ? 'generated' : 'existing') === source; control.setAttribute('aria-checked', String(selected)); control.tabIndex = selected ? 0 : -1; });
            uploadButton.hidden = existing.hidden = source !== 'existing';
            uploadButton.disabled = Boolean(latestUpload);
        }
        sections.hidden = true;
        const h = hierarchy(), enabled = itemValue(h, 'badge.post.local');
        const color = itemValue(h, 'badge.post.local.selection.color');
        const polygon = itemValue(h, 'badge.post.local.selection.polygon');
        const mapMode = itemValue(h, 'badge.post.local.color_id_map');
        view.querySelector('option[value=original]').textContent = color && mapMode && mapShown && (!segmented || selectionPixels()) ? '色彩分区图' : '原图';
        if (lastMapMode !== mapMode) {
            if (!mapMode) { ++mapJob; mapBusy = false; }
            mapShown = true; lastMapMode = mapMode; colorPicker.close(); state.preview = null; state.view = 'original'; confirmedSelection = null;
            node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
        }
        sourceButtons.forEach((control, i) => { control.setAttribute('aria-checked', String(Boolean(i) === mapMode)); control.tabIndex = Boolean(i) === mapMode ? 0 : -1; control.disabled = !enabled || !state.pixels || !isNodeAvailableInAppMode(node(104)); });
        // #8.7 may restore an existing map here, but only the explicit button may submit GPT work.
        if (mapMode && color && state.pixels && (!mapSource || mapSource !== state.pixels || (!segmented && !mapImage && !mapBusy && !mapError))) void generateMap(false, !segmented);
        mapActions.hidden = !mapMode; mapStatus.hidden = !mapMode; mapProgressBar.hidden = !mapMode || !mapBusy;
        mapProgressBar.value = mapProgress;
        if (segmented && mapBusy) mapProgressBar.removeAttribute('value');
        mapStatus.textContent = mapError || (mapBusy ? segmented ? '正在准备色彩分区图…' : `生成中 ${mapProgress}%` : mapImage ? '已生成' : state.pixels && segmented ? '点击“生成色彩分区图”开始生成。' : '请先上传目标图');
        mapPreview.disabled = !enabled || !selectionPixels() || mapBusy;
        mapPreview.setAttribute('aria-pressed', String(Boolean(mapImage && mapShown && state.view === 'original')));
        mapRegenerate.disabled = !enabled || !state.pixels || mapBusy;
        if (segmented) {
            const label = mapImage ? '重新生成色彩分区图' : '生成色彩分区图';
            mapRegenerate.textContent = mapBusy ? '处理中…' : label;
            mapRegenerate.setAttribute('aria-label', label); mapRegenerate.title = label;
            mapRegenerate.style.width = 'auto'; mapRegenerate.style.minWidth = 'max-content';
        }
        const nextSection = color ? 'color' : 'polygon';
        if (nextSection !== state.section) { state.section = nextSection; state.preview = null; state.view = 'original'; colorPicker.close(); }
        const available = enabled && isNodeAvailableInAppMode(sourceNode());
        element.hidden = !available;
        const editingCanvas = available && polygon && !color && expandedBlock === 'selection' && isNodeAvailableInAppMode(node(142));
        frame.hidden = editingCanvas;
        toolbar.hidden = editingCanvas;
        const resizeBar = element.querySelector('.badge-reference-resize');
        if (resizeBar) resizeBar.hidden = editingCanvas;
        element.dataset.canvasEditing = String(editingCanvas);
        for (const part of localParts) part.hidden = !enabled;
        advanced.hidden = !enabled || !color || expandedBlock !== 'selection';
        selectionActions.hidden = !enabled || expandedBlock !== 'selection';
        editEnd.hidden = !enabled || expandedBlock !== 'edit';
        for (const row of [selectionRow, editRow]) {
            const expanded = row.dataset.block === expandedBlock;
            row.dataset.expanded = String(expanded);
            const pair = row.querySelector('.badge-exclusive-pair'); if (pair) pair.hidden = !expanded;
            row.querySelector('.badge-local-block-heading').setAttribute('aria-expanded', String(expanded));
            row.querySelectorAll('button:not(.badge-local-block-heading):not(.badge-build-mask-preview)').forEach(b => { b.hidden = !expanded; });
        }
        for (const [b, suffix] of choices) { b.setAttribute('aria-pressed', String(itemValue(h, `badge.post.local.${suffix}`))); b.disabled = !enabled; }
        const selected = available ? normalizeImageSelection(imageWidget()?.value) : null;
        if (segmented && available) syncPolygonTarget87(graph);
        const key = JSON.stringify([sourceNode()?.id, selected]);
        if (state.sourceKey !== key) {
            state.sourceKey = key; colorPicker.close();
            node(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
            void load(selected, key);
            filename.textContent = selected?.filename || '未选择图片';
            filename.title = selected ? [selected.subfolder, selected.filename].filter(Boolean).join('/') : '未选择图片';
        }
        // Keep native App Mode items as direct children, preserving its visibility and lifecycle contracts.
        const items = [...root.querySelectorAll(':scope > [data-testid="app-mode-widget-item"]')];
        for (const item of items) {
            const id = Number(item.dataset.widgetKey?.split(':').at(-2));
            const show = enabled && ((expandedBlock === 'selection' && ((id === 104 && color) || (id === 142 && polygon))) || (expandedBlock === 'edit' && ((id === 105 && itemValue(h, 'badge.post.local.semantic')) || (id === 106 && itemValue(h, 'badge.post.local.material'))))) && isNodeAvailableInAppMode(node(id));
            item.toggleAttribute(HIDDEN, !show); item.toggleAttribute('data-badge-build-list', show);
            item.toggleAttribute('data-badge-local-body', show);
        }
        // Move only our section headers. Native items stay under their Vue-owned parent.
        const findItem = ids => items.find(item => ids.includes(Number(item.dataset.widgetKey?.split(':').at(-2))));
        const place = (part, anchor) => { if (part.nextElementSibling !== anchor) root.insertBefore(part, anchor); };
        place(editEnd, localActions);
        place(editRow, findItem([105, 106]) || editEnd);
        place(selectionActions, editRow);
        place(selectionRow, findItem([104, 142]) || selectionActions);
        const maskNode = node(color ? 104 : 142);
        const colorPanel = items.find(item => Number(item.dataset.widgetKey?.split(':').at(-2)) === 104)?.querySelector('.daelab-multi-color-mask-v1-panel');
        if (colorPanel && advanced.parentElement !== colorPanel) colorPanel.insertBefore(advanced, colorPanel.firstElementChild?.nextSibling || null);
        const maskHeader = color ? colorPanel?.firstElementChild : node(142)?.polygonWidget?.container?.querySelector('.badge-selection-tools');
        const previewParent = maskHeader || selectionRow;
        if (localPreview.parentElement !== previewParent || localPreview !== previewParent.lastElementChild) previewParent.append(localPreview);
        localPreview.hidden = !enabled || expandedBlock !== 'selection';
        preview.disabled = !state.pixels || !isNodeAvailableInAppMode(maskNode);
        view.disabled = !state.preview;
        const dirty = Boolean(state.preview && JSON.stringify(config()) !== state.signature);
        status.textContent = dirty ? '选区预览待更新' : state.preview ? '选区预览已更新' : polygon ? '使用下方手绘编辑器绘制选区' : mapMode ? segmented && !selectionPixels() ? mapBusy ? '当前显示原图，正在生成色彩分区图…' : '当前显示原图，请点击“生成色彩分区图”后取色。' : '从色彩分区图取色，然后预览选区' : '从原图取色，然后预览选区';
        const snapshot = stageSnapshot(graph, 'local'), session = getPrototypeSession(graph, 'local');
        localPreview.disabled = !available || !selectionPixels() || (!color && !polygon) || !isNodeAvailableInAppMode(maskNode) || session.busy;
        const selectionReady = confirmedSelection === selectionSignature() && !dirty;
        localApply.disabled = !available || Boolean(snapshot.error) || !selectionReady || session.busy;
        selectionStatus.textContent = selectionReady ? color ? '选区已确认，点击“预览遮罩”可在取色来源图与遮罩之间切换。' : '选区已确认，点击“预览遮罩”可在取色来源图与遮罩之间切换。' : confirmedSelection ? '选区已改变，请重新查看。' : '先选择区域；下方的修改仅作用于此选区。';
        const drawing = node(142)?.polygonWidget;
        const showCanvasMask = editingCanvas && maskActive() && state.pixels;
        if (drawing) {
            const previous = drawing.badgePrototypeMaskPreview;
            if (showCanvasMask && previous?.info !== state.preview) {
                drawing.badgePrototypeMaskPreview = { info: state.preview, width: state.pixels.width, height: state.pixels.height };
                node(142).redrawPolygonCanvas?.();
            } else if (!showCanvasMask && previous) {
                delete drawing.badgePrototypeMaskPreview;
                node(142).redrawPolygonCanvas?.();
            }
        }
        localStatus.textContent = graph.extra?.daelabBadgeExecutionV1?.version === 1
            ? session.busy ? '正在应用修改…' : snapshot.error ? `无法生成：${snapshot.error}` : !selectionReady ? '请先在第 1 块点击“预览遮罩”确认选区。' : session.message || '设置好修改内容后应用。'
            : session.busy ? '正在模拟应用…' : snapshot.error ? `无法生成：${snapshot.error}` : !selectionReady ? '请先在第 1 块点击“预览遮罩”确认选区。' : (session.phase === 'applied' && session.preview === snapshot.fingerprint ? '已模拟应用修改，目标图保持原样。' : '设置好修改内容后应用。当前为交互模拟，不生成图片。');
        draw();
    }
    if (!local) {
        generation = createGenerationPanel(graph, 'build', { live, onGenerate: () => runPrototype(graph, 'build'), onChange: invalidateGeneration });
        root.append(generation.element);
    }
    // Read the installed GPT Image 2 presets; never manufacture unsupported ratio buttons.
    void api.fetchApi('/object_info/OpenAIGPTImageNodeV2').then(r => {
        if (!r.ok) throw new Error('Node schema unavailable');
        return r.json();
    }).then(data => {
        const model = data.OpenAIGPTImageNodeV2?.input?.required?.model?.[1]?.options?.find(o => o.key === 'gpt-image-2');
        const sizes = model?.inputs?.required?.size?.[1]?.options;
        if (live() && Array.isArray(sizes)) generation.setPresets(sizes);
    }).catch(() => { /* Retain the verified bundled preset list when discovery is unavailable. */ });
    root.dataset.badgeBuild = '1';
    if (local) {
        root.dataset.badgeLocal = '1';
        root.append(...localParts);
    }
    root.querySelector('[data-daelab-app-layout-owned="tabs"]').after(element);
    if (!local) element.after(heightBoard.element);
    const referenceResize = attachReferenceResize(root, element, frame, graph, live);
    const resumeDrawing = event => {
        if (local && live() && event.target === node(142)?.polygonWidget?.canvas && maskActive()) {
            state.view = 'original'; update();
        }
    };
    root.addEventListener('pointerdown', resumeDrawing, true);
    update();
    return { graph, workflowId, root, element, tabId, update, dispose() {
        root.removeEventListener('pointerdown', resumeDrawing, true);
        if (local && node(142)?.polygonWidget?.badgePrototypeMaskPreview) {
            delete node(142).polygonWidget.badgePrototypeMaskPreview;
            node(142).redrawPolygonCanvas?.();
        }
        state.disposed = true; generation.dispose(); referenceResize.dispose(); colorPicker.dispose(); heightBoard.dispose(); materialStrip.dispose(); localPreview?.remove(); preview.remove(); gallery.close(); element.remove(); delete root.dataset.badgeBuild;
        root.style.removeProperty('--badge-tabs-height');root.querySelectorAll('.badge-function-tip').forEach(e=>e.classList.remove('badge-function-tip'));
        for (const [toggle, attrs] of invertSwitches) {
            ['role','title'].forEach((name,i) => attrs[i] === null ? toggle.removeAttribute(name) : toggle.setAttribute(name, attrs[i]));
            const caption = toggle.parentElement?.querySelector('span');
            if (caption && attrs[2] != null) caption.textContent = attrs[2];
        }
        invertSwitches.clear();
        for (const part of localParts) part.remove();
        delete root.dataset.badgeLocal;
        root.querySelectorAll('[data-badge-local-body]').forEach(e => e.removeAttribute('data-badge-local-body'));
        root.querySelectorAll(`[${HIDDEN}],[data-badge-build-list]`).forEach(e => { e.removeAttribute(HIDDEN); e.removeAttribute('data-badge-build-list'); });
    } };
}

app.registerExtension({ name: 'DAELAB.BadgeBuildPrototype', setup() {
    const installed = Symbol.for('DAELAB.BadgeBuildPrototype.installed');
    if (app[installed]) return;
    app[installed] = true;
    const style = document.createElement('style');
    style.textContent = GENERATION_CSS + `
    .badge-color-source {padding:10px 0;border-bottom:1px solid #414950;margin-bottom:8px;}
    .badge-color-source[hidden] {display:none!important;}
    .badge-color-source-row {display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .badge-color-source-toggle {display:flex;gap:0;border:1px solid #596975;border-radius:6px;overflow:hidden;}
    .badge-color-source .badge-color-source-toggle button {border:0;border-radius:0;box-shadow:none;}
    .badge-color-source-toggle button + button {border-left:1px solid #596975!important;}
    .badge-color-source-actions {display:flex;align-items:center;gap:5px;margin-left:auto;}
    .badge-color-source-actions[hidden],.badge-color-source progress[hidden],.badge-color-source span[hidden] {display:none!important;}
    .badge-color-source .badge-color-source-regenerate {font-size:21px;padding:1px 8px;}
    .badge-color-source [role="status"] {display:inline-block;margin-top:8px;font-size:12px;color:#aabac5;}
    .badge-color-source progress {display:block;width:100%;height:5px;margin-top:5px;accent-color:#39c8b1;}
    .badge-color-source button[aria-checked="true"] {background:#287d70;color:white;}
    .badge-color-source button[aria-checked="false"] {background:#242b31;color:#abb5bd;}
    .badge-color-source button {padding:6px 12px;border:1px solid #596975;border-radius:6px;background:#283139;color:#dce7ee;cursor:pointer;}
    .badge-color-source button[aria-pressed="true"] {background:#254a43;border-color:#39c8b1;color:#dcfff5;box-shadow:inset 0 0 0 1px #39c8b1;}
    .badge-color-source button:disabled {opacity:.45;cursor:default;}
    .badge-color-source button:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    .badge-color-source p {margin:7px 0 0;color:#aabac5;font-size:12px;}
    .badge-local-options {flex:none;margin:0 8px;padding:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-inline:1px solid #46535d;background:#20282e;color:#dce7ee;}
    .badge-local-block-start {margin-top:14px;border-top:1px solid #46535d;border-radius:10px 10px 0 0;padding-bottom:10px;}
    .badge-local-block-start strong {flex-basis:100%;margin-bottom:5px;}
    .badge-local-block-end {border-bottom:1px solid #46535d;border-radius:0 0 10px 10px;margin-bottom:4px;}
    [data-badge-local-body] {margin:0 8px!important;padding:4px 12px!important;border-inline:1px solid #46535d;background:#20282e;}
    [data-badge-local-body] > div:first-child {display:none!important;}
    .badge-local-options[hidden] {display:none!important;}
    .badge-local-options strong {font-size:14px;margin-right:10px;}
    .badge-local-options p {width:100%;margin:4px 0;color:#aabac5;font-size:12px;}
    .badge-local-options button {padding:7px 14px;border-radius:999px;border:1px solid #596975;background:#283139;color:#dce7ee;cursor:pointer;}
    .badge-local-options button[aria-pressed="true"] {border-color:#39c8b1;background:#254a43;color:#dcfff5;box-shadow:inset 0 0 0 1px #39c8b1;}
    .badge-local-options button:disabled {opacity:.45;cursor:default;}
    .badge-local-options button:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    .badge-local-options button[hidden] {display:none!important;}
    .badge-local-options .badge-local-block-heading {flex-basis:100%;display:flex;justify-content:space-between;text-align:left;font-weight:600;font-size:14px;border:0;border-radius:0;padding:2px 0 7px;background:transparent;color:#e4edf4;}
    .badge-local-block-heading::after {content:'▾';color:#9daebc;}
    .badge-local-block-heading[aria-expanded="false"]::after {content:'▸';}
    .badge-local-block-start[data-expanded="false"] {border-bottom:1px solid #46535d;border-radius:10px;padding-bottom:8px;}
    .badge-local-edit-end {padding:4px 12px;}
    .badge-local-page-actions {display:block;margin:0;padding:0;border:0;background:transparent;}
    .badge-local-page-actions .badge-generation p{width:auto;}
    .badge-local-page-actions .badge-local-primary {width:100%;flex-basis:100%;min-height:44px;border-radius:8px;border:1px solid #249fea;background:#087fc7;color:#fff;font-weight:600;}
    .badge-local-page-actions .badge-local-primary:hover:not(:disabled) {background:#0993df;}
    details.badge-local-options {display:block;}
    details.badge-local-options button {margin-top:10px;}
    [data-badge-build="1"] { overflow-y:auto!important;overflow-x:hidden!important; }
    [data-badge-build="1"] > [data-daelab-app-layout-owned="panel"],
    [data-badge-build="1"] > [data-daelab-badge-prototype], [${HIDDEN}] { display:none!important; }
    .badge-build-workspace {flex:none;min-width:0;padding:8px;background:#1b2024;color:#e4eaee;}
    .badge-reference-resize {height:14px;margin:3px -8px -8px;display:flex;align-items:center;justify-content:center;cursor:ns-resize;touch-action:none;user-select:none;border-radius:3px;}
    .badge-reference-resize::after {content:'';width:48px;height:4px;border-radius:9px;background:#65747f;}
    .badge-reference-resize:hover,.badge-reference-resize[data-dragging],.badge-reference-resize:focus-visible {background:#2d4555;outline:1px solid #62a7d7;outline-offset:-1px;}
    .badge-reference-resize:hover::after,.badge-reference-resize[data-dragging]::after {background:#80bfff;}
    [data-badge-build="1"] > [data-daelab-app-layout-owned="tabs"] {position:sticky;top:0;z-index:12;background:#171717;}
    [data-badge-build="1"] > .badge-build-workspace {position:sticky;top:var(--badge-tabs-height,48px);z-index:11;box-shadow:0 3px 8px #0005;}
    .badge-build-base-prompt {display:block;width:100%;box-sizing:border-box;margin-bottom:10px;font-size:14px;font-weight:600;}
    .badge-build-base-prompt summary {cursor:pointer;padding:4px 0;user-select:none;}
    .badge-build-base-prompt summary:focus-visible {outline:2px solid #80bfff;outline-offset:2px;border-radius:4px;}
    .badge-build-base-prompt textarea {display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:10px;border:1px solid #52606b;border-radius:6px;background:#242b31;color:#e4edf4;resize:vertical;font:inherit;font-weight:normal;}
    .badge-function-tip {display:block!important;flex:1 1 100%;width:100%;min-width:0;box-sizing:border-box;border-left:3px solid #62a7d7;border-radius:4px;background:#223039;padding:10px 12px!important;color:#cde3f3!important;font-size:13px!important;font-weight:normal!important;}
    .badge-color-popup {position:fixed;z-index:100000;width:260px;padding:12px;border:1px solid #647885;border-radius:8px;background:#202a31;color:#e5edf4;box-shadow:0 8px 30px #0008;}
    .badge-color-popup[hidden] {display:none;}
    .badge-color-popup canvas {display:block;width:240px;height:130px;margin:8px 0;cursor:crosshair;}
    .badge-color-popup label {display:flex;align-items:center;gap:8px;margin:6px 0;}
    .badge-color-popup input {min-width:0;flex:1;background:#303d47;color:white;}
    .badge-color-popup button {padding:5px 8px;margin:4px 4px 0 0;background:#315d7b;color:white;border:1px solid #6990ab;border-radius:4px;cursor:pointer;}
    .badge-build-bar,.badge-build-sections {display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:4px 0;}
    .badge-build-upload-bar {flex-wrap:nowrap;}
    .badge-build-upload-bar > [role="tablist"] {display:flex;gap:4px;flex:none;}
    .badge-build-upload-actions {display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-left:auto;min-width:0;}
    .badge-build-filename {font-size:12px;color:#c5c9cf;min-width:0;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .badge-build-workspace .badge-build-icon-button {display:flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;padding:6px;}
    .badge-build-icon-button img {width:20px;height:20px;filter:invert(1);}
    .badge-build-workspace button,.badge-build-workspace select {background:#2d343a;color:#e4eaee;border:1px solid #52606b;border-radius:6px;padding:5px 8px;font-size:12px;max-width:190px;}
    .badge-build-workspace button {cursor:pointer;} .badge-build-workspace button:disabled {opacity:.45;cursor:default;}
    .badge-build-workspace [aria-selected="true"] {border-color:#39c8b1;background:#254a43;}
    .badge-build-workspace :focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    .badge-build-mask-preview,.badge-local-options .badge-build-mask-preview,.badge-selection-tools .badge-build-mask-preview {flex:none;width:auto;min-width:78px;height:auto;margin-left:auto;padding:4px 10px;border:1px solid #3299eb;border-radius:6px;background:#087ccb;color:white;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer;}
    .badge-height-board {flex:0 0 auto;min-height:0;overflow:visible;padding:10px;color:#e4eaee;}
    .badge-height-board[hidden] {display:none;}
    .badge-height-introduction {margin:0 0 14px;font-weight:600;font-size:14px;}
    .badge-height-board-header,.badge-height-fallback {display:flex;align-items:center;gap:12px;margin-bottom:10px;}
    .badge-height-fallback {font-size:12px;color:#abb9c4;}
    .badge-height-board input,.badge-height-board select,.badge-height-board button {background:#292f35;color:#e4eaee;border:1px solid #4d5a65;border-radius:5px;padding:5px;}
    .badge-height-board button {cursor:pointer;}
    .badge-height-board button:disabled {opacity:.4;cursor:default;}
    .badge-height-board .badge-build-mask-preview {background:#087ccb;}
    .badge-height-tier {border:1px solid #414c55;border-radius:8px;padding:8px;margin-bottom:6px;background:#20262b;}
    .badge-height-tier[data-over] {border-color:#25c9b5;background:#23463f;}
    .badge-height-tier-title {display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;}
    .badge-height-alpha {display:flex;align-items:center;gap:6px;font-weight:normal;color:#bdc9d2;}
    .badge-height-tier-actions {margin-left:auto;display:flex;gap:6px;}
    .badge-height-tier-actions button {display:flex;align-items:center;gap:4px;white-space:nowrap;}
    .badge-height-tier-actions img {width:16px;height:16px;filter:invert(1);}
    .badge-height-tier-title {flex-wrap:wrap;}
    .badge-height-cards {margin-left:24px;padding:8px!important;border:1px solid #414f59;border-radius:6px;}
    .badge-height-group-handle {border-style:dashed!important;color:#a8bbc9!important;font-size:12px;}
    .badge-height-tier[data-over]::after {content:attr(data-drop-label);display:block;color:#70e3cf;border-top:2px solid #25c9b5;margin-top:6px;padding-top:4px;}
    .badge-height-tier[data-over="swap"] {outline:2px solid #25c9b5;}
    .badge-height-tier[data-over="add"] .badge-height-color-list {outline:2px dashed #25c9b5;outline-offset:3px;}
    .badge-height-drag-ghost {position:fixed;z-index:99999;pointer-events:none;display:flex;gap:5px;align-items:center;padding:10px;border:1px solid #25c9b5;border-radius:8px;background:#23393e;color:white;box-shadow:0 4px 20px #0008;}
    .badge-height-drag-ghost span {width:18px;height:18px;border:1px solid #aaa;border-radius:3px;}
    .badge-height-alpha-track {display:flex;flex-direction:column;width:160px;}
    .badge-height-alpha-value {min-width:4ch;text-align:right;font-variant-numeric:tabular-nums;color:#e4eaee;}
    .badge-height-alpha input[type=range] {width:100%;margin:0;padding:0;accent-color:#62a7d7;border:0;cursor:pointer;}
    .badge-height-alpha-ticks {display:flex;justify-content:space-between;padding:0 7px;pointer-events:none;}
    .badge-height-alpha-ticks i {height:4px;width:1px;background:#8a99a5;}
    .badge-height-count {display:flex;align-items:center;gap:10px;}
    .badge-height-count button {width:30px;height:30px;}
    .badge-height-tier-title > span {width:16px;height:16px;border:1px solid #88929b;border-radius:3px;}
    .badge-height-cards {display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start;}
    .badge-height-color-actions {display:flex;gap:6px;align-items:center;padding-top:3px;}
    .badge-height-board .badge-height-circle {display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border-radius:50%;font-size:19px;flex:none;}
    .badge-height-color-list {display:flex;flex-direction:column;gap:6px;min-width:0;}
    .badge-height-color-list .badge-height-color {align-self:stretch;}
    .badge-height-color-list .height-hex {flex:1;min-width:70px;}
    .badge-height-empty {color:#8d9ba6;font-size:12px;padding:10px 0;}
    .badge-height-color {display:flex;gap:5px;align-items:center;border:1px solid #4a5964;border-radius:6px;padding:4px;background:#2b343c;}
    .badge-height-color [draggable] {cursor:grab;padding:4px;}
    .badge-height-color input[type=color] {width:30px;height:30px;padding:2px;cursor:pointer;}
    .badge-height-color .height-hex {width:78px;}
    .badge-height-color input[type=number] {width:48px;}
    .badge-height-color select {width:85px;}
    .badge-height-board :focus-visible {outline:2px solid #74baff;outline-offset:2px;}
    .badge-build-mask-preview + span {margin-left:0!important;flex:none;}
    .badge-build-mask-preview[aria-pressed="true"],.badge-local-options .badge-build-mask-preview[aria-pressed="true"],.badge-selection-tools .badge-build-mask-preview[aria-pressed="true"]{background:#254a43;border-color:#39c8b1;color:#dcfff5;box-shadow:inset 0 0 0 1px #39c8b1;}
    .badge-build-mask-preview:hover:not([aria-pressed="true"]) {background:#096bac;}
    .badge-build-mask-preview:disabled {opacity:.45;cursor:default;}
    .badge-build-mask-preview:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel {height:auto!important;min-height:0!important;max-height:none!important;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel [data-color-group-id] {height:46px!important;min-height:46px!important;grid-template-rows:1fr!important;grid-template-columns:122px 90px minmax(0,1fr) auto!important;align-items:center;gap:8px!important;padding:8px!important;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel [data-color-group-id] > div {display:contents!important;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel [data-color-group-id] > div > span {display:none!important;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel [data-color-group-id] > div:nth-child(2) > label {display:flex!important;grid-column:4;align-items:center;gap:8px!important;padding:0!important;border:0!important;background:transparent!important;white-space:nowrap;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel [data-color-group-id] > div:nth-child(2) > label > span {display:inline!important;order:-1;font-size:12px;color:#c5c9cf;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel input[type="checkbox"] {appearance:none!important;-webkit-appearance:none!important;position:relative;grid-column:4;width:34px!important;height:20px!important;margin:0!important;border:1px solid #7f8993;border-radius:999px;background:#454e57;cursor:pointer;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel input[type="checkbox"]::after {content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;border-radius:50%;background:#e5e9ed;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel input[type="checkbox"]:checked {background:#25a990;border-color:#39c8b1;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel input[type="checkbox"]:checked::after {left:16px;background:white;}
    [data-badge-build="1"] .daelab-multi-color-mask-v1-panel input[type="checkbox"]:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    [data-badge-build="1"] .daelab-badge-material-region-v1-panel {height:auto!important;min-height:0!important;max-height:none!important;container-type:inline-size;}
    [data-badge-material-compact] {height:auto!important;min-height:46px!important;max-height:none!important;display:block!important;padding:8px!important;}
    .badge-material-compact-line {display:grid;grid-template-columns:36px 108px 74px 110px minmax(150px,1fr) 26px;gap:8px;align-items:center;}
    .badge-material-compact-target {display:flex;gap:5px;align-items:center;min-width:0;}
    .badge-material-compact-target > span {display:none;}
    .badge-material-compact-target > button {display:flex!important;align-items:center;gap:6px;min-width:0;width:100%;height:30px;}
    .badge-material-compact-target > button img {width:22px!important;height:22px!important;flex:none;}
    .badge-material-compact-target > button span:first-of-type {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .badge-material-compact-strength {display:flex;align-items:center;gap:4px;font-size:12px;color:#aeb4bc;}
    .badge-material-compact-strength input {width:100%!important;min-width:50px!important;flex:1;accent-color:#62a7d7;cursor:pointer;}
    .badge-material-compact-strength > span {flex:none;}
    [data-badge-build="1"] .daelab-badge-material-region-v1-panel > div:first-child > button:nth-of-type(3),
    [data-badge-build="1"] .daelab-badge-material-region-v1-panel > div:first-child > [data-role="config-status"],
    [data-badge-build="1"] .daelab-badge-material-region-v1-panel > div:first-child > [data-role="config-status"] + span {display:none!important;}
    .badge-material-compact-more {height:28px;background:#292c31;color:#ddd;border:1px solid #45484e;border-radius:5px;cursor:pointer;}
    .badge-material-compact-extra {padding:10px 0 2px;color:#aeb4bc;font-size:12px;}
    .badge-material-compact-extra[hidden] {display:none;}
    .badge-material-compact-extra select {max-width:150px;}
    @container (max-width:570px) {.badge-material-compact-line {grid-template-columns:32px 108px 74px minmax(95px,1fr);gap:6px;}.badge-material-compact-strength {grid-column:2 / 4;}.badge-material-compact-more {grid-column:4;justify-self:end;width:26px;}}
    .badge-material-strip {display:flex;align-items:center;gap:6px;min-width:0;padding:10px 0;}
    .badge-material-strip-rail {display:flex;gap:8px;overflow-x:auto;min-width:0;flex:1;padding:4px;}
    .badge-material-strip button {color:#e4eaee;background:#2b3239;border:1px solid #57626d;border-radius:8px;cursor:pointer;}
    .badge-material-strip > button {flex:none;width:28px;height:40px;font-size:22px;}
    .badge-material-strip .badge-material-strip-card {position:relative;flex:0 0 96px;padding:6px;display:flex;flex-direction:column;gap:6px;align-items:center;font-size:12px;}
    .badge-material-strip-card img {width:82px;height:82px;object-fit:cover;border-radius:6px;}
    .badge-material-strip-card[aria-selected="true"] {border-color:#39cb86;background:#254a3c;box-shadow:inset 0 0 0 2px #39cb86;}
    .badge-material-strip-check {position:absolute;right:4px;top:4px;background:#39cb86;color:#082719;border-radius:4px;padding:0 4px;}
    .badge-material-strip button:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
    .badge-build-image {height:clamp(100px,27vh,300px);display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#282d32 0% 25%,#343b42 0% 50%) 50% / 18px 18px;border:1px dashed #65747f;border-radius:8px;overflow:hidden;}
    .badge-build-image canvas {width:100%;height:100%;object-fit:contain;}
    .badge-build-image [hidden],.badge-build-workspace [hidden] {display:none!important;}
    .badge-local-options .badge-exclusive-pair,.badge-color-source .badge-exclusive-pair,.badge-build-workspace .badge-target-source {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;max-width:480px;box-sizing:border-box;gap:3px;padding:4px;border:1px solid #86969f;border-radius:999px;background:#c4cdd2;overflow:visible;}
    .badge-build-workspace .badge-target-source {margin:2px 0 10px;}
    .badge-exclusive-pair[hidden] {display:none!important;}
    .badge-local-options .badge-exclusive-pair > button,.badge-color-source .badge-exclusive-pair > button,.badge-target-source > button {display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;min-height:40px;margin:0;padding:8px 10px;border:0!important;border-radius:999px;background:transparent;color:#35424b;box-shadow:none;font-weight:600;line-height:1.35;}
    .badge-exclusive-pair > button svg {width:19px;height:19px;flex:none;pointer-events:none;}
    .badge-exclusive-pair > button span {min-width:0;overflow-wrap:anywhere;}
    .badge-local-options .badge-exclusive-pair > button[aria-pressed="true"],.badge-color-source .badge-exclusive-pair > button[aria-checked="true"],.badge-target-source > button[aria-checked="true"] {background:#35434c;color:#f1f6f8;box-shadow:0 1px 3px #1115;}
    .badge-exclusive-pair > button:not(:disabled):hover {filter:brightness(1.08);}
    .badge-exclusive-pair > button:focus-visible {outline:2px solid #65baff;outline-offset:2px;}
    .badge-build-workspace .badge-build-capsule {display:flex;align-items:center;gap:0;border:1px solid #59616a;border-radius:999px;background:#282e34;color:#aab2bb;}
    .badge-build-upload-bar .badge-build-capsule > [role="tab"] {background:transparent;border:0;}
    .badge-build-capsule[data-enabled="true"] {border-color:#39c8b1;background:#254a43;color:#dcfff5;}
    .badge-build-capsule > button {position:relative;border:0;border-radius:999px;background:transparent;color:inherit;padding:8px 11px;}
    .badge-build-capsule[data-expanded="true"] > button::after {content:'';position:absolute;bottom:3px;left:30%;right:30%;height:2px;border-radius:2px;background:currentColor;}
    .badge-build-capsule-switch {appearance:none;-webkit-appearance:none;position:relative;flex:none;width:28px;height:16px;margin:0 10px 0 2px;border:1px solid #7f8993;border-radius:999px;background:#454e57;cursor:pointer;}
    .badge-build-capsule-switch::after {content:'';position:absolute;width:10px;height:10px;left:2px;top:2px;border-radius:50%;background:#d7dce1;}
    .badge-build-capsule-switch:checked {background:#25a990;border-color:#39c8b1;}
    .badge-build-capsule-switch:checked::after {left:14px;background:#fff;}
    .badge-build-sections span,.badge-build-workspace [role="status"] {font-size:11px;}
    .badge-build-gallery {width:min(850px,calc(100vw - 32px));max-height:85vh;box-sizing:border-box;padding:16px;border:1px solid #52606b;border-radius:12px;background:#1b2024;color:#e4eaee;overflow:auto;}
    .badge-build-gallery::backdrop {background:#0009;}
    .badge-build-gallery > .badge-build-bar {justify-content:space-between;}
    .badge-build-gallery > input {width:100%;box-sizing:border-box;margin:8px 0;padding:9px;background:#2d343a;color:#e4eaee;border:1px solid #52606b;border-radius:6px;}
    .badge-build-gallery-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px;}
    .badge-build-gallery-grid .badge-build-image-card {display:flex;flex-direction:column;align-items:stretch;gap:6px;max-width:none;min-width:0;padding:8px;text-align:left;}
    .badge-build-image-card img {width:100%;height:130px;object-fit:contain;background:repeating-conic-gradient(#282d32 0% 25%,#343b42 0% 50%) 50% / 16px 16px;border-radius:4px;}
    .badge-build-image-card span {overflow-wrap:anywhere;font-size:12px;}
    .badge-build-image-card[aria-pressed="true"] {border-color:#39c8b1;background:#254a43;}
    [data-badge-build-list] {flex:0 0 auto!important;min-height:0!important;overflow:visible!important;}
    `;
    document.head.append(style);
    setInterval(() => {
        const graph = getRootGraphSafely(app), root = document.querySelector('[data-testid="linear-widgets"]');
        const tabId = root?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tabId;
        const eligible = isBadgePrototype(graph) && ['build', 'local'].includes(tabId);
        if (!eligible || active && (active.tabId !== tabId || active.graph !== graph || active.workflowId !== graph.id || active.root !== root || !active.element.isConnected)) { active?.dispose(); active = null; }
        if (eligible) { active ??= mount(graph, root, tabId); active.update(); }
    }, 250);
} });
