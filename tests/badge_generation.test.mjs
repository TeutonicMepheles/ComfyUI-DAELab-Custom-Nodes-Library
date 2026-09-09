import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {classifyPresets, DEFAULT_CONFIG, editDimension, validateDimensions, generationParameters, readGenerationConfig, stageSnapshot, stageNodeIds} from '../web/badge_generation_model.mjs';
import {readHierarchyState} from '../web/badge_app_layout_model.mjs';
import {initializePromptOnlyBuild,isPromptOnlyBuild} from '../web/badge_generation_model.mjs';
function fixture(){
 const g=JSON.parse(readFileSync(new URL('../user/default/workflows/%238.6-UI%20-%20Badge%20App%20Mode%20Prototype.json',import.meta.url)));
 g.getNodeById=id=>g.nodes.find(n=>String(n.id)===String(id));
 for(const n of g.nodes)n.mode=0;
 const h=readHierarchyState(g.getNodeById(95));
 g.getNodeById(95).daelabBooleanHierarchyV1={getState:()=>h};
 const set=(id,value)=>{const item=h.find(i=>i.id===id);assert.ok(item,id);item.value=value};
 set('badge.post.local',true);set('badge.post.local.selection.color',true);set('badge.post.local.selection.polygon',false);set('badge.post.local.semantic',true);set('badge.post.local.material',false);
 g.getNodeById(105).widgets_values_named.value='change region';
 return {g,set};
}
test('legacy mode migrates once and persists independently of image and prompt edits',()=>{
 const {g}=fixture(), meta=g.extra.daelabBadgePrototypeV1;
 g.getNodeById(1).widgets_values_named.image=''; meta.buildPrompt='A planet';
 assert.equal(initializePromptOnlyBuild(g),true);
 g.getNodeById(1).widgets_values_named.image='retained.png'; meta.buildPrompt='';
 assert.equal(initializePromptOnlyBuild(g),true);
 assert.equal(JSON.parse(JSON.stringify(g)).extra.daelabBadgePrototypeV1.promptOnly,true);
 assert.match(stageSnapshot(g,'build').error,/基础提示词/);
 meta.promptOnly=false; assert.equal(isPromptOnlyBuild(g),false);
});
test('only supported preset combinations in 1K and 2K',()=>{
 const p=classifyPresets(['auto','Custom','3840x2160','2160x3840','1024x1024','1024x1536','1536x1024','2048x2048','2048x1152','1152x2048']);
 assert.equal(p.length,6);assert.deepEqual([...new Set(p.map(x=>x.ratio))],['1:1','2:3','3:2','16:9','9:16']);
 assert.ok(!p.some(x=>x.ratio==='16:9'&&x.tier==='1K'));
 for(const c of p)assert.equal(validateDimensions(c),'');
});
test('custom dimensions validate backend limits, locking and parameter mapping',()=>{
 for(const [width,height] of [[1024,576],[1025,1024],[3840,3840],[3840,1024],[null,1024],[NaN,1024]])assert.ok(validateDimensions({width,height}));
 const c=editDimension({...DEFAULT_CONFIG,ratio:'16:9'},'width',2560);
 assert.equal(c.height,1440);assert.equal(validateDimensions(c),'');assert.equal(generationParameters(c)['model.size'],'Custom');
 assert.equal(editDimension({...DEFAULT_CONFIG,locked:false},'width',2048).height,1024);
});
test('stage configs persist separately through workflow serialization',()=>{
 const {g}=fixture();g.extra.daelabBadgePrototypeV1.generation={build:{...DEFAULT_CONFIG,width:2048,height:2048,tier:'2K'}};
 const clone=JSON.parse(JSON.stringify(g));assert.equal(readGenerationConfig(clone,'build').width,2048);assert.equal(readGenerationConfig(clone,'local').width,1024);
});
test('local generation ignores build and studio missing images or edits',()=>{
 const {g}=fixture();const before=stageSnapshot(g,'local');assert.equal(before.error,'');
 g.getNodeById(1).widgets_values_named.image='';g.getNodeById(2).widgets_values_named.image='';g.getNodeById(147).widgets_values_named.image='';
 g.extra.daelabBadgePrototypeV1.heightBoard={test:true};g.extra.daelabBadgePrototypeV1.generation={build:{...DEFAULT_CONFIG,width:2048,height:2048}};
 assert.equal(stageSnapshot(g,'local').fingerprint,before.fingerprint);assert.equal(stageSnapshot(g,'local').error,'');assert.ok(stageSnapshot(g,'build').error);
});
test('build generation ignores local confirmation, prompts, flags and config',()=>{
 const {g,set}=fixture();const before=stageSnapshot(g,'build');assert.equal(before.error,'');
 g.getNodeById(146).widgets_values_named.image='';g.getNodeById(105).widgets_values_named.value='';set('badge.post.local.apply',true);
 g.extra.daelabBadgePrototypeV1.generation={local:{...DEFAULT_CONFIG,width:2048,height:2048}};
 assert.equal(stageSnapshot(g,'build').fingerprint,before.fingerprint);assert.equal(stageSnapshot(g,'build').error,'');
 assert.ok(!stageNodeIds(g,'build').includes(146));assert.ok(!stageNodeIds(g,'local').includes(1));
});
test('changed local config invalidates fingerprint; Apply does not; bypass is rejected and restores',()=>{
 const {g,set}=fixture();const before=stageSnapshot(g,'local');
 set('badge.post.local.apply',true);assert.equal(stageSnapshot(g,'local').fingerprint,before.fingerprint);
 g.extra.daelabBadgePrototypeV1.generation={local:{...DEFAULT_CONFIG,width:2048,height:2048,tier:'2K'}};
 assert.notEqual(stageSnapshot(g,'local').fingerprint,before.fingerprint);
 for(const mode of [2,4]){g.getNodeById(146).mode=mode;assert.match(stageSnapshot(g,'local').error,/静音或跳过/);}
 g.getNodeById(146).mode=0;assert.equal(stageSnapshot(g,'local').error,'');
});

