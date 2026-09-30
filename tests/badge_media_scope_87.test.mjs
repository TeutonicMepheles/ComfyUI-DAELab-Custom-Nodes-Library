import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBadgeMediaScope87} from '../web/badge_media_scope_87.mjs';
import {setNodeMode} from '../web/boolean_group_bypass_controller_model.mjs';
test('future-stage media bypasses scanning and restores without persisting stage modes',()=>{
    const nodes=new Map([1,2,96,146,147].map(id=>[id,{id,mode:id===147?2:0}]));
    const graph={extra:{daelabBadgeExecutionV1:{version:1},daelabBadgePrototypeV1:{localReferenceNodeId:146,studioReferenceNodeId:147}},getNodeById:id=>nodes.get(id)};
    syncBadgeMediaScope87(graph,'build');
    assert.equal(nodes.get(146).mode,4);
    assert.equal(nodes.get(1).mode,0);
    const serialized={mode:4};nodes.get(146).onSerialize(serialized);
    assert.equal(serialized.mode,0);
    setNodeMode(nodes.get(146),0);
    assert.equal(nodes.get(146).mode,4);
    syncBadgeMediaScope87(graph,'local');
    assert.equal(nodes.get(146).mode,0);
    assert.equal(nodes.get(1).mode,4);
    syncBadgeMediaScope87(graph,'studio');
    assert.equal(nodes.get(147).mode,2);
    assert.equal(nodes.get(146).mode,4);
});
test('original workflows keep their media modes',()=>{
    syncBadgeMediaScope87({extra:{},getNodeById:()=>{throw Error('must not inspect')}});
});

test('panel refresh keeps the chosen stage and emits no repeated mode changes',()=>{
    const events=[];
    const nodes=new Map([1,2,96,146,147].map(id=>[id,{id,mode:0}]));
    const graph={extra:{daelabBadgeExecutionV1:{version:1},daelabBadgePrototypeV1:{localReferenceNodeId:146,studioReferenceNodeId:147}},getNodeById:id=>nodes.get(id),trigger:(type,event)=>events.push(event)};
    for(const node of nodes.values())node.graph=graph;
    syncBadgeMediaScope87(graph,'local');
    events.length=0;
    for(let i=0;i<100;i++){
        syncBadgeMediaScope87(graph);
        for(const node of nodes.values())setNodeMode(node,0);
    }
    assert.equal(nodes.get(146).mode,0);
    assert.equal(nodes.get(1).mode,4);
    assert.deepEqual(events,[]);
});

test('activation releases suspension before synchronous mode listeners run',()=>{
    const node={id:146,mode:0};
    const graph={extra:{daelabBadgeExecutionV1:{version:1},daelabBadgePrototypeV1:{localReferenceNodeId:146}},getNodeById:id=>id===146?node:null,trigger:(type,event)=>{
        if(event.newValue===0)setNodeMode(node,0);
    }};
    node.graph=graph;
    syncBadgeMediaScope87(graph,'build');
    syncBadgeMediaScope87(graph,'local');
    assert.equal(node.mode,0);
    assert.equal(node.onSerialize,undefined);
});
