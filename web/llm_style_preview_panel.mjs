import {bindIOPanel} from './llm_io_panel.mjs?v=20261021-integrated1';
import {createTableButton,tableTheme} from './table_controls.mjs?v=20261017-row-header-drag';
let sharedFields=null,sharedPanels=null;
try{sharedFields=await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_field.mjs');sharedPanels=await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_panel_state.mjs');}catch{}

export const STYLE_VARIANTS=Object.freeze([
    {id:'A',label:'A 紧凑单栏',width:420,height:610},
    {id:'B',label:'B 双栏工作台',width:700,height:520},
    {id:'C',label:'C 指令优先',width:460,height:610},
    {id:'D',label:'D 分步编辑',width:460,height:610},
    {id:'E',label:'E 对照审阅',width:700,height:610},
].map(v=>Object.freeze({...v,type:`DAELAB.LLMStylePreview${v.id}`})));
const MODES=[['polish','提示词润色'],['reverse','图片反推'],['custom','自定义']];
const SOURCE='清晨，一只白色小猫坐在窗边，窗外是被薄雾笼罩的城市。画面安静、温暖。';
const INSTRUCTION='保留原意，补充主体、环境、光线与构图。使用自然、清晰的中文，不添加与原文无关的情节。';
const RESULT='清晨的柔光透过窗帘，一只白色小猫安静地坐在木质窗台上。窗外的城市隐于淡淡晨雾之中，背景柔和虚化。以平视中景构图，暖色室内与冷色晨雾形成细腻对比，整体氛围宁静、温暖。';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function icon(name){const e=el('span','llm-style-icon');e.setAttribute('aria-hidden','true');e.style.setProperty('--llm-icon',`url("${new URL((name==='upload-2-line'?'./vendor/remixicon/':'./vendor/prompt-optimization-shared/vendor/remixicon/')+name+'.svg',import.meta.url).href}")`);return e;}
export function createLLMStylePanel(node,variant){
    tableTheme();
    if(!document.getElementById('dae-llm-style-css')){const link=el('link');link.id='dae-llm-style-css';link.rel='stylesheet';link.href=new URL('./llm_style_preview.css?v=20261015-mixed1',import.meta.url).href;document.head.append(link);}
    const root=el('section',`dae-ui llm-style llm-style-${variant.id}`);root.dataset.variant=variant.id;root.setAttribute('aria-label',`LLM 优化 ${variant.label}`);
    const releases=[],fields=[],buttons=[];let interaction=null;
    const saved=()=>node.properties.llmStylePreview||={version:1,mode:'polish'};
    const write=(key,value)=>{saved()[key]=value;node.graph?.change?.();};
    const button=(label,fn,primary=false)=>{const b=createTableButton(label,fn,primary);buttons.push(b);return b;};
    const top=el('div','llm-style-top');const badge=el('span','llm-style-badge',variant.id);top.append(badge,el('span','llm-style-caption',variant.label.slice(2)),el('span','llm-style-preview-tag','样式预览'));if(variant.id!=='B')root.append(top);
    const tabs=el('div','llm-style-modes');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','处理方式');
    const modes=variant.id==='B'?MODES.slice(0,2):MODES;
    const modeButtons=modes.map(([value,label])=>{const b=button(label,()=>{write('mode',value);sync();});b.dataset.mode=value;tabs.append(b);return b;});
    function editor(label,key,fallback,cls){const section=el('label',`llm-style-section ${cls}`);section.append(el('span','llm-style-label',label));const input=el('textarea');input.setAttribute('aria-label',`${variant.id} ${label}`);input.spellcheck=false;input.value=saved()[key]??fallback;input.addEventListener('input',()=>write(key,input.value));section.append(input);fields.push(input);const release=sharedFields?.bindCreativeField(input);if(release)releases.push(release);return {section,input,key,fallback};}
    const source=editor('原始文字','source',variant.id==='B'?'':SOURCE,'llm-style-source');
    const instruction=editor('处理要求','instruction',INSTRUCTION,'llm-style-instruction');
    const materials=el('div','llm-style-materials');
    const upload=button('上传图片',()=>{});upload.prepend(icon('upload-2-line'));upload.disabled=true;upload.title='仅样式预览，暂不上传文件';
    const materialHint=el('span','llm-style-caption','可接入文字与图片');materials.append(upload,materialHint);
    const result=el('section','llm-style-result');const resultHead=el('div','llm-style-result-head');resultHead.append(el('span','llm-style-label','优化结果'),el('span','llm-style-caption','示例'));result.append(resultHead,el('p','',RESULT));
    if(variant.id==='B'){
        resultHead.lastElementChild.remove();
        const actions=el('div','llm-style-result-actions');
        for(const [label,name] of [['应用结果','check-line'],['撤销应用','arrow-go-back-line']]){
            const action=button('',()=>{});
            action.classList.add('llm-style-result-action');
            action.setAttribute('aria-label',label);action.title=label+'（前端样式预览）';
            action.disabled=true;
            const glyph=icon(name);glyph.style.setProperty('--llm-icon',`url("${new URL('./vendor/remixicon/'+name+'.svg',import.meta.url).href}")`);
            action.append(glyph);actions.append(action);
        }
        resultHead.append(actions);
    }
    const footer=el('footer','llm-style-footer');const select=el('select');select.setAttribute('aria-label',`${variant.id} 模型`);select.add(new Option('DeepSeek','deepseek'));select.add(new Option('Qwen · 待接入','qwen'));select.add(new Option('GPT · 待接入','gpt'));select.value=saved().model||'deepseek';select.addEventListener('change',()=>write('model',select.value));fields.push(select);const fieldRelease=sharedFields?.bindCreativeField(select);if(fieldRelease)releases.push(fieldRelease);
    const run=button('生成',()=>{},true);run.prepend(icon('sparkling-line'));run.disabled=true;run.title='仅样式预览，未接入生成逻辑';footer.append(select,run);
    const body=el('div','llm-style-body');
    const foldedResult=()=>{const d=el('details','llm-style-details');d.append(el('summary','','优化结果 · 示例'),result);return d;};
    if(variant.id==='A'){body.append(tabs,source.section,materials,instruction.section,foldedResult());}
    if(variant.id==='B'){root.append(tabs);const left=el('div','llm-style-column'),right=el('div','llm-style-column');left.append(source.section,materials,instruction.section);right.append(result);body.append(left,right);}
    if(variant.id==='C'){body.append(tabs,instruction.section);const details=el('details','llm-style-details');details.append(el('summary','','输入内容 · 1 段文字'),source.section,materials);body.append(details,result);}
    if(variant.id==='D'){const steps=[['01','输入内容',[source.section,materials]],['02','处理方式',[tabs,instruction.section]],['03','查看结果',[foldedResult()]]];for(const [num,label,children] of steps){const step=el('section','llm-style-step');const h=el('div','llm-style-step-heading');h.append(el('span','llm-style-number',num),el('span','llm-style-label',label));step.append(h,...children);body.append(step);}}
    if(variant.id==='E'){body.append(tabs);const compare=el('div','llm-style-compare');compare.append(source.section,result);body.append(compare,materials,instruction.section);}
    root.append(body,footer);
    const note=el('div','llm-style-note','仅供样式确认 · 不会调用模型');if(variant.id!=='B')root.append(note);
    for(const event of ['pointerdown','dblclick','keydown','wheel'])root.addEventListener(event,e=>e.stopPropagation());
    const availability=sharedPanels?.bindPanelAvailability(node,root);if(availability)releases.push(availability);
    function sync(){for(const b of modeButtons){const selected=b.dataset.mode===(saved().mode||'polish');b.setAttribute('aria-pressed',String(selected));b.toggleAttribute('data-primary',selected);}for(const field of [source,instruction])if(document.activeElement!==field.input)field.input.value=saved()[field.key]??field.fallback;select.value=saved().model||(variant.id==='B'?'qwen':'deepseek');interaction?.sync();}
    sync();
    if(variant.id==='B')releases.push(interaction=bindIOPanel({node,root,source:source.input,instruction:instruction.input,select,run,upload,result,materialHint,sync,example:RESULT}));
    return {root,fields,buttons,sync,tasks:()=>interaction?.tasks?.()||[],acceptMaterials:collection=>interaction?.acceptMaterials?.(collection),destroy(){for(const release of releases)release();root.remove();}};
}
