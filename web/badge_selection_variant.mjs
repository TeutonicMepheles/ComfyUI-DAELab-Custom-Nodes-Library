import { drawBrushStrokes, drawSelectionMask } from './badge_selection_render.mjs';
import { resolveWorkflowPolygonInfo } from './polygon_mask_state.mjs?v=20260908-selection-1';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';

const clone = value => JSON.parse(JSON.stringify(value || []));
export function installBadgeSelectionVariant(nodeType) {
    const p = nodeType.prototype;
    if (Object.hasOwn(p, '_badgeSelectionInstalled')) return;
    p._badgeSelectionInstalled = true;
    const wrap = (name, fn) => { const original = p[name]; p[name] = function (...args) { return fn.call(this, original.bind(this), ...args); }; };
    wrap('serializePolygonInfo', function (original) {
        const info = JSON.parse(original() || '{}');
        info.brush_strokes = clone(this.polygonWidget?.brushStrokes);
        if (info.brush_strokes.length) info.cleared = false;
        const value = JSON.stringify(info);
        this.properties.polygon_info = this.properties.polygon_data_value = value;
        const widget = this.getPolygonWidget('polygon_data'); if (widget) widget.value = value;
        return value;
    });
    wrap('restorePolygonInfo', function (original) {
        let info = resolveWorkflowPolygonInfo(this);
        try { if (typeof info === 'string') info = JSON.parse(info); } catch { info = {}; }
        this.polygonWidget.brushStrokes = clone(info?.brush_strokes);
        return original();
    });
    wrap('getPolygonState', function (original) { return { ...original(), brushStrokes: clone(this.polygonWidget.brushStrokes) }; });
    wrap('restorePolygonState', function (original, state) {
        this.polygonWidget.brushStrokes = clone(state.brushStrokes); return original(state);
    });
    wrap('redrawPolygonCanvas', function (original) {
        const w = this.polygonWidget;
        const preview = w?.badgePrototypeMaskPreview;
        if (preview && w.canvas && w.ctx) {
            w.ctx.save();
            w.ctx.setTransform(1, 0, 0, 1, 0, 0);
            w.ctx.scale(w.canvas.width / preview.width, w.canvas.height / preview.height);
            drawSelectionMask(w.ctx, preview.info, preview.width, preview.height);
            w.ctx.restore();
            return;
        }
        original();
        if (!w?.image || !w.brushStrokes?.length) return;
        // Draw the union once so overlapping strokes keep a constant preview opacity.
        const layer = w.brushLayer ||= document.createElement('canvas');
        layer.width = w.canvas.width; layer.height = w.canvas.height;
        const ctx = layer.getContext('2d');
        ctx.fillStyle = ctx.strokeStyle = this.getPolygonWidget('color')?.value || '#FF1744';
        drawBrushStrokes(ctx, w.brushStrokes, layer.width, layer.height);
        w.ctx.save();w.ctx.globalAlpha = Number(this.getPolygonWidget('fill_opacity')?.value ?? 35)/100;
        w.ctx.drawImage(layer,0,0);w.ctx.restore();
    });
    wrap('updatePolygonButtons', function (original) {
        original();
        const w = this.polygonWidget;
        if (!w?.buttons) return;
        const brush = this.properties.badge_selection_tool === 'brush';
        const pending = Boolean(w.pendingSourceImageData);
        if (brush) w.buttons.clear.disabled = pending || !w.brushStrokes?.length;
        // resetPolygon() can create an initial polygon when none is selected.
        w.buttons.reset.disabled = pending || !w.image;
        for (const [key, button] of [['clear', w.buttons.clear], ['reset', w.buttons.reset]]) {
            button.style.opacity = button.disabled ? '0.4' : '1';
            button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
            button.style.background = button.disabled ? '#242a30' : '#315f8f';
            button.style.borderColor = button.disabled ? '#46515b' : '#72b8ec';
            button.style.color = button.disabled ? '#99a3ad' : '#ffffff';
            button.title = pending ? '请先应用待加载的图片' : key === 'clear'
                ? brush ? button.disabled ? '没有可清空的画笔笔画' : '清空画笔笔画（可撤销）'
                    : button.disabled ? '请先选中一个 Polygon' : '删除选中的 Polygon（可撤销）'
                : !w.image ? '请先加载目标图片' : '按当前顶点数重置或创建 Polygon（可撤销）';
        }
    });
    wrap('clearPolygon', function (original) {
        if (this.properties.badge_selection_tool !== 'brush') return original();
        this.polygonWidget.brushStrokes = [];
        this.updatePolygonInfo();this.pushPolygonHistory();this.redrawPolygonCanvas();this.updatePolygonButtons();
    });
    wrap('onNodeCreated', function (original, ...args) {
        const result = original(...args);
        const w = this.polygonWidget, c = w.appearanceControls;
        w.container.classList.add('badge-selection-editor');
        w.container.firstElementChild?.remove();
        c.text.closest('label')?.remove();
        // Appearance fields are divs in the shared editor; remove only the text field.
        if (c.text.isConnected || c.text.parentElement) c.text.parentElement?.remove();
        c.element.classList.add('badge-selection-appearance');
        const tools = document.createElement('div');tools.className='badge-selection-tools';tools.setAttribute('role','tablist');tools.setAttribute('aria-label','选区绘制工具');
        const tabs = [];
        for (const [mode,label,path] of [
            ['brush','画笔涂抹','M4 16c-2 0-3 2-3 5 3 0 5-1 5-3M7 15 17 3c2-2 5 1 3 3L9 17Z'],
            ['polygon','Polygon 绘制','M4 5 19 4 17 19 6 16Z M2 3h4v4H2Z M17 2h4v4h-4Z M15 17h4v4h-4Z M4 14h4v4H4Z'],
        ]) {
            const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('role','tab');b.setAttribute('aria-label',label);
            b.innerHTML=`<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>`;
            b.onclick=()=>{this.graph?.beforeChange?.();this.properties.badge_selection_tool=mode;this.graph?.afterChange?.();updateTools();};
            tools.append(b);tabs.push([b,mode]);
        }
        tools.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?1:tabs.findIndex(([,m])=>m!==this.properties.badge_selection_tool);tabs[i][0].click();tabs[i][0].focus();};
        const brushLabel=document.createElement('label');brushLabel.textContent='笔刷 ';const brushSize=document.createElement('input');brushSize.type='number';brushSize.min='1';brushSize.max='300';brushSize.value=String(this.properties.badge_brush_size || 30);brushSize.setAttribute('aria-label','笔刷直径（图像像素）');brushLabel.append(brushSize);c.element.append(brushLabel);
        brushSize.onchange=()=>{this.graph?.beforeChange?.();this.properties.badge_brush_size=Math.max(1,Math.min(300,Number(brushSize.value)||30));brushSize.value=String(this.properties.badge_brush_size);this.graph?.afterChange?.();};
        c.element.before(tools);
        const help = c.element.nextElementSibling?.nextElementSibling;
        const updateTools=()=>{
            const brush=this.properties.badge_selection_tool==='brush';
            tabs.forEach(([b,m])=>{const selected=m===(brush?'brush':'polygon');b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
            c.vertexCount.parentElement.hidden=brush;c.outlineWidth.parentElement.hidden=brush;brushLabel.hidden=!brush;
            w.buttons.reset.hidden=brush;
            if(help)help.textContent=brush?'拖动画布涂抹选区 · Undo / Redo 撤销与重做 · Clear 清空笔画':'Shift+左键新建 Polygon · 拖动顶点或区域 · 左键点边加点 / 右键点顶点删点';
            w.canvas.style.cursor=brush?'crosshair':'default';this.updatePolygonButtons();
        };
        let stroke=null;
        const point=e=>{const q=this.getPolygonCanvasCoords(e);return {x:Math.max(0,Math.min(1,q.x/w.canvas.width)),y:Math.max(0,Math.min(1,q.y/w.canvas.height))};};
        const finish=cancel=>{if(!stroke)return;if(cancel)w.brushStrokes.pop();stroke=null;this.updatePolygonInfo();if(!cancel)this.pushPolygonHistory();this.redrawPolygonCanvas();this.updatePolygonButtons();};
        const canvas=w.canvas;canvas.style.touchAction='none';
        canvas.addEventListener('pointerdown',e=>{
            if(this.properties.badge_selection_tool!=='brush'||e.button!==0||!w.image||w.pendingSourceImageData||!isNodeAvailableInAppMode(this))return;
            e.preventDefault();e.stopImmediatePropagation();canvas.setPointerCapture(e.pointerId);
            if(!w.history.length)this.resetPolygonHistory();
            stroke={diameter:Math.min(2,(Number(this.properties.badge_brush_size)||30)/Math.min(canvas.width,canvas.height)),points:[point(e)]};
            (w.brushStrokes ||= []).push(stroke);this.redrawPolygonCanvas();
        },true);
        canvas.addEventListener('pointermove',e=>{if(!stroke)return;e.preventDefault();e.stopImmediatePropagation();stroke.points.push(point(e));this.redrawPolygonCanvas();},true);
        canvas.addEventListener('pointerup',e=>{if(!stroke)return;finish(false);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);},true);
        canvas.addEventListener('pointercancel',()=>finish(true),true);
        canvas.addEventListener('lostpointercapture',()=>finish(true),true);
        for(const event of ['mousedown','mousemove','mouseup'])canvas.addEventListener(event,e=>{if(this.properties.badge_selection_tool==='brush'){e.preventDefault();e.stopImmediatePropagation();}},true);
        const previousConfigure=this.onConfigure;this.onConfigure=function(...a){const r=previousConfigure?.apply(this,a);brushSize.value=String(this.properties.badge_brush_size||30);updateTools();return r;};
        updateTools();return result;
    });
    if (!document.getElementById('badge-selection-style')) {
        const style=document.createElement('style');style.id='badge-selection-style';style.textContent=`
        .badge-selection-tools {display:flex;gap:4px;padding:5px 8px;background:#20262c;flex:none;}
        .badge-selection-tools button {display:flex;align-items:center;justify-content:center;width:34px;height:30px;border:1px solid #52616d;border-radius:5px;background:#29333b;color:#cbd9e3;cursor:pointer;}
        .badge-selection-tools button[aria-selected=true] {background:#254a43;border-color:#39c8b1;color:#dcfff5;box-shadow:inset 0 0 0 1px #39c8b1;}
        .badge-selection-tools button:focus-visible {outline:2px solid #80bfff;outline-offset:2px;}
        .badge-selection-appearance {flex-wrap:nowrap!important;gap:8px!important;padding:5px 8px!important;overflow-x:auto;}
        .badge-selection-appearance > div {flex:0 0 auto!important;gap:4px!important;}
        .badge-selection-appearance input[type=number] {width:46px!important;min-width:40px!important;}
        .badge-selection-appearance input[type=text] {width:66px!important;min-width:60px!important;flex:none!important;}
        .badge-selection-appearance [hidden],.badge-selection-editor button[hidden] {display:none!important;}
        .badge-selection-appearance label {display:flex;align-items:center;white-space:nowrap;gap:4px;font-size:12px;}
        `;document.head.append(style);
    }
}
