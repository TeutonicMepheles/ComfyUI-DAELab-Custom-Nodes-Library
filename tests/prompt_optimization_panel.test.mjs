import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationQuoteLabel,createPromptOptimizationPanel} from '../web/prompt_optimization_panel.mjs';

test('menu quote distinguishes pending, unavailable, expired and zero estimates',()=>{
    assert.equal(optimizationQuoteLabel(null),'待估算');
    assert.equal(optimizationQuoteLabel({status:'estimating'}),'估算中…');
    assert.equal(optimizationQuoteLabel({status:'unavailable',estimatedCredits:0}),'暂无法估算');
    assert.equal(optimizationQuoteLabel({status:'ready',estimatedCredits:null}),'暂无法估算');
    assert.equal(optimizationQuoteLabel({status:'ready',estimatedCredits:0,expiresAt:101},100),'预计 0 积分');
    assert.equal(optimizationQuoteLabel({status:'ready',estimatedCredits:0.001,expiresAt:100},100),'估算已失效');
    assert.equal(optimizationQuoteLabel({status:'expired',estimatedCredits:0.001}),'估算已失效');
});

class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.value='';this.checked=false;this.hidden=false;this.style={setProperty(){}};this.classList={add(){}};}
    append(...nodes){for(const e of nodes){e.parentNode=this;this.children.push(e);}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(name,value){this[name]=value;}
    remove(){this.parentNode?.children.splice(this.parentNode.children.indexOf(this),1);}
    set innerHTML(_value){throw new Error('Suggestion HTML must never be interpreted');}
}
function fixture(){
    globalThis.document={createElement:tag=>new Element(tag),activeElement:null};
    const calls=[],listeners=new Set();let state={scope:'column',model:'gpt-4.1-mini',models:[{id:'gpt-4.1-mini',available:true}],requirements:'',range:{total:2,processable:2,skipped:[]},rows:[],permissions:{canEstimate:true}};
    const controller={getState:()=>state,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},setRequirements:value=>calls.push(['requirements',value]),setModel:value=>calls.push(['model',value])};
    for(const name of ['estimate','submit','stop','recover','continue','retry','apply','applyAll'])controller[name]=async(...args)=>calls.push([name,...args]);
    return {calls,listeners,controller,container:new Element('div'),update:patch=>{state={...state,...patch};for(const fn of listeners)fn(state);}};
}
const find=(root,predicate)=>{if(predicate(root))return root;for(const e of root.children){const result=find(e,predicate);if(result)return result;}return null;};

test('polling retains input composition and row DOM; result HTML stays plain text',()=>{
    const f=fixture(),panel=createPromptOptimizationPanel(f),input=find(panel.root,e=>e.tagName==='textarea');
    input.dispatchEvent(new Event('compositionstart'));input.value='中文未完成';input.dispatchEvent(new Event('input'));
    f.update({requirements:'旧草稿',rows:[{requestId:'r1',recordId:'row',before:'原文',after:'<img onerror=alert(1)>',status:'succeeded',suggestionStatus:'valid',canApply:true}]});
    assert.equal(input.value,'中文未完成');assert.deepEqual(f.calls,[]);
    const row=find(panel.root,e=>e.className==='prompt-opt-result');assert.equal(find(row,e=>e.tagName==='pre'&&e.textContent?.includes('<img')).textContent,'<img onerror=alert(1)>');
    f.update({busy:true});assert.equal(find(panel.root,e=>e.className==='prompt-opt-result'),row);assert.equal(input.disabled,false);
    input.dispatchEvent(new Event('compositionend'));assert.deepEqual(f.calls,[['requirements','中文未完成']]);
    panel.destroy();assert.equal(f.listeners.size,0);
});
test('unknown submission requires explicit duplicate-fee acknowledgement and never auto-retries',async()=>{
    const f=fixture();f.update({batchId:'b',rows:[{requestId:'r',recordId:'row',status:'unknown'}],permissions:{canRecover:true}});
    const panel=createPromptOptimizationPanel(f),retry=find(panel.root,e=>e.textContent==='重新优化（新请求）'),ack=find(panel.root,e=>e.type==='checkbox');
    assert.equal(retry.disabled,true);assert.deepEqual(f.calls,[]);
    ack.checked=true;ack.dispatchEvent(new Event('change'));assert.equal(retry.disabled,false);
    await retry.onclick({preventDefault(){},stopPropagation(){}});assert.deepEqual(f.calls,[['retry',{acknowledgeUnknown:true}]]);panel.destroy();
});
test('result summary includes preflight skips without double-counting persisted rows',()=>{
    const f=fixture();f.update({range:{total:3,processable:1,skipped:[{recordId:'empty',reason:'为空'}]},rows:[{requestId:'r',recordId:'empty',status:'skipped'},{requestId:'s',recordId:'changed',status:'skipped'}]});
    const panel=createPromptOptimizationPanel(f);assert.match(find(panel.root,e=>e.className==='prompt-opt-counts').textContent,/跳过 2/);panel.destroy();
});
test('disabled submission explains inactive mode and clears explanation on restoration',()=>{
    const f=fixture();f.update({inactiveReason:'节点已停用，请恢复 Active 模式。'});const panel=createPromptOptimizationPanel(f);
    const reason=find(panel.root,e=>e.className==='prompt-opt-warning'&&e.textContent?.includes('Active'));assert.equal(reason.hidden,false);
    f.update({inactiveReason:'',quote:{status:'ready',estimatedCredits:1,expiresAt:Date.now()+5000},permissions:{canSubmit:true}});assert.equal(reason.hidden,true);panel.destroy();
});

