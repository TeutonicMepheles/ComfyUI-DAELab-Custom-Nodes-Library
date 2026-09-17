import {setLocalTargetSize87} from '../web/badge_refinement_87.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { requestForStage as compileRequest, promptForRequest, isBadge87 } from '../web/badge_execution_87_model.mjs';
import { readHierarchyState, normalizeBadgeAppLayout } from '../web/badge_app_layout_model.mjs';

function requestForStage(g,stage) {
    if (stage === 'local') { const n=g.getNodeById(146); setLocalTargetSize87(g,n.widgets?.find(w=>w.name==='image')?.value ?? n.widgets_values_named.image,1024,1024); }
    return compileRequest(g,stage);
}
function fixture() {
    const g = JSON.parse(readFileSync(new URL('../user/default/workflows/%238.7%20-%20Badge%20Workflow.json',import.meta.url)));
    g.getNodeById = id => g.nodes.find(n => String(n.id) === String(id));
    for (const n of g.nodes) n.mode=0;
    const items=readHierarchyState(g.getNodeById(95));
    g.getNodeById(95).daelabBooleanHierarchyV1={getState:()=>items};
    const set=(key,value)=>{items.find(i=>i.id===key).value=value};
    return {g,set};
}

test('refined local output inherits size and runs once without overwriting saved batch count', () => {
    const {g,set}=fixture();
    for (const [key,value] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.semantic',true],['badge.post.local.material',false]]) set(key,value);
    g.getNodeById(146).widgets_values_named.image='target.png';
    g.extra.daelabBadgePrototypeV1.generation={local:{count:8,width:2048,height:2048}};
    const {request}=requestForStage(g,'local');
    assert.equal(request.count,1);
    assert.deepEqual([request.width,request.height],[1024,1024]);
    assert.equal(g.extra.daelabBadgePrototypeV1.generation.local.count,8);
});

test('saved rhinestone material remains intact but requires an explicit replacement in refined 8.7', () => {
    const {g,set}=fixture();
    for (const [key,value] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.semantic',false],['badge.post.local.material',true]]) set(key,value);
    g.getNodeById(146).widgets_values_named.image='target.png';
    const material=g.getNodeById(106).widgets_values_named;
    for (const id of ['rhinestone','水钻']) {
        material.material_id=id;
        assert.throws(()=>requestForStage(g,'local'),/水钻已移除/);
        assert.equal(material.material_id,id);
    }
    material.material_id='glitter';
    assert.equal(requestForStage(g,'local').request.local_regions.groups[0].material_id,'glitter');
});

test('palette tab is removed without rewriting legacy layout', () => {
    const {g} = fixture();
    const raw = JSON.stringify(g.extra.daelabAppLayoutV1);
    const result = normalizeBadgeAppLayout(g);
    assert.equal(result.ok, true);
    assert.ok(!result.layout.tabs.some(t=>t.id==='palette'));
    assert.equal(JSON.stringify(g.extra.daelabAppLayoutV1), raw);
});

test('legacy palette is retained but cannot override cleaned references or prompt-only', () => {
    const {g} = fixture(), meta = g.extra.daelabBadgePrototypeV1;
    meta.promptOnly=true; meta.buildPrompt='A badge';
    const before=requestForStage(g,'build'); meta.paletteReference='palette.png';
    assert.equal(requestForStage(g,'build').request.color_reference,undefined);
    assert.equal(requestForStage(g,'build').fingerprint,before.fingerprint);
    assert.equal(JSON.parse(JSON.stringify(g)).extra.daelabBadgePrototypeV1.paletteReference,'palette.png');
});

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
    const meta=g.extra.daelabBadgePrototypeV1;meta.heightEnabled=true;meta.heightBoard={count:3,fallback:1,alphas:{3:255},groups:[]};
    set('badge.path.flat_height.special_material',true);
    const {request}=requestForStage(g,'build');assert.equal(request.height_board.fixedEndpoints,true);assert.deepEqual(request.height_board.groups,meta.heightBoard.groups);assert.equal(request.regions,undefined);
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
    assert.throws(()=>requestForStage(g,'local'),/GPT/);
    map.model='gpt-image-2.5-sunburst';
    const compiled=requestForStage(g,'local');
    assert.equal(compiled.request.model,'gpt-image-2.5-sunburst');
    assert.deepEqual(compiled.request.color_map,map.image);
    map.image={...map.image,filename:'next-map.png'};
    assert.notEqual(requestForStage(g,'local').fingerprint,compiled.fingerprint);
    g.getNodeById(146).widgets[0].value='another.png';
    assert.throws(()=>requestForStage(g,'local'),/GPT/);
});

test('model selection persists and changes actual request plus fingerprint',()=>{
 const {g}=fixture(); const m=g.extra.daelabBadgePrototypeV1;
 m.promptOnly=true;m.buildPrompt='A badge';
 const before=compileRequest(g,'build');
 m.generation.build.model='gpt-image-2.5-flare';
 const after=compileRequest(g,'build');
 assert.equal(after.request.model,'gpt-image-2.5-flare');
 assert.notEqual(before.fingerprint,after.fingerprint);
 assert.equal(JSON.parse(JSON.stringify(g)).extra.daelabBadgePrototypeV1.generation.build.model,'gpt-image-2.5-flare');
 m.generation.build.model='invalid';assert.throws(()=>compileRequest(g,'build'),/模型/);
});
test('local size follows decoded target and rejects stale size after target switch',()=>{
 const {g,set}=fixture();
 for(const [k,v] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.semantic',true],['badge.post.local.material',false]])set(k,v);
 g.getNodeById(146).widgets_values_named.image='wide.png';
 assert.throws(()=>compileRequest(g,'local'),/尺寸/);
 setLocalTargetSize87(g,'wide.png',1536,1024);
 const r=compileRequest(g,'local').request;assert.equal(r.width,1536);assert.equal(r.height,1024);
 assert.deepEqual(Object.keys(promptForRequest({...r,apply:false})),['200']);
 g.getNodeById(146).widgets_values_named.image='tall.png';
 assert.throws(()=>compileRequest(g,'local'),/尺寸/);
});
test('legacy excessive height remains intact and blocks generation',()=>{
 const {g}=fixture();const m=g.extra.daelabBadgePrototypeV1;m.promptOnly=false;m.heightEnabled=true;
 m.heightBoard={count:6,fallback:1,groups:[]};const saved=JSON.stringify(m.heightBoard);
 assert.throws(()=>compileRequest(g,'build'),/六层/);assert.equal(JSON.stringify(m.heightBoard),saved);
});
