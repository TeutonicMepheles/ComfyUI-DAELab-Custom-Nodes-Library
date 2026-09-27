import {app} from '/scripts/app.js';
import {normalizeTable,clone} from './data_table_model.mjs';
import {createTableEditor,tableButton as button,tableDialog} from './data_table_editor.mjs';
import {createAssetGroups} from './data_table_groups.mjs';
import {readStoryboard,projectStoryboard,serializeStoryboardTable,importRows,writeGenerationResults,STORYBOARD_ROLES} from './storyboard_table_adapter.mjs';
import {previewImport} from './daelab_storyboard_import.mjs?v=20260926';
import {studioTheme} from './daelab_studio_theme.mjs?v=20260927-table4';
import {stopCanvasPropagation} from './list_editor_controls.mjs';
import {removeOwnedWidgets} from './dynamic_widget_lifecycle.mjs';
import {recoverShiftedWorkflowValues} from './storyboard_legacy_widgets.mjs';

const TYPES=['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'];
const OWNER='__daelabStoryboardOwned',VERSION='20260927-table4';
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
const isGeneric=node=>node.type==='DAELAB.Table';
const panelName=node=>isGeneric(node)?'daelab_table_editor':'daelab_storyboard_editor';
const dataName=node=>isGeneric(node)?'table_data':'storyboard_data';
function notify(message,severity='info'){app.extensionManager?.toast?.add?.({severity,summary:'数据表',detail:message,life:7000});}
function setWidget(node,name,value){const w=widget(node,name);if(!w||w.value===value)return;w.value=value;w.callback?.(value,app.canvas,node);node.graph?.setDirtyCanvas?.(true,true);}
function hideNative(node,name){const w=widget(node,name);if(!w)return;w.hidden=true;w.options={...w.options,hidden:true,canvasOnly:true};w.computeSize=()=>[0,-4];w.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});w.draw=()=>{};for(const e of [w.element,w.inputEl])if(e?.style)e.style.display='none';}
async function upload(file){const body=new FormData();body.append('image',file,`${crypto.randomUUID()}-${file.name}`);body.append('type','input');body.append('subfolder','DAELAB/table');body.append('overwrite','false');const response=await app.api.fetchApi('/upload/image',{method:'POST',body});if(!response.ok)throw new Error(await response.text());const data=await response.json();return '/view?'+new URLSearchParams({filename:data.name,subfolder:data.subfolder||'',type:data.type||'input'});}
function linkedReport(node){return node.graph?._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&node.graph.links[i.link]?.origin_id===node.id))?.properties?.daelabLibTVBatch;}
function save(node,table){const report=linkedReport(node);if(report&&!isGeneric(node))writeGenerationResults(table,report);node.__dataTable=table;if(isGeneric(node))setWidget(node,'table_data',JSON.stringify(table));else{node.__daelabStoryboardState=projectStoryboard(table);setWidget(node,'storyboard_data',serializeStoryboardTable(table));}}
function fit(node){if(!node.graph)return;const width=Math.max(isGeneric(node)?720:920,node.size?.[0]||1080);node.setSize?.([width,1]);node.arrange?.();node.setSize?.([width,Math.max(558,node.computeSize()[1])]);}

function mappingDialog(node,editor){
 const table=node.__dataTable,m=table.meta.storyboard,d=tableDialog('字段映射'),controls={};
 const hint=document.createElement('p');hint.textContent='绑定字段 ID，改列名或调换列位置不会改变含义。删除绑定字段后，可在这里重新选择。';d.append(hint);
 for(const [role,label] of Object.entries(STORYBOARD_ROLES)){
  const row=document.createElement('label');row.append(document.createTextNode(label));const select=document.createElement('select');select.setAttribute('aria-label',label);select.add(new Option('不绑定',''));
  const types=['image_url','video_result'].includes(role)?['assets']:['source','original_fields'].includes(role)?['json']:['text','longtext','select'];
  for(const f of table.fields.filter(f=>types.includes(f.type)))select.add(new Option(f.name,f.id));select.value=m.bindings[role]||'';row.append(select);d.append(row);controls[role]=select;
 }
 d.append(button('取消',()=>d.remove()),button('保存映射',()=>{editor.change(t=>{t.meta.storyboard.bindings=Object.fromEntries(Object.entries(controls).map(([k,s])=>[k,s.value]));});d.remove();}));
}

