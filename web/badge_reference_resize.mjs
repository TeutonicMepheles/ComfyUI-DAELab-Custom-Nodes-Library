// Resize only the reference image; toolbars and configuration retain their own layout.
export function attachReferenceResize(root, workspace, frame, graph, live) {
    const bar = document.createElement('div');
    bar.className = 'badge-reference-resize';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-orientation', 'horizontal');
    bar.setAttribute('aria-label', '调整置顶参考区高度');
    bar.title = '拖动调整参考区高度 · 方向键微调 · 双击恢复默认';
    workspace.append(bar);
    let desired = Number(graph.extra.daelabBadgePrototypeV1.referenceImageHeight) || null;
    let drag = null;
    function limits() {
        const tabs = root.querySelector('[data-daelab-app-layout-owned="tabs"]');
        const chrome = workspace.getBoundingClientRect().height - frame.getBoundingClientRect().height;
        const available = root.clientHeight - (tabs?.getBoundingClientRect().height || 48) - chrome - 120;
        const max = Math.max(80, Math.min(600, available));
        return { min: Math.min(120, max), max };
    }
    function render() {
        if (!live() || !workspace.isConnected) return;
        const {min, max} = limits();
        const value = Math.round(Math.max(min, Math.min(max, desired ?? innerHeight * .27)));
        frame.style.height = `${value}px`;
        bar.setAttribute('aria-valuemin', String(Math.round(min)));
        bar.setAttribute('aria-valuemax', String(Math.round(max)));
        bar.setAttribute('aria-valuenow', String(value));
        bar.setAttribute('aria-valuetext', `图片高度 ${value} 像素`);
    }
    function save() {
        if (!live()) return;
        graph.beforeChange?.();
        if (desired === null) delete graph.extra.daelabBadgePrototypeV1.referenceImageHeight;
        else graph.extra.daelabBadgePrototypeV1.referenceImageHeight = desired;
        graph.afterChange?.();
    }
    function set(value) {
        const {min,max}=limits();
        desired=Math.round(Math.max(min,Math.min(max,value)));render();
    }
    bar.onpointerdown=e=>{
        if(e.button!==0)return;
        e.preventDefault();bar.focus();
        drag={id:e.pointerId,y:e.clientY,height:frame.getBoundingClientRect().height,previous:desired};
        bar.setPointerCapture(e.pointerId);bar.dataset.dragging='true';
    };
    bar.onpointermove=e=>{if(drag?.id===e.pointerId)set(drag.height+e.clientY-drag.y);};
    function finish(cancel=false){
        if(!drag)return;
        const previous=drag.previous,id=drag.id;drag=null;delete bar.dataset.dragging;
        if(bar.hasPointerCapture(id))bar.releasePointerCapture(id);
        if(cancel){desired=previous;render();}else save();
    }
    bar.onpointerup=()=>finish();bar.onpointercancel=()=>finish(true);
    bar.onlostpointercapture=()=>finish(true);
    bar.ondblclick=()=>{desired=null;render();save();};
    bar.onkeydown=e=>{
        if(e.key==='Escape'){finish(true);return;}
        if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
        e.preventDefault();const {min,max}=limits();
        set(e.key==='Home'?min:e.key==='End'?max:frame.getBoundingClientRect().height+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?30:10));save();
    };
    const observer=new ResizeObserver(render);
    observer.observe(root);observer.observe(workspace);render();
    return {dispose(){observer.disconnect();drag=null;bar.remove();frame.style.removeProperty('height');}};
}
