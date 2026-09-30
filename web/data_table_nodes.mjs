import {attachGenerationColumns} from './table_generation_panel.mjs';
import {isColumnPrompt,effectivePrompt} from './table_prompt_template.mjs?v=20260930-inline4';
import {installContentPresentation} from './table_content_view.mjs?v=20260930-table-surfaces3';
import {tableTheme,tableHistory} from './table_controls.mjs?v=20260930-table-surfaces3';
import {createWorkbench,showExistingPanel} from './table_workbench.mjs';
import {workbenchTheme} from './table_workbench_theme.mjs';
import {storyboardTaskState,selectedTaskSummary} from './storyboard_task_state.mjs?v=20260930-inline4';
import {app} from '/scripts/app.js';
import {normalizeTable,clone,addField} from './data_table_model.mjs?v=20260930-inline4';
import {createPromptEditor} from './table_prompt_editor.mjs?v=20260930-inline4';
import {promptConfig,promptField,promptFingerprint} from './table_prompt_model.mjs?v=20260930-inline4';
import {createTableEditor,tableButton as button} from './data_table_editor.mjs?v=20260930-table-surfaces3';
import {createAssetGroups} from './data_table_groups.mjs';
import {readStoryboard,projectStoryboard,serializeStoryboardTable,importRows,writeGenerationResults,addGenerationFields,STORYBOARD_ROLES} from './storyboard_table_adapter.mjs';
import {previewImport} from './daelab_storyboard_import.mjs?v=20260927-multiref';
import {studioTheme} from './daelab_studio_theme.mjs?v=20260927-ux1';
import {stopCanvasPropagation} from './list_editor_controls.mjs';
import {removeOwnedWidgets} from './dynamic_widget_lifecycle.mjs';
import {recoverShiftedWorkflowValues} from './storyboard_legacy_widgets.mjs';

const TYPES=['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'];
const OWNER='__daelabStoryboardOwned',VERSION='20260928-content4';
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
const isGeneric=node=>node.type==='DAELAB.Table';
const panelName=node=>isGeneric(node)?'daelab_table_editor':'daelab_storyboard_editor';
const dataName=node=>isGeneric(node)?'table_data':'storyboard_data';
function notify(message,severity='info'){app.extensionManager?.toast?.add?.({severity,summary:'数据表',detail:message,life:7000});}
function setWidget(node,name,value){const w=widget(node,name);if(!w||w.value===value)return;w.value=value;w.callback?.(value,app.canvas,node);node.graph?.setDirtyCanvas?.(true,true);}
function hideNative(node,name){const w=widget(node,name);if(!w)return;w.hidden=true;w.options={...w.options,hidden:true,canvasOnly:true};w.computeSize=()=>[0,-4];w.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});w.draw=()=>{};for(const e of [w.element,w.inputEl])if(e?.style)e.style.display='none';}
async function upload(file){
 // Keep the original display name on the asset; Comfy /view rejects names containing '..'.
 const extension=file.name.match(/\.(png|jpe?g|webp)$/i)?.[0].toLowerCase();
 if(!extension)throw new Error('上传暂支持 PNG、JPG、WebP');
 const body=new FormData();body.append('image',file,`${crypto.randomUUID()}${extension}`);body.append('type','input');body.append('subfolder','DAELAB/table');body.append('overwrite','false');const response=await app.api.fetchApi('/upload/image',{method:'POST',body});if(!response.ok)throw new Error(await response.text());const data=await response.json();return '/view?'+new URLSearchParams({filename:data.name,subfolder:data.subfolder||'',type:data.type||'input'});
}
function linkedReport(node){return node.graph?._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&node.graph.links[i.link]?.origin_id===node.id))?.properties?.daelabLibTVBatch;}
function save(node,table){
 const report=linkedReport(node);node.properties||={};const reports=node.properties.daelabTableReports||={};if(report)reports[report.project_uuid+':'+report.batch_id]=clone(report);
 for(const r of Object.values(reports).sort((a,b)=>(a.started_at||0)-(b.started_at||0)))writeGenerationResults(table,r);
 for(const row of table.records){const doc=row.values[promptField(table)];if(isColumnPrompt(effectivePrompt(table,row,promptField(table)))){row.meta||={};row.meta.promptEditorFingerprint=promptFingerprint(table,row);}if(doc&&typeof doc==='object'&&!isColumnPrompt(doc))doc.editorFingerprint=promptFingerprint(table,row);}
 node.__dataTable=table;if(isGeneric(node))setWidget(node,'table_data',JSON.stringify(table));else{node.__daelabStoryboardState=projectStoryboard(table);setWidget(node,'storyboard_data',serializeStoryboardTable(table));}
 node.__promptUI?.observe();
}
function fit(node){if(!node.graph)return;const width=Math.max(isGeneric(node)?720:920,node.size?.[0]||1080);node.setSize?.([width,1]);node.arrange?.();node.setSize?.([width,Math.max(558,node.computeSize()[1])]);}