function videoNode(node){
 const graph=node.graph;let batch=graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&graph.links[i.link]?.origin_id===node.id));
 if(!batch){batch=LiteGraph.createNode('DAELAB.LibTV.StoryboardBatch');if(!batch){notify('请重启 ComfyUI，加载 LibTV 批量节点','error');return;}batch.pos=[node.pos[0]+node.size[0]+70,node.pos[1]];graph.add(batch);node.connect(0,batch,batch.inputs.findIndex(i=>i.name==='storyboard_json'));setWidget(batch,'request_id',`batch-${crypto.randomUUID()}`);}
 graph.extra||={};const linear=graph.extra.linearData||={inputs:[],outputs:[]};linear.inputs||=[];linear.outputs||=[];
 for(const [id,name] of [[node.id,panelName(node)],[batch.id,'daelab_libtv_panel']])if(!linear.inputs.some(i=>String(i[0])===String(id)&&i[1]===name))linear.inputs.push([id,name]);
 if(!linear.outputs.some(id=>String(id)===String(batch.id)))linear.outputs.push(batch.id);
 graph.events?.dispatchEvent(new Event('configured'));app.canvas.selectNode(batch);app.canvas.centerOnNode?.(batch);notify('已连接 LibTV；请设置画布与模型，再生成选中记录。');
}

