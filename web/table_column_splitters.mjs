// Column layout only. Values and prompt bindings remain keyed by field ID.
export function resizeColumnPair(left, right, delta) {
    const movement = Math.max(Math.max(100 - left, right - 600),
        Math.min(Math.min(600 - left, right - 100), Math.round(delta)));
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
.dae-column-divider{position:absolute;top:0;bottom:0;width:10px;transform:translateX(-50%);pointer-events:auto;cursor:col-resize;touch-action:none;outline:none}
.dae-column-divider::before{content:'';position:absolute;left:4px;top:0;bottom:0;width:2px;background:#717773;opacity:0;transition:opacity .12s}
.dae-column-divider:hover::before,.dae-column-divider:focus-visible::before,.dae-column-divider:focus-within::before,.dae-column-divider[data-dragging]::before{opacity:1}
.dae-table .dae-column-swap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:38px;padding:7px!important;border:1px solid #3b403e!important;border-radius:12px!important;background:#242725!important;color:#a6b0aa!important;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;cursor:pointer;box-shadow:0 2px 8px #0003;transition:opacity .12s,background .12s}
.dae-column-divider:hover .dae-column-swap,.dae-column-divider:focus-within .dae-column-swap{opacity:1;pointer-events:auto}
.dae-table .dae-column-swap:hover,.dae-table .dae-column-swap:focus-visible{background:#343936!important;color:#e2eee7!important;outline:1px solid #9eb4a8;outline-offset:2px}
.dae-column-swap svg{width:20px;height:20px;flex:none;pointer-events:none}
.dae-column-swap-hint{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);border:1px solid #414642;border-radius:8px;background:#303430;color:#f0f3f1;padding:6px 10px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0}
.dae-column-swap:hover .dae-column-swap-hint,.dae-column-swap:focus-visible .dae-column-swap-hint{opacity:1}
.dae-column-divider[data-dragging] .dae-column-swap{opacity:0;pointer-events:none}
.dae-table[data-view=cards] .dae-column-splitters{display:none}
@media(prefers-reduced-motion:reduce){.dae-column-divider::before,.dae-table .dae-column-swap{transition:none}}
`;
    document.head.append(style);
}

// Reuses the editor's change/history transaction and existing tableButton control.
// Pointer capture/cancel follows the shared reference-resize interaction pattern.
export function attachColumnSplitters({root, shell, table, fields, change, button}) {
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
            // Keep the floating control and its hint inside a narrow scrolled view.
            const swap = bar.querySelector('button'), hint = swap.querySelector('.dae-column-swap-hint');
            const buttonX = Math.max(20, Math.min(shell.clientWidth - 20, x));
            swap.style.marginLeft = buttonX - x + 'px';
            const inset = hint.offsetWidth / 2 + 4;
            hint.style.marginLeft = Math.max(inset, Math.min(shell.clientWidth - inset, buttonX)) - buttonX + 'px';
        });
    }
    function schedule() {
        if (frame != null || disposed) return;
        frame = requestAnimationFrame(() => { frame = null; geometry(); });
    }
    function preview(index, widths) {
        [index, index + 1].forEach((at, j) => {
            const width = widths[j];
            if (colgroup) colgroup.children[at + 1].style.width = width + 'px';
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
    function focusBoundary(left, right, swap = false) {
        queueMicrotask(() => {
            const bar = [...root.querySelectorAll('.dae-column-divider')].find(e => e.dataset.left === left && e.dataset.right === right);
            (swap ? bar?.querySelector('button') : bar)?.focus({preventScroll:true});
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
        bar.setAttribute('aria-valuemin', String(Math.max(100, left.width + right.width - 600)));
        bar.setAttribute('aria-valuemax', String(Math.min(600, left.width + right.width - 100)));
        bar.setAttribute('aria-valuenow', String(left.width));
        bar.title = '拖动调整左右列宽；方向键微调，Esc 取消';
        const swap = button('', () => {
            change(t => swapColumns(t, left.id, right.id));
            focusBoundary(right.id, left.id, true);
        });
        swap.className = 'dae-column-swap';
        swap.setAttribute('aria-label', `交换左右列：${left.name} / ${right.name}`);
        swap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3 4 8l5 5M4 8h15M15 11l5 5-5 5M20 16H5"/></svg><span class="dae-column-swap-hint" aria-hidden="true">交换左右列</span>';
        swap.onpointerdown = e => e.stopPropagation();
        swap.onkeydown = e => e.stopPropagation();
        bar.append(swap); layer.append(bar); bars.push(bar);
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
            active.widths = resizeColumnPair(...active.original, (e.clientX - active.x) * active.ratio);
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
            commit(index, resizeColumnPair(left.width, right.width, delta));
        };
        for (const event of ['mousedown','mouseup','click','dblclick','dragstart']) bar.addEventListener(event, e => {e.stopPropagation();if(event==='dragstart')e.preventDefault();});
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(root); observer.observe(shell); observer.observe(table);
    shell.addEventListener('scroll', schedule, {passive:true});
    schedule();
    return {dispose() {disposed=true;active=null;if(frame!=null)cancelAnimationFrame(frame);observer.disconnect();shell.removeEventListener('scroll',schedule);layer.remove();}};
}