function mappingDialog(node,editor){
 const table=node.__dataTable,m=promptConfig(table),d=editor.openDialog('字段映射'),controls={};
 const hint=document.createElement('p');hint.textContent='绑定字段 ID，改列名或调换列位置不会改变含义。删除绑定字段后，可在这里重新选择。视频仅使用列头图钉标记的素材列；“参考素材”映射决定该列排在参考序列首位。';d.append(hint);
 for(const [role,label] of Object.entries(isGeneric(node)?{image_prompt:'画面描述',camera_notes:'镜头备注',image_url:'参考素材'}:STORYBOARD_ROLES)){
  const row=document.createElement('label');row.append(document.createTextNode(label));const select=document.createElement('select');select.setAttribute('aria-label',label);select.add(new Option('不绑定',''));
  const types=['image_url','video_result'].includes(role)?['assets']:['source','original_fields'].includes(role)?['json']:['text','longtext','select'];
  for(const f of table.fields.filter(f=>types.includes(f.type)))select.add(new Option(f.name,f.id));select.value=m.bindings?.[role]||'';row.append(select);d.append(row);controls[role]=select;
 }
 d.append(button('取消',()=>d.remove()),button('保存映射',()=>{editor.change(t=>{t.meta.prompt_config||=clone(promptConfig(t));const cfg=t.meta.prompt_config;cfg.bindings={...cfg.bindings,...Object.fromEntries(Object.entries(controls).map(([k,s])=>[k,s.value]))};if(t.meta.storyboard)t.meta.storyboard.bindings={...cfg.bindings};for(const [key,type,name] of [['generation_status','text','生成状态'],['video_result','assets','视频结果']])if(!t.fields.some(f=>f.id===cfg.bindings[key]))cfg.bindings[key]=addField(t,{name,type,readonly:true,width:180}).id;});d.remove();}));
 if(table.meta.prompt_mode==='reviewed')d.append(button(isGeneric(node)?'关闭生成配置':'恢复旧模式',()=>{if(!window.confirm('保留解析结果，切换生成模式？可撤销。'))return;editor.change(t=>{delete t.meta.prompt_mode;});d.remove();}));
}

function videoNode(node){
 const graph=node.graph;let batch=graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&graph.links[i.link]?.origin_id===node.id));
 if(!batch){batch=LiteGraph.createNode('DAELAB.LibTV.StoryboardBatch');if(!batch){notify('请重启 ComfyUI，加载 LibTV 批量节点','error');return;}batch.pos=[node.pos[0]+node.size[0]+70,node.pos[1]];graph.add(batch);node.connect(0,batch,batch.inputs.findIndex(i=>i.name==='storyboard_json'));setWidget(batch,'request_id',`batch-${crypto.randomUUID()}`);}
 graph.extra||={};const linear=graph.extra.linearData||={inputs:[],outputs:[]};linear.inputs||=[];linear.outputs||=[];
 for(const [id,name] of [[node.id,panelName(node)],[batch.id,'daelab_libtv_panel']])if(!linear.inputs.some(i=>String(i[0])===String(id)&&i[1]===name))linear.inputs.push([id,name]);
 if(!linear.outputs.some(id=>String(id)===String(batch.id)))linear.outputs.push(batch.id);
 graph.events?.dispatchEvent(new Event('configured'));return batch;
}

