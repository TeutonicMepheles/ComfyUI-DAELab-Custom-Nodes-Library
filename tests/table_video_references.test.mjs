import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable,addField,SnapshotHistory} from '../web/data_table_model.mjs';
import {videoReferenceFields,setVideoReference} from '../web/table_video_references.mjs';
import {promptAssets,resolvePromptAsset,promptText,sourceStamp,PromptRequests,applyPromptResults,promptState} from '../web/table_prompt_model.mjs';
import {storyboardTaskState} from '../web/storyboard_task_state.mjs';
import {newStoryboardTable,readStoryboard,serializeStoryboardTable,importRows} from '../web/storyboard_table_adapter.mjs';
function fixture(){return normalizeTable({fields:['p','a','g','other','v'].map(id=>({id,name:id,type:id==='p'?'longtext':'assets'})),records:[{id:'r',values:{p:'scene',...Object.fromEntries(['a','g','other','v'].map(id=>[id,[{id:'asset-'+id,url:'/view?filename='+id+'.png'}]]))}}],meta:{storyboard:{bindings:{image_prompt:'p',image_url:'a',video_result:'v'}},asset_groups:[{id:'group',field_id:'g',required:true}]}});}

test('visible references resolve by asset and field identity even when not selected for generation',()=>{
 const t=fixture(),row=t.records[0],ref={refId:'ref-a',assetId:'asset-a',fieldId:'a',included:true};
 row.values.a[0].name='可见素材';setVideoReference(t,'a',false);
 const doc={version:1,compilerVersion:1,segments:[{type:'ref',refId:'ref-a'}],references:[ref]};
 applyPromptResults(t,[{recordId:row.id,document:doc}]);
 assert.equal(resolvePromptAsset(t,row,ref).name,'可见素材');assert.equal(promptText(doc,t,row),'@可见素材');
 assert.match(promptState(t,row).error,/未选为生成参考/);assert(!promptAssets(t,row).some(a=>a.id==='asset-a'));
 assert.equal(resolvePromptAsset(t,row,{...ref,fieldId:'other'}),undefined);
 row.values.a=[];assert.equal(resolvePromptAsset(t,row,ref),undefined);assert.equal(promptText(doc,t,row),'@失效引用');
});
test('legacy asset-to-content migration retains reference selection without overriding explicit exclusions',()=>{
 const raw={fields:[{id:'a',type:'assets'},{id:'b',type:'assets',video_reference:false}],records:[{id:'r',values:{a:[{id:'original',url:'/view?filename=a.png'}],b:[]}}],meta:{material_columns:true,prompt_config:{bindings:{image_url:'a'}},asset_groups:[{field_id:'b'}]}};
 const t=normalizeTable(raw);assert.equal(t.fields[0].type,'content');assert.deepEqual(videoReferenceFields(t).map(f=>f.id),['a']);assert.equal(t.records[0].values.a[0].id,'original');assert.equal(t.fields[1].video_reference,false);assert.deepEqual(normalizeTable(t),t);
});
test('old assigned columns migrate visibly; new columns and video output default unmarked',()=>{const t=fixture();assert.deepEqual(videoReferenceFields(t).map(f=>f.id),['a','g']);assert.equal(t.fields.find(f=>f.id==='other').video_reference,false);const f=addField(t,{type:'assets'});assert.equal(f.video_reference,false);assert.deepEqual(normalizeTable(t),t);});
test('explicit empty selection never falls back to mapped assets or groups',()=>{const t=fixture();setVideoReference(t,'a',false);setVideoReference(t,'g',false);assert.deepEqual(promptAssets(t,t.records[0]),[]);assert.deepEqual(videoReferenceFields(readStoryboard(serializeStoryboardTable(t))),[]);assert(t.records[0].values.a.length);assert.throws(()=>setVideoReference(t,'v',true));});
test('ordinary and readonly image columns can be marked; order follows primary then table order',()=>{const t=fixture();t.fields.find(f=>f.id==='other').readonly=true;setVideoReference(t,'other',true);assert.deepEqual(promptAssets(t,t.records[0]).map(a=>a.fieldId),['a','g','other']);t.fields.reverse();assert.deepEqual(promptAssets(t,t.records[0]).map(a=>a.fieldId),['a','other','g']);});
test('toggle invalidates parsed references and in-flight results; undo restores data and selection',()=>{const t=fixture(),r=t.records[0];applyPromptResults(t,[{recordId:r.id,document:{version:1,compilerVersion:1,segments:[{type:'text',text:'scene'}],references:[{refId:'r-a',assetId:'asset-a',fieldId:'a',included:true}]}}]);const h=new SnapshotHistory(),before=JSON.stringify(t),q=new PromptRequests(),token=q.begin(t,['r']);setVideoReference(t,'a',false);h.record(before,JSON.stringify(t));assert.equal(promptState(t,r).key,'invalid');assert.equal(q.matches(t,token,'r'),false);const old=h.restore(JSON.stringify(t));assert.equal(promptState(old,old.records[0]).key,'parsed');assert.deepEqual(old.records,t.records);});
test('unmarked missing required group and edits do not affect video eligibility',()=>{const t=fixture(),r=t.records[0];setVideoReference(t,'g',false);r.values.g=[];assert.equal(storyboardTaskState(t,r).key,'ready');const stamp=sourceStamp(t,r);r.values.g=[{url:'invalid-unsubmitted-url'}];assert.equal(sourceStamp(t,r),stamp);setVideoReference(t,'g',true);r.values.g=[];assert.equal(storyboardTaskState(t,r).key,'invalid');});
test('import preserves unmarked source data and selection',()=>{const t=newStoryboardTable();importRows(t,{shots:[{id:'r',image_prompt:'scene',image_url:'/view?filename=a.png'}]},'append');setVideoReference(t,'image_url',false);const before=structuredClone(t.records[0]);importRows(t,{shots:[{id:'r2',image_prompt:'next'}]},'append');assert.deepEqual(t.records[0],before);assert.equal(t.fields.find(f=>f.id==='image_url').video_reference,false);});
