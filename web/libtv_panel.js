import { app } from "/scripts/app.js";
import { stopCanvasPropagation } from "./list_editor_controls.mjs";
import { removeOwnedWidgets } from './dynamic_widget_lifecycle.mjs';
import { resultUrl, validateResultUrl, addVideoToCanvas } from "./libtv_canvas_result.mjs?v=20260925-1";
import { connectionPanel, connectionRequest, compatibleValues, fallbackCapabilities } from "./libtv_connection.mjs";

// DAELab-owned adaptation of ComfyTV's StageParamsPanel grouping and theme.
// No dependency on the upstream Vue application or its node registrations.
import { studioTheme } from './daelab_studio_theme.mjs';
import { batchControls, showBatchReport } from './libtv_batch_panel.mjs?v=20260926-batch1';
const BATCH_TYPE = 'DAELAB.LibTV.StoryboardBatch';
const TYPE = "DAELAB.LibTV.VideoGenerate";
const PANEL = "daelab_libtv_panel";
const names = ["project_uuid", "request_id", "model", "mode", "prompt", "duration", "resolution", "ratio", "sound", "reference_files"];
const labels = {project_uuid:"LibTV 画布 ID",request_id:"任务编号",model:"视频模型",mode:"输入模式",prompt:"画面与运动描述",duration:"时长 · 秒",resolution:"分辨率",ratio:"画幅",sound:"生成声音",reference_files:"参考素材路径 · JSON"};
const modes = {text2video:"文生视频",singleImage2video:"首帧生视频",frames2video:"首尾帧",image2video:"多图参考",mixed2video:"全能参考"};
const nodes = new Set();
const widget = (node, name) => node.widgets?.find(w => w.name === name);

function styles() {
    if (document.getElementById("daelab-libtv-style")) return;
    const el = document.createElement("style"); el.id = "daelab-libtv-style";
    el.textContent = `
.dae-libtv{box-sizing:border-box;width:100%;height:100%;overflow:auto;background:#1e1e1e;color:#ddd;border:1px solid #3d3d3d;border-radius:10px;font:12px/1.5 system-ui;padding:16px;display:flex;flex-direction:column;gap:14px}
.dae-libtv *{box-sizing:border-box}.dae-libtv header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;padding-bottom:12px}.dae-libtv strong{font-size:16px;letter-spacing:.3px}.dae-libtv small,.dae-libtv p{color:#999;margin:0}.dae-libtv .badge{color:#83c2ff;background:#26384b;border:1px solid #36536f;border-radius:5px;padding:3px 8px;font-size:10px}
.dae-libtv section{display:flex;flex-direction:column;gap:10px}.dae-libtv .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dae-libtv label{display:flex;flex-direction:column;gap:5px;min-width:0;color:#bbb}.dae-libtv input,.dae-libtv select,.dae-libtv textarea{width:100%;min-width:0;border:1px solid #3d3d3d;background:#2a2a2a;color:#eee;border-radius:5px;padding:8px;font:inherit;outline:none}.dae-libtv :is(input,select,textarea):focus{border-color:#4ea8ff;box-shadow:0 0 0 1px #4ea8ff33}.dae-libtv textarea{resize:vertical;min-height:84px}.dae-libtv input[type=checkbox]{width:18px;height:18px;accent-color:#4ea8ff}.dae-libtv .refs{padding:12px;border:1px dashed #555;border-radius:6px;background:#232323}.dae-libtv summary{cursor:pointer;color:#aaa}.dae-libtv details section{padding-top:10px}.dae-libtv button{background:#26384b;color:#a7d4ff;border:1px solid #36536f;padding:7px 10px;border-radius:5px;cursor:pointer}.dae-libtv footer{border-top:1px solid #333;padding-top:10px;color:#999;white-space:pre-wrap;overflow-wrap:anywhere}.dae-libtv [hidden]{display:none!important}.dae-libtv :disabled{opacity:.5}
`;
    document.head.append(el);
}

