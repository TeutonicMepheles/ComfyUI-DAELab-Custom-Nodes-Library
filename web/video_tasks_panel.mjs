import {requirePromptSource,promptSourceId} from './table_prompt_source.mjs';
import {replaceLinkedTaskText,bindLinkedTaskReference} from './video_task_linked_prompt.mjs?v=20261023-h3-size-r3';
import {syncApprovedTaskRows} from './video_task_rows.mjs?v=20261023-h3-size-r3';
import {appliedSnapshot} from './llm_slot_model.mjs?v=20261023-h3-size-r3';
import {createTableButton as button,tableIcon,tableTheme,tableHistory} from './table_controls.mjs?v=20261023-h3-size-r3';
import {attachGenerationColumns} from './table_generation_panel.mjs?v=20261023-h3-size-r3';
import {createPromptEditor} from './table_prompt_editor.mjs?v=20261023-h3-size-r3';
import {createPromptSettingsBar} from './table_prompt_settings.mjs?v=20261023-h3-size-r3';
import {createTextSide} from './table_text_side.mjs?v=20261023-h3-size-r3';
import {isTableSource,readTableSnapshot,previewTableRow,writeTablePrompts} from './table_exchange.mjs?v=20261023-h3-size-r3';
import {effectivePrompt,toColumnPrompt,promptContent} from './table_prompt_template.mjs?v=20261023-h3-size-r3';
import {tableAssets,promptText} from './table_prompt_model.mjs?v=20261023-h3-size-r3';
import {rowGenerationConfig,setRowGenerationConfig,promptColumns,syncGenerationFrameTags} from './table_generation_model.mjs?v=20261023-h3-size-r3';
import {videoResultAssets} from './libtv_video_model.mjs?v=20261012-client-workflow-r2';
import {addField,uid,normalizeTable} from './data_table_model.mjs?v=20261023-h3-size-r3';
import {fillMaterialCell} from './table_material_columns.mjs?v=20261023-h3-size-r3';
import {createVideoTasks,importVideoTasks,addVideoTask,activeVideoTask,videoTaskAssets,selectTaskPrompt,syncVideoTaskInputs} from './video_tasks_model.mjs?v=20261023-h3-size-r3';
import {stopCanvasPropagation} from './list_editor_controls.mjs';
import {bindMaterialThumbnail} from './table_content_view.mjs?v=20261023-h3-size-r3';

const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
const element=(tag,parent,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;parent?.append(el);return el;};
const phases={waiting:'排队中',running:'生成中',pausing:'暂停中',paused:'已暂停',complete:'已完成',failed:'失败',needs_input:'待补充',needs_recovery:'待恢复',stopped:'已停止',stale:'输入已变化'};

