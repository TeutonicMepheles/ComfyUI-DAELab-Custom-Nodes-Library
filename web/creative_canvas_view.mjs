import {createFieldGallery} from './creative_field_gallery.mjs';
import {bindCreativeField} from './creative_field.mjs';
import {createCreativeButton,bindCreativeButton} from './creative_button.mjs';
import {canvasState,cardState,supportedNode,TABLE_TYPES,zoomAt,socketCompatible,graphLinks} from './creative_canvas_model.mjs';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
const button=(text,action)=>{const b=el('button','',text);b.type='button';b.onclick=action;return b;};
const value=(n,name)=>n.widgets?.find(w=>w.name===name)?.value;
const mediaURL=n=>n.properties?.daelabCreativePreview?.url||n.properties?.daelabLibTVResult||value(n,'asset_url');
// Lease the actual panel, not a clone: Vue Teleports, callbacks and editor history stay alive.
export function leasePanel(panel,target,buttons=[],fields=[]) {
    const parent=panel.parentNode, marker=document.createComment('DAELAB creative panel return');
    if(parent)parent.insertBefore(marker,panel);
    target.append(panel);
    const unbind=[...buttons.filter(b=>panel.contains(b)).map(bindCreativeButton),...fields.filter(f=>panel.contains(f)).map(bindCreativeField)];
    const cleanup=()=>unbind.forEach(release=>release());
    const release=()=>{cleanup();panel.querySelectorAll('video,audio').forEach(m=>m.pause());if(marker.parentNode)marker.replaceWith(panel);else if(parent?.isConnected)parent.append(panel);};
    release.abandon=()=>{cleanup();marker.remove();};return release;
}