function createPanel(node){
 studioTheme();workbenchTheme();tableTheme();const root=document.createElement('div');root.className='dae-ui dae-table-panel daelab-storyboard-panel';
 const heading=document.createElement('header');heading.className='studio-heading';const title=document.createElement('div');const name=document.createElement('strong');name.textContent=isGeneric(node)?'多维表格':'分镜表';title.append(name);heading.append(title);
 const tabs=document.createElement('nav');tabs.className='studio-tabs';heading.append(tabs);root.append(heading);
 let tools=document.createElement('div');tools.className='studio-group-head';root.append(tools);
 let updateSummary=()=>{},promptUI=null,generationUI=null;
 const editor=createTableEditor({nativeHistory:tableHistory(app),displayContent:()=>isGeneric(node)&&!!root.closest('.dae-creative'),getTable:()=>node.__dataTable,setTable:t=>{save(node,t);updateSummary();},upload,notify,getRowState:(t,r)=>isGeneric(node)&&!t.meta.prompt_config?{issues:[],hint:''}:storyboardTaskState(t,r),renderCell:args=>promptUI?.renderCell(args),decorateAsset:(...args)=>promptUI?.decorateAsset(...args),onRestore:()=>{promptUI?.invalidate();generationUI?.invalidate();}});
 function defaults(){const batch=node.graph?._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&node.graph.links[i.link]?.origin_id===node.id));return batch?Object.fromEntries(['model','mode','duration','resolution','ratio','sound'].map(k=>[k,widget(batch,k)?.value])):promptConfig(node.__dataTable).defaults||{};}
 function syncDefaults(){const next=defaults();if(JSON.stringify(next)!==JSON.stringify(promptConfig(node.__dataTable).defaults||{}))editor.change(t=>{t.meta.prompt_config||=clone(promptConfig(t));t.meta.prompt_config.defaults=next;});}
 node.__syncPromptDefaults=syncDefaults;
 const feedback=document.createElement('p');feedback.className='table-parse-feedback';feedback.setAttribute('role','status');feedback.hidden=true;
 promptUI=createPromptEditor({getTable:()=>node.__dataTable,editor,notify,getDefaults:defaults,onStatus:state=>{feedback.textContent=state.message;feedback.dataset.error=String(Boolean(state.error));feedback.hidden=!state.message;root.setAttribute('aria-busy',String(state.busy));},request:async body=>{const r=await app.api.fetchApi('/daelab/storyboard/parse-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'解析接口不可用，请重启 ComfyUI');return data;}});node.__promptUI=promptUI;
 const parseButton=button('解析选中行',()=>{syncDefaults();return promptUI.parse();},true);tools.append(parseButton);
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
  editor.toolbar.append(button('导入文稿',()=>picker.click()),picker);
  root.addEventListener('dragover',e=>e.preventDefault());root.addEventListener('drop',e=>{e.preventDefault();const file=e.dataTransfer?.files?.[0];if(file&&/\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(file.name))void importFile(file);});
 }
 source.hidden=true;root.title='';
 const run=button(isGeneric(node)?'输出表格':node.type==='DAELAB.StoryboardImport'?'输出分镜任务':'生成图片',async()=>{try{const force=widget(node,'force_run_token');if(force)setWidget(node,'force_run_token',Number(force.value||0)+1);await app.queuePrompt(0,1,[node.id]);}catch(e){notify(e.message,'error');}});
 const settings=document.createElement('details');settings.className='table-settings';const summary=document.createElement('summary');summary.textContent='设置';settings.append(summary);
 if(!isGeneric(node))settings.append(button('查看文稿说明',()=>{settings.open=false;const d=editor.openDialog('文稿说明');const p=document.createElement('pre');p.style.whiteSpace='pre-wrap';p.textContent=node.__dataTable.meta.storyboard.document_notes||'这份文稿没有表外说明。';d.append(p,button('关闭',()=>d.remove()));}));
 if(node.type==='DAELAB.StoryboardImport')settings.append(button('添加逐行生成设置',()=>{editor.change(addGenerationFields);settings.open=false;notify('生成秒数和生成方式留空时沿用视频面板。首尾帧按参考素材顺序：第一张首帧，第二张尾帧。');}),run);else settings.append(run);
 if(isGeneric(node))settings.append(button('添加逐行生成设置',()=>{editor.change(addGenerationFields);settings.open=false;}));
 editor.toolbar.append(settings);
 let closeGeneration=null;
 const generate=button('生成视频…',async()=>{
  syncDefaults();
  const check=selectedTaskSummary(node.__dataTable);if(!check.selected){notify('请先勾选记录');return;}
  if(check.invalid){notify(`${check.invalid} 条记录待补充，请先检查标记的单元格`);show(false);editor.focusCell(check.issues[0].record,check.issues[0].field);return;}
  const batch=videoNode(node);if(!batch)return;
  // A newly created DOM widget is mounted by Comfy after this click returns.
  for(let i=0;i<30&&!batch.__libtvPanel?.root?.isConnected;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
  if(!node.graph||!batch.graph)return;
  closeGeneration?.();closeGeneration=showExistingPanel(batch,batch.__libtvPanel?.root,'生成设置与队列');
  if(!closeGeneration)notify('生成面板尚未就绪，请再点一次生成选中项','warn');
 },true);
 if(node.type==='DAELAB.StoryboardImport'||isGeneric(node))tools.append(generate);
 const mapping=button('配置字段映射',()=>mappingDialog(node,editor));editor.toolbar.prepend(mapping,button('编辑整列模板',()=>{let id=promptField(node.__dataTable);if(!node.__dataTable.fields.some(f=>f.id===id))editor.change(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});promptUI.editTemplate(id);}));
 settings.append(button('视频设置',async()=>{const batch=videoNode(node);if(!batch)return;for(let i=0;i<30&&!batch.__libtvPanel?.root?.isConnected;i++)await new Promise(requestAnimationFrame);closeGeneration?.();closeGeneration=showExistingPanel(batch,batch.__libtvPanel?.root,'生成设置与队列');syncDefaults();}));
 const status=document.createElement('div');status.className='table-task-summary';status.setAttribute('role','status');
 updateSummary=()=>{const selected=node.__dataTable.records.filter(r=>r.selected).length;tools.hidden=!selected;parseButton.textContent=`解析选中行 (${selected})`;mapping.textContent=node.__dataTable.meta.prompt_config?'字段映射':'配置字段映射';const configured=Boolean(node.__dataTable.meta.prompt_config||node.__dataTable.meta.storyboard);parseButton.disabled=!selected||!configured;generate.disabled=!selected||!configured;if(isGeneric(node)&&!node.__dataTable.meta.prompt_config){status.textContent=`共 ${node.__dataTable.records.length} 条记录 · 请先点击“配置字段映射”，再解析选中行`;return;}const state=selectedTaskSummary(node.__dataTable);status.replaceChildren(document.createTextNode(`已选 ${state.selected} 条 · ${state.ready} 条可生成 · ${state.invalid} 条待补充${state.active?' · '+state.active+' 条处理中':''}${state.complete?' · '+state.complete+' 条已完成':''}`));status.dataset.invalid=String(state.invalid>0);if(state.invalid)status.append(button('定位问题',()=>{show(false);editor.focusCell(state.issues[0].record,state.issues[0].field);}));generate.disabled=!state.selected;generate.dataset.primary=String(state.ready>0&&!state.invalid);parseButton.dataset.primary=String(!state.ready||Boolean(state.invalid));};

 const style=widget(node,'main_prompt');if(style){const input=document.createElement('input');input.setAttribute('aria-label','全局风格');input.placeholder='全局画面风格';input.value=style.value||'';input.oninput=()=>setWidget(node,'main_prompt',input.value);editor.toolbar.append(input);}
 editor.toolbar.prepend(tabs);heading.append(editor.toolbar);root.append(editor.root,groups.root,status,feedback);editor.selectionActions.append(...tools.children);tools.remove();tools=editor.selectionActions;updateSource();updateSummary();
 const workbench=createWorkbench(node,root,{title:isGeneric(node)?'多维表格工作台':'分镜工作台',onResize:()=>fit(node),onClose:()=>{closeGeneration?.();promptUI.close();editor.closeDialogs();}});tabs.append(workbench.trigger);
 for(const e of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown','drop'])root.addEventListener(e,event=>{if(e==='wheel'&&event.ctrlKey||e==='pointerdown'&&event.button===1||e==='mousedown'&&event.button===1)return;stopCanvasPropagation(event);});
 node.__storyboardResultUI=()=>{
  const report=linkedReport(node);if(!report)return;
  const next=clone(node.__dataTable);writeGenerationResults(next,report);if(JSON.stringify(next)!==JSON.stringify(node.__dataTable)){save(node,next);editor.render();updateSummary();}
 };
 const presentation=isGeneric(node)?installContentPresentation({root,editor,getTable:()=>node.__dataTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)}):null;
 generationUI=isGeneric(node)?attachGenerationColumns({editor,getTable:()=>node.__dataTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)}):null;
 editor.render();return {root:workbench.host,editor,height:workbench.height,close:()=>{generationUI?.invalidate();presentation?.close();promptUI.invalidate();promptUI.close();closeGeneration?.();editor.closeDialogs();workbench.close();},render:()=>{workbench.restoreHeight();promptUI.observe();editor.render();groups.render();updateSource();updateSummary();},destroy:()=>{generationUI?.destroy();presentation?.destroy();promptUI.destroy();delete node.__promptUI;delete node.__syncPromptDefaults;closeGeneration?.();workbench.destroy();editor.destroy();}};
}

function install(node){
 if(!node.graph)return;
 if(node.type==='DAELAB.ComfyTV.GPTImageStoryboardStage')recoverShiftedWorkflowValues(node);
 const raw=widget(node,dataName(node))?.value;
 try{node.__dataTable=isGeneric(node)?normalizeTable(raw||{fields:[{id:'title',name:'标题',type:'text'},{id:'assets',name:'素材',type:'assets'}],records:[]}):readStoryboard(raw);}catch(e){notify(`表格未加载：${e.message}`,'error');return;}
 hideNative(node,dataName(node));hideNative(node,'main_prompt');save(node,node.__dataTable);
 if(node.__dataTablePanel){node.__dataTablePanel.render();return;}
 removeOwnedWidgets(node,OWNER);const panel=createPanel(node);node.__dataTablePanel=panel;node.__daelabStoryboardRender=panel.render;
 const w=node.addDOMWidget(panelName(node),'custom',panel.root,{serialize:false,hideOnZoom:false,getHeight:()=>panel.height(),getMinHeight:()=>panel.height(),getValue:()=>'',setValue:()=>panel.render()});
 w[OWNER]=true;w.serialize=false;w.inputEl=panel.root;w.label=isGeneric(node)?'多维表格':'分镜表';w.computeSize=width=>[width||1080,panel.height()];w.computeLayoutSize=()=>({minHeight:panel.height(),maxHeight:panel.height(),minWidth:isGeneric(node)?720:920});
 const removed=w.onRemove?.bind(w);w.onRemove=()=>{panel.destroy();removed?.();panel.root.remove();};
 requestAnimationFrame(()=>fit(node));
}
export function registerTableNodes(){
 if(globalThis.__DAELAB_TABLE_VERSION===VERSION)return;globalThis.__DAELAB_TABLE_VERSION=VERSION;
 app.registerExtension({name:'DAELab.DataTable',beforeRegisterNodeDef(type,data){
  if(!TYPES.includes(data.name))return;
  for(const method of ['onNodeCreated','onAdded','onConfigure']){const prev=type.prototype[method];type.prototype[method]=function(){const result=prev?.apply(this,arguments);if(method==='onConfigure'&&this.__dataTablePanel){this.__dataTablePanel.close();this.__dataTablePanel.editor.history.undoStack=[];this.__dataTablePanel.editor.history.redoStack=[];}if(this.graph)install(this);else queueMicrotask(()=>{if(this.graph)install(this);});return result;};}
  const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){removeOwnedWidgets(this,OWNER);delete this.__dataTablePanel;delete this.__daelabStoryboardRender;delete this.__storyboardResultUI;return removed?.apply(this,arguments);};
 }});
}
