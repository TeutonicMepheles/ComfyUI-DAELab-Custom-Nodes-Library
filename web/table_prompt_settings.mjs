import {LOCAL_VIDEO_MODEL} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
import {createTableButton} from './table_controls.mjs?v=20261009-progress-r3';

// The order and setting keys are the contract documented in docs/prompt-settings-template.md.
export const PROMPT_SETTINGS_TEMPLATE=Object.freeze([
 {key:'kind',label:'生成类型',icon:'video-line'},
 {key:'model',label:'模型',icon:'box-3-line'},
 {key:'mode',label:'参考模式',icon:'film-line'},
 {key:'size',label:'比例／分辨率',icon:'aspect-ratio-line',settings:['ratio','resolution','width','height']},
 {key:'duration',label:'时间',icon:'time-line',settings:['duration']},
]);
export const generationModeLabels={text2video:'文生视频',singleImage2video:'首尾帧',frames2video:'首尾帧',image2video:'多图参考',mixed2video:'混合参考',text2image:'文生图',image2image:'参考图'};
function sizeLabel(settings){
 const width=Number(settings.width),height=Number(settings.height),dimensions=width>0&&height>0;
 let ratio=settings.ratio;
 if(!ratio&&dimensions&&Number.isInteger(width)&&Number.isInteger(height)){let a=width,b=height;while(b){[a,b]=[b,a%b];}ratio=`${width/a}:${height/a}`;}
 return [ratio,settings.resolution||(dimensions?`${width}×${height}`:'')].filter(Boolean).join(' · ')||'比例／分辨率';
}
export function promptSettingsItems(config){
 const settings=config.settings||{},video=config.kind==='video';
 const labels={kind:video?'视频生成':'图片生成',model:config.model||'选择模型',mode:generationModeLabels[config.mode]||config.mode||'选择方式',size:sizeLabel(settings),duration:settings.duration!=null&&settings.duration!==''?`${settings.duration}s`:'设置时长'};
 return PROMPT_SETTINGS_TEMPLATE.map(item=>({...item,icon:item.key==='kind'&&!video?'image-line':item.icon,text:labels[item.key],hidden:item.key==='duration'&&!video}));
}
export function createPromptSettingsBar(onActivate){
 const root=document.createElement('div');root.className='generation-prompt-settings';root.setAttribute('role','group');
 const controls=new Map();let signature='';
 for(const item of PROMPT_SETTINGS_TEMPLATE){
  const control=createTableButton(item.label,()=>onActivate(item.key,control)),icon=document.createElement('span'),label=document.createElement('span');
  control.className='generation-prompt-setting';control.dataset.setting=item.key;control.setAttribute('aria-haspopup','dialog');
  icon.className='dae-table-icon';icon.setAttribute('aria-hidden','true');label.className='generation-prompt-setting-label';control.replaceChildren(icon,label);root.append(control);controls.set(item.key,{control,icon,label});
 }
 for(const event of ['pointerdown','mousedown','dblclick','keydown'])root.addEventListener(event,e=>e.stopPropagation());
 return {root,update(config,name){
  const next=JSON.stringify([config,name]);if(next===signature)return;signature=next;root.setAttribute('aria-label',name+' · 生成设置（当前单元格）');
  for(const item of promptSettingsItems(config)){const {control,icon,label}=controls.get(item.key);const title=`${name} · ${item.label}：${item.text}（只修改当前单元格）`;
   label.textContent=item.text;control.hidden=item.hidden;control.title=title;control.setAttribute('aria-label',title);icon.style.setProperty('--table-icon',`url("${new URL('./vendor/remixicon/'+item.icon+'.svg',import.meta.url).href}")`);
  }
 }};
}
export const promptSettingsStyle=`
.dae-ui.generation-settings-popover{position:fixed;z-index:100100;display:flex;flex-direction:column;gap:10px;width:340px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--dae-border-control,#555);border-radius:16px;background:var(--dae-surface,#262626);color:var(--dae-text,#ededed);box-shadow:0 12px 36px #0006;font:400 13px/1.5 var(--dae-font-family,sans-serif);scrollbar-width:thin;scrollbar-color:var(--dae-border-control,#555) transparent}
.dae-ui.generation-settings-popover>strong{padding:0 40px 0 10px;font-size:12px!important;font-weight:400!important;line-height:1.5;color:var(--dae-text-muted,#b5b5b5)!important;opacity:.65}
.dae-ui.generation-settings-popover .generation-settings-fields{min-width:0;padding:0 10px}
.dae-ui.generation-settings-popover label{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.dae-ui.generation-settings-popover :is(input,select){box-sizing:border-box;width:100%;min-height:36px;padding:6px;border:1px solid var(--dae-border-control,#555);border-radius:6px;color:inherit;background:var(--dae-surface-low,#202020);font:inherit}
.dae-ui.generation-settings-popover button{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;text-align:left;padding:10px!important;border:0;border-radius:10px;background:transparent;color:inherit;font:400 13px/1.5 var(--dae-font-family,sans-serif)!important;cursor:pointer}
.dae-ui.generation-settings-popover button[aria-pressed]+button[aria-pressed]{margin-top:4px}
.dae-ui.generation-settings-popover button:hover:not([aria-pressed=true]){background:color-mix(in srgb,var(--dae-surface-high,#383838) 55%,var(--dae-surface,#262626))}
.dae-ui.generation-settings-popover button[aria-pressed=true]{background:var(--dae-surface-high,#383838)}
.dae-ui.generation-settings-popover button[aria-pressed=true]::after{content:"✓";margin-left:auto}
.dae-ui.generation-settings-popover :focus-visible{outline:2px solid var(--dae-focus,#b8c4ff);outline-offset:-2px}
.dae-ui.generation-settings-popover [role=status]{margin:0;color:var(--dae-text-muted,#bbb)}
.dae-ui.generation-settings-popover [role=status]:empty{display:none}
.dae-ui.generation-settings-popover button.generation-settings-reset{position:absolute;top:8px;right:14px;display:grid;place-items:center;width:30px;height:30px;min-height:30px;margin:0;padding:7px!important;border-radius:6px;color:var(--dae-text-muted,#b5b5b5)}
.dae-ui.generation-settings-popover .generation-settings-reset .dae-table-icon{display:block;width:16px;height:16px;background:currentColor;mask:var(--table-icon) center/contain no-repeat}

.dae-ui .generation-duration{min-width:0;margin:4px 0}
.dae-ui .generation-duration-caption{display:block;margin-bottom:10px;font-size:12px;color:var(--dae-text-muted,#b5b5b5);opacity:.65}
.dae-ui.generation-settings-popover .generation-duration-caption{display:none}
.dae-ui .generation-duration-row{display:grid;grid-template-columns:minmax(0,1fr) 80px;gap:20px;align-items:start}
.dae-ui .generation-duration-track{--duration-thumb-width:4px;min-width:0;padding-top:2px}
.dae-ui input.generation-duration-slider{appearance:none!important;-webkit-appearance:none!important;display:block;width:100%;height:24px!important;min-height:24px!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:transparent!important;cursor:pointer}
.dae-ui input.generation-duration-slider::-webkit-slider-runnable-track{height:12px;border:0;border-radius:4px;background:linear-gradient(to right,#626262 var(--duration-fill),#383838 var(--duration-fill))}
.dae-ui input.generation-duration-slider::-webkit-slider-thumb{-webkit-appearance:none;width:var(--duration-thumb-width);height:18px;margin-top:-3px;border:0;border-radius:2px;background:#f5f5f5;box-shadow:none}
.dae-ui input.generation-duration-slider::-moz-range-track{height:12px;border:0;border-radius:4px;background:linear-gradient(to right,#626262 var(--duration-fill),#383838 var(--duration-fill))}
.dae-ui input.generation-duration-slider::-moz-range-thumb{width:var(--duration-thumb-width);height:18px;border:0;border-radius:2px;background:#f5f5f5;box-shadow:none}
.dae-ui .generation-duration-ticks{pointer-events:none;position:relative;height:14px;margin:0 calc(var(--duration-thumb-width)/2);font:400 10px/1.4 var(--dae-font-family,sans-serif);color:var(--dae-text-muted,#aaa);opacity:.55}
.dae-ui .generation-duration-ticks span{position:absolute;top:0;transform:translateX(-50%)}
.dae-ui .generation-duration-ticks span:first-child{transform:none}
.dae-ui .generation-duration-ticks span:last-child{transform:translateX(-100%)}
.dae-ui .generation-duration-ticks span:not(:first-child):not(:last-child)::before{content:'';position:absolute;left:50%;transform:translateX(-50%);top:-12px;height:4px;width:1px;background:currentColor;pointer-events:none}
.dae-ui .generation-duration-value{position:relative}
.dae-ui .generation-duration-value input{box-sizing:border-box;width:100%;min-height:36px;height:36px;padding:6px 26px 6px 10px!important;border:0!important;border-radius:6px;background:var(--dae-surface-high,#383838)!important;color:var(--dae-text,#eee);font:400 13px var(--dae-font-family,sans-serif);font-variant-numeric:tabular-nums;appearance:textfield;-moz-appearance:textfield}
.dae-ui .generation-duration-value input::-webkit-inner-spin-button,.dae-ui .generation-duration-value input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.dae-ui .generation-duration-value>span{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--dae-text-muted,#aaa);opacity:.65;pointer-events:none}

.dae-ui .dae-table td[data-generation-settings]{position:relative;padding-bottom:calc(var(--generation-settings-height) + 14px)!important}
.dae-ui .dae-table td[data-generation-settings]>textarea{bottom:calc(var(--generation-settings-height) + 8px);height:calc(100% - var(--generation-settings-height) - 17px)!important}
.dae-ui .dae-table[data-view=cards] td[data-generation-settings]>textarea{height:calc(100% - var(--generation-settings-height) - 38px)!important}
.dae-ui .generation-prompt-settings-list{container:prompt-settings / inline-size;position:absolute;left:10px;right:10px;bottom:6px;display:flex;flex-direction:column;gap:2px;min-width:0;max-width:calc(100% - 20px)}
.dae-ui .generation-prompt-settings{display:flex;align-items:center;gap:4px;height:32px;min-width:0;overflow:hidden;white-space:nowrap}
.dae-ui .generation-prompt-settings button.generation-prompt-setting{display:inline-flex;align-items:center;justify-content:flex-start;gap:4px;flex:0 1 auto;width:max-content;min-width:24px;min-height:28px;height:28px;margin:0!important;padding:3px 4px!important;border:0!important;border-radius:4px!important;background:transparent!important;color:var(--dae-text-muted,#b5b5b5)!important;font:400 11px/1.5 var(--dae-font-family)!important;white-space:nowrap;cursor:pointer}
.dae-ui .generation-prompt-settings button.generation-prompt-setting[data-setting=model]{flex-shrink:2}
.dae-ui .generation-prompt-settings button.generation-prompt-setting:hover:not(:disabled){background:var(--dae-surface-high,#383838)!important}
.dae-ui .generation-prompt-settings button.generation-prompt-setting:focus-visible{outline:2px solid var(--dae-focus,#b8c4ff);outline-offset:-2px}
.dae-ui .generation-prompt-settings .dae-table-icon{display:block;flex:none;width:12px;height:12px;background:currentColor;mask:var(--table-icon) center/contain no-repeat}
.dae-ui .generation-prompt-setting-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dae-ui .generation-prompt-settings button:disabled{opacity:.45;cursor:default}
@container prompt-settings (max-width:135px){
 .dae-ui .generation-prompt-settings{gap:2px}
 .dae-ui .generation-prompt-settings button.generation-prompt-setting{min-width:12px;padding:3px 0!important;gap:0}
 .dae-ui .generation-prompt-setting-label{display:none}
}
`;

