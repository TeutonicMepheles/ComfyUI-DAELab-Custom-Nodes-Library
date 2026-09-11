import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLocalTarget87, localTargets87, selectLocalSource87, setExistingTarget87, enterLocalStage87, selectGeneratedTarget87 } from '../web/badge_result_target_87.mjs';
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

test('unavailable generated source cannot clear an existing image',()=>{
    const {graph,widget,session}=fixture();
    assert.equal(localTargets87(graph).source,'generated');
    assert.equal(selectLocalSource87(graph,'generated',session),false);
    assert.equal(widget.value,'old.png');
    selectLocalSource87(graph,'existing',session);
    assert.equal(normalizeImageSelection(widget.value).filename,'old.png');
});
test('stage entry preserves explicit source across reentry and serialization',()=>{
    const {graph,widget,session}=fixture();
    assert.equal(enterLocalStage87(graph,session),'existing');
    assert.equal(normalizeImageSelection(widget.value).filename,'old.png');
    updateLocalTarget87(graph,{filename:'build.png',type:'output'},session);
    assert.equal(localTargets87(graph).source,'existing');
    assert.equal(enterLocalStage87(graph,session),'existing');
    assert.equal(normalizeImageSelection(widget.value).filename,'old.png');
    selectLocalSource87(graph,'existing',session);
    assert.equal(normalizeImageSelection(widget.value).filename,'old.png');
    graph.extra=JSON.parse(JSON.stringify(graph.extra));
    assert.equal(enterLocalStage87(graph,session),'existing');
});

test('reopening the same target repairs native media binding without invalidating its draft',()=>{
    const {graph,widget,target,session}=fixture();
    updateLocalTarget87(graph,{filename:'saved.png',subfolder:'Badge87',type:'output'},session);
    graph.extra=JSON.parse(JSON.stringify(graph.extra));
    widget.options.values=[];
    target.widgets_values_named.image='';
    let missing=true,notification;
    target.onWidgetChanged=(name,value,previous,w)=>{
        notification={name,value,previous,w}; missing=false;
    };
    Object.assign(session,{preview:'current',serverToken:'valid',phase:'applied'});
    const before=widget.value;
    enterLocalStage87(graph,session);
    assert.equal(missing,false);
    assert.deepEqual(notification,{name:'image',value:before,previous:before,w:widget});
    assert.equal(target.widgets_values_named.image,before);
    assert.deepEqual(widget.options.values,[before]);
    assert.equal(session.preview,'current');assert.equal(session.serverToken,'valid');
    assert.equal(session.phase,'applied');
});

test('changed targets notify native widget errors; empty sources do not clear genuine missing media',()=>{
    const {graph,widget,target,session}=fixture();
    const events=[];
    target.onWidgetChanged=(...args)=>events.push(args);
    updateLocalTarget87(graph,{filename:'saved.png',type:'output'},session);
    assert.equal(events.length,1);assert.equal(events[0][2],'old.png');
    localTargets87(graph).existing=null;
    selectLocalSource87(graph,'existing',session);
    assert.equal(widget.value,'');assert.equal(events.length,1);
});

test('all results are selectable; a later batch cannot replace the active target',()=>{
    const {graph,widget,session}=fixture();
    const images=[1,2,3,4].map(i=>({filename:`result-${i}.png`,type:'output'}));
    updateLocalTarget87(graph,images,session);
    assert.equal(localTargets87(graph).results.length,4);
    selectGeneratedTarget87(graph,images[2],session);
    assert.equal(normalizeImageSelection(widget.value).filename,'result-3.png');
    session.preview='keep';
    assert.equal(selectGeneratedTarget87(graph,images[2],session),false);
    assert.equal(session.preview,'keep');
    updateLocalTarget87(graph,[{filename:'next.png',type:'output'}],session);
    assert.equal(normalizeImageSelection(widget.value).filename,'result-3.png');
    assert.equal(session.preview,'keep');
    assert.equal(localTargets87(graph).pendingResults,true);
    graph.extra=JSON.parse(JSON.stringify(graph.extra));
    enterLocalStage87(graph,session);
    assert.equal(normalizeImageSelection(widget.value).filename,'result-3.png');
    selectGeneratedTarget87(graph,localTargets87(graph).results[0],session);
    assert.equal(normalizeImageSelection(widget.value).filename,'next.png');
    assert.equal(session.preview,null);
});