function install(node) {
    if (!node.graph) return;
    if (node.__libtvPanel) {sync(node);return;}
    const batch=node.type===BATCH_TYPE;
    studioTheme();
    styles();
    const root = document.createElement("div"); root.className = "dae-libtv dae-studio";
    root.innerHTML = `<header><div><strong>LibTV 视频工作台</strong><br><small>Comfy → LibTV → Comfy</small></div><span class="badge">DAELAB / VIDEO</span></header>`;
    const controls = {};
    const capabilities = async (adjust) => {
        const model=widget(node,"model")?.value;
        try {
            const caps=await connectionRequest(`capabilities?model=${encodeURIComponent(model)}`);
            if(widget(node,"model")?.value!==model || !node.__libtvPanel)return;
            node.__libtvPanel.caps=caps;
            if(adjust){const values=compatibleValues(Object.fromEntries(names.map(n=>[n,widget(node,n)?.value])),caps);for(const name of ["resolution","ratio","mode","duration","sound"])set(name,values[name]);}
            sync(node);
        }catch(error){if(node.__libtvPanel)node.__libtvPanel.status.textContent=error.message;}
    };
    const set = (name, value, event) => {
        const w = widget(node,name); if (!w) return;
        w.value = value; w.callback?.(value,app.canvas,node,null,event);
        node.graph?.setDirtyCanvas?.(true,true);
    };
    function field(name, parent) {
        const w = widget(node,name); if (!w) return;
        const row = document.createElement("label");
        const title = document.createElement("span"); title.textContent = labels[name];
        const options = w.options?.values;
        const el = document.createElement(Array.isArray(options)?"select":["prompt","reference_files"].includes(name)?"textarea":"input");
        el.setAttribute("aria-label",labels[name]);
        if(Array.isArray(options)) for(const value of options){ const option=document.createElement("option");option.value=value;option.textContent=modes[value]||value;el.append(option); }
        if(name==="duration"){el.type="number";el.min="4";el.max="30";el.step="1";}
        if(name==="sound") el.type="checkbox";
        el.addEventListener(el.tagName==="TEXTAREA"?"input":"change",event=>{set(name,name==="sound"?el.checked:name==="duration"?Number(el.value):el.value,event);if(name==="model"){
            if(node.__libtvPanel)node.__libtvPanel.caps=null;
            const values=compatibleValues(Object.fromEntries(names.map(n=>[n,widget(node,n)?.value])),fallbackCapabilities(el.value));
            for(const field of ["resolution","ratio","mode","duration","sound"])set(field,values[field]);
            sync(node);capabilities(true);
        }else if(name==="mode"){
            const caps=node.__libtvPanel?.caps || fallbackCapabilities(widget(node,"model")?.value);
            const values=compatibleValues(Object.fromEntries(names.map(n=>[n,widget(node,n)?.value])),caps);
            set("ratio",values.ratio);sync(node);
        }});
        row.append(title,el);parent.append(row);controls[name]=el;
    }
    connectionPanel(root,{get:name=>widget(node,name)?.value,set,capabilities});
    const grid=document.createElement("section");grid.className="grid";root.append(grid);
    for(const name of ["model","mode"]) field(name,grid);
    const prompt=document.createElement("section");if(!batch){root.append(prompt);field("prompt",prompt);}
    const settings=document.createElement("section");settings.className="grid";root.append(settings);
    for(const name of ["duration","resolution","ratio","sound"])field(name,settings);
    const refs=document.createElement("section");refs.className="refs";
    const hint=document.createElement("p");hint.textContent="通过左侧接口连接首帧、尾帧、参考图或 ComfyTV 视频；也可填写 Comfy 本地素材路径。";refs.append(hint);if(!batch){field("reference_files",refs);root.append(refs);}
    const details=document.createElement("details");const summary=document.createElement("summary");summary.textContent="画布与任务设置";details.append(summary);
    const advanced=document.createElement("section");details.append(advanced);field("project_uuid",advanced);field("request_id",advanced);
    const fresh=document.createElement("button");fresh.type="button";fresh.textContent="新建任务编号";fresh.onclick=()=>{set("request_id",`${batch?"batch":"video"}-${crypto.randomUUID()}`);sync(node);};advanced.append(fresh);
    const note=document.createElement("p");note.textContent="相同编号用于恢复已有任务；更换编号后运行会创建新的付费生成。";advanced.append(note);root.append(details);
    const status=document.createElement("footer");status.setAttribute("role","status");status.textContent="使用 Comfy 的运行按钮提交。生成完成后，视频显示在节点下方。";root.append(status);
    for(const event of ["pointerdown","pointerup","mousedown","mouseup","click","dblclick","wheel","keydown"])root.addEventListener(event,stopCanvasPropagation);
    for(const name of names){const w=widget(node,name);if(!w)continue;w.hidden=true;w.options={...w.options,hidden:true,canvasOnly:true};w.computeSize=()=>[0,-4];w.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});if(w.inputEl)w.inputEl.style.display="none";}
    const panel=node.addDOMWidget(PANEL,"custom",root,{serialize:false,hideOnZoom:false,getValue:()=>"",setValue:()=>sync(node)});
    panel.serialize=false;panel.inputEl=root;panel.label="LibTV 视频工作台";
    panel.__daelabLibTVPanel=true;
    panel.computeSize=width=>[width,700];panel.computeLayoutSize=()=>({minHeight:700,maxHeight:700,minWidth:360});
    const video=document.createElement("video");video.controls=true;video.preload="metadata";video.hidden=true;video.style.cssText="width:100%;max-height:260px;flex-shrink:0;background:#111;border-radius:6px";
    const restore=document.createElement("button");restore.type="button";restore.textContent="恢复已有任务预览（不生成）";
    restore.onclick=async()=>{
        try {
            const response=await fetch("/history?max_items=200"); if(!response.ok)throw new Error("无法读取 Comfy 历史");
            const entries=Object.values(await response.json()).reverse();
            for(const entry of entries)for(const [id,p] of Object.entries(entry.prompt?.[2]||{})) {
                if(p.class_type===TYPE && p.inputs?.request_id===widget(node,"request_id")?.value && p.inputs?.project_uuid===widget(node,"project_uuid")?.value && p.inputs?.model===widget(node,"model")?.value){
                    const url=resultUrl(entry.outputs?.[id]);if(url){showResult(node,url);return;}
                }
            }
            status.textContent="未找到当前编号的已完成结果。";
        }catch(error){status.textContent=error.message;}
    };
    const send=document.createElement("button");send.type="button";send.textContent="加入 ComfyTV 当前画布";send.hidden=true;
    send.onclick=async()=>{
        try {
            if(!globalThis.LiteGraph?.registered_node_types?.["ComfyTV.AssetVideoLoaderStage"]){
                throw new Error("当前服务未加载 ComfyTV。请在安装了 ComfyTV 的同一服务中打开此工作流，无需固定端口。");
            }
            await addVideoToCanvas(app,node.properties.daelabLibTVResult,`LibTV · ${widget(node,"model").value}`);
            status.textContent="已加入 ComfyTV 画布，可从视频节点继续编辑。";
        }catch(error){status.textContent=error.message;}
    };
    root.insertBefore(video,status);root.insertBefore(restore,status);root.insertBefore(send,status);
    node.__libtvPanel={root,controls,status,video,send,creativeButtons:[fresh,restore],creativeFields:[controls.prompt,controls.duration,controls.model].filter(Boolean)};nodes.add(node);sync(node);
    if(batch){restore.remove();send.remove();video.remove();root.querySelector("strong").textContent="LibTV · 分镜批量生成";fresh.textContent="新建批次编号";batchControls(node,root,{app,set});}
    if(node.properties?.daelabLibTVResult)showResult(node,node.properties.daelabLibTVResult);
    // Content-sized panel; restored surplus height must never feed back into layout.
    requestAnimationFrame(()=>{if(!node.graph)return;node.setSize?.([Math.max(420,node.size[0]),1]);node.setSize?.([Math.max(420,node.size[0]),node.computeSize()[1]]);});
}