export function installVideoTasks(node,app){
 tableTheme();
 if(!document.getElementById('dae-video-tasks-css')){const sheet=element('link',document.head);sheet.id='dae-video-tasks-css';sheet.rel='stylesheet';sheet.href=new URL('./video_tasks.css?v=20261022-unified-surface',import.meta.url).href;}
 if(['视频生成','DAELAB · 视频生成'].includes(node.title))node.title='生成节点';
 node.properties||={};
 let data=widget(node,'task_data');if(!data)data=node.addWidget('text','task_data','',()=>{},{serialize:true});
 if(!node.inputs?.some(i=>i.name==='table_json'))node.addInput('table_json','STRING');
 let state=data.value?JSON.parse(data.value):createVideoTasks(Object.fromEntries((node.widgets||[]).map(w=>[w.name,w.value])));
 state.table=normalizeTable(state.table);
 if(!data.value){const saved=videoResultAssets(node);if(saved.ready)state.table.records[0].values[state.fieldId]=saved.assets.map(a=>({...a,id:uid()}));}
 let disposed=false,frame=null,generation=null,promptUI=null,binding=null,promptStamp='',resultsStamp='',lastStored='',sourceKey='',inputError='',linkedTable=null,lastMode=node.mode,notice='';
 let highlightedNode=null,highlightedRecord='',releaseRowHighlight=null;
 function clearRowHighlight(){releaseRowHighlight?.();releaseRowHighlight=null;highlightedNode=null;highlightedRecord='';}
 function syncRowHighlight(){
  const context=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root);
  const selected=context?context.selected:app.canvas?.selected_nodes?.[node.id]===node;
  const source=selected&&!node.mode&&linkedTable&&state.source?.key===linkedTable.key&&!linkedTable.node.mode?linkedTable.node:null;
  if(source===highlightedNode&&state.currentId===highlightedRecord)return;
  clearRowHighlight();
  if(source){releaseRowHighlight=previewTableRow(source,state.currentId);if(releaseRowHighlight){highlightedNode=source;highlightedRecord=state.currentId;}}
 }
 const history=tableHistory(app),root=element('div',null,'dae-ui dae-video-tasks');
 const header=element('header',root,'video-task-heading');
 const billing=element('small',header,'video-task-billing','云端生成使用 ComfyUI 积分');billing.setAttribute('role','note');
 let changingType=false;
 const typeTabs=element('div',header,'video-task-types');typeTabs.setAttribute('role','group');typeTabs.setAttribute('aria-label','生成类型');typeTabs.after(billing);
 const typeButtons=new Map();
 for(const [kind,label,icon] of [['image','图片','image-line'],['video','视频','film-line']]){
  const control=button('',()=>changeType(kind));control.className='video-task-type';control.title=label+'生成';typeTabs.append(control);
  const glyph=element('span',control,'dae-table-icon');glyph.setAttribute('aria-hidden','true');glyph.style.setProperty('--table-icon',`url("${new URL('./vendor/remixicon/'+icon+'.svg',import.meta.url).href}")`);element('span',control,'',label);typeButtons.set(kind,control);
 }
 const importButton=tableIcon(button('重新导入表格',()=>importSource()),'restart-line','重新导入表格');importButton.classList.add('video-task-import');header.append(importButton);importButton.hidden=true;
 const rail=element('section',root,'video-task-rail');rail.setAttribute('aria-label','生成任务');
 const add=button('＋',()=>{if(node.mode)return;mutate(next=>addVideoTask(next));});add.classList.add('video-task-add');add.title='新增任务';add.setAttribute('aria-label','新增任务');rail.append(add);
 const cards=element('div',rail,'video-task-cards');cards.setAttribute('role','tablist');cards.setAttribute('aria-label','选择任务');
 const body=element('section',root,'video-task-body');
 const bodyTop=element('div',body,'video-task-body-top');
 const materials=element('div',bodyTop,'video-task-materials');materials.setAttribute('aria-label','当前任务参考素材');materials.tabIndex=-1;materials.dataset.selected=String(!node.mode);
 let uploadController=null,uploadTaskId='';
 const picker=element('input',root);picker.type='file';picker.accept='.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov';picker.multiple=true;picker.hidden=true;
 const emptyMaterial=button('',()=>{if(!current()||node.mode||generation.submitting||activeVideoTask(current()))return;uploadTaskId=state.currentId;picker.value='';picker.click();});emptyMaterial.classList.add('video-task-material-add');emptyMaterial.title='添加图片或视频，也可拖入素材';emptyMaterial.setAttribute('aria-label','添加图片或视频');
 const addMaterialIcon=element('span',emptyMaterial,'dae-table-icon');addMaterialIcon.setAttribute('aria-hidden','true');addMaterialIcon.style.setProperty('--table-icon',`url("${new URL('./vendor/remixicon/add-line.svg',import.meta.url).href}")`);
 picker.onchange=()=>void uploadMaterials([...picker.files],uploadTaskId);
 emptyMaterial.ondragover=event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();}};
 emptyMaterial.ondrop=event=>{if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();void uploadMaterials([...event.dataTransfer.files],state.currentId);}};
 const inputBar=element('div',bodyTop,'video-task-input');inputBar.hidden=true;
 const promptSource=element('select',inputBar);promptSource.setAttribute('aria-label','表格提示词来源');promptSource.title='提示词来源由表格列头设置';
 let materialPreviews=[];
 function clearMaterialPreviews(){for(const dispose of materialPreviews)dispose();materialPreviews=[];releaseThumbnails(materials);}
 const prompt=element('div',body,'video-task-prompt');prompt.tabIndex=0;
 const bottom=element('footer',body,'video-task-bottom');
 const settings=createPromptSettingsBar((key,anchor)=>{if(current())void generation.chooseSetting(state.fieldId,state.currentId,key,anchor);},{combined:true});bottom.append(settings.root);
 const actions=element('div',bottom,'video-task-actions');
 const run=button('运行',()=>runTask(),true);actions.append(run);
 const status=element('div',root,'video-task-status');status.setAttribute('role','status');
 const results=element('div',root,'video-task-results');results.setAttribute('aria-label','当前任务生成结果');
 const side=createTextSide({root}),dialogs=new Set();
 const getTable=()=>state.table,current=()=>state.table.records.find(r=>r.id===state.currentId),field=()=>state.table.fields.find(f=>f.id===state.fieldId);
 const config=()=>rowGenerationConfig(current(),state.fieldId,field()?.generation);
 function notify(message){notice=message;status.textContent=message;}
 function acceptMaterials(key,collection){
  const row=state.table.records.find(r=>r.id===key);if(!row)throw new Error('任务已删除');
  if(node.mode||generation.submitting||activeVideoTask(row))throw new Error('请先暂停当前任务');
  editor.change(t=>{const target=t.fields.find(f=>!f.readonly&&['content','assets'].includes(f.type))||addField(t,{name:'参考素材',type:'content'});fillMaterialCell(t,key,target.id,collection);});
 }
 async function uploadMaterials(files,recordId){
  const row=state.table.records.find(r=>r.id===recordId);if(!files.length||!row||disposed||node.mode||uploadController||generation.submitting||activeVideoTask(row))return;
  const snapshot=JSON.stringify(row),controller=new AbortController();uploadController=controller;emptyMaterial.disabled=true;notify('正在添加素材…');
  try{
   const assets=[];
   for(const file of files){
    const extension=file.name.match(/\.(png|jpe?g|webp|mp4|webm|mov)$/i)?.[0].toLowerCase();if(!extension)throw new Error('请选择 PNG、JPG、WebP、MP4、WebM 或 MOV 文件');
    const form=new FormData();form.append('image',file,crypto.randomUUID()+extension);form.append('type','input');form.append('subfolder','DAELAB/uploads');form.append('overwrite','false');
    const response=await app.api.fetchApi('/upload/image',{method:'POST',body:form,signal:controller.signal});if(!response.ok)throw new Error(`上传失败（${response.status}），请重试`);
    const result=await response.json();assets.push({filename:result.name,subfolder:result.subfolder||'',type:result.type||'input',kind:/\.(mp4|webm|mov)$/.test(extension)?'video':'image',name:file.name});
   }
   if(disposed)return;
   if(state.currentId!==recordId||JSON.stringify(state.table.records.find(r=>r.id===recordId))!==snapshot)throw new Error('任务已变化，请重新添加素材');
   acceptMaterials(recordId,{version:1,assets});
  }catch(error){if(!disposed&&error.name!=='AbortError')notify(error.message);}
  finally{uploadController=null;if(!disposed)schedule();}
 }
 function persist(){
  const text=JSON.stringify(state);if(text===lastStored)return;data.value=text;lastStored=text;node.graph?.setDirtyCanvas?.(true,true);node.graph?.change?.();
 }
 function schedule(){if(!disposed&&frame===null)frame=requestAnimationFrame(()=>{frame=null;render();});}
 let historyGroup=null;
 function mutate(update,{render:draw=true,group=null,writePrompts=false}={}){
  const next=structuredClone(state);update(next);generation?.syncPromptChanges(next.table,state.table);
  if(JSON.stringify(next)===JSON.stringify(state))return;
  notice='';
  const derived=['table-input-sync','approved-row-sync'].includes(group),continuing=group&&group===historyGroup;
  const write=()=>{
   if(writePrompts&&linkedTable&&state.source?.key===linkedTable.key){
    const source=JSON.parse(state.source.stamp),changes=[];
    for(const row of next.table.records){
     const old=state.table.records.find(r=>r.id===row.id),origin=source.records.find(r=>r.id===row.id);if(!old||!origin)continue;
     for(const field of promptColumns(next.table)){
      const segments=promptContent(next.table,row,field.id);if(JSON.stringify(segments)===JSON.stringify(promptContent(state.table,old,field.id)))continue;
      changes.push({recordId:row.id,fieldId:field.id,segments,expected:promptContent(source,origin,field.id)});
     }
    }
    if(changes.length){writeTablePrompts(linkedTable.node,changes,{group:group||crypto.randomUUID()});linkedTable.raw=widget(linkedTable.node,'table_data').value;syncVideoTaskInputs(next,readTableSnapshot(linkedTable.node),source);next.source.stamp=linkedTable.raw;}
   }
   state=next;persist();
  };
  if((derived||continuing)&&history?.amend)history.amend(write);
  else {history?.begin();try{write();}finally{history?.end();}}
  historyGroup=group;
  if(draw)promptStamp='';schedule();
 }
 const editor={root,change:(update,options)=>mutate(next=>update(next.table),{...options,writePrompts:true}),
  refreshCells(){promptStamp='';schedule();},focusCell(id){selectTask(id);materials.scrollIntoView({block:'nearest'});},
  openTextSide:side.open,openDialog(title){const dialog=element('dialog',document.body,'dae-ui video-task-dialog');element('strong',dialog,'',title);dialogs.add(dialog);dialog.addEventListener('close',()=>{dialogs.delete(dialog);dialog.remove();});dialog.showModal();return dialog;}};
 generation=attachGenerationColumns({editor,getTable,notify,observe:false,onRefresh:schedule,canGenerate:()=>!disposed&&!node.mode&&!inputError,editPromptTemplate:id=>promptUI.editTemplate(id,state.currentId)});
 promptUI=createPromptEditor({editor,getTable,notify,renderFrame:generation.renderFrame});
 function selectTask(id){binding?.finish();generation.close();clearRowHighlight();mutate(next=>{next.currentId=id;});syncRowHighlight();}
 async function changeType(kind){
  const row=current();if(!row||changingType||node.mode||generation.submitting||activeVideoTask(row)||config().kind===kind)return;
  binding?.finish();changingType=true;schedule();
  try{await generation.setKind(state.fieldId,row.id,kind);}catch(error){if(!disposed)notify(error.message);}
  finally{changingType=false;schedule();}
 }
 function removeTask(id){
  const row=state.table.records.find(r=>r.id===id);if(!row||activeVideoTask(row)||node.mode||generation.submitting)return;
  binding?.finish();generation.close();
  mutate(next=>{const index=next.table.records.findIndex(r=>r.id===id);next.table.records.splice(index,1);if(next.currentId===id)next.currentId=next.table.records[Math.min(index,next.table.records.length-1)]?.id||'';});
 }
 function renameTask(){
  const row=current();if(!row||activeVideoTask(row)||node.mode)return;
  const dialog=editor.openDialog('任务名称'),input=element('input',dialog);input.value=row.name||'';input.setAttribute('aria-label','任务名称');
  const save=()=>{if(!input.value.trim())return;mutate(next=>next.table.records.find(r=>r.id===row.id).name=input.value.trim());dialog.close();};
  dialog.append(button('取消',()=>dialog.close()),button('保存',save,true));input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save();}};input.focus();input.select();
 }
 function syncSource(){
  let linked=null;
  inputError='';
  for(const input of node.inputs||[]){
   if(input.link==null)continue;
   const link=node.graph?.links[input.link],source=node.graph?.getNodeById(link?.origin_id);
   if(!source||source.mode){inputError='输入节点不可用或已停用';continue;}
   if(isTableSource(source)){if(link.origin_slot!==0){inputError='请连接上游的 table_json 输出';continue;}if(linked&&linked.node!==source){inputError='一次连接一个多维表格';continue;}linked={node:source,key:String(source.id)+':'+link.origin_slot,raw:widget(source,'table_data')?.value};}
  }
  const rowInputs=(node.inputs||[]).filter(input=>input.link!=null).map(input=>{const link=node.graph?.links[input.link];return {input,link,source:node.graph?.getNodeById(link?.origin_id)};}).filter(({source,link})=>source?.type==='DAELAB.LLMStylePreviewB'&&link.origin_slot===1);
  if(rowInputs.length){
   linkedTable=null;inputBar.hidden=true;importButton.hidden=true;
   try{
    if(inputError)throw new Error(inputError);
    if(rowInputs.length!==1||linked||(node.inputs||[]).filter(i=>i.link!=null).length!==1)throw new Error('逐行结果请单独连接，提示词和参考图已按镜头配对');
    const {source}=rowInputs[0],snapshot=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.inputSnapshot?.(source)??appliedSnapshot(source);
    if(!snapshot?.ready)throw new Error('等待上游选行、优化并同意更改；已有结果保留');
    const key=String(source.id)+':1',stamp=JSON.stringify(snapshot);sourceKey=stamp;
    if(state.approvedSource?.key!==key||state.approvedSource?.stamp!==stamp){
     if(generation.submitting)throw new Error('提交结束后同步上游');
     mutate(next=>{syncApprovedTaskRows(next,snapshot);next.approvedSource={key,stamp};delete next.source;},{group:'approved-row-sync'});
    }
   }catch(error){inputError=error.message;}
   return;
  }
  if(state.approvedSource&&!linked){linkedTable=null;inputBar.hidden=true;importButton.hidden=true;inputError='逐行结果输入已断开；已有结果保留，请重新连接';return;}
  linkedTable=linked;inputBar.hidden=!linked&&!state.source;importButton.hidden=!linked;
  if(!linked){sourceKey='';if(state.source){inputError='表格输入已断开；已有结果保留，请重新连接';return;}syncLinkedMedia();return;}
  try{requirePromptSource(readTableSnapshot(linked.node));}catch(error){inputError=error.message;}
  const sourceChanged=sourceKey!==linked.raw;sourceKey=linked.raw;
  importButton.disabled=state.table.records.some(activeVideoTask)||generation.submitting||!!node.mode;
  importButton.title=state.source?.stamp===linked.raw?'重新导入表格':'更新表格任务';importButton.setAttribute('aria-label',importButton.title);
  if(!inputError&&state.source?.key!==linked.key&&!state.table.records.some(activeVideoTask))importSource();
  else if(state.source?.key===linked.key&&(sourceChanged||state.source.stamp!==linked.raw)){
   try{
    const source=readTableSnapshot(linked.node),previous=JSON.parse(state.source.stamp);
    mutate(next=>{
     syncVideoTaskInputs(next,source,previous);next.source.stamp=linked.raw;
     if(JSON.stringify(current()?.values[config()?.promptFieldId])!==JSON.stringify(next.table.records.find(r=>r.id===next.currentId)?.values[config()?.promptFieldId]))binding?.finish();
    },{group:'table-input-sync'});
   }catch(error){inputError=error.message;}
  }
 }
 function syncLinkedMedia(){
  for(const input of node.inputs||[]){
   if(input.link==null||!['text_input','first_frame','last_frame','reference_images','reference_video','table_json'].includes(input.name))continue;
   const link=node.graph?.links[input.link],source=node.graph?.getNodeById(link?.origin_id);if(!source||source.mode)continue;
   try{
    if(input.name==='table_json')throw new Error('表格任务接口请连接多维表格');
    let snapshot=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.inputSnapshot?.(source);
    if(!snapshot&&source.type==='LoadImage'){const file=widget(source,'image')?.value;if(file)snapshot={assets:[{filename:file,type:'input',kind:'image',name:file}]};}
    if(!snapshot){const value=source.getOutputData?.(link.origin_slot)??widget(source,'value')?.value;if(typeof value==='string')snapshot=input.name==='text_input'?{texts:[value]}:{assets:[{url:value,kind:input.name==='reference_video'?'video':'image'}]};}
    if(!snapshot||snapshot.ready===false)throw new Error('等待上游素材就绪');
    const stamp=JSON.stringify([String(source.id),snapshot]),previous=state.inputs?.[input.name];if(previous?.stamp===stamp)continue;
    const row=state.table.records.find(r=>r.id===previous?.recordId)||current();if(!row||activeVideoTask(row))continue;
    mutate(next=>{
     const target=next.table.records.find(r=>r.id===row.id),output=next.table.fields.find(f=>f.id===next.fieldId),cfg=structuredClone(rowGenerationConfig(target,next.fieldId,output.generation));
     if(input.name==='text_input'){if(!snapshot.texts)throw new Error('此接口需要文字');replaceLinkedTaskText(next.table,target,cfg,snapshot.texts);}
     else{
      const incoming=snapshot.assets||[];if(!incoming.length)throw new Error('上游没有可用素材');
      let column=next.table.fields.find(f=>f.videoInput===input.name);if(!column)column=addField(next.table,{name:({first_frame:'输入首帧',last_frame:'输入尾帧',reference_images:'参考图片',reference_video:'参考视频'})[input.name],type:'content',videoInput:input.name});
      const old=target.values[column.id]||[];target.values[column.id]=incoming.map(a=>{const url=a.url||'/view?'+new URLSearchParams({filename:a.filename,subfolder:a.subfolder||'',type:a.type||'input'});if(!url.startsWith('/view?'))throw new Error('请连接本地 Comfy 素材');return {id:old.find(item=>item.url===url)?.id||uid(),kind:a.kind||'image',url,name:a.name||a.filename||'参考素材'};});
      const role=input.name==='first_frame'?'first':input.name==='last_frame'?'last':null;
      if(role&&cfg.kind==='video'){target.meta||={};target.meta.generationFrames||={};const frames=target.meta.generationFrames[next.fieldId]||={};frames[role]={fieldId:column.id,assetId:target.values[column.id][0].id};cfg.mode=frames.last?'frames2video':'singleImage2video';setRowGenerationConfig(target,next.fieldId,cfg);syncGenerationFrameTags(next.table,next.fieldId,output.generation,target.id);}
      else if(['reference_images','reference_video'].includes(input.name))bindLinkedTaskReference(next.table,target,next.fieldId,cfg,column);
     }
     next.inputs||={};next.inputs[input.name]={stamp,recordId:target.id};
    });
   }catch(error){inputError=error.message;}
  }
 }
 function importSource(){
  if(!linkedTable||state.table.records.some(activeVideoTask)||generation.submitting)return;
  try{const sameSource=state.source?.key===linkedTable.key,next=importVideoTasks(readTableSnapshot(linkedTable.node),sameSource?state.source.promptId:'',state);
   next.source={key:linkedTable.key,stamp:linkedTable.raw,promptId:next.table.fields.find(f=>f.id===next.fieldId).generation.promptFieldId};
   if(sameSource){
    for(const row of next.table.records){const old=state.table.records.find(r=>r.id===row.id);if(!old)continue;
     // Keep results, but the imported table binding owns all new task inputs.
     row.values[next.fieldId]=structuredClone(old.values[state.fieldId]||[]);
     if(old.meta?.generationColumns?.[state.fieldId])row.meta.generationColumns={[next.fieldId]:structuredClone(old.meta.generationColumns[state.fieldId])};
    }
    if(next.table.records.some(r=>r.id===state.currentId))next.currentId=state.currentId;
   }
   binding?.finish();delete prompt.dataset.inlineEditing;generation.invalidate();history?.begin();try{state=next;persist();}finally{history?.end();}promptStamp='';resultsStamp='';generation.refresh();schedule();notify(`已导入 ${next.table.records.length} 个任务，一行对应一个任务`);
   }catch(error){inputError=error.message;notify(error.message);}
 }
 promptSource.onchange=()=>{
  const row=current(),sourceId=promptSource.value;if(!row||node.mode||generation.submitting||activeVideoTask(row)){schedule();return;}
  binding?.finish();generation.close();
  try{mutate(next=>{selectTaskPrompt(next,row.id,sourceId);if(linkedTable&&next.source?.key===linkedTable.key){const source=readTableSnapshot(linkedTable.node);syncVideoTaskInputs(next,source,source);}});generation.refresh();}catch(error){notify(error.message);schedule();}
 };
 const thumbnails=new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries)if(isIntersecting){thumbnails.unobserve(target);target.src=target.dataset.thumbnailSrc;delete target.dataset.thumbnailSrc;}});
 function videoThumb(asset,parent){
  const video=element('video',parent);video.draggable=false;video.muted=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label',asset.name||'视频');
  if(asset.thumbnailUrl||asset.poster)video.poster=asset.thumbnailUrl||asset.poster;
  video.onloadedmetadata=()=>{if(video.paused&&video.currentTime===0&&Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(.1,video.duration/2);};
  video.dataset.thumbnailSrc=asset.url;thumbnails.observe(video);
  return video;
 }
 function mediaThumb(asset,parent){
  const poster=asset.thumbnailUrl||asset.poster;
  if(asset.kind==='video'&&!poster){videoThumb(asset,parent);return;}
  const image=element('img',parent);image.src=poster||asset.url;image.alt=asset.name||'图片';image.loading='lazy';image.decoding='async';image.draggable=false;
  image.onerror=()=>{image.onerror=null;if(asset.kind==='video'){image.remove();videoThumb(asset,parent);}else if(poster)image.src=asset.url;};
  return image;
 }
 function releaseThumbnails(parent){for(const image of parent.querySelectorAll('img'))image.onerror=null;for(const video of parent.querySelectorAll('video')){thumbnails.unobserve(video);video.onloadedmetadata=null;video.pause();video.removeAttribute('src');video.load();}}
 function renderCards(){
  const existing=new Map([...cards.children].map(card=>[card.dataset.record,card]));
  for(const [index,row] of state.table.records.entries()){
   let card=existing.get(row.id);if(!card){card=element('div',null,'video-task-card');card.dataset.record=row.id;}
   existing.delete(row.id);const cfg=rowGenerationConfig(row,state.fieldId,field().generation),assets=tableAssets(state.table,row).filter(a=>a.fieldId!==state.fieldId).slice(0,3),phase=row.meta?.generationColumns?.[state.fieldId]?.phase||'';
   let text='';try{text=promptText(effectivePrompt(state.table,row,cfg.promptFieldId),state.table,row);}catch{text='引用已失效';}
   const stamp=JSON.stringify([index,row.name,assets,phase]);
   if(card.dataset.stamp!==stamp){
    card.dataset.stamp=stamp;releaseThumbnails(card);card.replaceChildren();
    const select=button('',()=>selectTask(row.id));select.className='video-task-select';select.setAttribute('role','tab');select.ondblclick=()=>{selectTask(row.id);renameTask();};card.append(select);
    element('span',select,'video-task-number',String(index+1));const thumbnails=element('span',select,'video-task-thumbs');for(const asset of assets)mediaThumb(asset,thumbnails);const label=element('span',select,'video-task-card-label');element('strong',label,'',row.name||`任务${index+1}`);element('span',label,'video-task-card-prompt');if(phase)element('small',label,'',phases[phase]||phase);
    const remove=tableIcon(button('删除任务',()=>removeTask(row.id)),'delete-bin-line',`删除${row.name||`任务${index+1}`}`);remove.classList.add('video-task-remove');card.append(remove);
   }
   const summary=card.querySelector('.video-task-card-prompt'),summaryText=text||'输入提示词…';if(summary.textContent!==summaryText)summary.textContent=summaryText;
   const selected=row.id===state.currentId,select=card.querySelector('[role=tab]');card.dataset.selected=String(selected);select.setAttribute('aria-selected',String(selected));select.tabIndex=selected?0:-1;select.title=row.name||`任务${index+1}`;
   card.querySelector('.video-task-remove').disabled=activeVideoTask(row)||!!node.mode||generation.submitting;
   if(cards.children[index]!==card)cards.insertBefore(card,cards.children[index]||null);
  }
  for(const card of existing.values()){releaseThumbnails(card);card.remove();}
 }
 function renderPrompt(){
  const row=current(),cfg=config();if(!row||!cfg||!state.table.fields.some(f=>f.id===cfg.promptFieldId)){binding?.dispose();binding=null;prompt.replaceChildren();clearMaterialPreviews();materials.replaceChildren();return;}
  const stamp=JSON.stringify([row.id,cfg.promptFieldId,effectivePrompt(state.table,row,cfg.promptFieldId),tableAssets(state.table,row).filter(a=>a.fieldId!==state.fieldId)]);
  if(promptStamp===stamp||prompt.dataset.inlineEditing==='true'&&prompt.dataset.record===row.id)return;promptStamp=stamp;binding?.dispose();delete prompt.dataset.inlineEditing;prompt.replaceChildren();
  prompt.dataset.record=row.id;prompt.dataset.field=cfg.promptFieldId;
  binding=promptUI.mountEditor({cell:prompt,row,field:state.table.fields.find(f=>f.id===cfg.promptFieldId)});
  clearMaterialPreviews();materials.replaceChildren();const assets=tableAssets(state.table,row).filter(a=>a.fieldId!==state.fieldId);if(!assets.length)materials.append(emptyMaterial);
  for(const [index,asset] of assets.entries()){
   const removeMaterial=()=>{if(node.mode||generation.submitting||activeVideoTask(current()))return;editor.change(t=>{const target=t.records.find(r=>r.id===row.id);target.values[asset.fieldId]=target.values[asset.fieldId].filter(a=>a.id!==asset.id);});};
   const thumb=element('div',materials,'video-task-material');thumb.title=asset.name;thumb.setAttribute('aria-label',asset.name||'参考素材');
   const media=asset.kind==='video'?videoThumb(asset,thumb):mediaThumb(asset,thumb);if(asset.kind==='video'){media.onloadedmetadata=null;if(asset.poster||asset.thumbnailUrl)media.poster=asset.poster||asset.thumbnailUrl;}
   materialPreviews.push(bindMaterialThumbnail(thumb,media,index,{cell:materials,remove:removeMaterial}));
   const openPreview=()=>{const dialog=editor.openDialog(asset.name||'参考素材'),preview=element(asset.kind==='video'?'video':'img',dialog);preview.src=asset.url;if(asset.kind==='video'){preview.controls=true;preview.preload='metadata';dialog.addEventListener('close',()=>{preview.pause();preview.removeAttribute('src');preview.load();},{once:true});}const remove=button('移除素材',()=>{removeMaterial();dialog.close();});remove.disabled=activeVideoTask(current())||generation.submitting||!!node.mode;dialog.append(remove,button('关闭',()=>dialog.close()));};
   thumb.ondblclick=openPreview;thumb.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();openPreview();}};
  }
 }
 function render(){
  if(disposed)return;
  if(!current())state.currentId=state.table.records[0]?.id||'';
  const row=current(),cfg=config(),receipt=row?.meta?.generationColumns?.[state.fieldId],busy=!!row&&activeVideoTask(row);
  renderCards();renderPrompt();syncRowHighlight();body.hidden=!row;bodyTop.hidden=!linkedTable&&!state.source&&!materials.children.length;
  const locked=busy||!!node.mode||generation.submitting||changingType;
  emptyMaterial.disabled=locked||!!uploadController||!row;
  const columns=promptColumns(state.table).filter(f=>f.id===promptSourceId(state.table)),columnStamp=JSON.stringify(columns.map(f=>[f.id,f.name]));
  if(promptSource.dataset.columns!==columnStamp){promptSource.dataset.columns=columnStamp;promptSource.replaceChildren(...columns.map(f=>new Option(f.name,f.id)));}
  promptSource.value=cfg?.promptFieldId||'';promptSource.disabled=true;
  root.dataset.kind=cfg?.kind||'video';typeTabs.setAttribute('aria-busy',String(changingType));for(const [kind,control] of typeButtons){control.disabled=locked||!row;control.setAttribute('aria-pressed',String(cfg?.kind===kind));}
  prompt.inert=locked;
  if(cfg)settings.update(cfg,'当前任务');settings.root.hidden=!row;settings.root.inert=locked;
  const runLabel=busy?'暂停':['paused','needs_recovery','stopped'].includes(receipt?.phase)?'继续':receipt?'重新生成':'运行';
  if(run.title!==runLabel)tableIcon(run,busy?'pause-fill':runLabel==='重新生成'?'restart-line':'play-line',runLabel);
  run.disabled=!row||!!node.mode||generation.submitting||changingType||!!inputError;
  const output=row?.values[state.fieldId]||[],stamp=JSON.stringify([row?.id,output]);
  if(resultsStamp!==stamp){resultsStamp=stamp;releaseThumbnails(results);results.replaceChildren();for(const asset of output){if(asset.kind==='image'){const media=element('img',results);media.src=asset.url;media.alt=asset.name||'生成图片';media.loading='lazy';}else{const media=videoThumb(asset,results);media.controls=true;media.muted=false;media.setAttribute('aria-label',asset.name||'生成视频');}}results.hidden=!output.length;}
  status.textContent=inputError||notice||(receipt?(phases[receipt.phase]||receipt.phase)+(receipt.error?' · '+receipt.error:''):'');
 }
 async function runTask(){
  syncSource();
  if(node.mode||inputError||generation.submitting||changingType)return;
  notice='';
  const row=current(),receipt=row?.meta?.generationColumns?.[state.fieldId];
  if(!row)return;
  if(activeVideoTask(row))return generation.pause([receipt]);
  if(['paused','needs_recovery','stopped'].includes(receipt?.phase))return generation.generate(state.fieldId,row.id,true);
  binding?.finish();return generation.generate(state.fieldId,row.id);
 }
 prompt.addEventListener('click',event=>{if(!event.target.closest('.dae-prompt-ref'))binding?.start(event);});
 cards.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const index=state.table.records.findIndex(r=>r.id===state.currentId),row=state.table.records[index+(event.key==='ArrowLeft'?-1:1)];if(row){selectTask(row.id);requestAnimationFrame(()=>cards.querySelector('[aria-selected=true]')?.focus());}});
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','keydown'])root.addEventListener(event,stopCanvasPropagation);
 root.addEventListener('wheel',event=>{if(!event.ctrlKey)event.stopPropagation();});
 for(const w of node.widgets||[]){w.hidden=true;w.options={...w.options,hidden:true,canvasOnly:true};w.computeSize=()=>[0,-4];w.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});if(w.inputEl)w.inputEl.style.display='none';}
 const panel=node.addDOMWidget('daelab_libtv_panel','custom',root,{serialize:false,hideOnZoom:false,getValue:()=>'',setValue:()=>sync()});panel.serialize=false;panel.inputEl=root;panel.__daelabLibTVPanel=true;panel.computeSize=width=>[width,560];panel.computeLayoutSize=()=>({minHeight:560,maxHeight:560,minWidth:640});
 requestAnimationFrame(()=>{if(!disposed&&node.graph)node.setSize?.([Math.max(640,node.size[0]),node.computeSize()[1]]);});
 function sync(){
  if(disposed)return;
  if(['视频生成','DAELAB · 视频生成'].includes(node.title))node.title='生成节点';
  const before=lastStored,previousError=inputError,previousSource=sourceKey;
  if(data.value&&data.value!==lastStored){try{const next=JSON.parse(data.value);generation.invalidate();binding?.dispose();binding=null;delete prompt.dataset.inlineEditing;state=next;lastStored=data.value;promptStamp='';resultsStamp='';}catch(error){notify(error.message);return;}}
  syncSource();syncRowHighlight();if(lastMode!==node.mode){lastMode=node.mode;generation.close();materials.dataset.selected=String(!node.mode);materials.dispatchEvent(new Event('dae-cell-selection-change'));for(const video of root.querySelectorAll('video'))video.pause();}
  if(before!==lastStored||previousError!==inputError||previousSource!==sourceKey||root.dataset.mode!==String(node.mode)){root.dataset.mode=String(node.mode);schedule();}
 }
 window.addEventListener('dae-canvas-layout',syncRowHighlight);
 persist();generation.refresh();sync();
 return {root,status,run,creativeButtons:[],creativeFields:[],tasks:generation.tasks,sync,close:()=>{side.hide();generation.close();materials.dataset.selected='false';materials.dispatchEvent(new Event('dae-cell-selection-change'));materials.dataset.selected=String(!node.mode);materials.dispatchEvent(new Event('dae-cell-selection-change'));},assets:()=>videoTaskAssets(state),
  materialTargets:()=>current()&&!activeVideoTask(current())&&!generation.submitting?[{element:body,key:state.currentId,label:'将素材加入当前任务',dropElements:[prompt],project:false}]:[],
  acceptMaterials,
  acceptResult(message){if(message.daelab_video_task_result)return;notify('原生任务已完成；新任务请使用节点内运行按钮');},
  dispose(){disposed=true;window.removeEventListener('dae-canvas-layout',syncRowHighlight);clearRowHighlight();uploadController?.abort();if(frame!==null)cancelAnimationFrame(frame);binding?.dispose();promptUI.destroy();generation.destroy();side.destroy();for(const dialog of dialogs)dialog.close();clearMaterialPreviews();releaseThumbnails(root);thumbnails.disconnect();root.remove();}
 };
}
