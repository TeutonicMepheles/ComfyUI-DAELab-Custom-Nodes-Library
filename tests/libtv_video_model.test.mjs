import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVideoDraft,videoIdentity,videoResultAssets} from '../web/libtv_video_model.mjs';
import {materialItem} from '../web/table_material_item.mjs';
const valid={project_uuid:'project',request_id:'a',model:'model',prompt:'hello',duration:5,reference_files:'[]',mode:'text2video',resolution:'720p',ratio:'16:9'};
test('preflight accepts linked text and blocks malformed media, frames and capabilities',()=>{
 assert.equal(validateVideoDraft({...valid,prompt:''},['text_input']),true);
 assert.throws(()=>validateVideoDraft({...valid,prompt:''}),/文本/);
 assert.throws(()=>validateVideoDraft({...valid,reference_files:'{}'}),/数组/);
 assert.throws(()=>validateVideoDraft(valid,['last_frame']),/首帧/);
 assert.throws(()=>validateVideoDraft({...valid,reference_files:'["a.png"]'}),/文生/);
 assert.throws(()=>validateVideoDraft({...valid,duration:5.5}),/整数/);
 assert.throws(()=>validateVideoDraft(valid,[],{model:'model',duration:{enum:[4,8]}}),/时长/);
 assert.throws(()=>validateVideoDraft(valid,[],{model:'changed'}),/模型/);
});
test('result identity hides a previous request after editing or copying',()=>{
 const node={title:'shot',widgets:Object.entries(valid).map(([name,value])=>({name,value})),properties:{daelabLibTVResult:'/view?filename=result.mp4&type=output'}};
 assert.equal(videoResultAssets(node).ready,true);node.properties.daelabLibTVResultIdentity=videoIdentity(node);
 assert.equal(videoResultAssets(node).assets[0].name,'shot');node.widgets.find(w=>w.name==='request_id').value='b';
 assert.equal(videoResultAssets(node).ready,false);
});
test('single material export uses stable identities, preserves source and detects deletion',()=>{
 const asset={id:'a',url:'/view?filename=a.png&type=input',kind:'image',name:'A'},table={records:[{id:'r',values:{f:[asset]}}]};
 const before=JSON.stringify(table),key=JSON.stringify(['r','f','a']);
 assert.equal(materialItem(table,key).assets.length,1);assert.equal(JSON.stringify(table),before);
 delete asset.kind;assert.equal(materialItem(table,key).assets[0].kind,'image');
 assert.equal(materialItem(table,'bad'),null);table.records[0].values.f=[];assert.equal(materialItem(table,key),null);
});
