import { app } from '/scripts/app.js';
import { api } from '/scripts/api.js';
import { getRootGraphSafely, isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { buildImageViewPath } from './app_mode_load_image_preview_model.mjs';
import { getBadgeNativeQueue } from './badge_app_prototype.js?v=20261119-build-menu';
import { localImageFromDrop } from './badge_image_drop_87.mjs?v=20260917-drop-1';
import { queueBadge87 } from './badge_execution_87_queue.mjs?v=20260916-content-1';
import { BADGE_APP_PALETTE } from './badge_ui_styles.mjs';
import { captureGenerationHistory, generationLoadIdentity } from './generation_ui_model.mjs';
import { accessModelReason, findAccessModel, loadModelAccess } from './model_access.mjs?v=20261119-model-matching';
import { bindCreativeButton } from './vendor/generation-ui-shared/creative_button.mjs';
import { bindCreativeField } from './vendor/generation-ui-shared/creative_field.mjs';
import { REGION_KEY, BUILD_RESULTS_CHANGED, OUTPUT_ID, DEFAULT_POLYGON, EDIT_MODES, compileEdit, compileCutout, defaultDraft, ensurePolygon, imageKey, imageWidgetValue, installedRmbgModel, setPosition, sourceRef, validPolygon } from './image_editing_model.mjs?v=20261119-local-edit';
import { createSelectionEditor } from './image_editing_selection.mjs?v=20261119-local-edit';

const ROOT = '[data-testid="linear-widgets"]';
const RIGHT = '[data-testid="linear-right-panel"]';
const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
const STAGES = [['build','效果图生成'],['local','局部修改'],['cutout','抠图']];
const runtime = new WeakMap();
let enqueueing = false;

function element(tag, parent, text, className) {
    const control = document.createElement(tag);
    if (text) control.textContent = text;
    if (className) control.className = className;
    parent?.append(control);
    return control;
}

function nodeImage(graph, id) {
    return sourceRef(graph.getNodeById(id)?.widgets?.find(widget => widget.name === 'image')?.value);
}

function workspaceState(graph, stage, marker) {
    const appState = graph.extra[REGION_KEY].workspaces ??= {};
    if (appState[stage]) return appState[stage];
    const legacy = stage === 'local' && graph.extra.daelabBadgePrototypeV1?.localTargets;
    const base = nodeImage(graph, marker[stage]) || sourceRef(legacy?.existing) || sourceRef(legacy?.generated);
    const state = { base, drafts: {}, history: [], mode:'rmbg', model:'RMBG-2.0' };
    if (base && stage === 'local') {
        const saved = legacy?.drafts?.[imageKey(base)];
        const draft = defaultDraft();
        const polygonId = marker.kind === 'badge' ? 142 : 673;
        const polygonNode = graph.getNodeById(polygonId);
        let shape = saved?.polygon;
        if (!shape) {
            try {
                const candidate = JSON.parse(polygonNode?.properties?.polygon_info || 'null');
                const prefix = 'load-image:' + (marker.sources?.[stage] ?? marker[stage]) + ':';
                if (candidate?.image?.startsWith(prefix) && imageKey(candidate.image.slice(prefix.length)) === imageKey(base)) shape = candidate;
            } catch { /* No prior polygon draft. */ }
        }
        if (shape) draft.legacyShape = shape;
        try {
            const color = JSON.parse(saved?.color || graph.getNodeById(104)?.widgets?.find(widget => widget.name === 'multi_color_mask_v1_panel')?.value || '{}');
            const groups = color.groups?.filter(group => /^#[a-f\d]{6}$/i.test(group.color));
            if (groups?.length) draft.colors = groups.map(({color,threshold,invert}) => ({color,threshold:Number.isFinite(Number(threshold))?Number(threshold):30,invert:Boolean(invert)}));
        } catch { /* Preserve the default group for malformed legacy data. */ }
        state.drafts[imageKey(base)] = draft;
    }
    appState[stage] = state;
    return state;
}

function restoreLegacyShape(draft, width, height) {
    const shape = draft.legacyShape;
    if (!shape) return;
    delete draft.legacyShape;
    const dimensions = shape.stateImageSize ?? shape.image_size;
    const oldWidth = dimensions?.width || width;
    const oldHeight = dimensions?.height || height;
    const unit = number => Math.max(0,Math.min(1,number));
    const convert = point => [unit(Number(point.x ?? point[0])/oldWidth),unit(Number(point.y ?? point[1])/oldHeight)];
    const polygons = (shape.polygons || (shape.points ? [shape.points] : []))
        .map(polygon => (polygon.points ?? polygon).map(convert));
    const savedIndex = shape.selectedIndex ?? 0;
    const activeIndex = validPolygon(polygons[savedIndex]) ? savedIndex : polygons.findIndex(validPolygon);
    draft.polygon = polygons[activeIndex] ?? null;
    draft.extraPolygons = polygons.filter((points,index)=>index!==activeIndex && validPolygon(points));
    draft.strokes.polygon = (shape.brushStrokes ?? shape.brush_strokes ?? []).filter(stroke=>stroke.diameter>0)
        .map(stroke => ({size:stroke.diameter,points:stroke.points.map(point=>[unit(point.x),unit(point.y)])}));
    draft.maskKind = 'polygon';
}

async function upload(file, prefix = 'source') {
    if (!IMAGE_TYPES.test(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
    const extension = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp' }[file.type];
    const data = new FormData();
    data.set('image', file, prefix + '-' + crypto.randomUUID() + '.' + extension);
    data.set('type', 'input');
    data.set('subfolder', 'daelab-image-editor');
    const response = await api.fetchApi('/upload/image', {method:'POST',body:data});
    if (!response.ok) throw new Error('图片上传失败，请重试。');
    const {name:filename,subfolder,type} = await response.json();
    const result = sourceRef({filename,subfolder,type});
    if (!result) throw new Error('上传后未收到有效图片引用。');
    return result;
}

async function uploadCanvas(canvas, name) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法导出选区，请重新载入底图。');
    return upload(blob, name);
}

async function json(path) {
    const response = await api.fetchApi(path);
    if (!response.ok) throw new Error('ComfyUI 未提供所需能力。');
    return response.json();
}

async function runPrompt(graph, output) {
    if (enqueueing || app.processingQueue) throw new Error('已有任务正在提交，请稍后重试。');
    const compiled = {output, workflow: graph.serialize()};
    let receipt;
    enqueueing = true;
    try {
        receipt = await queueBadge87(app,api,getBadgeNativeQueue() || app.queuePrompt,graph,compiled);
    } finally { enqueueing = false; }
    const deadline = Date.now() + 20*60*1000;
    while (Date.now() < deadline) {
        const history = await json('/history/' + encodeURIComponent(receipt.prompt_id));
        const record = history[receipt.prompt_id];
        if (record?.status?.status_str === 'error') {
            const failure = record.status.messages?.find(([kind]) => ['execution_error','execution_interrupted'].includes(kind))?.[1];
            throw new Error(failure?.exception_message || '处理失败。');
        }
        if (record?.outputs) {
            const images = (record.outputs[OUTPUT_ID]?.images ?? []).map(sourceRef).filter(Boolean);
            if (images.length) return images;
            if (record.status?.completed) throw new Error('任务已结束，未保存结果。');
        }
        await new Promise(resolve => setTimeout(resolve,750));
    }
    throw new Error('等待结果超时，请检查 ComfyUI 队列。');
}

function setDrag(event, image) {
    const url = new URL(api.apiURL(buildImageViewPath(image)), location.href).href;
    event.dataTransfer.setData('text/uri-list',url);
    event.dataTransfer.effectAllowed = 'copy';
}

function stageRuntime(graph, stage, state) {
    let map = runtime.get(graph);
    if (!map) runtime.set(graph, map = new Map());
    if (map.get(stage)?.state !== state) map.set(stage,{state,busy:false,message:'',error:'',views:new Set()});
    return map.get(stage);
}

function addImage(parent, image, label) {
    const preview = element('img',parent);
    preview.src = api.apiURL(buildImageViewPath(image));
    preview.alt = label;
    preview.draggable = true;
    preview.addEventListener('dragstart',event=>setDrag(event,image));
    return preview;
}

function makeUpload(parent, label, onLoad, onError, events, dropTarget) {
    const field = element('label',parent,null,'cnl-edit-drop');
    const icon = element('span',field,null,'cnl-edit-upload-icon');
    icon.setAttribute('aria-hidden','true');
    const title = element('span',field,label);
    const hint = element('span',field,'点击上传或拖入图片','cnl-edit-hint');
    const input = element('input',field);
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.setAttribute('aria-label', label);
    const filename = element('span',field,null,'cnl-edit-filename');
    async function choose(file, image) {
        try {
            if (!file && !image) throw new Error('请拖入本机图片或 ComfyUI 的历史结果。');
            await onLoad(file ? await upload(file) : sourceRef(image));
        } catch (error) { onError(error.message); }
    }
    input.addEventListener('change',()=>{ if(input.files[0]) void choose(input.files[0]); input.value = ''; },{signal:events.signal});
    const target = dropTarget ?? field;
    target.addEventListener('dragover',event=>{event.preventDefault();target.dataset.over='true';},{signal:events.signal});
    target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))delete target.dataset.over;},{signal:events.signal});
    target.addEventListener('drop',event=>{
        event.preventDefault(); event.stopPropagation(); delete target.dataset.over;
        void choose(event.dataTransfer.files[0],localImageFromDrop(event.dataTransfer,location.href));
    },{signal:events.signal});
    return { field, filename, title, input, icon, hint };
}

