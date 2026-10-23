import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable,removeField,SnapshotHistory,setValue,addField} from '../web/data_table_model.mjs';
import {setPromptSource,promptSourceId,requirePromptSource} from '../web/table_prompt_source.mjs';
import {effectivePrompt,resolveColumnPrompt,toColumnPrompt,setColumnTemplate} from '../web/table_prompt_template.mjs';
import {columnReferenceOptions} from '../web/table_reference_menu.mjs';
import {importVideoTasks,syncVideoTaskInputs,selectTaskPrompt} from '../web/video_tasks_model.mjs';
import {generationInput} from '../web/table_generation_model.mjs';

const template=()=>({kind:'column-template',version:1,segments:[{type:'column',fieldId:'scene',valueType:'text'},{type:'column',fieldId:'motion',valueType:'text'},{type:'text',text:'保持写实风格。'}]});
const fixture=()=>normalizeTable({fields:[{id:'scene',name:'画面描述',type:'json',presentation:'prompt'},{id:'motion',name:'镜头运动',type:'text'},{id:'final',name:'最终描述',type:'json',presentation:'prompt'}],records:[{id:'r1',name:'任务1',values:{scene:toColumnPrompt('地球在左。'),motion:'向前推进。',final:template()}},{id:'r2',name:'任务2',values:{scene:toColumnPrompt('卫星在右。'),motion:'向右横移。',final:template()}}]});
const text=input=>input.segments.map(s=>s.text).join('');

test('legacy order/names are not bindings; explicit old binding migrates once and conflicts do not guess',()=>{
 const t=fixture();assert.equal(promptSourceId(t),null);assert.throws(()=>importVideoTasks(t,'scene'),/列头/);
 delete t.meta.generationInput;t.meta.prompt_config={bindings:{final_prompt:'final'}};
 const migrated=normalizeTable(t);assert.equal(promptSourceId(migrated),'final');assert.deepEqual(migrated.records,t.records);
 setPromptSource(migrated,null);assert.equal(promptSourceId(normalizeTable(migrated)),null);
 t.fields.push({id:'result',type:'content',presentation:'generation',generation:{promptFieldId:'scene'}});
 assert.equal(promptSourceId(normalizeTable(t)),null);
});

test('one binding transfers, copies do not claim it, deletion/undo/redo and serialization retain identity',()=>{
 let t=fixture();setPromptSource(t,'final');const original=JSON.stringify(t),history=new SnapshotHistory();
 setPromptSource(t,'scene');history.record(original,JSON.stringify(t));assert.equal(promptSourceId(t),'scene');assert.deepEqual(t.records[0].values.final,template());
 t=history.restore(JSON.stringify(t));assert.equal(promptSourceId(t),'final');
 t=history.restore(JSON.stringify(t),true);assert.equal(promptSourceId(t),'scene');
 const copied=addField(t,{...t.fields[0],id:'copied'});assert.equal(promptSourceId(t),'scene');assert.equal(copied.presentation,'prompt');
 const before=JSON.stringify(t);removeField(t,'scene');history.record(before,JSON.stringify(t));assert.equal(promptSourceId(normalizeTable(t)),null);
 t=history.restore(JSON.stringify(t));assert.equal(requirePromptSource(t).id,'scene');assert.equal(t.records[0].values.scene.segments[0].text,'地球在左。');
});

test('same-row text expansion matches imported generation input and survives rename/reorder/reload',()=>{
 const source=fixture();setPromptSource(source,'final');source.fields.reverse();source.records.reverse();source.fields.find(f=>f.id==='scene').name='画面（重命名）';
 const state=importVideoTasks(source,'motion');assert.equal(state.table.meta.generationInput.promptFieldId,'final');
 assert.equal(typeof state.table.records[0].values.motion,'string');
 for(const row of source.records){const expected=text(resolveColumnPrompt(row.values.final,source,row,'final'));assert.equal(text(generationInput(state.table,state.fieldId,row.id)),expected);}
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(generationInput(restored.table,restored.fieldId,'r1'),generationInput(state.table,state.fieldId,'r1'));
 assert.throws(()=>selectTaskPrompt(state,'r1','motion'),/列头/);
});