function showResult(node,value){
    const url=validateResultUrl(value);node.properties ||= {};node.properties.daelabLibTVResult=url;
    const panel=node.__libtvPanel;if(!panel)return;
    panel.video.src=url;panel.video.hidden=false;panel.send.hidden=false;
    panel.status.textContent="视频已返回，可在此预览并加入 ComfyTV 画布。";
    node.graph?.setDirtyCanvas?.(true,true);
}

function sync(node){
    const panel=node.__libtvPanel;if(!panel)return;
    const request=widget(node,'request_id');
    if(node.type===BATCH_TYPE && request && (!request.value || request.value==='video-001') && !node.inputs?.some(i=>i.name==='request_id' && i.link!=null)) {
        request.value=`batch-${crypto.randomUUID()}`;
        node.graph?.setDirtyCanvas?.(true,true);
    }
    if(panel.batchResults){const report=node.properties?.daelabLibTVBatch;panel.batchResults.hidden=Boolean(report&&(report.batch_id!==widget(node,'request_id')?.value || report.project_uuid!==widget(node,'project_uuid')?.value));}
    const model=widget(node,"model")?.value;
    const h3=model==="Minimax H3";
    const caps=panel.caps?.model===model?panel.caps:null;
    const resolutions=caps?.resolution?.length?caps.resolution:h3?["768P","2K"]:model==="Seedance 2.5"?["480p","720p","1080p"]:model==="Seedance 2.0"?["480p","720p","1080p","4k"]:["480p","720p"];
    // Display capability hints from the verified CLI catalog; backend revalidates live.
    for(const option of panel.controls.resolution.options)option.disabled=!resolutions.includes(option.value);
    for(const option of panel.controls.mode.options)option.disabled=caps?!caps.modes.includes(option.value):h3&&option.value==="image2video";
    const ratios=(caps||fallbackCapabilities(model)).ratioByMode?.[widget(node,"mode")?.value] || caps?.ratio;
    for(const option of panel.controls.ratio.options)option.disabled=Boolean(ratios?.length&&!ratios.includes(option.value));
    panel.controls.duration.min=String(caps?.duration?.min??(h3?5:4));
    panel.controls.duration.max=String(caps?.duration?.max??(model==="Seedance 2.5"?30:15));
    panel.controls.sound.closest("label").hidden=caps?!caps.sound:h3;
    for(const name of names){const w=widget(node,name),el=panel.controls[name];if(!w||!el)continue;if(document.activeElement!==el){if(name==="sound")el.checked=Boolean(w.value);else el.value=String(w.value??"");}el.disabled=Boolean(node.inputs?.find(i=>i.name===name)?.link!=null);}
    const graph=node.graph;const data=graph?.extra?.linearData;
    if(Array.isArray(data?.inputs)){
        let seen=false,changed=false;
        const inputs=data.inputs.filter(entry=>{if(String(entry[0])!==String(node.id)||![...names,PANEL].includes(entry[1]))return true;if(seen){changed=true;return false;}seen=true;return true;}).map(entry=>{if(String(entry[0])===String(node.id)&&names.includes(entry[1])){changed=true;return [entry[0],PANEL,...entry.slice(2)];}return entry;});
        if(changed){graph.extra.linearData={...data,inputs};graph.events?.dispatchEvent(new Event("configured"));}
    }
}

