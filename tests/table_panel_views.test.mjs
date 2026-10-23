import test from 'node:test';
import assert from 'node:assert/strict';
import {createTablePanelViews} from '../web/table_panel_views.mjs';
import {installContentPresentation} from '../web/table_context_menu.mjs';

class Element extends EventTarget {
    constructor(){super();this.dataset={};this.hidden=false;this.isConnected=true;}
    setAttribute(name,value){this[name]=value;}
    append(){}
    remove(){this.isConnected=false;}
    querySelector(){return null;}
    querySelectorAll(){return [];}
}

test('borrowed tables restore their bodies after group view, detach, reattach and disposal',t=>{
    const doc=new Element(),events=new EventTarget(),timers=new Set(),contexts=new Map();
    doc.body=new Element();doc.createElement=()=>new Element();
    t.mock.method(globalThis,'setInterval',fn=>{timers.add(fn);return fn;});
    t.mock.method(globalThis,'clearInterval',fn=>timers.delete(fn));
    const names=['document','addEventListener','removeEventListener'];
    const old=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
    const api=Symbol.for('DAELAB.CreativeCanvas.API.v1'),oldApi=globalThis[api];
    globalThis.document=doc;globalThis.addEventListener=events.addEventListener.bind(events);globalThis.removeEventListener=events.removeEventListener.bind(events);
    globalThis[api]={getPanelContext:root=>contexts.get(root)};
    t.after(()=>{names.forEach((name,i)=>old[i]?Object.defineProperty(globalThis,name,old[i]):delete globalThis[name]);if(oldApi)globalThis[api]=oldApi;else delete globalThis[api];});
    const fixture=()=>{
        const root=new Element(),editor={root:new Element(),render(){this.visibleAtRender=!this.root.hidden;},clearSelection(){}},groups={root:new Element(),render(){}},tableTab=new Element(),groupTab=new Element();
        const views=createTablePanelViews({editor,groups,tableTab,groupTab});
        const presentation=installContentPresentation({root,editor,getTable:()=>({fields:[],records:[]}),onPresentationChange:active=>views.setContent(active)});
        return {root,editor,groups,tableTab,groupTab,views,presentation};
    };
    const a=fixture(),b=fixture(),tick=()=>{for(const fn of timers)fn();};
    a.views.show(true);tick();
    assert.equal(a.editor.root.hidden,true);assert.equal(b.editor.root.hidden,false);
    // No Canvas installed/context: native selection remains authoritative.
    assert.equal(a.groups.root.hidden,false);
    const content={presentation:'content',getViewport:()=>({width:1200})};
    contexts.set(a.root,content);contexts.set(b.root,content);
    events.dispatchEvent(new Event('dae-canvas-layout'));
    assert.equal(a.editor.root.hidden,false);assert.equal(a.editor.visibleAtRender,true);
    assert.equal(a.groups.root.hidden,true);assert.equal(b.editor.root.hidden,false);
    assert.equal(a.groupTab['aria-selected'],'true');
    // Workflow switches can detach a live panel before its context is released.
    a.root.isConnected=false;tick();assert.equal(a.editor.root.hidden,true);
    a.root.isConnected=true;tick();assert.equal(a.editor.root.hidden,false);
    contexts.delete(a.root);events.dispatchEvent(new Event('dae-canvas-layout'));
    assert.equal(a.editor.root.hidden,true);assert.equal(a.groups.root.hidden,false);
    assert.equal(b.editor.root.hidden,false);
    contexts.set(a.root,content);tick();assert.equal(a.editor.root.hidden,false);
    a.presentation.destroy();assert.equal(timers.size,1);
    // A fresh instance after reload/undo must not inherit an old tab's state.
    const restored=fixture();contexts.set(restored.root,content);tick();
    assert.equal(restored.editor.root.hidden,false);
    b.presentation.destroy();restored.presentation.destroy();assert.equal(timers.size,0);
});