test('USD quotes and historical usage costs never render as Comfy credits or actual bills',()=>{
 assert.match(optimizationQuoteLabel({status:'ready',estimatedCredits:0.002,price:{currency:'USD'}}),/0\.002 美元（USD）/);
 assert.match(optimizationQuoteLabel({status:'ready',estimatedCredits:2}),/2 积分/);
 const f=fixture();f.update({model:'deepseek-flash',provider:'deepseek',models:[{id:'deepseek-flash',provider:'deepseek'},{id:'gpt-4.1-mini',provider:'comfy'}],quote:{status:'ready',estimatedCredits:0.002,budgetUpperCredits:0.01,price:{currency:'USD'}},batchId:'b',batchProvider:'comfy',batchModel:'gpt-4.1-mini',batchCurrency:'credits',rows:[{requestId:'old',provider:'comfy',currency:'credits',actualCredits:0.5},{requestId:'new',provider:'deepseek',currency:'USD',actualCredits:99,usageCostUSD:0.003}]});
 const panel=createPromptOptimizationPanel(f),model=find(panel.root,e=>e['aria-label']==='润色模型');
 assert.deepEqual(model.children.map(e=>e.value),['deepseek-flash']);
 const text=root=>[root.textContent||'',...root.children.map(text)].join('\n');const displayed=text(panel.root);
 assert.match(displayed,/0\.002 美元（USD）/);assert.match(displayed,/实际消耗：0\.5 积分/);
 assert.match(displayed,/用量保守估算：0\.003 美元（USD）；实际账单未知/);assert.doesNotMatch(displayed,/99 积分|实际消耗：.*美元/);
 assert.match(displayed,/现有批次：ComfyUI Partner.*积分/);panel.destroy();
});

test('page key input is password-only, cleared after save and when dock hides',()=>{
 const f=fixture(),saved=[];f.controller.setDeepSeekKey=key=>{saved.push(key);f.update({pageDeepSeekKeyConfigured:true});return true;};f.controller.clearDeepSeekKey=()=>{f.update({pageDeepSeekKeyConfigured:false});return false;};
 f.update({model:'deepseek-flash',provider:'deepseek',models:[{id:'deepseek-flash',provider:'deepseek'}]});
 const panel=createPromptOptimizationPanel(f),input=find(panel.root,e=>e['aria-label']==='DeepSeek API 密钥'),save=find(panel.root,e=>e.textContent==='保存到本页会话'),clear=find(panel.root,e=>e.textContent==='清除本页密钥');
 assert.equal(input.type,'password');assert.equal(input.autocomplete,'off');input.value='test-private-key';
 save.onclick({preventDefault(){},stopPropagation(){}});assert.deepEqual(saved,['test-private-key']);assert.equal(input.value,'');
 assert.ok(!JSON.stringify(f.controller.getState()).includes('test-private-key'));assert.equal(clear.disabled,false);
 input.value='unsaved-key';f.container.dispatchEvent(new Event('dae-text-side-hide'));assert.equal(input.value,'');
 clear.onclick({preventDefault(){},stopPropagation(){}});assert.equal(clear.disabled,true);panel.destroy();
});