app.registerExtension({name:"DAELab.LibTV.Panel",beforeRegisterNodeDef(type,data){
    if(![TYPE,BATCH_TYPE].includes(data.name))return;
    for(const method of ["onNodeCreated","onConfigure","onAdded"]){const previous=type.prototype[method];type.prototype[method]=function(){const result=previous?.apply(this,arguments);if(this.graph)install(this);else queueMicrotask(()=>install(this));return result;};}
    const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){nodes.delete(this);removeOwnedWidgets(this,'__daelabLibTVPanel');this.__libtvPanel?.root.remove();delete this.__libtvPanel;return removed?.apply(this,arguments);};
    const executed=type.prototype.onExecuted;type.prototype.onExecuted=function(message){const result=executed?.apply(this,arguments);if(this.type===BATCH_TYPE){showBatchReport(this,message.batch_report?.[0]);return result;}const url=resultUrl(message);if(url){showResult(this,url);if(globalThis.LiteGraph?.registered_node_types?.["ComfyTV.AssetVideoLoaderStage"])addVideoToCanvas(app,url,`LibTV · ${widget(this,"model").value}`).catch(error=>{this.__libtvPanel.status.textContent=error.message;});}return result;};
},afterConfigureGraph(){
    const params=new URLSearchParams(location.search),url=params.get("daelab_libtv_result");
    if(!url||this.resultHandled)return;this.resultHandled=true;
    addVideoToCanvas(app,url,params.get("daelab_libtv_title")||"LibTV 视频结果").catch(error=>app.extensionManager?.toast?.add({severity:"error",summary:"LibTV 回传",detail:error.message,life:10000}));
}});
setInterval(()=>{for(const node of nodes)sync(node);},300);

app.api.addEventListener("daelab.libtv.batch",event=>{for(const node of nodes)if(node.type===BATCH_TYPE&&widget(node,"project_uuid")?.value===event.detail.project_uuid&&widget(node,"request_id")?.value===event.detail.batch_id)showBatchReport(node,event.detail);});