export function generationSettingSpecs(schema,mode){
 const props=schema.properties||{},config=schema.config||{};
 return ['settings','advancedSettings'].flatMap(bucket=>{const keys=config[bucket]||[];return (Array.isArray(keys)?keys:keys[mode]||[]).filter(key=>props[key]).map(key=>({...props[key],name:props[key].originalField||key}));});
}
export const generationModeChoice=mode=>mode==='singleImage2video'?'frames2video':mode;
export function generationModes(schema,kind){
 const modes=Object.keys(schema.properties?.modeType?.items||{}),common=kind==='video'?['text2video','singleImage2video','frames2video','image2video','mixed2video']:['text2image','image2image'];
 return [...new Set([...modes,...common,...(!modes.length&&kind==='image'?['']:[])].map(generationModeChoice))];
}
export function promptSettingSpecs(schema,mode,key,settings={}){
 const names=key==='duration'?['duration']:['ratio','resolution','width','height'],specs=generationSettingSpecs(schema,mode),properties=Object.entries(schema.properties||{}).map(([key,spec])=>({...spec,name:spec.originalField||key}));
 return names.flatMap(name=>{
  const spec=specs.find(item=>item.name===name)||properties.find(item=>item.name===name);
  if(spec)return [spec];
  if(!schema.properties&&Object.hasOwn(settings,name))return [{name,displayName:({ratio:'比例',resolution:'分辨率',width:'宽度',height:'高度',duration:'时长（秒）'})[name],type:typeof settings[name]==='number'?'number':'string'}];
  return [];
 });
}
export function generationSettingWarning(config,schema){
 const modes=Object.keys(schema.properties?.modeType?.items||{}),warnings=[];
 if(config.mode&&!modes.includes(config.mode))warnings.push('生成方式“'+(generationModeLabels[config.mode]||config.mode)+'”');
 const specs=generationSettingSpecs(schema,config.mode);
 for(const [key,value] of Object.entries(config.settings||{})){
  const spec=specs.find(item=>item.name===key),choices=spec?.enum?.map(item=>typeof item==='object'?item.value:item)||[];
  if(!spec||choices.length&&!choices.includes(value)||typeof value==='number'&&(value<(spec.min??-Infinity)||value>(spec.max??Infinity)||(spec.type==='integer'&&!Number.isInteger(value))))warnings.push(spec?.displayName||spec?.title||({ratio:'比例',resolution:'分辨率',duration:'时长',width:'宽度',height:'高度'})[key]||key);
 }
 return warnings.length?'已保存。当前模型未声明支持或参数超出建议范围：'+warnings.join('、')+'；生成可能失败，请按需切换模型或调整配置。':'';
}
export function createGenerationSetting(spec,config,onChange,unrestricted=false){
 if(spec.name==='duration'){
  const wrapper=document.createElement('div'),caption=document.createElement('span'),row=document.createElement('div'),track=document.createElement('div'),ticks=document.createElement('div'),input=document.createElement('input'),valueBox=document.createElement('div'),number=document.createElement('input'),unit=document.createElement('span');
  const values=(spec.enum||[]).map(item=>Number(typeof item==='object'?item.value:item)).filter(Number.isFinite);
  const maximum=config.model===LOCAL_VIDEO_MODEL?15:30;
  let seconds=Number(config.settings.duration??spec.default??values[0]??.5);
  wrapper.className='generation-duration';wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label','视频时长');caption.className='generation-duration-caption';caption.textContent='选择视频时长';row.className='generation-duration-row';track.className='generation-duration-track';ticks.className='generation-duration-ticks';ticks.setAttribute('aria-hidden','true');
  input.type='range';input.className='generation-duration-slider';input.dataset.setting='duration';input.min='0';input.step='.5';input.setAttribute('aria-label','时长（秒），每格 0.5 秒');
  valueBox.className='generation-duration-value';number.type='number';number.min='0';number.max=String(maximum);number.step='.5';number.setAttribute('aria-label','时长（秒）');unit.textContent='s';unit.setAttribute('aria-hidden','true');valueBox.append(number,unit);
  for(let index=0;index<4;index++){const mark=document.createElement('span');mark.style.left=index/3*100+'%';mark.textContent=String(index*maximum/3);ticks.append(mark);}
  track.append(input,ticks);row.append(track,valueBox);wrapper.append(caption,row);
  const show=()=>{input.max=String(maximum);input.value=String(seconds);const fraction=Math.max(0,Math.min(1,seconds/maximum));input.style.setProperty('--duration-fill',`calc(${fraction*100}% + var(--duration-thumb-width) * ${.5-fraction})`);input.setAttribute('aria-valuetext',seconds+' 秒');number.value=String(seconds);};show();
  config.settings.duration=seconds;
  const commit=()=>{if(config.settings.duration!==seconds){config.settings.duration=seconds;onChange();}};
  input.oninput=()=>{seconds=Number(input.value);show();};input.onchange=commit;
  number.onchange=()=>{if(number.value===''||!number.reportValidity()){show();return;}const value=Number(number.value);if(value!==seconds)seconds=Math.max(0,Math.round(value*2)/2);show();commit();};
  return wrapper;
 }

 const wrapper=document.createElement('label'),choices=spec.enum||[],values=choices.map(x=>typeof x==='object'?x.value:x),select=choices.length&&!unrestricted,input=document.createElement(select?'select':'input');
 const title=spec.displayName||spec.title||spec.label||spec.name;wrapper.textContent=title;input.setAttribute('aria-label',title);input.dataset.setting=spec.name;wrapper.append(input);
 const numeric=spec.type==='integer'||spec.type==='number'||spec.component==='slider'||typeof spec.min==='number'||typeof values[0]==='number';
 if(select)choices.forEach((x,i)=>input.add(new Option(typeof x==='object'?(x.displayName||x.label||x.value):String(x),String(i))));
 else {input.type=spec.type==='boolean'?'checkbox':numeric?'number':'text';if(!unrestricted){if(spec.min!==undefined)input.min=spec.min;if(spec.max!==undefined)input.max=spec.max;}input.step=unrestricted?'any':spec.step??(spec.type==='integer'?'1':'any');
  if(choices.length){const list=document.createElement('datalist');list.id='generation-options-'+crypto.randomUUID();for(const item of choices)list.append(new Option(typeof item==='object'?(item.displayName||item.label||item.value):String(item),String(typeof item==='object'?item.value:item)));input.setAttribute('list',list.id);wrapper.append(list);}
 }
 const value=config.settings[spec.name]??spec.default;
 if(select){input.value=String(Math.max(0,values.indexOf(value)));config.settings[spec.name]=values[Number(input.value)];}
 else if(input.type==='checkbox'){input.checked=Boolean(value);config.settings[spec.name]=input.checked;}
 else if(value!==undefined){input.value=value;config.settings[spec.name]=value;}
 input.onchange=()=>{if(!input.reportValidity())return;if(unrestricted&&input.type!=='checkbox'&&input.value==='')delete config.settings[spec.name];else config.settings[spec.name]=input.type==='checkbox'?input.checked:select?values[Number(input.value)]:input.type==='number'?Number(input.value):input.value;onChange();};
 return wrapper;
}
export function createSettingsPopover(anchor,title,onClose){
 const root=document.createElement('div');root.className='dae-ui generation-settings-popover generation-form';root.id='generation-setting-'+crypto.randomUUID();root.setAttribute('role','dialog');root.setAttribute('aria-label',title);
 const heading=document.createElement('strong');heading.textContent=title;root.append(heading);document.body.append(root);anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-controls',root.id);
 let closed=false;
 const place=()=>{if(!anchor.isConnected||!anchor.getClientRects().length){close();return;}const r=anchor.getBoundingClientRect();root.style.left=Math.max(8,Math.min(r.left,innerWidth-root.offsetWidth-8))+'px';root.style.top=Math.max(8,Math.min(r.bottom+8,innerHeight-root.offsetHeight-8))+'px';};
 const outside=e=>{if(!root.contains(e.target)&&!anchor.contains(e.target))close();};
 const keys=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();anchor.focus({preventScroll:true});}};
 function close(){if(closed)return;closed=true;observer.disconnect();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keys,true);document.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);globalThis.removeEventListener('dae-canvas-layout',place);root.remove();anchor.removeAttribute('aria-controls');anchor.setAttribute('aria-expanded','false');onClose();}
 for(const name of ['pointerdown','mousedown','click','dblclick','keydown'])root.addEventListener(name,e=>e.stopPropagation());
 root.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)e.stopPropagation();},{passive:true});
 const observer=new ResizeObserver(place);observer.observe(root);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keys,true);document.addEventListener('scroll',place,{capture:true,passive:true});window.addEventListener('resize',place);globalThis.addEventListener('dae-canvas-layout',place);place();
 return {root,anchor,close};
}