function getOutputPanel(root) {
    const right = root.closest(RIGHT);
    return right && [...right.parentElement.children].find(child=>child!==right && child.hasAttribute('data-panel'));
}

function mount(graph, root, stage, marker) {
    const state = workspaceState(graph,stage,marker);
    const session = stageRuntime(graph,stage,state);
    const events = new AbortController(), releases = [];
    const cutout = stage === 'cutout';
    const available = () => isNodeAvailableInAppMode(graph.getNodeById(marker[stage]));
    const panel = element('section',root,null,'cnl-image-editing');
    panel.dataset.stage = stage;
    const outputPane = element('section',getOutputPanel(root),null,'cnl-edit-output');
    if (!outputPane.isConnected) panel.append(outputPane);
    outputPane.classList.toggle('cnl-edit-local-output', !cutout);
    outputPane.setAttribute('aria-label', cutout ? '抠图结果' : '局部修改结果');
    const outputImage = element('div',outputPane,null,'cnl-edit-result-preview');
    let source = null, sourceLoading = false, disposed = false, tool = '', activeColor = 0, imageRequest = 0;
    let previewingMask = false;
    let error = '', schema = [], rmbgFiles = null, checkpoint = null, displayId = null;
    let editAccess;
    const editReason = () => cutout ? '' : accessModelReason(editAccess);
    if (!cutout) void loadModelAccess(api, marker.kind, 'edit').then(access => {
        editAccess = access;
        if (active()) refreshJob();
    });
    const epoch = generationLoadIdentity(graph);
    const active = () => !disposed && graph === getRootGraphSafely(app) && epoch === generationLoadIdentity(graph);
    const saved = () => graph.extra?.[REGION_KEY]?.workspaces?.[stage] === state;
    const key = () => imageKey(state.base);
    const draft = () => state.drafts[key()] ?? (state.drafts[key()] = defaultDraft());
    const refreshJob = () => { for (const refresh of session.views) refresh(); };
    const persist = () => {
        graph.setDirtyCanvas?.(true,true);
        captureGenerationHistory(app,graph);
    };
    const changed = () => { persist(); render(); };
    const signal = events.signal;
    const onError = message => { error = message; if (!disposed) render(); };
    const button = (parent,label,callback,icon) => {
        const control = element('button',parent,icon ? null : label);
        control.type = 'button';
        if (icon) {
            control.classList.add('cnl-edit-icon-button');
            const glyph = element('span',control,null,'cnl-edit-button-icon');
            glyph.setAttribute('aria-hidden','true');
            glyph.style.setProperty('--cnl-edit-icon',`url("${new URL(`./vendor/remixicon/${icon}.svg`,import.meta.url).href}")`);
            element('span',control,label,'cnl-edit-button-label');
        }
        control.onclick = callback;
        releases.push(bindCreativeButton(control));
        return control;
    };
    const field = control => { releases.push(bindCreativeField(control)); return control; };
    const section = label => {
        const container = element('section',panel,null,'cnl-edit-card');
        if (label) element('h3',container,label);
        return container;
    };
    const toggleRow = (parent,label,options,read,write,tablist=false) => {
        const row = element('div',parent,null,'cnl-edit-choices');
        row.setAttribute('role',tablist?'tablist':'group');
        row.setAttribute('aria-label',label);
        const buttons = options.map(([value,text,icon]) => [value,button(row,text,()=>{write(value);changed();},icon)]);
        if(tablist) {
            for(const [,control] of buttons)control.setAttribute('role','tab');
            row.addEventListener('keydown',event=>{
                const current=buttons.findIndex(([,control])=>control===event.target);
                if(current<0)return;
                const length=buttons.length;
                const index={ArrowLeft:(current+length-1)%length,ArrowRight:(current+1)%length,Home:0,End:length-1}[event.key];
                if(index===undefined)return;
                event.preventDefault();buttons[index][1].click();buttons[index][1].focus();
            },{signal});
        }
        return {row,buttons,refresh(){
            for(const [value,control] of buttons){
                const current=read()===value;
                control.setAttribute(tablist?'aria-selected':'aria-pressed',String(current));
                if(tablist)control.tabIndex=current?0:-1;
            }
        }};
    };

    let mode;
    if (cutout) mode = toggleRow(section(null),'抠图方式',[['rmbg','主体物抠图'],['sam','识别物体抠图']],()=>state.mode,value=>{state.mode=value;displayId=null;},true);
    const inputBlock = section(null);
    const basePreview = element('div',inputBlock,null,'cnl-edit-base-preview');
    const baseUpload = makeUpload(basePreview,'上传底图',value=>setBase(value),onError,events,basePreview);
    baseUpload.filename.hidden = true;
    const canvas = element('canvas',basePreview);
    canvas.setAttribute('aria-label','底图和位置预览');
    const selection = element('div',inputBlock,null,'cnl-edit-selection');
    const nativeResults = () => {
        const saved = marker.kind==='exhibition' ? marker.buildResults ?? [] : [];
        const output = marker.kind==='badge' ? 113 : 1067;
        const samples = graph.getNodeById(output)?.imgs || [];
        return [...saved, ...samples.map(img=>{
            if (!img?.src) return null;
            const url = new URL(img.src,location.href);
            if (url.origin!==location.origin || !url.pathname.endsWith('/view')) return null;
            return sourceRef(Object.fromEntries(url.searchParams));
        })].map(sourceRef).filter(Boolean);
    };
    function previousResults(parent, heading, candidates, choose) {
        const block = element('details',parent);
        element('summary',block,heading);
        const grid = element('div',block,null,'cnl-edit-history');
        let last;
        return () => {
            const available = [...new Map(candidates().map(image=>[imageKey(image),image])).values()].slice(0,8);
            const signature = JSON.stringify(available);
            if(signature===last)return;
            last=signature;
            block.hidden=!available.length;
            grid.replaceChildren();
            for(const image of available){
                const tile=element('button',grid);
                tile.type='button';tile.setAttribute('aria-label','使用 '+image.filename);
                addImage(tile,image,image.filename);
                tile.onclick=()=>choose(image);
            }
        };
    }
    const refreshInputs = cutout ? previousResults(inputBlock,'上阶段成果',()=>[
        ...(graph.extra[REGION_KEY].workspaces?.local?.history ?? []).map(result=>result.image),
        ...nativeResults(),
    ],setBase) : null;

    const tools = cutout ? section('参数配置') : selection;
    if (!cutout) element('h3',selection,'选择修改位置');
    const scope = cutout ? null : toggleRow(tools,'位置选择',[
        ['mask','遮罩','contrast-2-line'],['annotation','标注','mark-pen-line'],
    ],()=>draft().position,value=>{
        setPosition(draft(),value);tool='';previewingMask=false;
    });
    const maskTabs = cutout ? null : toggleRow(tools,'遮罩方式',[
        ['color','颜色','palette-line'],['polygon','多边形','pentagon-line'],
    ],()=>draft().maskKind,value=>{
        draft().maskKind=value;tool='';previewingMask=false;
        if (value==='polygon') ensurePolygon(draft());
    });
    scope?.row.classList.add('cnl-edit-position-choices');
    maskTabs?.row.classList.add('cnl-edit-position-choices');
    const colorTools = element('div',tools,null,'cnl-edit-row');
    const colors = field(element('select',colorTools));
    colors.setAttribute('aria-label','颜色组');
    const color = field(element('input',colorTools));
    color.type = 'color'; color.setAttribute('aria-label','遮罩颜色');
    const threshold = field(element('input',colorTools));
    threshold.type='number';threshold.min='0';threshold.max='255';threshold.title='阈值';threshold.setAttribute('aria-label','颜色阈值');
    const invertLabel = element('label',colorTools,'反转匹配');
    const invert = field(element('input',invertLabel));
    invert.type='checkbox';
    invert.addEventListener('change',()=>{draft().colors[activeColor].invert=invert.checked;changed();},{signal});
    const sampleButton = button(colorTools,'从底图取色',()=>{
        previewingMask=false;
        tool=tool==='sample'?'':'sample';
        render();
        if (tool==='sample') canvas.scrollIntoView({block:'nearest'});
    });
    const add = button(colorTools,'添加颜色',()=>{draft().colors.push({color:'#ffffff',threshold:30});activeColor=draft().colors.length-1;changed();});
    const remove = button(colorTools,'删除颜色',()=>{draft().colors.splice(activeColor,1);activeColor=Math.max(0,activeColor-1);changed();});
    colors.addEventListener('change',()=>{activeColor=Number(colors.value);render();},{signal});
    color.addEventListener('change',()=>{draft().colors[activeColor].color=color.value;changed();},{signal});
    threshold.addEventListener('change',()=>{
        draft().colors[activeColor].threshold=Number.isFinite(threshold.valueAsNumber)?Math.max(0,Math.min(255,Math.round(threshold.valueAsNumber))):30;
        changed();
    },{signal});

    const modelIntro = cutout ? element('p',tools,null,'cnl-edit-hint') : null;
    const modelRow = element('label',tools,'模型文件','cnl-edit-row');
    const model = field(element('select',modelRow));
    model.addEventListener('change',()=>{state.model=model.value;changed();},{signal});
    const checkpointRow = element('p',tools);
    const rmbgState = element('p',tools,null,'cnl-edit-hint');
    const samTools = cutout ? toggleRow(selection,'SAM3 物体选取',[['bbox','框选'],['interactive','点选']],()=>draft().sam.mode,value=>{draft().sam.mode=value;}) : null;
    const negativeHint = samTools && element('span',samTools.row,'按住 Shift 键添加排除点','cnl-edit-hint');
    const drawingTools = element('div',selection,null,'cnl-edit-drawing-tools');
    const drawingActions = element('div',drawingTools,null,'cnl-edit-drawing-actions');
    const brush = button(drawingActions,'补绘画笔',()=>{
        previewingMask=false;
        tool=tool==='brush'?'':'brush';
        render();
    },'brush-line');
    const previewMask = cutout ? null : button(drawingActions,'预览遮罩',()=>{
        previewingMask=!previewingMask;
        render();
    });
    panel.addEventListener('keydown',event=>{
        if (event.key!=='Escape' || !previewingMask) return;
        event.stopPropagation();
        previewingMask=false;
        render();
        previewMask.focus();
    },{signal});
    const reset = button(drawingActions,'重置多边形',()=>{draft().polygon=structuredClone(DEFAULT_POLYGON);draft().extraPolygons=[];changed();},'restart-line');
    button(drawingActions,cutout?'撤销标记':'撤销笔画',()=>{
        if (cutout) draft().sam[draft().sam.mode==='bbox'?'boxes':'points'].pop();
        else draft().strokes[draft().position==='annotation'?'annotation':draft().maskKind].pop();
        changed();
    },'arrow-go-back-line');
    button(drawingActions,'清除标记',()=>{
        if (cutout) {draft().sam.boxes=[];draft().sam.points=[];}
        else draft().strokes[draft().position==='annotation'?'annotation':draft().maskKind]=[];
        changed();
    },'eraser-line');
    const size = field(element('input',drawingTools));
    size.type='range';size.min='4';size.max='70';size.value='18';size.setAttribute('aria-label','画笔大小');size.title='画笔大小';
    size.addEventListener('input',render,{signal});
    const editor = createSelectionEditor(canvas,{update:changed,sample(value){draft().colors[activeColor].color=value;tool='';changed();}});

    const operations = cutout ? null : section('修改内容');
    const editTabs = operations ? toggleRow(operations,'修改方式',[['semantic','语义描述'],['replace','图片替换'],['material','材质替换']],()=>draft().edit,value=>{draft().edit=value;}) : null;
    const text = operations ? field(element('textarea',operations)) : null;
    if (text) {
        text.placeholder='输入希望修改的内容';text.setAttribute('aria-label','修改描述');
        text.addEventListener('input',()=>{draft().text=text.value;persist();},{signal});
    }
    const replacement = operations ? makeUpload(operations,'上传替换图',value=>{if(active()){draft().replacement=value;changed();}},onError,events) : null;
    const replacementAssets = operations ? element('div',operations) : null;
    const refreshReplacement = replacementAssets ? previousResults(replacementAssets,'抠图成果',()=>
        (graph.extra[REGION_KEY].workspaces?.cutout?.history ?? []).map(result=>result.image),
        value=>{draft().replacement=value;changed();}) : null;
    const materialGrid = operations ? element('div',operations,null,'cnl-edit-materials') : null;

    const actions = section(null);
    const run = button(actions,cutout?'抠图':'开始修改',()=>Promise.resolve().then(submit));
    run.className='cnl-edit-primary';
    const notice = element('p',actions,null,'cnl-edit-status');
    notice.setAttribute('role','status');
    const resultsArea = cutout ? panel : element('div',outputPane,null,'cnl-edit-result-collection');
    const historyBlock = element('section',resultsArea,null,'cnl-edit-card');
    element('h3',historyBlock,'历史结果');
    const history = element('div',historyBlock,null,'cnl-edit-history');
    const upstreamBlock = cutout ? null : element('section',resultsArea,null,'cnl-edit-card');
    if (upstreamBlock) element('h3',upstreamBlock,'上阶段成果');
    const upstream = upstreamBlock ? element('div',upstreamBlock,null,'cnl-edit-history') : null;
    let chosenResult;
    const useResult = button(cutout ? historyBlock : resultsArea,'用作底图',()=>setBase(chosenResult?.image));
    useResult.hidden=true;
    let renderedResult, renderedHistory, renderedUpstream;
    const historyReleases = new Map();
    releases.push(()=>{ for (const list of historyReleases.values()) list.forEach(release=>release()); });

    function setBase(value) {
        if (!active() || !value) return;
        state.base = value;activeColor=0;tool='';previewingMask=false;error='';
        if (cutout) displayId=null;
        if (marker.sources?.[stage]) {
            const anchor=graph.getNodeById(marker[stage]);
            const widget=anchor?.widgets?.find(item=>item.name==='image');
            if(widget) {
                const image=imageWidgetValue(value);
                if(Array.isArray(widget.options?.values)&&!widget.options.values.includes(image))widget.options.values.push(image);
                widget.value=image;widget.callback?.(image);
            }
        }
        loadBase();
        changed();
    }

    function loadBase() {
        const request = ++imageRequest;
        source = null;
        editor.setImage(null);
        sourceLoading = Boolean(state.base);
        if (!state.base) return;
        const image = new Image();
        image.onload = () => {
            if (disposed || request!==imageRequest) return;
            source=image;sourceLoading=false;
            const item = draft();
            restoreLegacyShape(item,image.naturalWidth,image.naturalHeight);
            if (!cutout && item.maskKind==='polygon') ensurePolygon(item);
            editor.setImage(image);
            render();
        };
        image.onerror = () => {
            if (disposed || request!==imageRequest) return;
            sourceLoading=false;onError('无法载入底图，请重新选择图片。');
        };
        image.src = api.apiURL(buildImageViewPath(state.base));
    }

    function showHistory(container, records, previous) {
        const signature = JSON.stringify(records.map(({id,image})=>[id,image]));
        if (signature === previous) return previous;
        historyReleases.get(container)?.forEach(release=>release());
        const controls=[];
        historyReleases.set(container,controls);
        container.replaceChildren();
        for (const {id,image,upstream} of records) {
            const card = element('button',container);
            card.type='button';
            card.dataset.resultId=id;
            card.setAttribute('aria-label','查看 ' + image.filename);
            controls.push(bindCreativeButton(card));
            const thumb = addImage(card,image,upstream?'上阶段成果':'历史结果');
            thumb.addEventListener('error',()=>{
                thumb.draggable=false;
                card.dataset.missing='true';
            },{once:true});
            card.onclick=()=>{displayId=id;renderResults();};
        }
        return signature;
    }

    function renderResults() {
        const known = new Set();
        const unique = records => records.filter(({image})=>{
            const ref = sourceRef(image);
            if (!ref) return false;
            const key = imageKey(ref);
            if (known.has(key)) return false;
            known.add(key);
            return true;
        });
        const results = unique(state.history.filter(item=>!cutout || item.mode===state.mode));
        const badgePrevious = marker.kind==='badge' ? graph.extra.daelabBadgePrototypeV1?.localTargets?.results ?? [] : [];
        const earlier = cutout ? [] : unique([...nativeResults(), ...badgePrevious]
            .map(sourceRef).filter(Boolean).map(image=>({id:'upstream:'+imageKey(image),image,upstream:true})));
        chosenResult = [...results,...earlier].find(item=>item.id===displayId)
            || results.find(item=>item.baseKey===key()) || (cutout ? null : results[0]);

        renderedHistory=showHistory(history,results,renderedHistory);
        historyBlock.hidden=!results.length;
        if (upstream) {
            renderedUpstream=showHistory(upstream,earlier,renderedUpstream);
            upstreamBlock.hidden=!earlier.length;
        }
        for (const rail of [history,upstream]) {
            for (const card of rail?.children ?? []) {
                card.setAttribute('aria-pressed',String(card.dataset.resultId===chosenResult?.id));
            }
        }

        const signature = JSON.stringify([chosenResult?.id,chosenResult?.image]);
        if (signature===renderedResult) return;
        renderedResult=signature;
        outputImage.replaceChildren();
        const title = cutout?'抠图结果':'局部修改结果';
        useResult.hidden=!chosenResult;
        useResult.disabled=false;
        if (!chosenResult) {
            element('p',outputImage,title,'cnl-edit-hint');
            return;
        }
        const preview = addImage(outputImage,chosenResult.image,chosenResult.upstream?'上阶段成果':title);
        preview.addEventListener('error',()=>{
            if (disposed || preview.parentElement!==outputImage) return;
            useResult.disabled=true;
            outputImage.replaceChildren();
            element('p',outputImage,'无法载入结果，请重新选图。','cnl-edit-hint');
        },{once:true});
    }

    function render() {
        if (disposed) return;
        const item = draft();
        const enabled = available();
        const sam = cutout && state.mode==='sam';
        const mask = !cutout && item.position==='mask';
        const colorMode = mask && item.maskKind==='color';
        const annotation = !cutout && item.position==='annotation';
        const polygon = mask && item.maskKind==='polygon';
        panel.hidden = !enabled;
        const loaded = Boolean(source);
        const label = loaded ? '更换底图' : '上传底图';
        basePreview.dataset.loaded = String(loaded);
        basePreview.dataset.passive = String(cutout && !sam);
        baseUpload.title.textContent = label;
        baseUpload.input.setAttribute('aria-label', label);
        baseUpload.icon.hidden = loaded;
        baseUpload.hint.hidden = loaded;
        selection.hidden = cutout && (!sam || !loaded);
        refreshInputs?.();
        mode?.refresh();scope?.refresh();maskTabs?.refresh();editTabs?.refresh();samTools?.refresh();
        if(maskTabs)maskTabs.row.hidden=!mask;
        if(editTabs)for(const [value,control] of editTabs.buttons)control.hidden=!EDIT_MODES[item.position].includes(value);
        colorTools.hidden = !colorMode;
        if (colorMode) {
            if (colors.options.length!==item.colors.length) colors.replaceChildren(...item.colors.map((_,i)=>new Option('颜色 '+(i+1),String(i))));
            colors.value=String(activeColor);
            color.value=item.colors[activeColor]?.color ?? '#27894e';
            invert.checked=Boolean(item.colors[activeColor]?.invert);
            if (document.activeElement!==threshold) threshold.value=String(item.colors[activeColor]?.threshold ?? 30);
            remove.disabled=item.colors.length<=1;add.disabled=item.colors.length>=16;
            sampleButton.disabled=!loaded;
            sampleButton.setAttribute('aria-pressed',String(tool==='sample'));
        }
        if (modelIntro) modelIntro.textContent = sam
            ? 'Meta SAM3 按框选或点选分割指定物体，由 ComfyUI-SAM3 插件加载。权重采用 SAM License。'
            : 'Bria RMBG-2.0 自动去除背景，由 ComfyUI-RMBG 插件加载。公开权重限非商业用途。';
        modelRow.hidden=!cutout || sam;
        checkpointRow.hidden=!sam;
        rmbgState.hidden=!cutout||sam;
        const modelReady = rmbgFiles && installedRmbgModel(state.model,rmbgFiles);
        rmbgState.textContent = rmbgFiles===null?'正在检查模型文件…':modelReady?'模型文件可用。':'模型文件缺失。';
        if (negativeHint) negativeHint.hidden=item.sam.mode!=='interactive';
        checkpointRow.textContent = '模型文件 · sam3.safetensors · ' + (checkpoint===null?'正在检查':checkpoint?'可用':'未安装');
        brush.hidden=!mask;
        brush.setAttribute('aria-pressed',String(tool==='brush' && !previewingMask));
        if (previewMask) {
            previewMask.hidden=!mask;
            previewMask.disabled=!loaded;
            previewMask.setAttribute('aria-pressed',String(previewingMask));
        }
        size.hidden=!(annotation || tool==='brush' && !previewingMask);
        reset.hidden=!polygon;
        canvas.hidden=!source;
        if (text) {
            text.hidden=item.edit!=='semantic';
            if (document.activeElement!==text && text.value!==item.text) text.value=item.text;
            replacement.field.hidden=item.edit!=='replace';
            replacementAssets.hidden=item.edit!=='replace';
            if(item.edit==='replace')refreshReplacement();
            replacement.filename.textContent=item.replacement?.filename || '';
            materialGrid.hidden=item.edit!=='material';
            for(const tile of materialGrid.children)tile.setAttribute('aria-pressed',String(tile.dataset.value===item.material));
        }
        const editTool = annotation ? 'annotation' : tool || (polygon ? 'polygon' : 'none');
        editor.setView(item,cutout ? sam?'sam':'preview' : previewingMask?'mask-preview':editTool,Number(size.value)/1000);
        const accessError = editReason();
        run.disabled=!enabled || !source || session.busy || Boolean(accessError) || cutout && (sam ? checkpoint!==true : !schema.includes(state.model) || !modelReady);
        run.textContent=session.busy?'正在处理…':cutout?'抠图':'开始修改';
        notice.textContent=error || session.error || session.message || accessError || (sourceLoading?'正在加载底图…':'');
        notice.dataset.error=String(Boolean(error || session.error || accessError));
        notice.hidden=!notice.textContent;
        renderResults();
        if (!enabled) outputPane.hidden=true;
        else outputPane.hidden=false;
    }

    async function submit() {
        if (session.busy || !active() || !available() || !source || editReason()) return;
        const base = {...state.base}, baseKey=key(), mode=state.mode, model=state.model;
        const snapshot=structuredClone(draft());
        session.busy=true;session.error='';session.message='正在准备…';error='';refreshJob();
        try {
            let output;
            if (cutout) {
                output=compileCutout({base,mode,model,draft:snapshot.sam,width:source.naturalWidth,height:source.naturalHeight});
                if(mode==='sam' && !(await json('/models/sam3')).includes('sam3.safetensors')) throw new Error('SAM3 模型文件尚未安装。');
                if(mode==='rmbg' && !installedRmbgModel(model,await json('/models/rmbg'))) throw new Error('主体物抠图模型文件尚未安装。');
            } else {
                if (snapshot.edit==='semantic'&&!snapshot.text.trim()) throw new Error('请输入修改描述。');
                if (snapshot.edit==='replace'&&!snapshot.replacement) throw new Error('请先上传替换图。');
                if (snapshot.edit==='material'&&!snapshot.material) throw new Error('请选择材质。');
                const pictures=editor.exports();
                const [mask,guide]=await Promise.all([
                    pictures.mask ? uploadCanvas(pictures.mask,'mask') : null,
                    snapshot.edit==='replace'||snapshot.position==='annotation' ? uploadCanvas(pictures.guide,'guide') : null,
                ]);
                output=compileEdit({
                    base, draft:snapshot, mask, guide, width:pictures.width, height:pictures.height,
                    profile:findAccessModel(editAccess),
                    seed:crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
                });
            }
            if(!active() || !saved()) throw new Error('工作流已切换，本次操作已取消。');
            session.message='已提交，等待结果…';refreshJob();
            const images=await runPrompt(graph,output);
            if (!saved()) return;
            const records=images.map(image=>({id:crypto.randomUUID(), image,mode,baseKey,base,at:Date.now()}));
            state.history.unshift(...records);
            if(key()===baseKey && (!cutout||state.mode===mode))displayId=records[0].id;
            persist();
            session.message='处理完成。';
        } catch (failure) {
            session.error=failure.message || String(failure);session.message='';
        } finally {session.busy=false;refreshJob();}
    }

    if (cutout) {
        json('/object_info/RMBG').then(defs=>{
            if(disposed)return;
            schema=defs.RMBG?.input?.required?.model?.[0] ?? [];
            model.replaceChildren(...schema.map(name=>new Option(name,name)));
            if (!schema.includes(state.model)) state.model=schema[0] || '';
            model.value=state.model;render();
        }).catch(()=>onError('主体物抠图节点不可用。'));
        json('/models/rmbg').then(list=>{rmbgFiles=list;render();}).catch(()=>{rmbgFiles=[];render();});
        json('/models/sam3').then(list=>{checkpoint=list.includes('sam3.safetensors');render();}).catch(()=>{checkpoint=false;render();});
    } else {
        fetch(new URL('./materials.json',import.meta.url)).then(response=>response.json()).then(data=>{
            if(disposed)return;
            for(const material of Object.values(data)) {
                const tile=button(materialGrid,material.label,()=>{draft().material=material.label;changed();});
                tile.dataset.value=material.label;
                const thumbnail=element('img');
                thumbnail.src=new URL('./material_thumbs/'+encodeURIComponent(material.thumbnail),import.meta.url);
                thumbnail.alt='';tile.prepend(thumbnail);
            }
            render();
        }).catch(()=>onError('无法读取材质选项。'));
    }
    globalThis.addEventListener(BUILD_RESULTS_CHANGED,event=>{
        if (event.detail === graph && active()) render();
    },{signal});
    session.views.add(render);
    loadBase();
    render();
    return {
        panel,
        refreshMode(){if(panel.hidden===available())render();},
        dispose(){
            disposed=true;session.views.delete(render);events.abort();editor.dispose();releases.forEach(release=>release());
            panel.remove();outputPane.remove();
        },
    };
}

