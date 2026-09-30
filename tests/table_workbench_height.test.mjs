import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench} from '../web/table_workbench.mjs';

test('configure restores explicit height after the panel was created, without borrowing node height',()=>{
    const element=()=>({style:{},append(){},setAttribute(){}});
    globalThis.document={createElement:element,createTextNode:t=>t};
    globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
    const node={properties:{},size:[720,9000]},surface=element();
    const panel=createWorkbench(node,surface);
    assert.equal(panel.height(),520);
    node.properties.daelabTableHeight=1000;panel.restoreHeight();
    assert.match(panel.host.style.cssText,/height:1000px/);
    panel.restoreHeight();assert.equal(panel.height(),1000);
    node.properties.daelabTableHeight=100000;panel.restoreHeight();assert.equal(panel.height(),1000);
    node.properties.daelabTableHeight=40;panel.restoreHeight();assert.equal(panel.height(),360);
    panel.destroy();
});