test('text picker supports old literal documents; nested, empty, deleted and converted sources fail explicitly',()=>{
 const t=fixture(),row=t.records[0];setPromptSource(t,'final');
 const choices=columnReferenceOptions(t,row);assert.deepEqual(choices.map(f=>f.id),['scene','motion']);assert.equal(choices[0].textPreview,'地球在左。');
 row.values.scene=template();assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/嵌套/);
 row.values.scene=toColumnPrompt('');assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/任务1.*缺少文字.*画面描述/);
 row.values.scene=toColumnPrompt('恢复');removeField(t,'motion');assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/已删除或类型已变化/);
 const self={...template(),segments:[{type:'column',fieldId:'final',valueType:'text'}]};assert.throws(()=>resolveColumnPrompt(self,t,row,'final'),/自身/);
 const f=t.fields.find(f=>f.id==='scene');f.type='content';delete f.presentation;row.values.scene=[{id:'a',url:'/view?filename=a.png'}];assert.throws(()=>resolveColumnPrompt(template(),t,row,'final'),/类型已变化/);
});

test('source updates preserve submitted snapshots/results, and clearing designation blocks new export',()=>{
 const source=fixture();setPromptSource(source,'final');const state=importVideoTasks(source),row=state.table.records[0];
 const receipt={phase:'complete',input:generationInput(state.table,state.fieldId,row.id),requestId:'saved'};row.meta.generationColumns={[state.fieldId]:structuredClone(receipt)};row.values[state.fieldId]=[{id:'done',url:'/view?filename=done.png'}];
 const next=structuredClone(source);next.records[0].values.motion='拉远。';syncVideoTaskInputs(state,next,source);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'地球在左。拉远。保持写实风格。');
 assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);assert.equal(row.values[state.fieldId][0].id,'done');
 const changed=structuredClone(next);setPromptSource(changed,'motion');syncVideoTaskInputs(state,changed,next);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'拉远。');
 const cancelled=structuredClone(changed);setPromptSource(cancelled,null);syncVideoTaskInputs(state,cancelled,changed);assert.throws(()=>generationInput(state.table,state.fieldId,row.id),/列头/);
 syncVideoTaskInputs(state,changed,cancelled);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'拉远。');assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);
});

test('deleted source rows block new input, retain receipts and recover when the source row returns',()=>{
 const source=fixture();setPromptSource(source,'final');const state=importVideoTasks(source),row=state.table.records[0];
 const receipt={phase:'complete',input:generationInput(state.table,state.fieldId,row.id),requestId:'saved'};
 row.meta.generationColumns={[state.fieldId]:structuredClone(receipt)};row.values[state.fieldId]=[{id:'done',url:'/view?filename=done.png'}];
 const deleted=structuredClone(source);deleted.records=deleted.records.filter(r=>r.id!==row.id);syncVideoTaskInputs(state,deleted,source);
 assert.throws(()=>generationInput(state.table,state.fieldId,row.id),/任务行已删除/);
 assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);assert.equal(row.values[state.fieldId][0].id,'done');
 syncVideoTaskInputs(state,source,deleted);assert.equal(text(generationInput(state.table,state.fieldId,row.id)),'地球在左。向前推进。保持写实风格。');
 assert.equal(row.meta.generationSourceMissing,undefined);assert.deepEqual(row.meta.generationColumns[state.fieldId],receipt);
});

test('explicit clear differs from inheriting a column template, and pasted @ stays literal',()=>{
 const t=fixture(),row=t.records[0];setPromptSource(t,'final');setColumnTemplate(t,'final',template(),{replaceRows:true});
 assert.equal(text(resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final')),'地球在左。向前推进。保持写实风格。');
 setValue(t,row.id,'final','');assert.throws(()=>resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final'),/为空/);
 row.values.final='';assert.equal(effectivePrompt(t,row,'final'),t.fields.find(f=>f.id==='final').promptTemplate);
 setValue(t,row.id,'final','@画面描述');assert.equal(text(resolveColumnPrompt(effectivePrompt(t,row,'final'),t,row,'final')),'@画面描述');
});