test('DeepSeek pricing preserves date precision and unknown recovery explicitly stays local',()=>{
 const f=fixture();f.update({batchId:'b',batchProvider:'deepseek',rows:[{requestId:'r',status:'unknown',provider:'deepseek'}],quote:{status:'ready',estimatedCredits:0.001,price:{currency:'USD',checkedAt:'2026-10-08',basis:'按缓存未命中输入单价估算'}}});
 const panel=createPromptOptimizationPanel(f),text=root=>[root.textContent||'',...root.children.map(text)].join('\n'),displayed=text(panel.root);
 assert.match(displayed,/估算口径：按缓存未命中输入单价估算/);assert.match(displayed,/费率核对：2026-10-08。/);assert.doesNotMatch(displayed,/8:00|08:00|北京时间/);
 assert.match(displayed,/DeepSeek 查询仅查看本地记录，无法取回丢失的远端响应/);panel.destroy();
});

test('provider and model stay selectable during quote-only busy while actual task locks remain',()=>{
 const f=fixture();f.update({busy:true,permissions:{canChangeProvider:true}});const panel=createPromptOptimizationPanel(f);
 const provider=find(panel.root,e=>e['aria-label']==='服务提供方'),model=find(panel.root,e=>e['aria-label']==='润色模型');
 assert.equal(provider.disabled,false);assert.equal(model.disabled,false);
 f.update({permissions:{canChangeProvider:false}});assert.equal(provider.disabled,true);assert.equal(model.disabled,true);panel.destroy();
});

test('shared async button cleanup cannot overwrite final controller button permissions',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let release;
 f.controller.estimate=async()=>{f.update({busy:true,permissions:{canEstimate:false,canSubmit:false}});await new Promise(resolve=>release=resolve);f.update({busy:false,quote:{status:'ready',estimatedCredits:1,expiresAt:Date.now()+10000},permissions:{canEstimate:true,canSubmit:true}});};
 const panel=createPromptOptimizationPanel(f),estimate=find(panel.root,e=>e.textContent==='更新估算'),start=find(panel.root,e=>e.textContent==='开始优化');
 const sharedClick=async()=>{const result=estimate.onclick({preventDefault(){},stopPropagation(){}}),disabled=estimate.disabled;estimate.disabled=true;try{await result;}finally{estimate.disabled=disabled;}};
 const pending=sharedClick();assert.equal(estimate.disabled,true);release();await pending;
 assert.equal(estimate.disabled,true,'Fixture reproduces shared button restoring disabled captured after action started');
 t.mock.timers.tick(0);assert.equal(estimate.disabled,false);assert.equal(start.disabled,false);
 panel.destroy();t.mock.timers.tick(0);
});

test('fixed status and result shortcut replace stale submit guidance; single results expand once',async()=>{
 const f=fixture(),panel=createPromptOptimizationPanel(f),footer=find(panel.root,e=>e.tagName==='footer');
 const status=find(footer,e=>e.className==='prompt-opt-status'),details=find(panel.root,e=>e.className==='prompt-opt-settings');
 assert.match(find(status,e=>e.tagName==='strong').textContent,/更新估算/);
 f.update({batchId:'b',draftActive:false,rows:[{requestId:'one',recordId:'r',status:'succeeded',suggestionStatus:'valid',canApply:true}],permissions:{canRecover:true}});
 assert.equal(details.open,false);assert.equal(find(status,e=>e.tagName==='strong').textContent,'优化完成，等待应用');
 const row=find(panel.root,e=>e.className==='prompt-opt-result');assert.equal(row.open,true);
 row.open=false;f.update({});assert.equal(row.open,false,'polls preserve user collapse');
 const show=find(footer,e=>e.textContent==='查看结果');await show.onclick({preventDefault(){},stopPropagation(){}});assert.equal(row.open,true);
 assert.equal(find(footer,e=>e.textContent==='开始优化').hidden,true);assert.equal(find(footer,e=>e.textContent==='更新估算').hidden,true);
 f.update({draftActive:true});assert.equal(find(footer,e=>e.textContent==='开始优化').hidden,false);
 panel.destroy();
});

test('unsaved replacement key blocks start and IME explains disabled state',()=>{
 const f=fixture();f.update({quote:{status:'ready',expiresAt:Date.now()+10000},permissions:{canSubmit:true},pageDeepSeekKeyConfigured:true});
 const panel=createPromptOptimizationPanel(f),key=find(panel.root,e=>e.type==='password'),start=find(panel.root,e=>e.textContent==='开始优化');
 key.value='replacement-test-key';key.dispatchEvent(new Event('input'));assert.equal(start.disabled,true);assert.match(start.title,/保存到本页会话/);
 key.value='';key.dispatchEvent(new Event('input'));assert.equal(start.disabled,false);
 const input=find(panel.root,e=>e.tagName==='textarea');input.dispatchEvent(new Event('compositionstart'));assert.equal(start.disabled,true);assert.match(start.title,/候选词/);panel.destroy();
});
