import {modelCapabilities} from './table_generation_api.mjs?v=20261002-table-module-responsibilities';
import {attachGenerationTasks,generationTaskStyle} from './table_generation_tasks.mjs?v=20261009-instructions-v5';
import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261009-instructions-v5';
import {connectionPanel} from './libtv_connection.mjs';
import {GENERATION_MODELS,LOCAL_VIDEO_MODEL,isGeneration,rowGenerationConfig,setRowGenerationConfig,promptColumns,createGenerationPrompt,enableColumnPrompt,generationRows,generationFrameRoles,generationFrames,generationFrameTagKey,syncGenerationFrameTags,syncGenerationPromptMode,syncGenerationPromptSource,generationConfigField,syncGenerationConfigOwners} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
import {effectivePrompt,toColumnPrompt} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';
import {columnReferenceOptions,createReferenceMenu,materialReferenceLabel} from './table_reference_menu.mjs?v=20261001-table-perf';
import {PROMPT_SETTINGS_TEMPLATE,createPromptSettingsBar,promptSettingsStyle,generationModeLabels,generationModeChoice,generationSettingSpecs,generationModes,promptSettingSpecs,generationSettingWarning,createGenerationSetting,createSettingsPopover} from './table_prompt_settings.mjs?v=20261009-instructions-v5';
const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
export function attachGenerationColumns({editor,getTable,notify,editPromptTemplate}){
 let alive=true;
 const configPanels=new Map();
 const frameStamps=new WeakMap();
 const settingBars=new WeakMap();
 const style=el('style',document.head);style.textContent=`
.dae-ui [data-generation-source]{display:none}
[data-canvas-panel=true] .dae-ui [data-generation-source]{display:grid}
.dae-ui .generation-header-row{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0}
.dae-ui .generation-header-row>.field-title{flex:1;min-width:24px;padding-right:0!important}
.dae-ui .generation-actions{display:flex;gap:4px;align-items:center;margin-top:0;flex:0 1 auto;min-width:0;max-width:100%;flex-wrap:nowrap;white-space:nowrap}
.dae-ui .generation-actions button{flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dae-ui .generation-actions button{min-height:32px;max-width:100%;font:inherit;padding:4px 8px!important}
.dae-ui .generation-actions .generation-settings{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;max-height:36px!important;padding:8px!important;border:0!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important}
.dae-ui .generation-actions .generation-settings:is(:hover,:focus-visible){background:var(--dae-surface-high,#383838)!important}
.dae-ui .generation-actions .generation-settings .dae-table-icon{width:20px;height:20px;flex:none}
.dae-ui :is(td,th)[data-prompt-source-preview=true]{outline:2px solid var(--dae-focus,#b8c4ff);outline-offset:-2px;background:var(--table-selected-content,var(--dae-secondary-container,#3c4054))!important;box-shadow:inset 0 0 0 1px var(--dae-focus,#b8c4ff)!important}
.dae-ui th[data-prompt-source-preview=true]{background:var(--table-selected-header,var(--dae-secondary-container,#3c4054))!important;color:var(--dae-on-primary-container)!important}
${generationTaskStyle}.dae-ui .generation-form{display:flex;flex-direction:column;gap:14px}
.dae-ui .generation-form>[hidden]{display:none!important}
.dae-ui .generation-form label{display:flex;flex-direction:column;gap:6px;min-width:0}
.dae-ui .generation-form :is(input,select){box-sizing:border-box;width:100%;min-width:0;min-height:36px;font:inherit;color:var(--dae-text);background:var(--dae-surface);border:1px solid var(--dae-border-control);border-radius:6px;padding:6px}
.dae-ui .generation-form [role=status]{white-space:pre-wrap;overflow-wrap:anywhere}
.dae-ui .dae-prompt-ref[data-frame-role=first]{background:#544323;color:#ffe0a1}
.dae-ui .dae-prompt-ref[data-frame-role=last]{background:#49395f;color:#e5caff}
.dae-ui .dae-prompt-ref[data-frame-role][data-invalid=true]{background:#542e36;color:#ffd1d1}
.dae-ui .generation-prompt-hint{margin:0;font-size:12px;color:var(--dae-text-muted)}
`+promptSettingsStyle;
 const findField=id=>getTable().fields.find(f=>f.id===id);
 let frameMenu=null,frameAnchor=null,settingsMenu=null,promptSourceMenu=null,promptSourceTimer=null;
 let promptSourceCells=[];
 const frameConfig=(fieldId,row,promptFieldId)=>{const owner=generationConfigField(getTable(),fieldId,promptFieldId);const defaults=configPanels.get(owner?.id)?.draft||owner?.generation;return rowGenerationConfig(row,owner?.id,promptFieldId?{...defaults,promptFieldId}:defaults);};
 const tasks=attachGenerationTasks({editor,getTable,notify,getConfig:frameConfig,async prepareGeneration(fieldId,recordId){
   const owner=generationConfigField(getTable(),fieldId),panel=configPanels.get(owner.id),targets=recordId?getTable().records.filter(r=>r.id===recordId):generationRows(getTable(),fieldId);
   if(panel&&(panel.draft.promptFieldId!==owner.generation.promptFieldId||targets.some(row=>rowGenerationConfig(row,owner.id,panel.draft)===panel.draft)))await panel.apply();
 }});
 function previewPromptSource(fieldId){
  for(const cell of promptSourceCells)delete cell.dataset.promptSourcePreview;
  promptSourceCells=fieldId?[...editor.root.querySelectorAll(`th[data-column="${CSS.escape(fieldId)}"],td[data-field="${CSS.escape(fieldId)}"]`)]:[];
  for(const cell of promptSourceCells)cell.dataset.promptSourcePreview='true';
 }
 function closePromptSources(){promptSourceMenu?.close();}
 function leavePromptSources(){clearTimeout(promptSourceTimer);promptSourceTimer=setTimeout(closePromptSources,180);}
 function choosePromptSource(fieldId,anchor){
  clearTimeout(promptSourceTimer);
  if(promptSourceMenu?.anchor===anchor)return;
  closePromptSources();closeSettings();closeFrames();
  const field=findField(fieldId);if(!field)return;
  const menu=createSettingsPopover(anchor,'提示词来源',()=>{clearTimeout(promptSourceTimer);previewPromptSource(null);if(promptSourceMenu===menu)promptSourceMenu=null;});promptSourceMenu=menu;
  menu.root.onpointerenter=()=>clearTimeout(promptSourceTimer);menu.root.onpointerleave=leavePromptSources;
  menu.root.onfocusin=()=>clearTimeout(promptSourceTimer);
  const source=frameConfig(fieldId).promptFieldId,columns=promptColumns(getTable());
  for(const column of columns){
   const option=button(column.name,()=>{
    try{
     if(!promptColumns(getTable()).some(item=>item.id===column.id))throw new Error('该列已不能作为提示词来源，请重新选择');
     closePromptSources();
     editor.change(t=>{t.fields.find(item=>item.id===fieldId).generation.promptFieldId=column.id;},{render:false});
     configPanels.get(fieldId)?.setPromptSource(column.id);
     syncFrameTags();refreshFrameTokens();refreshSettingBars();
    }catch(error){notify(error.message);}
   });
   option.setAttribute('aria-pressed',String(column.id===source));
   option.onpointerenter=()=>previewPromptSource(column.id);option.onfocus=()=>previewPromptSource(column.id);menu.root.append(option);
  }
  if(!columns.length)el('p',menu.root,'请先添加提示词列');
  previewPromptSource(source);
 }
 function refreshDefaultHeaders(sources){
  for(const header of editor.root.querySelectorAll('th[data-column]')){
   const entry=sources.get(header.dataset.column);let row=header.querySelector('[data-generation-prompt-header]');
   if(!entry){if(row){const title=row.querySelector('.field-title');if(title)header.insertBefore(title,row);row.remove();}continue;}
   if(!row){row=el('div',header);row.className='generation-header-row';row.dataset.generationPromptHeader='true';const title=header.querySelector('.field-title');if(title)row.append(title);const actions=el('div',row);actions.className='generation-actions';actions.onpointerdown=e=>e.stopPropagation();actions.ondragstart=e=>e.preventDefault();}
   const {field}=entry,actions=row.querySelector('.generation-actions');let control=actions.firstElementChild;
   if(control?.dataset.generationDefaults!==field.id){actions.replaceChildren();control=tableIcon(button('列默认配置',()=>open(field.id)),'settings-3-line','列默认配置');control.classList.add('generation-settings');control.dataset.generationDefaults=field.id;actions.append(control);}
   const title=field.name+' · 列默认配置';control.title=title;control.setAttribute('aria-label',title);
  }
 }
 function refreshSettingBars(){
  const table=getTable(),sources=new Map(),rows=new Map(table.records.map(row=>[row.id,row]));
  for(const target of table.fields.filter(isGeneration)){const field=generationConfigField(table,target.id),config=frameConfig(field.id);if(!sources.has(config.promptFieldId))sources.set(config.promptFieldId,{field,config});}
  refreshDefaultHeaders(sources);
  for(const cell of editor.root.querySelectorAll('td[data-field]')){
   const entry=sources.get(cell.dataset.field),row=rows.get(cell.dataset.record);let state=settingBars.get(cell);
   if(!entry){if(state){state.root.remove();settingBars.delete(cell);delete cell.dataset.generationSettings;cell.style.removeProperty('--generation-settings-height');}continue;}
   const {field,config}=entry;
   if(state?.fieldId!==field.id){state?.root.remove();const root=el('div',cell),bar=createPromptSettingsBar((key,anchor)=>void chooseSetting(field.id,cell.dataset.record,key,anchor));root.className='generation-prompt-settings-list';root.append(bar.root);state={root,bar,fieldId:field.id};settingBars.set(cell,state);cell.dataset.generationSettings='true';}
   state.bar.update(rowGenerationConfig(row,field.id,config),field.name);
   cell.style.setProperty('--generation-settings-height','38px');
  }
 }
 function closeSettings(){settingsMenu?.close();}
 async function chooseSetting(fieldId,recordId,key,anchor){
  if(settingsMenu?.anchor===anchor){closeSettings();return;}closeSettings();closeFrames();closePromptSources();
  const spec=PROMPT_SETTINGS_TEMPLATE.find(item=>item.key===key),field=findField(fieldId),row=()=>getTable().records.find(r=>r.id===recordId);if(!field||!row())return;
  const currentConfig=()=>frameConfig(fieldId,row());
  const menu=createSettingsPopover(anchor,key==='duration'?'选择视频时长':spec.label,()=>{if(settingsMenu===menu)settingsMenu=null;});settingsMenu=menu;
  const content=el('div',menu.root),status=el('p',menu.root);if(key==='size'||key==='duration')content.className='generation-settings-fields';status.setAttribute('role','status');
  const draft=structuredClone(currentConfig());let baseline=JSON.stringify(currentConfig()),schema=null,schemaError='',busy=false;
  const active=()=>alive&&settingsMenu===menu&&Boolean(findField(fieldId)&&row());
  const current=()=>{if(JSON.stringify(currentConfig())!==baseline)throw new Error('配置已变化，请重新打开选择面板');};
  const resetButton=tableIcon(button('恢复列默认配置',()=>{
   if(busy||!active())return;
   try{current();editor.change(t=>{const settings=t.records.find(r=>r.id===recordId).meta.generationSettings[draft.promptFieldId];delete settings[fieldId];},{render:false});menu.close();syncFrameTags();refreshFrameTokens();refreshSettingBars();}
   catch(error){if(active())status.textContent=error.message;}
  }),'restart-line','恢复列默认配置');resetButton.classList.add('generation-settings-reset');
  if(row().meta?.generationSettings?.[draft.promptFieldId]?.[fieldId])menu.root.querySelector('strong').after(resetButton);
  async function commit(update,reset=false){
   if(busy)return;busy=true;menu.root.setAttribute('aria-busy','true');content.querySelectorAll('button,input,select').forEach(input=>input.disabled=true);
   try{
    current();const next=structuredClone(draft);update(next);
    if(reset){
     status.textContent='正在读取模型选项…';
     if(!schema||next.kind!==draft.kind||next.model!==draft.model){try{const caps=await modelCapabilities(next);schema=caps.schema;schemaError='';}catch(error){schema={};schemaError=error.message;}if(!active())return;}
     if(!next.mode)next.mode=Object.keys(schema.properties?.modeType?.items||{})[0]||(next.kind==='video'?'text2video':'');
     for(const setting of generationSettingSpecs(schema,next.mode))if(next.settings[setting.name]===undefined&&setting.default!==undefined)next.settings[setting.name]=structuredClone(setting.default);
    }
    if(!active())return;current();
    editor.change(t=>setRowGenerationConfig(t.records.find(r=>r.id===recordId),fieldId,next),{render:false});
    if(!resetButton.isConnected)menu.root.querySelector('strong').after(resetButton);
    baseline=JSON.stringify(currentConfig());Object.assign(draft,structuredClone(next));syncFrameTags();refreshFrameTokens();refreshSettingBars();
    const warning=schemaError?'已保存，但未能确认模型兼容性：'+schemaError:generationSettingWarning(next,schema||{});
    if(key==='size'||key==='duration')status.textContent=warning;else menu.close();
    if(warning)notify(warning);
   }catch(error){if(active())status.textContent=error.message;}
   finally{busy=false;if(active()){menu.root.removeAttribute('aria-busy');content.querySelectorAll('button,input,select').forEach(input=>input.disabled=false);}}
  }
  function choices(items,value,select){
   for(const [id,label] of items){const control=button(label,()=>{if(id===value){menu.close();return;}void commit(next=>select(next,id),true);});control.setAttribute('aria-pressed',String(id===(key==='mode'?generationModeChoice(value):value)));content.append(control);}
   (content.querySelector('[aria-pressed=true]')||content.querySelector('button'))?.focus({preventScroll:true});
  }
  if(key==='kind')choices([['video','视频生成'],['image','图片生成']],draft.kind,(next,id)=>{next.kind=id;next.model=GENERATION_MODELS[id][0];next.mode='';next.settings={};});
  else if(key==='model')choices(GENERATION_MODELS[draft.kind].map(name=>[name,name]),draft.model,(next,id)=>{next.model=id;if(next.kind==='video'&&typeof next.settings.duration==='number')next.settings.duration=Math.min(next.settings.duration,id===LOCAL_VIDEO_MODEL?15:30);});
  else {
   status.textContent='正在读取模型选项…';
   try{const caps=await modelCapabilities(draft);schema=caps.schema;}catch(error){schema={};schemaError=error.message;}
   if(!active())return;
   try{
    current();status.textContent=schemaError?'未能确认模型兼容性，仍可选择：'+schemaError:'';
    if(key==='mode')choices(generationModes(schema,draft.kind).map(id=>[id,generationModeLabels[id]||id||'默认']),draft.mode,(next,id)=>{next.mode=id;});
    else {
     const specs=promptSettingSpecs(schema,draft.mode,key,draft.settings);
     if(!specs.length&&!schemaError)status.textContent='当前模型不使用此项参数';
     for(const item of specs){const edit=structuredClone(draft);content.append(createGenerationSetting(item,edit,()=>void commit(next=>{if(edit.settings[item.name]===undefined)delete next.settings[item.name];else next.settings[item.name]=edit.settings[item.name];}),true));}
     content.querySelector('input,select')?.focus({preventScroll:true});
    }
   }catch(error){if(active())status.textContent=error.message;}
  }
 }
 function closeFrames(){frameAnchor?.removeAttribute('aria-controls');frameMenu?.root.remove();frameMenu=null;frameAnchor=null;document.removeEventListener('pointerdown',outsideFrames,true);document.removeEventListener('keydown',frameKeys,true);document.removeEventListener('scroll',placeFrames,true);window.removeEventListener('resize',placeFrames);}
 const outsideFrames=e=>{if(frameMenu&&!frameMenu.root.contains(e.target)&&!frameAnchor?.contains(e.target))closeFrames();};
 const frameKeys=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const anchor=frameAnchor;closeFrames();anchor?.focus({preventScroll:true});}else if(frameMenu?.keydown(e.key)){e.preventDefault();e.stopPropagation();}else if(['Backspace','Delete'].includes(e.key))closeFrames();};
 function placeFrames(){if(!frameMenu)return;if(!frameAnchor?.isConnected){closeFrames();return;}const r=frameAnchor.getBoundingClientRect(),menu=frameMenu.root;menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+8,innerHeight-menu.offsetHeight-8))+'px';frameMenu.layout();}
 function changeFrames(fieldId,recordId,update,role=null,promptFieldId=null){
  const table=getTable(),current=table.records.find(r=>r.id===recordId),config=frameConfig(fieldId,current,promptFieldId);if(!current||!config)return;
  const initial=Object.fromEntries(readFrames(table,current,fieldId,config).filter(item=>item.asset).map(item=>[item.role,{assetId:item.asset.id,fieldId:item.asset.fieldId}]));let inserted=false;
  editor.change(t=>{const row=t.records.find(r=>r.id===recordId);row.meta||={};row.meta.generationFrames||={};const frames=row.meta.generationFrames[fieldId]||initial;update(frames);row.meta.generationFrames[fieldId]=frames;
   if(role&&!effectivePrompt(t,row,config.promptFieldId)?.segments?.some(s=>s.type==='frame'&&s.generationFieldId===fieldId&&s.role===role)){const doc=toColumnPrompt(effectivePrompt(t,row,config.promptFieldId),row);doc.segments.unshift({type:'frame',generationFieldId:fieldId,role});row.values[config.promptFieldId]=doc;inserted=true;}
  },{render:false});
  if(inserted)editor.refreshCells(recordId,config.promptFieldId);else refreshFrameTokens();

 }
 function chooseFrame(fieldId,recordId,role,anchor){
  closeSettings();closeFrames();const promptFieldId=anchor.closest('[data-field]')?.dataset.field,table=getTable(),row=table.records.find(r=>r.id===recordId),config=frameConfig(fieldId,row,promptFieldId);if(!row||!config)return;
  const image=option=>option.asset.kind!=='video'&&option.asset.kind!=='audio';
  const options=columnReferenceOptions(table,row).filter(f=>f.id!==fieldId).flatMap(f=>{if(f.asset)return image(f)?[f]:[];const children=f.children.filter(image);return children.length===1?[children[0]]:children.length?[{...f,children}]:[];});
  if(!options.length){notify('本行没有可引用的图片');return;}
  const key=generationFrameTagKey(config);frameAnchor=anchor;
  frameMenu=createReferenceMenu({options,onLayout:placeFrames,onChoose:option=>{
   closeFrames();const currentConfig=frameConfig(fieldId,getTable().records.find(r=>r.id===recordId),promptFieldId);if(!currentConfig||generationFrameTagKey(currentConfig)!==key)return;
   changeFrames(fieldId,recordId,frames=>frames[role]={assetId:option.asset.id,fieldId:option.id},role,promptFieldId);
   if(anchor.isConnected&&anchor.dataset.frameRole){const current=getTable().records.find(r=>r.id===recordId);if(current)updateFrameToken(anchor,current);}
  }});
  document.body.append(frameMenu.root);anchor.setAttribute('aria-controls',frameMenu.root.id);placeFrames();
  document.addEventListener('pointerdown',outsideFrames,true);document.addEventListener('keydown',frameKeys,true);document.addEventListener('scroll',placeFrames,{capture:true,passive:true});window.addEventListener('resize',placeFrames);
 }
 function readFrames(table,row,fieldId,config){
  const roles=generationFrameRoles(config);
  try{return row?generationFrames(table,row,fieldId,config):roles.map(role=>({role}));}catch{return roles.map(role=>({role}));}
 }
 function frameLabel(row,item){return item.error?'引用失效':item.asset?'@'+materialReferenceLabel(item.asset,row.values[item.asset.fieldId].findIndex(a=>a.id===item.asset.id)):'@ 选择图片';}
 function updateFrameToken(token,row){
  const fieldId=token.dataset.generationFieldId,source=token.closest('[data-field]')?.dataset.field,current=frameConfig(fieldId,row,source),config=current&&{...current};
  if(config&&source&&source!==frameConfig(fieldId,row)?.promptFieldId){const roles=(effectivePrompt(getTable(),row,source)?.segments||[]).filter(s=>s.type==='frame'&&s.generationFieldId===fieldId).map(s=>s.role);config.kind='video';config.mode=roles.includes('last')?'frames2video':'singleImage2video';}
  const item=config?readFrames(getTable(),row,fieldId,config).find(f=>f.role===token.dataset.frameRole):null;
  const name=token.dataset.frameRole==='first'?'首帧':'尾帧',label=name+'：'+frameLabel(row,item||{error:'生成方式已变化'});
  const stamp=JSON.stringify([label,item?.asset?.url,item?.error]);if(frameStamps.get(token)===stamp)return;frameStamps.set(token,stamp);
  token.textContent=label;token.title=item?.error||label;token.dataset.invalid=String(!item||Boolean(item.error));
  if(item?.asset){const img=el('img');img.className='dae-ref-thumb';img.src=item.asset.url;img.alt='';img.draggable=false;token.prepend(img);}
 }
 function renderFrame(segment,row){
  const token=el('span');token.className='dae-prompt-ref';token.contentEditable='false';token.tabIndex=0;token.dataset.frameRole=segment.role;token.dataset.generationFieldId=segment.generationFieldId;
  updateFrameToken(token,row);
  token.setAttribute('aria-haspopup','menu');
  token.onpointerdown=e=>{if(e.button===0){e.preventDefault();e.stopPropagation();}};
  token.onclick=e=>{e.preventDefault();e.stopPropagation();chooseFrame(segment.generationFieldId,row.id,segment.role,token);};
  token.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();chooseFrame(segment.generationFieldId,row.id,segment.role,token);}};
  return token;
 }
 function syncFrameTags(){
  const table=getTable(),pending=[],sources=new Set(promptColumns(table).map(f=>f.id));
  for(const field of new Set(table.fields.filter(isGeneration).map(f=>generationConfigField(table,f.id))))for(const row of table.records){
   const config=frameConfig(field.id,row),roles=generationFrameRoles(config),previous=row.meta?.generationFrameTags?.[field.id];
   if((!roles.length||sources.has(config.promptFieldId))&&(previous||roles.length)&&previous!==generationFrameTagKey(config))pending.push({fieldId:field.id,recordId:row.id,config});
  }
  if(!pending.length)return;
  const types=new Map(table.fields.map(f=>[f.id,f.type])),changed=new Map();
  editor.change(t=>{for(const {fieldId,recordId,config} of pending)for(const id of syncGenerationFrameTags(t,fieldId,config,recordId)){if(!changed.has(id))changed.set(id,new Set());changed.get(id).add(recordId);}},{render:false});
  for(const [id,rows] of changed){if(types.get(id)!==findField(id)?.type)editor.refreshCells(null,id);else for(const recordId of rows)editor.refreshCells(recordId,id);}
 }
 function refreshFrameTokens(){
  const rows=new Map(getTable().records.map(row=>[row.id,row]));
  for(const token of editor.root.querySelectorAll('.dae-prompt-ref[data-frame-role]')){const row=rows.get(token.closest('[data-record]')?.dataset.record);if(row)updateFrameToken(token,row);}
 }
 function open(fieldId){
  fieldId=generationConfigField(getTable(),fieldId)?.id||fieldId;
  closeSettings();closePromptSources();
  const field=findField(fieldId);if(!field)return;
  editor.openTextSide('generation',fieldId,field.name+' · 列默认配置',body=>{
   body.classList.add('generation-form');el('p',body,'这里设置列默认值；提示词单元格底栏可独立修改，已单独配置的格子不受默认值修改影响。').className='generation-prompt-hint';let schema=null,sequence=0;
   const draft=structuredClone(field.generation);let original=JSON.stringify(field.generation),pendingCapabilities=null;
   const label=(name,tag='select')=>{const wrapper=el('label',body,name),input=el(tag,wrapper);input.setAttribute('aria-label',name);return input;};
   const kind=label('生成类型');for(const [v,n] of [['image','图片'],['video','视频']])kind.add(new Option(n,v));kind.value=draft.kind;
   const model=label('模型'),prompt=label('提示词列');
   function fillPrompts(){prompt.replaceChildren(new Option('请选择提示词列',''));for(const f of promptColumns(getTable()))prompt.add(new Option(f.name,f.id));prompt.value=draft.promptFieldId;}
   fillPrompts();
   function refreshDefaults(){syncFrameTags();refreshFrameTokens();refreshSettingBars();}
   prompt.onchange=()=>{const source=prompt.value;editor.change(t=>{t.fields.find(f=>f.id===fieldId).generation={...structuredClone(draft),promptFieldId:source};},{render:false});body.close();open(fieldId);};
   body.append(button('新建空白提示词列',()=>{editor.change(t=>{draft.promptFieldId=createGenerationPrompt(t,fieldId).id;});fillPrompts();refreshDefaults();}));
   const mode=label('生成方式'),settings=el('section',body),status=el('p',body);status.setAttribute('role','status');
   const project=label('LibTV 目标画布 ID','input');project.value=getTable().meta.generationProject||'';
   const connection=el('section',body);connectionPanel(connection,{get:()=>project.value,set:(key,value)=>project.value=value,capabilities:async()=>{}});
   function fillModels(){model.replaceChildren();if(draft.model==='Image-2')draft.model='Lib Image';if(!GENERATION_MODELS[kind.value].includes(draft.model)){const placeholder=new Option('请选择具体模型版本','');placeholder.disabled=true;model.add(placeholder);}for(const name of GENERATION_MODELS[kind.value])model.add(new Option(name,name));model.value=GENERATION_MODELS[kind.value].includes(draft.model)?draft.model:'';}
   function drawSettings(){
    settings.replaceChildren();if(!schema)return;
    for(const spec of generationSettingSpecs(schema,draft.mode))settings.append(createGenerationSetting(spec,draft,refreshSettingBars));
   }

   async function capabilities(){
    refreshDefaults();
    const local=draft.model===LOCAL_VIDEO_MODEL;project.parentElement.hidden=local;connection.hidden=local;
    const token=++sequence;schema=null;settings.replaceChildren();mode.replaceChildren();status.textContent='正在读取模型选项…';
    try{const caps=await modelCapabilities(draft);if(!alive||!body.isConnected||token!==sequence)return;
     schema=caps.schema;let modes=Object.keys(schema.properties?.modeType?.items||{});if(draft.kind==='video'&&!modes.includes('text2video'))modes.unshift('text2video');if(!modes.length)modes=[''];

     for(const m of new Set(modes.map(generationModeChoice)))mode.add(new Option(generationModeLabels[m]||m||'默认',m));if(!modes.includes(draft.mode))draft.mode=modes[0];mode.value=generationModeChoice(draft.mode);drawSettings();refreshDefaults();status.textContent=local?'使用本机 FL 模型生成带声音的视频，按行排队。在表格中点击首尾帧标签选择同行图片；不支持视频参考。默认 768×448、约 2 秒，可调整。':'参考素材请在表格提示词中通过 @ 或首尾帧标签选择。';
    }catch(error){if(token===sequence&&body.isConnected)status.textContent=error.message;}
   }
   const loadCapabilities=()=>pendingCapabilities=capabilities();
   kind.onchange=()=>{draft.kind=kind.value;draft.model=GENERATION_MODELS[draft.kind][0];draft.settings={};draft.mode='';fillModels();void loadCapabilities();};
   model.onchange=()=>{draft.model=model.value;draft.settings={};draft.mode='';void loadCapabilities();};
   mode.onchange=()=>{draft.mode=mode.value;draft.settings={};drawSettings();refreshDefaults();};
   async function applyConfig(){
     while(pendingCapabilities){const pending=pendingCapabilities;await pending;if(pending===pendingCapabilities)break;}
     if(!alive||!body.isConnected)throw new Error('配置面板已关闭，请重新打开');
     const current=findField(fieldId);if(!current)throw new Error('生成列已删除');
     // Only creating a prompt through this panel may have changed its binding.
     const comparison={...current.generation,promptFieldId:JSON.parse(original).promptFieldId};
     if(JSON.stringify(comparison)!==original)throw new Error('列配置已在其他位置变化，请重新打开');
     if(!model.value)throw new Error('请选择具体模型版本');
     if(!schema)throw new Error(status.textContent||'请重新读取模型选项');
     if(!promptColumns(getTable()).some(f=>f.id===draft.promptFieldId))throw new Error('请选择提示词列作为来源');
     const inputs=[...settings.querySelectorAll('input,select')];
     if(inputs.some(i=>!i.reportValidity()))throw new Error('请检查生成参数');
     for(const input of inputs)input.onchange();
     const config=JSON.stringify(draft),projectId=project.value.trim();
     if(JSON.stringify(current.generation)!==config||(getTable().meta.generationProject||'')!==projectId){
      editor.change(t=>{t.fields.find(f=>f.id===fieldId).generation=structuredClone(draft);t.meta.generationProject=projectId;},{render:false});
     }
     original=config;
   }
   configPanels.set(fieldId,{draft,apply:applyConfig,setPromptSource(sourceId){if(generationConfigField(getTable(),fieldId)?.id!==fieldId){body.close();open(fieldId);return;}draft.promptFieldId=sourceId;fillPrompts();refreshDefaults();}});
   body.append(button('重新读取模型选项',loadCapabilities),button('保存配置',async()=>{
    try{await applyConfig();body.close();
    }catch(error){status.textContent=error.message;}
   },true),button('编辑提示词模板',()=>{if(draft.promptFieldId){editor.change(t=>enableColumnPrompt(t,draft.promptFieldId));editPromptTemplate(draft.promptFieldId);}}));
   fillModels();void loadCapabilities();
   body.addEventListener('dae-text-side-show',refreshDefaults);body.onCleanup(()=>configPanels.delete(fieldId));refreshDefaults();
  });
 }
 function decorate(){
  if(promptSourceMenu&&!promptSourceMenu.anchor.isConnected)closePromptSources();
  if(settingsMenu&&!settingsMenu.anchor.isConnected)closeSettings();
  if(!alive)return;
  if(frameAnchor&&!frameAnchor.isConnected)closeFrames();

  const fields=getTable().fields.filter(isGeneration);syncFrameTags();refreshFrameTokens();refreshSettingBars();
  const headers=new Map([...editor.root.querySelectorAll('th[data-column]')].map(h=>[h.dataset.column,h]));
  for(const field of fields){
   const header=headers.get(field.id);
   if(header&&!header.querySelector('.generation-actions')){
    const row=el('div',header);row.className='generation-header-row';
    const title=header.querySelector('.field-title');if(title)row.append(title);
    const actions=el('div',row);actions.className='generation-actions';
    const run=button('生成 '+generationRows(getTable(),field.id).length+' 行',()=>findField(frameConfig(field.id)?.promptFieldId)?tasks.generate(field.id):open(field.id),true);run.dataset.generationRun=field.id;run.disabled=tasks.submitting;
    const source=tableIcon(button('选择提示词列',()=>choosePromptSource(field.id,source)),'edit-line','选择提示词列');source.classList.add('generation-settings');source.setAttribute('aria-haspopup','dialog');
    source.onpointerenter=()=>choosePromptSource(field.id,source);source.onpointerleave=leavePromptSources;
    actions.append(source,run);
    const output=document.createElement('button');output.type='button';output.className='dae-material-slot';output.dataset.generationSource=field.id;output.setAttribute('aria-label','输出为素材组');output.title='拖到画布空白处输出素材组';actions.append(output);
    actions.onpointerdown=e=>e.stopPropagation();actions.ondragstart=e=>e.preventDefault();
   }
  }
  tasks.decorate(headers);
 }
 const observer=new MutationObserver(decorate);observer.observe(editor.root,{childList:true,subtree:true});
 const promptInput=refreshSettingBars;editor.root.addEventListener('input',promptInput);
 decorate();
 return {tasks:tasks.tasks,open,renderFrame,syncPromptChanges(table,before){
  for(const field of table.fields.filter(isGeneration)){
   syncGenerationPromptSource(table,before,field.generation);const panel=configPanels.get(field.id);
   const draftChanged=panel&&syncGenerationPromptSource(table,before,panel.draft);
   if(draftChanged)queueMicrotask(()=>{if(configPanels.get(field.id)===panel)panel.setPromptSource(panel.draft.promptFieldId);});
  }
  syncGenerationConfigOwners(table,before);
  for(const field of new Set(table.fields.filter(isGeneration).map(f=>generationConfigField(table,f.id))))syncGenerationPromptMode(table,before,field.id,configPanels.get(field.id)?.draft||field.generation);
 },invalidate(){tasks.invalidate();closeFrames();closeSettings();closePromptSources();},destroy(){alive=false;tasks.destroy();closeFrames();closeSettings();closePromptSources();clearTimeout(promptSourceTimer);configPanels.clear();observer.disconnect();editor.root.removeEventListener('input',promptInput);style.remove();}};
}