app.registerExtension({
    name:'DAELab.ImageEditingUI',
    setup() {
        const palette=element('style',document.head);
        palette.textContent='.cnl-image-editing,.cnl-image-stage-tabs,.cnl-edit-output {'+BADGE_APP_PALETTE+'}';
        const style=element('link',document.head);
        style.rel='stylesheet';style.href=new URL('./image_editing_app.css?v=20261119-local-edit',import.meta.url).href;
        const typography = element('link',document.head);
        typography.rel='stylesheet';typography.href=new URL('./workflow_app_typography.css?v=20261119-reference-controls',import.meta.url).href;
        const font=element('link',document.head);
        font.rel='stylesheet';font.href=new URL('./vendor/generation-ui-shared/creative_theme.css',import.meta.url).href;

        let selected, mounted, graph, root, epoch, tabs;
        const visited = new WeakMap();
        function sync() {
            const nextGraph=getRootGraphSafely(app),nextRoot=document.querySelector(ROOT);
            const marker=nextGraph?.extra?.[REGION_KEY],nextEpoch=nextGraph && generationLoadIdentity(nextGraph);
            if (graph!==nextGraph || root!==nextRoot || epoch!==nextEpoch || app.configuringGraph) {
                mounted?.dispose();mounted=null;
                if(root)delete root.dataset.cnlImageStage;
                tabs?.remove();tabs=null;
                graph=nextGraph;root=nextRoot;epoch=nextEpoch;selected=null;
            }
            if(!root || marker?.version!==1 || app.configuringGraph)return;
            const badge=marker.kind==='badge';
            if(!badge && !tabs) {
                tabs=element('div',null,null,'cnl-image-stage-tabs');
                tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','展厅阶段');
                root.prepend(tabs);
                for(const [value,label] of STAGES.filter(([value])=>value!=='cutout'||Number.isInteger(marker.cutout))) {
                    const tab=element('button',tabs,label);
                    tab.type='button';tab.dataset.stage=value;tab.setAttribute('role','tab');
                    tab.onclick=()=>{visited.set(graph,value);sync();};
                }
                tabs.onkeydown=event=>{
                    const active=[...tabs.children].indexOf(document.activeElement);
                    const length=tabs.children.length;
                    const index={ArrowLeft:(active+length-1)%length,ArrowRight:(active+1)%length,Home:0,End:length-1}[event.key];
                    if(index===undefined)return;
                    event.preventDefault();tabs.children[index].click();tabs.children[index].focus();
                };
            }
            const stage=badge?root.querySelector('[role="tab"][aria-selected="true"][data-tab-id]')?.dataset.tabId:visited.get(graph) || 'build';
            if (stage !== selected || mounted && !mounted.panel.isConnected) {
                mounted?.dispose();mounted=null;
                selected=stage;
                if (stage==='local' || stage==='cutout') {
                    root.dataset.cnlImageStage=stage;
                    mounted=mount(graph,root,stage,marker);
                } else delete root.dataset.cnlImageStage;
                if(tabs) for(const button of tabs.children){
                    const current=button.dataset.stage===stage;button.setAttribute('aria-selected',String(current));button.tabIndex=current?0:-1;
                }
            }
            mounted?.refreshMode();
        }
        globalThis.addEventListener('daelab:app-layout-changed',sync);
        setInterval(sync,150);
    },
});