test('busy session rejects image and source changes',()=>{
    const {graph,widget,session}=fixture();
    const images=[1,2].map(i=>({filename:`${i}.png`,type:'output'}));
    updateLocalTarget87(graph,images,session);
    const before=widget.value;
    session.busy=true;
    assert.equal(selectGeneratedTarget87(graph,images[1],session),false);
    assert.equal(selectLocalSource87(graph,'existing',session),false);
    assert.equal(setExistingTarget87(graph,'manual.png',session),false);
    assert.equal(widget.value,before);
});

test('color and map drafts stay attached to their exact image',()=>{
    const {graph,session}=fixture();
    const getNode=graph.getNodeById;
    const color={name:'multi_color_mask_v1_panel',value:'{"groups":[{"color":"#123456"}]}'};
    graph.getNodeById=id=>id===104?{widgets:[color]}:getNode(id);
    const images=[1,2].map(i=>({filename:`${i}.png`,subfolder:'',type:'output'}));
    updateLocalTarget87(graph,images,session);
    color.value='{"groups":[{"color":"#abcdef"}]}';
    graph.extra.daelabBadgePrototypeV1.gptColorMap={sourceKey:JSON.stringify(normalizeImageSelection(images[0])),image:{filename:'map.png'}};
    selectGeneratedTarget87(graph,images[1],session);
    assert.notEqual(color.value,'{"groups":[{"color":"#abcdef"}]}');
    assert.equal(graph.extra.daelabBadgePrototypeV1.gptColorMap,null);
    selectGeneratedTarget87(graph,images[0],session);
    assert.equal(color.value,'{"groups":[{"color":"#abcdef"}]}');
    // Normalized image keys, including their subfolder and type, define ownership.
    assert.equal(localTargets87(graph).generated.filename,'1.png');
    assert.equal(graph.extra.daelabBadgePrototypeV1.gptColorMap.image.filename,'map.png');
});

test('polygon and brush drafts survive rapid target changes and serialization',()=>{
    const {graph,target,session}=fixture();
    target.id=146; target.type='LoadImage';
    const getNode=graph.getNodeById;
    const drawing={polygons:[],brushStrokes:[],cleared:true,loadToken:0,stateImageSize:{width:1024,height:1024}};
    const polygon={inputs:[{name:'image',link:1}],properties:{},polygonWidget:drawing,
        loadConnectedLoadImage(){},updatePolygonInfo(){},resetPolygonHistory(){drawing.history=[JSON.parse(JSON.stringify(drawing.polygons))];}};
    graph.links={1:{origin_id:146}};
    graph.getNodeById=id=>id===142?polygon:getNode(id);
    const images=[1,2].map(i=>({filename:`${i}.png`,type:'output'}));
    updateLocalTarget87(graph,images,session);
    drawing.polygons=[{points:[[1,2],[3,4],[5,6]]}];
    drawing.brushStrokes=[{points:[[0.1,0.2]],size:0.05}];
    drawing.cleared=false;
    drawing.stateImageSize={width:1024,height:1024};
    const expected=JSON.parse(JSON.stringify(drawing));
    selectGeneratedTarget87(graph,images[1],session);
    assert.deepEqual(drawing.polygons,[]);assert.deepEqual(drawing.brushStrokes,[]);
    const pendingToken=drawing.loadToken;
    graph.extra=JSON.parse(JSON.stringify(graph.extra));
    selectGeneratedTarget87(graph,images[0],session);
    assert.deepEqual(drawing.polygons,expected.polygons);
    assert.deepEqual(drawing.brushStrokes,expected.brushStrokes);
    assert.deepEqual(drawing.stateImageSize,{width:1024,height:1024});
    assert.ok(drawing.loadToken>pendingToken);
    assert.equal(session.serverToken,null);
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
