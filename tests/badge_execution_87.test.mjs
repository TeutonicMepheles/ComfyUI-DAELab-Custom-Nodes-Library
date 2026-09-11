import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { requestForStage, promptForRequest, isBadge87 } from '../web/badge_execution_87_model.mjs';
import { readHierarchyState } from '../web/badge_app_layout_model.mjs';

function fixture() {
    const g = JSON.parse(readFileSync(new URL('../user/default/workflows/%238.7%20-%20Badge%20Workflow.json',import.meta.url)));
    g.getNodeById = id => g.nodes.find(n => n.id === id);
    for (const n of g.nodes) n.mode=0;
    const items=readHierarchyState(g.getNodeById(95));
    g.getNodeById(95).daelabBooleanHierarchyV1={getState:()=>items};
    const set=(key,value)=>{items.find(i=>i.id===key).value=value};
    return {g,set};
}

test('local color reference uses removal config and invalidates preview on changes',()=>{
    const {g,set}=fixture();
    for(const [key,val] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.semantic',true],['badge.post.local.material',false]])set(key,val);
    g.getNodeById(146).widgets_values_named.image='target.png';
    g.getNodeById(1).widgets_values_named.image='flat.png';
    const meta=g.extra.daelabBadgePrototypeV1;meta.backgroundEnabled=true;
    const first=requestForStage(g,'local');
    assert.ok(first.request.original_background);
    assert.equal(first.request.original_image.filename,'flat.png');
    meta.backgroundEnabled=false;
    const fallback=requestForStage(g,'local');
    assert.equal(fallback.request.original_background,undefined);
    assert.equal(fallback.request.original_image.filename,'flat.png');
    assert.notEqual(first.fingerprint,fallback.fingerprint);
});

test('explicit prompt-only ignores retained, bypassed and malformed structured inputs',()=>{
    const {g}=fixture(), meta=g.extra.daelabBadgePrototypeV1;
    meta.promptOnly=true; meta.buildPrompt='A blue planet';
    g.getNodeById(1).widgets_values_named.image='old.png';
    for(const id of [1,2,3,47,49,55]) g.getNodeById(id).mode=4;
    g.getNodeById(47).widgets_values_named.config_json='{invalid';
    const {request,fingerprint}=requestForStage(g,'build');
    assert.equal(request.prompt_only,true); assert.equal(request.prompt,'A blue planet');
    assert.equal(request.image,null);
    for(const key of ['material','background','height_image','height_board','regions']) assert.equal(key in request,false);
    g.getNodeById(1).widgets_values_named.image='another.png'; meta.heightBoard={changed:true};
    assert.equal(requestForStage(g,'build').fingerprint,fingerprint);
    meta.buildPrompt=' '; assert.throws(()=>requestForStage(g,'build'),/基础提示词/);
    meta.buildPrompt='A planet'; g.getNodeById(200).mode=4;
    assert.throws(()=>requestForStage(g,'build'),/跳过/);
});

test('explicit structured mode requires image and retains supplementary prompt',()=>{
    const {g}=fixture(), meta=g.extra.daelabBadgePrototypeV1;
    meta.promptOnly=false; meta.buildPrompt='Soft lighting';
    assert.throws(()=>requestForStage(g,'build'),/材质图/);
    g.getNodeById(1).widgets_values_named.image='flat.png'; meta.heightEnabled=false;
    const {request}=requestForStage(g,'build');
    assert.equal(request.prompt_only,false); assert.equal(request.prompt,'Soft lighting');
    assert.equal(request.image.filename,'flat.png'); assert.ok(request.material);
    meta.buildPrompt=''; assert.doesNotThrow(()=>requestForStage(g,'build'));
});
test('8.7 preserves prototype input contracts and has a separate identity',()=>{
    const {g}=fixture();
    const p=JSON.parse(readFileSync(new URL('../user/default/workflows/%238.6-UI%20-%20Badge%20App%20Mode%20Prototype.json',import.meta.url)));
    assert.notEqual(g.id,p.id); assert.equal(isBadge87(p),false);
    assert.deepEqual(g.extra.linearData.inputs.map(([k])=>k.split(':').slice(1)),p.extra.linearData.inputs.map(([k])=>k.split(':').slice(1)));
    for(const n of p.nodes) assert.equal(g.getNodeById(n.id).type,n.type);
});
test('prompt-only build compiles into one stage with low quality and one image',()=>{
    const {g}=fixture();g.extra.daelabBadgePrototypeV1.buildPrompt='A badge';
    const {request}=requestForStage(g,'build');
    assert.equal(request.image,null);assert.equal(request.quality,'low');assert.equal(request.count,1);
    const prompt=promptForRequest(request);assert.deepEqual(Object.keys(prompt).sort(),['113','200']);
    for(const node of Object.values(prompt)) assert.equal(typeof node._meta.title,'string');
});
test('local uses its own source and rejects empty or bypassed required inputs',()=>{
    const {g,set}=fixture();
    for(const [key,val] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.semantic',true],['badge.post.local.material',false]])set(key,val);
    assert.throws(()=>requestForStage(g,'local'));
    g.getNodeById(146).widgets_values_named.image='target.png';
    const {request}=requestForStage(g,'local');assert.equal(request.image.filename,'target.png');
    g.getNodeById(200).mode=4;assert.throws(()=>requestForStage(g,'local'));
});
test('height board and material settings are delivered without changing prototype widgets',()=>{
    const {g,set}=fixture();g.getNodeById(1).widgets_values_named.image='flat.png';g.getNodeById(2).widgets_values_named.image='height.png';
    const meta=g.extra.daelabBadgePrototypeV1;meta.heightEnabled=true;meta.heightBoard={count:6,fallback:1,alphas:{6:153},groups:[]};
    set('badge.path.flat_height.special_material',true);
    const {request}=requestForStage(g,'build');assert.deepEqual(request.height_board,meta.heightBoard);assert.ok(request.regions);
});
test('generation count accepts GPT Image 2 range and enters the stage fingerprint',()=>{
    const {g}=fixture();g.extra.daelabBadgePrototypeV1.buildPrompt='A badge';
    const initial=requestForStage(g,'build').fingerprint;
    for(let count=1;count<=8;count++) {
        g.extra.daelabBadgePrototypeV1.generation.build.count=count;
        assert.equal(requestForStage(g,'build').request.count,count);
    }
    assert.notEqual(requestForStage(g,'build').fingerprint,initial);
    for(const count of [0,9,1.5,'2']) {
        g.extra.daelabBadgePrototypeV1.generation.build.count=count;
        assert.throws(()=>requestForStage(g,'build'),/1–8/);
    }
});

test('polygon execution rejects a canvas loaded from an earlier image',()=>{
    const {g,set}=fixture();
    for(const [key,val] of [['badge.post.local',true],['badge.post.local.selection.color',false],['badge.post.local.selection.polygon',true],['badge.post.local.semantic',true],['badge.post.local.material',false]])set(key,val);
    g.getNodeById(146).widgets=[{name:'image',value:'current.png'}];
    g.links=Object.fromEntries(g.links.map(link=>[link[0],{origin_id:link[1]}]));
    g.getNodeById(142).polygonWidget={imageValue:'load-image:146:previous.png'};
    assert.throws(()=>requestForStage(g,'local'),/Load Image/);
    g.getNodeById(142).polygonWidget.imageValue='load-image:146:current.png';
    assert.equal(requestForStage(g,'local').request.image.filename,'current.png');
});

test('GPT map must belong to current target and replacing it invalidates preview',()=>{
    const {g,set}=fixture();
    for(const [key,val] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.color_id_map',true],['badge.post.local.semantic',true],['badge.post.local.material',false]])set(key,val);
    g.getNodeById(146).widgets=[{name:'image',value:'current.png'}];
    assert.throws(()=>requestForStage(g,'local'),/GPT/);
    const source={filename:'current.png',subfolder:'',type:'input'};
    const map={image:{filename:'map.png',subfolder:'',type:'output'},source,sourceKey:JSON.stringify(source)};
    g.extra.daelabBadgePrototypeV1.gptColorMap=map;
    const compiled=requestForStage(g,'local');
    assert.deepEqual(compiled.request.color_map,map.image);
    map.image={...map.image,filename:'next-map.png'};
    assert.notEqual(requestForStage(g,'local').fingerprint,compiled.fingerprint);
    g.getNodeById(146).widgets[0].value='another.png';
    assert.throws(()=>requestForStage(g,'local'),/GPT/);
});
