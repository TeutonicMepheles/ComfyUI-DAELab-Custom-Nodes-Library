import test from 'node:test';
import assert from 'node:assert/strict';
import {isTableSource,readTableSnapshot,writeTablePrompts} from '../web/table_exchange.mjs';
import {promptContent} from '../web/table_prompt_template.mjs';
import {importVideoTasks,syncVideoTaskInputs} from '../web/video_tasks_model.mjs';
import {generationInput,LOCAL_VIDEO_MODEL,setRowGenerationConfig} from '../web/table_generation_model.mjs';
import {generationParameterModes,generationModes} from '../web/table_prompt_settings.mjs';
import {frameReferenceOptions} from '../web/table_reference_menu.mjs';
import {bindLinkedTaskReference} from '../web/video_task_linked_prompt.mjs';

function sourceNode(type='DAELAB.ScriptParser'){
 const table={fields:[{id:'shot',name:'镜号',type:'text'},{id:'scene',name:'画面',type:'text'},{id:'media',name:'图片',type:'content'},
  {id:'prompt',name:'拼接',type:'json',presentation:'prompt',promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:'shot',valueType:'text'},{type:'text',text:'的运镜下，呈现'},{type:'column',fieldId:'scene',valueType:'text'}]}}],
  records:['1','2'].map(id=>({id,values:{shot:id,scene:'画面'+id,prompt:'',media:[{id:'a'+id,kind:'image',url:'/view?filename=a'+id+'.png'},{id:'b'+id,kind:'image',url:'/view?filename=b'+id+'.png'}]}})),meta:{generationInput:{version:1,promptFieldId:'prompt'}}};
 const data={name:'table_data',value:JSON.stringify(table)};
 const editor={change(update){const t=JSON.parse(data.value);update(t);data.value=JSON.stringify(t);},refreshCells(){}};
 return {type,mode:0,widgets:[data],[type==='DAELAB.ScriptParser'?'__scriptPanel':'__dataTablePanel']:{editor}};
}

test('parser and generic table export the same row-expanded template into generation input',()=>{
 for(const type of ['DAELAB.ScriptParser','DAELAB.Table']){
  const n=sourceNode(type);assert(isTableSource(n));
  const state=importVideoTasks(readTableSnapshot(n));
  for(const row of state.table.records)assert.equal(generationInput(state.table,state.fieldId,row.id).segments.map(s=>s.text).join(''),row.id+'的运镜下，呈现画面'+row.id);
 }
 assert.equal(isTableSource({type:'Unrelated'}),false);
});

test('frame bindings survive writeback to a source without generation column, two instances, reload and re-import',()=>{
 for(const type of ['DAELAB.Table','DAELAB.ScriptParser']){
  const n=sourceNode(type),before=readTableSnapshot(n),a=importVideoTasks(before),b=importVideoTasks(before);
  const segments=[...['first','last'].map((role,i)=>({type:'frame',role,generationFieldId:a.fieldId,binding:{fieldId:'media',assetId:(i?'b':'a')+'1'}})),{type:'text',text:'连续镜头'}];
  writeTablePrompts(n,[{recordId:'1',fieldId:'prompt',expected:promptContent(before,before.records[0],'prompt'),segments}]);
  const source=readTableSnapshot(n);
  for(const state of [a,b]){
   syncVideoTaskInputs(state,source,before);
   const input=generationInput(state.table,state.fieldId,'1');
   assert.equal(input.config.mode,'frames2video');assert.deepEqual(input.assets.map(a=>a.id),['a1','b1']);
   const saved=JSON.parse(JSON.stringify(state));assert.deepEqual(generationInput(saved.table,saved.fieldId,'1'),input);
  }
  const reimport=importVideoTasks(source);assert.deepEqual(generationInput(reimport.table,reimport.fieldId,'1').assets.map(a=>a.id),['a1','b1']);
  assert.deepEqual(source.records[1],before.records[1]);
 }
});

test('local FL modes remain separate and unsupported saved modes are not offered or submitted',()=>{
 const modes=['text2video','singleImage2video','frames2video'];
 const schema={properties:{modeType:{items:Object.fromEntries(modes.map(m=>[m,[]]))}},config:{strictModes:true}};
 const config={kind:'video',model:LOCAL_VIDEO_MODEL,mode:'mixed2video'};
 assert.deepEqual(generationParameterModes(config,schema),modes);assert.deepEqual(generationModes(schema,'video'),modes);assert.equal(config.mode,'mixed2video');
 const s=importVideoTasks(readTableSnapshot(sourceNode())),f=s.table.fields.find(f=>f.id===s.fieldId);
 setRowGenerationConfig(s.table.records[0],s.fieldId,{...f.generation,model:LOCAL_VIDEO_MODEL,mode:'mixed2video'});
 assert.throws(()=>generationInput(s.table,s.fieldId,'1'),/仅支持/);
});

test('frame picker excludes text, video and audio while retaining image identity and ordinal',()=>{
 const t=readTableSnapshot(sourceNode()),row=t.records[0];
 row.values.media.unshift({id:'v',kind:'video',url:'/view?filename=v.mp4'});
 row.values.media.push({id:'sound',kind:'audio',url:'/view?filename=s.wav'});
 const options=frameReferenceOptions(t,row,'result');assert.equal(options.length,1);
 assert.deepEqual(options[0].children.map(o=>[o.asset.id,o.assetIndex]),[['a1',1],['b1',2]]);
 assert.deepEqual(frameReferenceOptions(t,row,'media'),[]);
});

test('local FL rejects reference ports without silently assigning frames or changing the prompt',()=>{
 const s=importVideoTasks(readTableSnapshot(sourceNode())),f=s.table.fields.find(f=>f.id===s.fieldId),row=s.table.records[0];
 const before=JSON.stringify(row);
 assert.throws(()=>bindLinkedTaskReference(s.table,row,s.fieldId,{...f.generation,model:LOCAL_VIDEO_MODEL},s.table.fields.find(f=>f.id==='media')),/首帧／尾帧接口/);
 assert.equal(JSON.stringify(row),before);
});