function createPanel(node){
 studioTheme();const root=document.createElement('div');root.className='dae-studio daelab-storyboard-panel';root.style.cssText='height:520px;min-height:520px;max-height:520px;width:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden';
 const heading=document.createElement('header');heading.className='studio-heading';const title=document.createElement('div');const mark=document.createElement('div');mark.className='studio-eyebrow';mark.textContent='DAELAB / TABLE';const name=document.createElement('strong');name.textContent=isGeneric(node)?'多维表格':'分镜表';title.append(mark,name);heading.append(title);
 const tabs=document.createElement('nav');tabs.className='studio-tabs';heading.append(tabs);root.append(heading);
 const tools=document.createElement('div');tools.className='studio-group-head';root.append(tools);
 const editor=createTableEditor({getTable:()=>node.__dataTable,setTable:t=>save(node,t),upload,notify});
 const groups=createAssetGroups({getTable:()=>node.__dataTable,change:fn=>editor.change(fn),upload,notify});
 const tableTab=button('任务表',()=>show(false)),groupTab=button('素材组',()=>show(true));tabs.append(tableTab,groupTab);
 function show(group){editor.root.hidden=group;groups.root.hidden=!group;tableTab.setAttribute('aria-selected',String(!group));groupTab.setAttribute('aria-selected',String(group));if(group)groups.render();}
 show(false);
 let importing=false;
 async function importFile(file){
  if(importing)return;importing=true;const snapshot=JSON.stringify(node.__dataTable);
  try{
   const body=new FormData();body.append('file',file,file.name);const response=await app.api.fetchApi('/daelab/storyboard/import_document?preview=1',{method:'POST',body});if(!response.ok){let detail='文档解析失败';try{detail=(await response.json()).error||detail;}catch{}throw new Error(detail);}
   const confirmed=await previewImport(await response.json(),upload);if(!confirmed)return;
   if(snapshot!==JSON.stringify(node.__dataTable))throw new Error('预览期间表格已变化，未覆盖现有记录，请重新导入');
   editor.change(t=>importRows(t,confirmed.result,confirmed.mode));show(false);updateSource();notify(`已导入 ${confirmed.result.shots.length} 条记录`);
  }catch(e){notify(e.message,'error');}finally{importing=false;}
 }
 const source=document.createElement('span');source.className='studio-hint';source.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
 const updateSource=()=>source.textContent=node.__dataTable.meta.storyboard?.source_filename||'字段可增删、改名、隐藏和拖动排序';
 if(!isGeneric(node)){
  const picker=document.createElement('input');picker.type='file';picker.accept='.docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.pdf';picker.hidden=true;picker.onchange=()=>{const f=picker.files[0];picker.value='';if(f)void importFile(f);};
  tools.append(button('导入文稿',()=>picker.click()),button('字段映射',()=>mappingDialog(node,editor)),picker);
  root.addEventListener('dragover',e=>e.preventDefault());root.addEventListener('drop',e=>{e.preventDefault();const file=e.dataTransfer?.files?.[0];if(file&&/\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(file.name))void importFile(file);});
 }
 tools.append(source);
 const run=button(isGeneric(node)?'输出表格':node.type==='DAELAB.StoryboardImport'?'输出分镜任务':'生成图片',async()=>{try{const force=widget(node,'force_run_token');if(force)setWidget(node,'force_run_token',Number(force.value||0)+1);await app.queuePrompt(0,1,[node.id]);}catch(e){notify(e.message,'error');}});
 tools.append(run);if(node.type==='DAELAB.StoryboardImport')tools.append(button('视频生成 →',()=>videoNode(node),true));
 const style=widget(node,'main_prompt');if(style){const input=document.createElement('input');input.setAttribute('aria-label','全局风格');input.placeholder='全局画面风格';input.value=style.value||'';input.oninput=()=>setWidget(node,'main_prompt',input.value);tools.append(input);}
 root.append(editor.root,groups.root);updateSource();
 for(const e of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown','drop'])root.addEventListener(e,stopCanvasPropagation);
 node.__storyboardResultUI=()=>{
  const report=linkedReport(node);if(!report)return;
  const next=clone(node.__dataTable);writeGenerationResults(next,report);if(JSON.stringify(next)!==JSON.stringify(node.__dataTable)){save(node,next);editor.render();}
 };
 return {root,editor,render:()=>{editor.render();groups.render();updateSource();},destroy:()=>editor.destroy()};
}

function install(node){
 if(!node.graph)return;
 if(node.type==='DAELAB.ComfyTV.GPTImageStoryboardStage')recoverShiftedWorkflowValues(node);
 const raw=widget(node,dataName(node))?.value;
 try{node.__dataTable=isGeneric(node)?normalizeTable(raw||{fields:[{id:'title',name:'标题',type:'text'},{id:'assets',name:'素材',type:'assets'}],records:[]}):readStoryboard(raw);}catch(e){notify(`表格未加载：${e.message}`,'error');return;}
 hideNative(node,dataName(node));hideNative(node,'main_prompt');save(node,node.__dataTable);
 if(node.__dataTablePanel){node.__dataTablePanel.render();return;}
 removeOwnedWidgets(node,OWNER);const panel=createPanel(node);node.__dataTablePanel=panel;node.__daelabStoryboardRender=panel.render;
 const w=node.addDOMWidget(panelName(node),'custom',panel.root,{serialize:false,hideOnZoom:false,getHeight:()=>520,getMinHeight:()=>520,getValue:()=>'',setValue:()=>panel.render()});
 w[OWNER]=true;w.serialize=false;w.inputEl=panel.root;w.label=isGeneric(node)?'多维表格':'分镜表';w.computeSize=width=>[width||1080,520];w.computeLayoutSize=()=>({minHeight:520,maxHeight:520,minWidth:isGeneric(node)?720:920});
 const removed=w.onRemove?.bind(w);w.onRemove=()=>{panel.destroy();removed?.();panel.root.remove();};
 requestAnimationFrame(()=>fit(node));
}
export function registerTableNodes(){
 if(globalThis.__DAELAB_TABLE_VERSION===VERSION)return;globalThis.__DAELAB_TABLE_VERSION=VERSION;
 app.registerExtension({name:'DAELab.DataTable',beforeRegisterNodeDef(type,data){
  if(!TYPES.includes(data.name))return;
  for(const method of ['onNodeCreated','onAdded','onConfigure']){const prev=type.prototype[method];type.prototype[method]=function(){const result=prev?.apply(this,arguments);if(method==='onConfigure'&&this.__dataTablePanel){this.__dataTablePanel.editor.history.undoStack=[];this.__dataTablePanel.editor.history.redoStack=[];}if(this.graph)install(this);else queueMicrotask(()=>{if(this.graph)install(this);});return result;};}
  const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){removeOwnedWidgets(this,OWNER);delete this.__dataTablePanel;delete this.__daelabStoryboardRender;delete this.__storyboardResultUI;return removed?.apply(this,arguments);};
 }});
}
