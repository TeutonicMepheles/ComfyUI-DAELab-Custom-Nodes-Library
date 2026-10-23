import test from 'node:test';
import assert from 'node:assert/strict';
import {createOptimizationComposer,optimizationCostSummary} from '../web/prompt_optimization_composer.mjs';
import {COMFY_GPT_MODEL,OPTIMIZATION_MODELS,optimizationProvider} from '../web/prompt_optimization_model.mjs';
import {installDom,Element} from './prompt_optimization_dom.mjs';
const find=(root,test)=>test(root)?root:root.children.map(e=>find(e,test)).find(Boolean);

test('aggregate applied label follows undo and redo without offering a second application',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());let notify;
 let state={provider:'comfy',model:COMFY_GPT_MODEL,batchId:'retained',range:{total:3},rows:Array.from({length:3},()=>({status:'succeeded',suggestionStatus:'applied',canApply:false})),permissions:{canApplyAll:false}};
 const controller={getState:()=>state,subscribe(fn){notify=fn;fn(state);return()=>{};}};
 const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'最终提示词'});t.after(()=>view.destroy());
 const progress=find(container,e=>e.className==='opt-progress-label'),apply=find(container,e=>e.tagName==='button'&&e['aria-label']==='应用结果'),message=find(container,e=>e.className==='opt-message');
 assert.equal(progress.children[1].textContent,'已应用 3 行');
 state={...state,rows:state.rows.map(r=>({...r,suggestionStatus:'reverted'}))};notify(state);
 assert.equal(progress.children[1].textContent,'已撤销 3 行');assert.match(message.textContent,/重做/);assert.equal(apply.disabled,true);
 state={...state,rows:state.rows.map(r=>({...r,suggestionStatus:'applied'}))};notify(state);
 assert.equal(progress.children[1].textContent,'已应用 3 行');assert.equal(message.hidden,true);
});

test('DeepSeek settings are opt-in, close on provider switch, and discard unsaved key drafts',t=>{
 const dom=installDom(t);t.after(()=>dom.restore());let notify;
 let state={provider:'deepseek',model:'deepseek-flash',range:{total:12},rows:[],permissions:{canChangeProvider:true},quote:{status:'ready',estimatedCredits:.1,budgetUpperCredits:.2,expiresAt:Date.now()+10000}};
 const controller={getState:()=>state,subscribe(fn){notify=fn;fn(state);return()=>{};}};
 const container=new Element('div'),view=createOptimizationComposer({controller,container,fieldName:'画面'});t.after(()=>view.destroy());
 const gear=find(container,e=>e['aria-label']==='DeepSeek API 设置'&&e.tagName==='button'),panel=find(container,e=>e.className==='opt-key-panel'),key=find(container,e=>e.type==='password'),message=find(container,e=>e.className==='opt-message');
 assert.equal(panel.hidden,true);assert.equal(gear.hidden,false);assert.equal(message.hidden,true);
 gear.onclick({preventDefault(){},stopPropagation(){}});assert.equal(panel.hidden,false);assert.match(find(panel,e=>e.className==='opt-muted'&&e.textContent.includes('预计')).textContent,/\$0.1/);
 key.value='unsaved-dummy';state={...state,provider:'comfy',model:COMFY_GPT_MODEL};notify(state);assert.equal(panel.hidden,true);assert.equal(gear.hidden,true);assert.equal(key.value,'');assert.match(message.textContent,/积分/);assert.doesNotMatch(message.textContent,/\$/);
 state={...state,provider:'deepseek',model:'deepseek-flash'};notify(state);assert.equal(panel.hidden,true);gear.onclick({preventDefault(){},stopPropagation(){}});assert.equal(view.closeNested(),true);assert.equal(panel.hidden,true);assert.equal(view.closeNested(),false);
 state={...state,provider:'qwen',model:'qwen3.5:9b-q4_K_M'};notify(state);assert.equal(gear.hidden,true);
});

test('Comfy GPT is a real native-credit model and prices cannot be labelled as USD',()=>{
 assert.equal(OPTIMIZATION_MODELS.find(m=>m.id===COMFY_GPT_MODEL).label,'GPT-6 Luna（ComfyUI）');assert.equal(optimizationProvider(COMFY_GPT_MODEL),'comfy');
 assert.equal(optimizationCostSummary({provider:'comfy',quote:{status:'ready',estimatedCredits:1.2,budgetUpperCredits:2.3,expiresAt:Date.now()+5000}}),'预计 1.2 积分 · 预算上界 2.3 积分');
});
