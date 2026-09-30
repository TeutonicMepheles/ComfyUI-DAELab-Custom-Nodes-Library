import {columnMinimumWidth} from './data_table_model.mjs';
// Column layout only. Values and prompt bindings remain keyed by field ID.
export function resizeColumnPair(left, right, delta, leftMin=100, rightMin=100) {
    const movement = Math.max(Math.max(leftMin - left, right - 600),
        Math.min(Math.min(600 - left, right - rightMin), Math.round(delta)));
    return [left + movement, right - movement];
}

export function swapColumns(table, leftId, rightId) {
    const left = table.fields.findIndex(f => f.id === leftId);
    const right = table.fields.findIndex(f => f.id === rightId);
    if (left < 0 || right < 0 || left === right) return;
    [table.fields[left], table.fields[right]] = [table.fields[right], table.fields[left]];
}

function styles() {
    if (document.getElementById('dae-column-splitter-style')) return;
    const style = document.createElement('style');
    style.id = 'dae-column-splitter-style';
    style.textContent = `
.dae-table{position:relative}
.dae-column-splitters{position:absolute;pointer-events:none;overflow:hidden;z-index:6}
.dae-column-divider{position:absolute;width:12px;transform:translateX(-50%);pointer-events:auto;cursor:col-resize;touch-action:none;outline:none}
.dae-column-divider::before{content:'';position:absolute;left:5px;top:0;height:var(--divider-line-height);width:2px;background:var(--dae-border-control,#909090);opacity:0;pointer-events:none}
.dae-column-splitters[data-header-hover=true] .dae-column-divider::before,.dae-column-divider:focus-visible::before,.dae-column-divider[data-dragging]::before{opacity:1}
.dae-table[data-view=cards] .dae-column-splitters{display:none}
`;
    document.head.append(style);
}

