import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextSide} from '../web/table_text_side.mjs';

// Minimal DOM harness for dock ownership, lifecycle and keyboard behavior.
class Element extends EventTarget {
    constructor(tag) { super(); this.tagName=tag; this.children=[]; this.dataset={}; this.style={setProperty(){}}; this.hidden=false; this.isConnected=true; }
    append(...nodes) { for(const n of nodes){n.parentNode?.children.splice(n.parentNode.children.indexOf(n),1);n.parentNode=this;this.children.push(n);} }
    replaceChildren(...nodes) {this.children=[];this.append(...nodes);}
    setAttribute(name,value) {this[name]=value;}
    querySelector() {return null;}
    querySelectorAll() {return [];}
    contains(node) {return node===this||this.children.some(child=>child.contains(node));}
    remove() {if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.isConnected=false;}
    focus() {globalThis.document.activeElement=this;}
}
function setup(){
    const document=Object.assign(new EventTarget(),{body:new Element('body'),createElement:tag=>new Element(tag)});
    globalThis.document=document;
    globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
    return {document,root:new Element('main')};
}
test('different dock kinds keep independent drafts and collapse does not dispose either',()=>{
    const {document,root}=setup(),side=createTextSide({root}),anchor=new Element('button');let disposed=0,built=0;
    const build=body=>{built++;body.draft='用户草稿';body.onCleanup(()=>disposed++);};
    const text=side.open('row','field','正文',build);
    const optimize=side.open('row','field','优化',build,{kind:'optimization',returnFocus:anchor});
    assert.notEqual(text,optimize);assert(text.parentNode.hidden);assert.equal(document.body.children.length,2);
    side.hide();assert.equal(disposed,0);assert.equal(document.activeElement,anchor);
    assert.equal(side.open('row','field','优化',build,{kind:'optimization'}),optimize);
    assert.equal(optimize.draft,'用户草稿');assert.equal(built,2);
    side.destroy();assert.equal(disposed,2);assert.equal(document.body.children.length,0);
});
test('opening another instance hides the first without transferring its draft or cleanup',()=>{
    const {root}=setup(),a=createTextSide({root}),b=createTextSide({root});
    const first=a.open('r','f','A',body=>body.draft='A');
    const second=b.open('r','f','B',body=>body.draft='B');
    assert(first.parentNode.hidden);assert.equal(first.draft,'A');assert.equal(second.draft,'B');
    b.destroy();a.destroy();
});
test('Escape during composition leaves dock open; ordinary Escape restores caller focus',()=>{
    const {document,root}=setup(),side=createTextSide({root}),anchor=new Element('button');
    const body=side.open('r','f','优化',()=>{},{kind:'optimization',returnFocus:anchor});
    const composing=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:true});
    body.parentNode.dispatchEvent(composing);assert.equal(body.parentNode.hidden,false);
    const escape=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false});
    body.parentNode.dispatchEvent(escape);assert.equal(body.parentNode.hidden,true);assert.equal(document.activeElement,anchor);
    side.destroy();
});
test('closing a native popup restores the target cell when its menu anchor is hidden',()=>{
    const {document,root}=setup(),anchor=new Element('button'),cell=new Element('td');anchor.getClientRects=()=>[];cell.dataset={record:'r',field:'f'};root.querySelectorAll=()=>[cell];
    const side=createTextSide({root});side.open('r','f','优化',()=>{},{kind:'optimization',returnFocus:anchor});side.hide();
    assert.equal(document.activeElement,cell);side.destroy();
});

test('IME Escape with false isComposing preserves the dock and native default action',()=>{
    const {document,root}=setup(),side=createTextSide({root}),anchor=new Element('button');
    const body=side.open('r','f','优化',()=>{},{kind:'optimization',returnFocus:anchor}),pane=body.parentNode;
    pane.dispatchEvent(new Event('compositionstart'));
    const escape=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false,keyCode:27});
    pane.dispatchEvent(escape);assert.equal(pane.hidden,false);assert.equal(escape.defaultPrevented,false);assert.notEqual(document.activeElement,anchor);
    pane.dispatchEvent(new Event('compositionend'));
    const ordinary=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false,keyCode:27});
    pane.dispatchEvent(ordinary);assert.equal(pane.hidden,true);assert.equal(document.activeElement,anchor);
    side.destroy();
});

test('IME boundary key 229 cannot close the dock before start or after compositionend',()=>{
    for(const ended of [false,true]){
        const {root}=setup(),side=createTextSide({root}),pane=side.open('r','f','优化',()=>{}).parentNode;
        if(ended){pane.dispatchEvent(new Event('compositionstart'));pane.dispatchEvent(new Event('compositionend'));}
        const boundary=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false,keyCode:229});
        pane.dispatchEvent(boundary);assert.equal(pane.hidden,false);assert.equal(boundary.defaultPrevented,false);
        const next=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false,keyCode:27});
        pane.dispatchEvent(next);assert.equal(pane.hidden,true);side.destroy();
    }
});

test('focus leaving a composing dock cannot leave a stale Escape guard on reopening',()=>{
    const {root}=setup(),side=createTextSide({root}),pane=side.open('r','f','优化',()=>{}).parentNode;
    pane.dispatchEvent(new Event('compositionstart'));
    pane.dispatchEvent(Object.assign(new Event('focusout'),{relatedTarget:null}));
    side.hide();side.open('r','f','优化',()=>{});
    pane.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:false,keyCode:27}));
    assert.equal(pane.hidden,true);side.destroy();
});