export function createCreativeCanvas(app,{onExit=()=>{}}={}) {
    const root=el('section','dae-creative');root.setAttribute('aria-label','创作画布');root.tabIndex=-1;
    const grid=el('div','dae-creative-grid'),world=el('div','dae-creative-world');
    const wires=document.createElementNS('http://www.w3.org/2000/svg','svg');wires.classList.add('dae-creative-wires');world.append(wires);
    const status=el('div','dae-creative-status','拖动画布移动 · 滚轮缩放 · 点击输出与输入连接');status.setAttribute('role','status');
    const empty=el('div','dae-creative-empty');empty.append(el('strong','','从一个素材开始'),el('span','','添加多维表格、LibTV 视频或 ComfyTV 节点'));
    const toolbar=el('nav','dae-creative-toolbar');toolbar.setAttribute('aria-label','创作工具');
    const zoom=el('div','dae-creative-zoom'),zoomLabel=el('span','','100%');
    root.append(grid,world,status,empty,toolbar,zoom);document.body.append(root);
    let graph=app.graph,state=canvasState(graph),selected=null,pending=null,picker=null,visible=false,drag=null;
    const cards=new Map();let fieldGallery=null;
    const dirty=()=>{graph.setDirtyCanvas?.(true,true);graph.change?.();};
    const message=text=>{status.textContent=text;};
    function viewport(){const v=state.viewport;world.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.zoom})`;grid.style.backgroundSize=`${24*v.zoom}px ${24*v.zoom}px`;grid.style.backgroundPosition=`${v.x}px ${v.y}px`;zoomLabel.textContent=`${Math.round(v.zoom*100)}%`;}
    function setZoom(factor){state.viewport=zoomAt(state.viewport,{x:root.clientWidth/2,y:root.clientHeight/2},factor);viewport();dirty();}
    zoom.append(button('−',()=>setZoom(0.8)),zoomLabel,button('+',()=>setZoom(1.25)),button('适应',fit));
    function fit(){
        const list=[...cards.values(),...(fieldGallery?[{layout:{x:graph.extra.daelabControlGallery.x,y:graph.extra.daelabControlGallery.y,width:480},element:fieldGallery.root}]:[])];if(!list.length){state.viewport={x:60,y:60,zoom:.8};viewport();return;}
        const minX=Math.min(...list.map(c=>c.layout.x)),minY=Math.min(...list.map(c=>c.layout.y));
        const maxX=Math.max(...list.map(c=>c.layout.x+c.layout.width)),maxY=Math.max(...list.map(c=>c.layout.y+c.element.offsetHeight));
        const z=Math.max(.15,Math.min(1,(root.clientWidth-100)/(maxX-minX),(root.clientHeight-150)/(maxY-minY)));
        state.viewport={x:50-minX*z,y:50-minY*z,zoom:z};viewport();dirty();
    }
    function panelFor(node){
        if(node.__dataTablePanel)return node.__dataTablePanel.root;
        if(node.__libtvPanel)return node.__libtvPanel.root;
        return node.widgets?.map(w=>w.element||w.inputEl).find(e=>e instanceof HTMLElement&&e.classList.contains('comfytv-root'));
    }
    function select(node){selected=node?.id??null;for(const c of cards.values())c.element.dataset.selected=String(c.node.id===selected);}
    function connect(node,index,side){
        if(side==='output'){pending={node,index};message(`已选择 ${node.title} 的 ${node.outputs[index].name}，点击目标输入连接；Esc 取消`);return;}
        if(!pending){message('请先点击来源卡片的输出接口');return;}
        const source=pending;pending=null;
        if(source.node===node||!socketCompatible(source.node.outputs[source.index].type,node.inputs[index].type)){message('接口类型不兼容，未更改连线');return;}
        // Replacement is explicit; existing connections are never silently discarded.
        if(node.inputs[index].link!=null&&!window.confirm('该输入已有连接，替换为新连接？'))return;
        const link=source.node.connect(source.index,node,index);
        message(link?'已连接，可在当前画布继续操作':'连接未建立，请检查接口类型');dirty();sync();
    }
    function ports(c){
        const signature=JSON.stringify([c.layout.portsExpanded,c.node.inputs?.map(i=>[i.name,i.type,i.link]),c.node.outputs?.map(o=>[o.name,o.type,o.links])]);
        if(c.portSignature===signature)return;c.portSignature=signature;c.ports.replaceChildren();
        for(const side of ['input','output']){
            const group=el('div');c.ports.append(group);
            for(const [i,p] of (c.node[side==='input'?'inputs':'outputs']||[]).entries()){
                if(side==='input'&&p.widget&&p.link==null&&!c.layout.portsExpanded)continue;
                const b=button(`${side==='input'?'○ ':''}${p.localized_name||p.name}${side==='output'?' ○':''}`,()=>connect(c.node,i,side));
                b.dataset.side=side;b.dataset.slot=String(i);b.dataset.linked=String(side==='input'?p.link!=null:!!p.links?.length);b.title=`${p.name} · ${p.type}`;
                b.setAttribute('aria-label',`${c.node.title} ${side==='input'?'输入':'输出'} ${p.name}`);group.append(b);
            }
        }
    }
    function nativeFields(c){
        // Parameters left outside ComfyTV's rich widget still need editable controls.
        c.fields.replaceChildren();c.fieldBindings=[];
        for(const w of c.node.widgets||[]){
            if(w.hidden||w.options?.hidden||w.type==='button'||w.type==='custom'||w.serialize===false||typeof w.value==='object'||w.element)continue;
            const label=el('label','',w.label||w.name);label.style.cssText='display:flex;flex-direction:column;gap:5px;margin:8px';
            const choices=typeof w.options?.values==='function'?w.options.values():w.options?.values;
            const input=el(Array.isArray(choices)?'select':typeof w.value==='string'&&w.value.length>100?'textarea':'input');
            if(Array.isArray(choices))for(const opt of choices)input.add(new Option(opt,opt));
            else if(typeof w.value==='boolean')input.type='checkbox';else if(typeof w.value==='number'){input.type='number';input.step='any';if(w.options?.min!=null)input.min=w.options.min;if(w.options?.max!=null)input.max=w.options.max;}
            input.value=w.value??'';input.checked=!!w.value;input.setAttribute('aria-label',w.name);
            input.onchange=e=>{w.value=typeof w.value==='boolean'?input.checked:typeof w.value==='number'?Number(input.value):input.value;w.callback?.(w.value,app.canvas,c.node,null,e);dirty();};
            label.append(input);c.fields.append(label);c.fieldBindings.push({w,input});
        }
    }
    function attach(c){
        const panel=panelFor(c.node);if(!panel||panel.parentNode===c.body||panel.closest('dialog')||!panel.isConnected)return;
        // The host's first DOM-widget mount may happen after node creation. Reacquire
        // only if it returned to the host; never steal a panel from a child dialog.
        if(c.panel===panel)c.release?.abandon?.();else c.release?.();
        c.body.replaceChildren();c.panel=panel;c.release=leasePanel(panel,c.body,c.node.__libtvPanel?.creativeButtons,c.node.__libtvPanel?.creativeFields);nativeFields(c);c.body.append(c.fields);if(c.run)c.body.append(c.run);
    }
    function makeCard(node,index){
        const layout=cardState(state,node,index),element=el('article','dae-creative-card');element.dataset.nodeId=String(node.id);
        const heading=el('header','dae-creative-heading'),title=el('strong','',node.title||node.type),media=el('div','dae-creative-media'),summary=el('div','dae-creative-summary'),body=el('div','dae-creative-body'),portBox=el('div','dae-creative-ports');
        const c={node,layout,element,heading,title,media,summary,body,fields:el('div','dae-creative-fields'),ports:portBox,panel:null,release:null,portSignature:null};
        const toggle=createCreativeButton('设置',()=>{layout.expanded=!layout.expanded;select(node);update(c);dirty();});toggle.setAttribute('aria-label',`${node.title} 设置`);c.toggle=toggle;
        heading.append(title,toggle,createCreativeButton('接口',()=>{layout.portsExpanded=!layout.portsExpanded;ports(c);dirty();}),createCreativeButton('移除',()=>{if(window.confirm(`从工作流移除“${node.title}”？`)){graph.remove(node);dirty();sync();}}));
        heading.addEventListener('pointerdown',e=>{if(e.target.closest('button')||e.button!==0)return;select(node);drag={kind:'card',c,x:e.clientX,y:e.clientY,original:{x:layout.x,y:layout.y}};heading.setPointerCapture(e.pointerId);e.preventDefault();});
        element.addEventListener('pointerdown',()=>select(node));
        body.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
        element.append(heading,media,summary,body,portBox);world.append(element);cards.set(node.id,c);
        attach(c);if(!c.panel){nativeFields(c);body.append(c.fields);}
        // ComfyTV and batch nodes already provide their own generation buttons.
        if(node.type==='DAELAB.LibTV.VideoGenerate'){c.run=button('生成视频',async()=>{c.run.disabled=true;try{await app.queuePrompt(0,1,[node.id]);message('已提交视频任务');}catch(e){message(e.message);}finally{c.run.disabled=false;}});body.append(c.run);}
        update(c);return c;
    }
    function update(c){
        const {node,layout}=c;c.element.style.left=`${layout.x}px`;c.element.style.top=`${layout.y}px`;c.element.style.width=`${layout.width}px`;
        c.element.dataset.inactive=String(node.mode!=null&&node.mode!==0);c.body.inert=node.mode!=null&&node.mode!==0;
        for(const {w,input} of c.fieldBindings||[]){input.disabled=node.inputs?.some(p=>p.name===w.name&&p.link!=null);if(document.activeElement!==input){input.value=w.value??'';input.checked=!!w.value;}}
        c.title.textContent=node.title||node.type;c.body.hidden=!layout.expanded;c.toggle.textContent=layout.expanded?'收起':'设置';c.toggle.setAttribute('aria-expanded',String(layout.expanded));
        const text=TABLE_TYPES.includes(node.type)?`${node.__dataTable?.records?.length||0} 条记录`:value(node,'prompt')||value(node,'text')||'展开设置进行编辑';
        if(c.summary.textContent!==text)c.summary.textContent=text;c.summary.hidden=layout.expanded;
        const url=mediaURL(node);if(url!==c.mediaURL){c.mediaURL=url;c.media.replaceChildren();if(typeof url==='string'&&(/^(\/view\?|\/comfytv\/|https?:\/\/)/).test(url)){
            const file=new URL(url,location.href).searchParams.get('filename')||url;
            const isVideo=node.properties?.daelabCreativePreview?.kind==='video'||/\.(mp4|webm|mov)(?:[?&]|$)/i.test(file);const m=el(isVideo?'video':'img');m.src=url;if(isVideo){m.controls=true;m.preload='metadata';}else m.alt=node.title||'素材';c.media.append(m);
        }}
        c.media.hidden=layout.expanded&&!!c.panel?.querySelector('video[src],img[src]');
        ports(c);
    }
    function drawWires(){
        const segments=[];
        for(const link of graphLinks(graph)){
            const a=cards.get(link.origin_id),b=cards.get(link.target_id);if(!a||!b)continue;
            const source=a.ports.querySelector(`[data-side=output][data-slot="${link.origin_slot}"]`),target=b.ports.querySelector(`[data-side=input][data-slot="${link.target_slot}"]`);if(!source||!target)continue;
            const ra=source.getBoundingClientRect(),rb=target.getBoundingClientRect(),rw=world.getBoundingClientRect(),z=state.viewport.zoom;
            const x1=(ra.right-rw.left)/z,y1=(ra.top+ra.height/2-rw.top)/z,x2=(rb.left-rw.left)/z,y2=(rb.top+rb.height/2-rw.top)/z,d=Math.max(60,Math.abs(x2-x1)*.45);
            segments.push([link.id,`M${x1},${y1} C${x1+d},${y1} ${x2-d},${y2} ${x2},${y2}`]);
        }
        const sig=JSON.stringify(segments);if(wires.dataset.signature===sig)return;wires.dataset.signature=sig;wires.replaceChildren();
        for(const [id,d] of segments){const path=document.createElementNS(wires.namespaceURI,'path');path.setAttribute('d',d);path.dataset.linkId=id;path.addEventListener('dblclick',()=>{if(window.confirm('断开这条连接？')){graph.removeLink(id);dirty();sync();}});wires.append(path);}
    }
    function clear(){fieldGallery?.release();fieldGallery=null;for(const c of cards.values()){c.node.__dataTablePanel?.close?.();c.release?.();c.element.remove();}cards.clear();wires.replaceChildren();delete wires.dataset.signature;selected=null;pending=null;}
    function sync(){
        if(!visible)return;
        if(graph!==app.graph||state!==app.graph.extra?.daelabCreativeCanvasV1){clear();graph=app.graph;state=canvasState(graph);if(!state.active){hide(false);onExit();return;}viewport();}
        const nodes=graph._nodes.filter(supportedNode),current=new Set(nodes);
        for(const [id,c] of cards)if(!current.has(c.node)){c.release?.();c.element.remove();cards.delete(id);}
        nodes.forEach((node,i)=>{const c=cards.get(node.id)||makeCard(node,i);attach(c);update(c);});empty.hidden=nodes.length>0;drawWires();
    }
    function add(type){
        const node=globalThis.LiteGraph.createNode(type);if(!node){message('当前服务没有加载此节点，请检查扩展或重启服务');return;}
        graph.add(node);node.pos=[Math.max(0,...graph._nodes.map(n=>n===node?0:n.pos[0]+n.size[0]))+80,100];
        if(type==='DAELAB.LibTV.VideoGenerate'){const request=node.widgets?.find(w=>w.name==='request_id');if(request)request.value=`video-${crypto.randomUUID()}`;}
        const v=state.viewport;state.cards[node.id]={x:(root.clientWidth/2-v.x)/v.zoom-220,y:(root.clientHeight/3-v.y)/v.zoom,width:TABLE_TYPES.includes(type)?1060:460,expanded:true};
        dirty();sync();select(node);picker?.remove();picker=null;message('已添加，可直接编辑、连接并运行');return node;
    }
    function choose(){
        if(picker){picker.remove();picker=null;return;}
        picker=el('section','dae-creative-picker');picker.setAttribute('aria-label','添加 ComfyTV 节点');const search=el('input');search.placeholder='搜索 ComfyTV 功能';search.setAttribute('aria-label','搜索 ComfyTV 功能');const list=el('div');picker.append(search,list);root.append(picker);
        const render=()=>{list.replaceChildren();for(const [type,def] of Object.entries(globalThis.LiteGraph.registered_node_types).filter(([type,def])=>type.startsWith('ComfyTV.')&&`${type} ${def.title}`.toLowerCase().includes(search.value.toLowerCase()))){const b=button(def.title||type,()=>add(type));b.title=type;list.append(b);}};search.oninput=render;render();search.focus();
    }
    toolbar.append(button('多维表格',()=>add('DAELAB.Table')),button('分镜表',()=>add('DAELAB.StoryboardImport')),button('LibTV 视频',()=>add('DAELAB.LibTV.VideoGenerate')),button('ComfyTV 功能',choose),button('图形模式',()=>{hide();onExit();}));
    root.addEventListener('wheel',e=>{if(e.target.closest('.dae-creative-card,.dae-creative-picker,.dae-creative-toolbar'))return;e.preventDefault();const r=root.getBoundingClientRect();state.viewport=zoomAt(state.viewport,{x:e.clientX-r.left,y:e.clientY-r.top},Math.exp(-e.deltaY*.001));viewport();dirty();},{passive:false});
    root.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,select,textarea,.dae-creative-card,.dae-creative-picker')||e.button!==0)return;select(null);drag={kind:'pan',x:e.clientX,y:e.clientY,original:{...state.viewport}};root.setPointerCapture(e.pointerId);});
    root.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(drag.kind==='pan'){state.viewport.x=drag.original.x+dx;state.viewport.y=drag.original.y+dy;viewport();}else{drag.c.layout.x=drag.original.x+dx/state.viewport.zoom;drag.c.layout.y=drag.original.y+dy/state.viewport.zoom;update(drag.c);drawWires();}});
    const endDrag=()=>{if(drag){drag=null;dirty();}};root.addEventListener('pointerup',endDrag);root.addEventListener('pointercancel',endDrag);
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){pending=null;picker?.remove();picker=null;message('已取消连接选择');}e.stopPropagation();});
    function show(){graph=app.graph;state=canvasState(graph);state.active=true;visible=true;root.hidden=false;document.body.dataset.daelabCreative='true';viewport();sync();if(graph.extra?.daelabControlGallery&&!fieldGallery){fieldGallery=createFieldGallery(graph.extra.daelabControlGallery);world.append(fieldGallery.root);}dirty();}
    function hide(save=true){if(save&&state){state.active=false;dirty();}visible=false;root.hidden=true;delete document.body.dataset.daelabCreative;clear();picker?.remove();picker=null;app.canvas.setDirty?.(true,true);}
    const timer=setInterval(sync,250);root.hidden=true;
    return {root,show,hide,sync,add,fit,get active(){return visible;},destroy(){hide(false);clearInterval(timer);root.remove();}};
}
