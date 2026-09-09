import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLocalTarget87, localTargets87, selectLocalSource87, setExistingTarget87 } from '../web/badge_result_target_87.mjs';
import { normalizeImageSelection } from '../web/app_mode_load_image_preview_model.mjs';

function fixture() {
    const calls=[];
    const widget={name:'image',value:'old.png',options:{values:['old.png']},callback:value=>calls.push(value)};
    const target={widgets:[widget],widgets_values_named:{image:'old.png'}};
    const hierarchy={daelabBooleanHierarchyV1:{setItemValue:(...args)=>calls.push(args)}};
    const graph={extra:{daelabBadgeExecutionV1:{version:1},daelabBadgePrototypeV1:{localReferenceNodeId:146,stateNodeId:95}},
        getNodeById:id=>id===146?target:id===95?hierarchy:null};
    const session={preview:'old',serverToken:'old',phase:'applied',images:['old'],seed:123};
    return {graph,widget,target,session,calls};
}
test('build output becomes a serializable local target and invalidates prior selection',()=>{
    const {graph,widget,target,session,calls}=fixture();
    const image={filename:'new.png',subfolder:'Badge87\\build',type:'output'};
    assert.equal(updateLocalTarget87(graph,image,session),true);
    assert.deepEqual(normalizeImageSelection(widget.value),{...image,subfolder:'Badge87/build'});
    assert.equal(target.widgets_values_named.image,widget.value);
    assert.equal(calls[0],widget.value);
    assert.deepEqual(calls[1],['badge.post.local.apply',false]);
    assert.equal(session.preview,null);assert.equal(session.serverToken,null);assert.equal(session.images,null);
    assert.equal(session.phase,'changed');
    updateLocalTarget87(graph,image,session);
    assert.equal(widget.options.values.length,2);
});
test('missing output and the original prototype never replace the target',()=>{
    const {graph,widget,session}=fixture();
    assert.equal(updateLocalTarget87(graph,null,session),false);
    delete graph.extra.daelabBadgeExecutionV1;
    assert.equal(updateLocalTarget87(graph,{filename:'new.png',type:'output'},session),false);
    assert.equal(widget.value,'old.png');assert.equal(session.preview,'old');
});

test('source defaults to generated without substituting the existing image',()=>{
    const {graph,widget,session}=fixture();
    assert.equal(localTargets87(graph).source,'generated');
    selectLocalSource87(graph,'generated',session);
    assert.equal(widget.value,'');
    selectLocalSource87(graph,'existing',session);
    assert.equal(normalizeImageSelection(widget.value).filename,'old.png');
});
test('new generation retains the selected existing image and both sources survive serialization',()=>{
    const {graph,widget,session}=fixture();
    setExistingTarget87(graph,'chosen.png',session);
    session.preview='confirmed-existing';
    assert.equal(updateLocalTarget87(graph,{filename:'generated.png',type:'output'},session),false);
    assert.equal(normalizeImageSelection(widget.value).filename,'chosen.png');
    assert.equal(session.preview,'confirmed-existing');
    graph.extra=JSON.parse(JSON.stringify(graph.extra));
    selectLocalSource87(graph,'generated',session);
    assert.deepEqual(normalizeImageSelection(widget.value),{filename:'generated.png',type:'output',subfolder:''});
    assert.equal(session.preview,null);
    selectLocalSource87(graph,'existing',session);
    assert.equal(normalizeImageSelection(widget.value).filename,'chosen.png');
});