test('stage runner flushes only its inputs and keeps independent sessions without submitting a queue',async()=>{
 const {g}=fixture();g._nodes=g.nodes;let outsideFlushes=0,insideFlushes=0;
 g.getNodeById(147).widgets=[{name:'image',value:'studio.png',beforeQueued(){outsideFlushes++}}];
 g.getNodeById(146).widgets=[{name:'image',value:'local.png',beforeQueued(){insideFlushes++}}];
 const previousDocument=globalThis.document;
 globalThis.document={querySelector:()=>null};
 globalThis.__badgeGenerationTestApp={rootGraph:g,registerExtension(){},queuePrompt(){throw new Error('No real queue allowed')}};
 let source=readFileSync(new URL('../web/badge_app_prototype.js',import.meta.url),'utf8');
 source=source.replace("import { app } from '/scripts/app.js';",'const app = globalThis.__badgeGenerationTestApp;');
 source=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../web/'+path.slice(2),import.meta.url).href}'`);
 try {
  const {run,getPrototypeSession}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  await run(g,'local');assert.equal(insideFlushes,1);assert.equal(outsideFlushes,0);assert.equal(getPrototypeSession(g,'local').phase,'preview-ready');
  const localPreview=getPrototypeSession(g,'local').preview;
  await run(g,'build');assert.equal(insideFlushes,1);assert.equal(outsideFlushes,0);assert.equal(getPrototypeSession(g,'build').phase,'complete');assert.equal(getPrototypeSession(g,'local').preview,localPreview);
 } finally {globalThis.document=previousDocument;delete globalThis.__badgeGenerationTestApp;}
});

test('removed supplementary prompt is ignored in saved configs and generation', () => {
 const {g}=fixture();
 const before=stageSnapshot(g,'build'), local=stageSnapshot(g,'local');
 g.extra.daelabBadgePrototypeV1.generation={build:{...DEFAULT_CONFIG,prompt:'Soft studio lighting'}};
 const after=stageSnapshot(g,'build');
 assert.equal(after.fingerprint,before.fingerprint);
 assert.equal(after.parameters.prompt,'');
 assert.equal(readGenerationConfig(g,'build').prompt,undefined);
 assert.equal(stageSnapshot(g,'local').fingerprint,local.fingerprint);
});

test('base prompt supports image-free build without unrelated node dependencies', () => {
 const {g,set}=fixture();
 g.getNodeById(1).widgets_values_named.image='';
 g.getNodeById(2).widgets_values_named.image='';
 g.extra.daelabBadgePrototypeV1.buildPrompt='A silver badge on a white background';
 set('badge.path.flat_height',false);
 for(const id of [1,2,3,47,49,55])g.getNodeById(id).mode=4;
 const result=stageSnapshot(g,'build');
 assert.equal(result.error,''); assert.deepEqual(stageNodeIds(g,'build'),[]);
 assert.equal(result.parameters.prompt,g.extra.daelabBadgePrototypeV1.buildPrompt);
 const local=stageSnapshot(g,'local').fingerprint;
 g.extra.daelabBadgePrototypeV1.buildPrompt='A golden badge';
 assert.notEqual(stageSnapshot(g,'build').fingerprint,result.fingerprint);
 assert.equal(stageSnapshot(g,'local').fingerprint,local);
 g.extra.daelabBadgePrototypeV1.buildPrompt='   ';
 assert.ok(stageSnapshot(g,'build').error);
});