// Reuses the editor's change/history transaction and existing tableButton control.
// Pointer capture/cancel follows the shared reference-resize interaction pattern.
export function attachColumnSplitters({root, shell, table, fields, change}) {
    styles();
    const layer = document.createElement('div');
    layer.className = 'dae-column-splitters';
    root.append(layer);
    const headers = [...table.querySelectorAll('th[data-column]')];
    const colgroup = table.querySelector('colgroup');
    const bars = [];
    let active = null, frame = null, disposed = false;

    function geometry() {
        if (disposed || !root.isConnected) return;
        if(table.dataset.fluid==='true'&&colgroup){
            const choice=Number(table.dataset.choiceWidth),available=Math.max(fields.length*100,shell.clientWidth-choice-(root.dataset.structure?48:0)),total=fields.reduce((sum,f)=>sum+f.width,0);
            const projected=fields.map((f,i)=>{const width=active&&i>=active.index&&i<=active.index+1?active.widths[i-active.index]:f.width;return root.dataset.structure?Math.max(160,columnMinimumWidth(f),available*width/total):Math.max(columnMinimumWidth(f),available*width/total);});
            table.style.setProperty('--dae-table-min-width',(choice+(root.dataset.structure?48:0)+projected.reduce((a,b)=>a+b,0))+'px');
            projected.forEach((width,i)=>{colgroup.children[i+1].style.width=width+'px';});
        }
        const rect = root.getBoundingClientRect(), viewport = shell.getBoundingClientRect();
        const scale = rect.width / root.offsetWidth;
        if (!scale || !viewport.width || !viewport.height) return;
        layer.style.left = (viewport.left - rect.left) / scale + shell.clientLeft + 'px';
        layer.style.top = (viewport.top - rect.top) / scale + shell.clientTop + 'px';
        layer.style.width = shell.clientWidth + 'px';
        layer.style.height = shell.clientHeight + 'px';
        const origin = viewport.left + shell.clientLeft * scale;
        const choice = table.querySelector('th.table-choice').getBoundingClientRect();
        const covered = (choice.right - origin) / scale;
        bars.forEach((bar, i) => {
            const x = (headers[i].getBoundingClientRect().right - origin) / scale;
            bar.style.left = x + 'px';
            bar.hidden = x < covered + 5 || x > shell.clientWidth - 5;
            const header=headers[i].getBoundingClientRect();
            bar.style.top=Math.max(0,(header.top-viewport.top)/scale)+'px';
            bar.style.height=Math.min(shell.clientHeight,header.height/scale)+'px';
            bar.style.setProperty('--divider-line-height',shell.clientHeight+'px');
        });
    }
    function schedule() {
        if (frame != null || disposed) return;
        frame = requestAnimationFrame(() => { frame = null; geometry(); });
    }
    function preview(index, widths) {
        [index, index + 1].forEach((at, j) => {
            const width = widths[j];
            if (colgroup) colgroup.children[at + 1].style.width = table.dataset.fluid==='true'?Math.max(fields.length*100,shell.clientWidth-Number(table.dataset.choiceWidth))*width/fields.reduce((sum,f)=>sum+f.width,0)+'px':width+'px';
            headers[at].style.width = width + 'px';
            for (const row of table.tBodies[0].rows) {
                const cell = row.cells[at + 1];
                cell.style.width = width + 'px';
                const assets = cell.querySelector('.table-assets');
                if (assets) assets.style.width = Math.max(80, width - 18) + 'px';
            }
        });
        bars[index].setAttribute('aria-valuenow', String(widths[0]));
        geometry();
    }
    function focusBoundary(left, right) {
        queueMicrotask(() => {
            const bar = [...root.querySelectorAll('.dae-column-divider')].find(e => e.dataset.left === left && e.dataset.right === right);
            bar?.focus({preventScroll:true});
        });
    }
    function commit(index, widths) {
        if (widths[0] === fields[index].width && widths[1] === fields[index + 1].width) return;
        const ids = [fields[index].id, fields[index + 1].id];
        change(t => ids.forEach((id, j) => { const field = t.fields.find(f => f.id === id); if (field) field.width = widths[j]; }));
        focusBoundary(...ids);
    }
    function finish(cancel = false) {
        if (!active) return;
        const state = active; active = null;
        delete state.bar.dataset.dragging;
        if (state.bar.hasPointerCapture(state.pointer)) state.bar.releasePointerCapture(state.pointer);
        if (cancel) preview(state.index, state.original);
        else commit(state.index, state.widths);
    }
    fields.slice(0, -1).forEach((left, index) => {
        const right = fields[index + 1], bar = document.createElement('div');
        bar.className = 'dae-column-divider';
        bar.dataset.left = left.id; bar.dataset.right = right.id;
        bar.tabIndex = 0; bar.setAttribute('role', 'separator');
        bar.setAttribute('aria-orientation', 'vertical');
        bar.setAttribute('aria-label', `调整列宽：${left.name} / ${right.name}`);
        bar.setAttribute('aria-valuemin', String(Math.max(columnMinimumWidth(left), left.width + right.width - 600)));
        bar.setAttribute('aria-valuemax', String(Math.min(600, left.width + right.width - columnMinimumWidth(right))));
        bar.setAttribute('aria-valuenow', String(left.width));
        bar.title = '拖动调整左右列宽；方向键微调，Esc 取消';
        layer.append(bar); bars.push(bar);
        bar.onpointerdown = e => {
            if (e.button !== 0 || e.target.closest('button')) return;
            e.preventDefault(); e.stopPropagation(); bar.focus({preventScroll:true});
            const screenWidth = headers[index].getBoundingClientRect().width + headers[index + 1].getBoundingClientRect().width;
            active = {bar,index,pointer:e.pointerId,x:e.clientX,ratio:(left.width + right.width) / screenWidth,original:[left.width,right.width],widths:[left.width,right.width]};
            bar.setPointerCapture(e.pointerId); bar.dataset.dragging = 'true';
        };
        bar.onpointermove = e => {
            if (active?.pointer !== e.pointerId) return;
            e.preventDefault(); e.stopPropagation();
            active.widths = resizeColumnPair(...active.original, (e.clientX - active.x) * active.ratio, columnMinimumWidth(left), columnMinimumWidth(right));
            preview(index, active.widths);
        };
        bar.onpointerup = e => { e.stopPropagation(); finish(); };
        bar.onpointercancel = () => finish(true);
        bar.onlostpointercapture = () => finish(true);
        bar.onkeydown = e => {
            if (e.key === 'Escape' && active) { e.preventDefault(); e.stopPropagation(); finish(true); return; }
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const delta = e.key === 'Home' ? -1000 : e.key === 'End' ? 1000 : (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 40 : 10);
            commit(index, resizeColumnPair(left.width, right.width, delta, columnMinimumWidth(left), columnMinimumWidth(right)));
        };
        for (const event of ['mousedown','mouseup','click','dblclick','dragstart']) bar.addEventListener(event, e => {e.stopPropagation();if(event==='dragstart')e.preventDefault();});
    });
    const hover=e=>{layer.dataset.headerHover=String(Boolean(e.target.closest('thead,.dae-column-divider')));};
    const leave=()=>{layer.dataset.headerHover='false';};
    root.addEventListener('pointermove',hover);root.addEventListener('pointerleave',leave);
    const observer = new ResizeObserver(schedule);
    observer.observe(root); observer.observe(shell); observer.observe(table);
    shell.addEventListener('scroll', schedule, {passive:true});
    schedule();
    return {dispose() {disposed=true;active=null;if(frame!=null)cancelAnimationFrame(frame);observer.disconnect();root.removeEventListener('pointermove',hover);root.removeEventListener('pointerleave',leave);shell.removeEventListener('scroll',schedule);layer.remove();}};
}
