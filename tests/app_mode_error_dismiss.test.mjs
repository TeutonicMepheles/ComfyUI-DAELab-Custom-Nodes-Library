import test from 'node:test';
import assert from 'node:assert/strict';
import { installErrorDismiss } from '../web/app_mode_error_dismiss.mjs';

function fixture() {
    class Element {
        attrs = new Map(); children = []; isConnected = true; textContent = '';
        setAttribute(k,v) { this.attrs.set(k,v); }
        removeAttribute(k) { this.attrs.delete(k); }
        append(child) { this.children.push(child); child.parent = this; }
        contains(child) { return this.children.includes(child); }
        remove() { if(this.parent) this.parent.children = this.parent.children.filter(x=>x!==this); }
        querySelector() { return this.description; }
    }
    const card = new Element(); card.description = {textContent:'执行失败'};
    const document = {head:new Element(),body:new Element(),createElement:()=>new Element(),querySelectorAll:()=>card.isConnected?[card]:[]};
    const api = new EventTarget();
    class Observer { observe() {} disconnect() {} }
    const controller = installErrorDismiss(document,api,Observer);
    const close = () => card.children[0].onclick({preventDefault(){},stopPropagation(){}});
    return {card,document,api,Observer,controller,close};
}
test('dismiss only the card, preserve contents, and reinstall idempotently',()=>{
    const f=fixture(); f.close(); f.controller.sync();
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),true);
    assert.equal(f.card.description.textContent,'执行失败');
    assert.equal(installErrorDismiss(f.document,f.api,f.Observer),f.controller);
    assert.equal(f.card.children.length,1);
    assert.match(f.document.head.children[0].textContent,/data-daelab-error-dismissed\] \{ display:none!important/);
});
test('identical execution errors and new messages reappear',()=>{
    const f=fixture(); f.close(); f.api.dispatchEvent(new Event('execution_error'));
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
    f.close(); f.card.description.textContent='新错误'; f.controller.sync();
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
    f.close(); f.api.dispatchEvent(new Event('execution_start'));
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
});
test('graph reset, card remount, and disposal restore visibility',()=>{
    const f=fixture(); f.close(); f.controller.reset();
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
    f.close(); f.card.isConnected=false; f.controller.sync();
    f.card.isConnected=true; f.controller.sync();
    assert.equal(f.card.children.length,1);
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
    f.close(); f.controller.dispose();
    assert.equal(f.card.children.length,0);
    assert.equal(f.card.attrs.has('data-daelab-error-dismissed'),false);
    assert.equal(f.document.head.children.length,0);
});
