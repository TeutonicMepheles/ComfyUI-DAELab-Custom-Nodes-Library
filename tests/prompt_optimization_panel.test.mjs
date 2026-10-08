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
