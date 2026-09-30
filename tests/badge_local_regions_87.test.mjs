import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readHierarchyState} from '../web/badge_app_layout_model.mjs';
import {requestForStage,promptForRequest} from '../web/badge_execution_87_model.mjs';
import {readLocalRegions87,writeLocalRegions87,previewLocalRegions87,countRegionOverlap87} from '../web/badge_local_regions_87_model.mjs';
import {setLocalTargetSize87} from '../web/badge_refinement_87.mjs';
import {setExistingTarget87} from '../web/badge_result_target_87.mjs';

function fixture() {
 const g=JSON.parse(readFileSync(new URL('../user/default/workflows/%238.7%20-%20Badge%20Workflow.json',import.meta.url)));
 g.getNodeById=id=>g.nodes.find(n=>String(n.id)===String(id));g.nodes.forEach(n=>n.mode=0);
 const h=readHierarchyState(g.getNodeById(95));g.getNodeById(95).daelabBooleanHierarchyV1={getState:()=>h,setItemValue:(id,v)=>{h.find(i=>i.id===id).value=v}};
 const set=(id,value)=>h.find(i=>i.id===id).value=value;
 for(const [id,v] of [['badge.post.local',true],['badge.post.local.selection.color',true],['badge.post.local.selection.polygon',false],['badge.post.local.material',true],['badge.post.local.semantic',false]])set(id,v);
 g.getNodeById(146).widgets_values_named.image='target.png';setLocalTargetSize87(g,'target.png',1024,1024);
 g.getNodeById(104).widgets_values_named.config_json=JSON.stringify({groups:[{color:'#ff0000',threshold:0},{color:'#00ff00',threshold:2}]});
 g.getNodeById(106).widgets_values_named.material_id='satin_silver';
 return {g,set};
}
test('8.7 migrates legacy colors without graph surgery and compiles the 8.7 executor/model/output',()=>{
 const {g}=fixture(), before=JSON.stringify(g.nodes), c=readLocalRegions87(g);
 assert.equal(c.groups.length,2);assert.ok(c.groups.every(r=>r.material_id==='satin_silver'));
 c.groups[0].name='外框';c.groups[0].samples=['#aa0000'];c.groups[1].material_id='glitter';writeLocalRegions87(g,c);
 const {request}=requestForStage(g,'local');
 assert.equal(request.workflow_version,'8.7');assert.equal(request.edit_mode,'region_materials');assert.equal(request.count,1);
 assert.equal(request.model,'gpt-image-2.5-sunburst');assert.deepEqual([request.width,request.height],[1024,1024]);
 assert.equal(request.local_regions.groups[0].name,'外框');assert.equal(request.local_regions.groups[1].material_id,'glitter');
 assert.equal(JSON.stringify(g.nodes),before);assert.equal(g.getNodeById(201),undefined);assert.equal(g.extra.daelabBadgeLocalMaterialsV1,undefined);
 const prompt=promptForRequest({...request,apply:true});assert.equal(prompt[200].class_type,'DAELAB.BadgeApp87V1');assert.equal(prompt[113].inputs.filename_prefix,'Badge87/local');
});
test('pending regions are excluded and semantic/brush switches retain the saved correspondence',()=>{
 const {g,set}=fixture(),c=readLocalRegions87(g);c.groups[1].material_pending=true;writeLocalRegions87(g,c);
 const saved=JSON.stringify(g.extra.daelabBadgePrototypeV1.localRegions);
 assert.equal(requestForStage(g,'local').request.local_regions.groups.length,1);
 set('badge.post.local.material',false);set('badge.post.local.semantic',true);
 assert.equal(requestForStage(g,'local').request.edit_mode,'semantic');
 assert.equal(JSON.stringify(g.extra.daelabBadgePrototypeV1.localRegions),saved);
 set('badge.post.local.material',true);set('badge.post.local.semantic',false);
 assert.equal(requestForStage(g,'local').request.local_regions.groups[0].id,c.groups[0].id);
 c.groups[0].material_pending=true;writeLocalRegions87(g,c);assert.throws(()=>requestForStage(g,'local'),/至少/);
});
test('multiple samples and inversion agree with conflict visualization',()=>{
 const source=new Uint8ClampedArray([255,0,0,255,0,0,255,255,0,255,0,255]);
 const c={groups:[{id:'a',color:'#ff0000',samples:['#0000ff'],threshold:0}]};
 assert.deepEqual([...previewLocalRegions87(source,source,c,'mask','a')],[255,255,255,255,255,255,255,255,0,0,0,255]);
 c.groups[0].invert=true;assert.deepEqual([...previewLocalRegions87(source,source,c,'mask','a')].filter((_,i)=>i%4===0),[0,0,255]);
 c.groups.push({id:'b',color:'#00ff00',threshold:0});assert.equal(countRegionOverlap87(source,source,c),1);
});
test('8.7 target drafts retain region names and materials separately',()=>{
 const {g}=fixture(), n=g.getNodeById(146);n.widgets=[{name:'image',value:'target.png'}];
 g.extra.daelabBadgePrototypeV1.localTargets={source:'existing',existing:{filename:'target.png',subfolder:'',type:'input'}};
 const c=readLocalRegions87(g);c.groups[0].name='外框';writeLocalRegions87(g,c);
 setExistingTarget87(g,'other.png',{});assert.equal(g.extra.daelabBadgePrototypeV1.localRegions,null);
 setExistingTarget87(g,'target.png',{});assert.equal(readLocalRegions87(g).groups[0].name,'外框');
});

test('native localized material labels migrate without falling back to lacquer',()=>{ const {g}=fixture();g.getNodeById(106).widgets=[{name:'material_id',value:'亚金'}];assert.equal(readLocalRegions87(g).groups[0].material_id,'satin_gold'); });

test('simple layer UI ignores hidden advanced settings without mutating saved data',()=>{
 const {g}=fixture(), c=readLocalRegions87(g);
 Object.assign(c.groups[0],{samples:['#123456'],invert:true,color_policy:'material_intrinsic'});
 writeLocalRegions87(g,c);
 const stored=JSON.stringify(g.extra.daelabBadgePrototypeV1.localRegions);
 const layer=readLocalRegions87(g).groups[0];
 assert.deepEqual(layer.samples,[]);assert.ok(!layer.invert);assert.equal(layer.color_policy,'material_intrinsic');
 assert.equal(JSON.stringify(g.extra.daelabBadgePrototypeV1.localRegions),stored);
 const request=requestForStage(g,'local').request;
 assert.deepEqual(request.local_regions.groups[0].samples,[]);
 assert.equal(request.local_regions.groups[0].color_policy,'material_intrinsic');
});

test('local layer strength is fixed at 150 percent for migrated and saved configurations',()=>{
 const {g}=fixture();
 assert.ok(readLocalRegions87(g).groups.every(r=>r.material_strength===1.5));
 const c=readLocalRegions87(g);c.groups[0].material_strength=.25;
 g.extra.daelabBadgePrototypeV1.localRegions=c;
 assert.ok(requestForStage(g,'local').request.local_regions.groups.every(r=>r.material_strength===1.5));
 writeLocalRegions87(g,c);
 assert.ok(g.extra.daelabBadgePrototypeV1.localRegions.groups.every(r=>r.material_strength===1.5));
});
