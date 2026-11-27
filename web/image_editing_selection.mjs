import { drawBrushStrokes } from './badge_selection_render.mjs';
import { ensurePolygon } from './image_editing_model.mjs?v=20261119-local-edit';

const MARK = '#ff3555';
const vertexRadius = 10;

function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function trace(ctx, points, width, height) {
    ctx.beginPath();
    for (const [x, y] of points) ctx.lineTo(x * width, y * height);
}

function drawStroke(ctx, stroke, width, height, color) {
    ctx.fillStyle = ctx.strokeStyle = color;
    drawBrushStrokes(ctx, [{diameter:stroke.size,points:stroke.points.map(([x,y])=>({x,y}))}], width, height);
}

export function createSelectionEditor(canvas, { update, sample }) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const events = new AbortController();
    let image, draft, tool, editing, colorMask, colorSignature;
    let brushSize = .018;
    const commit = () => { draw(); update(); };

    function mask() {
        const { width, height } = canvas;
        const selection = makeCanvas(width, height);
        const sc = selection.getContext('2d', { willReadFrequently: true });
        if (draft.maskKind === 'color') {
            const signature = JSON.stringify(draft.colors);
            if (colorSignature !== signature || !colorMask) {
                colorSignature = signature;
                const colorContext = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
                colorContext.drawImage(image, 0, 0, width, height);
                const pixels = colorContext.getImageData(0, 0, width, height);
                const groups = draft.colors.map(({color, threshold, invert}) => [
                    Number.parseInt(color.slice(1,3),16), Number.parseInt(color.slice(3,5),16),
                    Number.parseInt(color.slice(5,7),16), threshold ** 2, Boolean(invert),
                ]);
                for (let i = 0; i < pixels.data.length; i += 4) {
                    const r = pixels.data[i], g = pixels.data[i+1], b = pixels.data[i+2];
                    pixels.data[i+3] = groups.some(([x,y,z,t,invert]) => (((x-r)**2 + (y-g)**2 + (z-b)**2 <= t) !== invert)) ? 255 : 0;
                    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = 255;
                }
                colorMask = pixels;
            }
            sc.putImageData(colorMask, 0, 0);
        } else {
            sc.fillStyle = 'white';
            for (const points of [draft.polygon, ...(draft.extraPolygons ?? [])]) {
                if (!points || points.length < 3) continue;
                trace(sc, points, width, height);
                sc.closePath();
                sc.fill();
            }
        }
        for (const stroke of draft.strokes[draft.maskKind]) drawStroke(sc, stroke, width, height, 'white');
        if (editing?.kind === 'stroke' && tool === 'brush') drawStroke(sc, editing.stroke, width, height, 'white');
        const pixels = sc.getImageData(0,0,width,height);
        for (let i=3; i<pixels.data.length; i+=4) pixels.data[i] = pixels.data[i]>=128 ? 255 : 0;
        sc.putImageData(pixels,0,0);
        return selection;
    }

    function overlay(selection, target, opacity) {
        const {width, height} = selection;
        const color = makeCanvas(width, height);
        const cc = color.getContext('2d');
        cc.drawImage(selection, 0, 0);
        cc.globalCompositeOperation = 'source-in';
        cc.fillStyle = MARK;
        cc.fillRect(0, 0, width, height);
        target.save();
        target.globalAlpha = opacity;
        target.drawImage(color, 0, 0);
        target.restore();
    }

    function previewMask(selection) {
        const {width, height} = selection;
        const shade = makeCanvas(width, height);
        const dark = shade.getContext('2d');
        dark.fillStyle = 'rgba(0, 0, 0, .58)';
        dark.fillRect(0, 0, width, height);
        dark.globalCompositeOperation = 'destination-out';
        dark.drawImage(selection, 0, 0);
        ctx.drawImage(shade, 0, 0);
    }

    function drawSAM() {
        const {width,height} = canvas;
        for (const {start,end,negative} of [...draft.sam.boxes, ...(editing?.kind === 'box' ? [editing.box] : [])]) {
            ctx.strokeStyle = negative ? MARK : '#36ccae';
            ctx.lineWidth = Math.max(3, width / 200);
            ctx.strokeRect(start[0]*width, start[1]*height, (end[0]-start[0])*width, (end[1]-start[1])*height);
        }
        if (draft.sam.mode !== 'interactive') return;
        for (const {at,negative} of draft.sam.points) {
            ctx.fillStyle = negative ? MARK : '#36ccae';
            ctx.beginPath(); ctx.arc(at[0]*width, at[1]*height, Math.max(4,width/120),0,2*Math.PI); ctx.fill();
        }
    }

    function draw() {
        if (!image || !draft) return;
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0);
        if (tool === 'preview' || tool === 'sample') return;
        if (tool === 'sam') { drawSAM(); return; }
        if (draft.position === 'annotation') {
            for (const stroke of draft.strokes.annotation) drawStroke(ctx, stroke, width, height, MARK);
            if (editing?.kind === 'stroke') drawStroke(ctx, editing.stroke, width, height, MARK);
            return;
        }
        const selection = mask();
        if (tool === 'mask-preview') {
            previewMask(selection);
            return;
        }
        overlay(selection, ctx, .55);
        if (draft.maskKind === 'polygon') {
            const rect = canvas.getBoundingClientRect();
            const radius = Math.max(3, 4 * width / Math.max(rect.width, 1));
            for (const [x, y] of draft.polygon ?? []) {
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(x*width,y*height,radius,0,2*Math.PI); ctx.fill();
            }
        }
    }

    function coordinates(event) {
        const rect = canvas.getBoundingClientRect();
        const unit = (value, origin, size) => Math.max(0, Math.min(1, (value-origin)/Math.max(1,size)));
        return [unit(event.clientX, rect.left, rect.width), unit(event.clientY, rect.top, rect.height)];
    }

    function vertex(at) {
        const rect = canvas.getBoundingClientRect();
        return draft.polygon?.findIndex(([x,y]) => Math.hypot((x-at[0])*rect.width, (y-at[1])*rect.height) <= vertexRadius) ?? -1;
    }

    function edge(at) {
        const points = draft.polygon;
        let closest = 0, distance = Infinity;
        for (let i = 0; i < points.length; i++) {
            const [x,y] = points[i], [u,v] = points[(i+1)%points.length];
            const dx = u-x, dy = v-y;
            const factor = Math.max(0, Math.min(1, ((at[0]-x)*dx+(at[1]-y)*dy)/(dx*dx+dy*dy || 1)));
            const next = Math.hypot(at[0]-x-factor*dx, at[1]-y-factor*dy);
            if (next < distance) { closest = i; distance = next; }
        }
        return closest;
    }

    function begin(event) {
        if (!image || !draft || ['preview','mask-preview','none'].includes(tool) || ![0,2].includes(event.button)) return;
        const at = coordinates(event);
        event.preventDefault();
        if (tool === 'sample') {
            const read = makeCanvas(canvas.width,canvas.height).getContext('2d', { willReadFrequently: true });
            read.drawImage(image,0,0);
            const pixel = read.getImageData(Math.min(canvas.width-1,Math.floor(at[0]*canvas.width)),Math.min(canvas.height-1,Math.floor(at[1]*canvas.height)),1,1).data;
            sample('#' + Array.from(pixel).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join(''));
            return;
        }
        if (tool === 'sam') {
            const negative = event.shiftKey || event.button === 2;
            if (draft.sam.mode === 'interactive') { draft.sam.points.push({at,negative}); commit(); return; }
            if (negative) return;
            editing = { kind:'box', box:{start:at,end:at,negative:false} };
        } else if (tool === 'brush' || draft.position === 'annotation') {
            if (event.button !== 0) return;
            editing = { kind:'stroke', stroke:{points:[at],size:brushSize} };
        } else if (tool === 'polygon') {
            const index = vertex(at);
            if (event.button === 2) {
                if (index >= 0 && draft.polygon.length > 3) { draft.polygon.splice(index,1); commit(); }
                return;
            }
            if (!draft.polygon?.length) ensurePolygon(draft);
            if (index < 0) {
                const next = edge(at)+1;
                draft.polygon.splice(next,0,at);
                editing = {kind:'vertex',index:next};
            } else editing = {kind:'vertex',index};
        } else return;
        canvas.setPointerCapture?.(event.pointerId);
        draw();
    }

    function move(event) {
        if (!editing) return;
        const at = coordinates(event);
        if (editing.kind === 'stroke') {
            const previous = editing.stroke.points.at(-1);
            if (Math.hypot(at[0]-previous[0],at[1]-previous[1]) < .002) return;
            editing.stroke.points.push(at);
        } else if (editing.kind === 'vertex') draft.polygon[editing.index] = at;
        else editing.box.end = at;
        draw();
    }

    function end() {
        if (!editing) return;
        if (editing.kind === 'stroke') {
            const kind = draft.position === 'annotation' ? 'annotation' : draft.maskKind;
            draft.strokes[kind].push(editing.stroke);
        } else if (editing.kind === 'box') {
            const {start,end} = editing.box;
            if (Math.abs(start[0]-end[0]) >= .005 && Math.abs(start[1]-end[1]) >= .005) draft.sam.boxes.push(editing.box);
        }
        editing = null;
        commit();
    }

    for (const [name,callback] of [
        ['pointerdown',begin],['pointermove',move],['pointerup',end],
        ['pointercancel',end],['contextmenu',event=>event.preventDefault()],
    ]) canvas.addEventListener(name,callback,{signal:events.signal});

    return {
        draw,
        setImage(next) {
            editing = null;
            image = next;
            colorMask = null;
            if (next) { canvas.width = next.naturalWidth; canvas.height = next.naturalHeight; draw(); }
        },
        setView(next, nextTool, size) {
            draft = next;
            tool = nextTool;
            brushSize = size;
            draw();
        },
        exports() {
            const {width,height} = canvas;
            if (!image) throw new Error('请先载入底图。');
            const guide = makeCanvas(width,height);
            const gc = guide.getContext('2d');
            gc.drawImage(image,0,0);
            if (draft.position === 'annotation') {
                if (!draft.strokes.annotation.length) throw new Error('请先在图中圈注要修改的对象。');
                for (const line of draft.strokes.annotation) drawStroke(gc,line,width,height,MARK);
                return {guide,width,height};
            }
            const selection = mask();
            overlay(selection,gc,.70);
            const sc = selection.getContext('2d', {willReadFrequently:true});
            const data = sc.getImageData(0,0,width,height);
            let selected = false;
            for (let i=0; i<data.data.length; i+=4) {
                const value = data.data[i+3] >= 128 ? 255 : 0;
                selected ||= value === 255;
                data.data[i] = data.data[i+1] = data.data[i+2] = value;
                data.data[i+3] = 255;
            }
            if (!selected) throw new Error('当前遮罩没有选中像素。');
            sc.putImageData(data,0,0);
            return {mask:selection, guide,width,height};
        },
        dispose() { events.abort(); },
    };
}
