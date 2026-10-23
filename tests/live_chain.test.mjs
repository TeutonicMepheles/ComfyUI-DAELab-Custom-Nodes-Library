import test from 'node:test';
import assert from 'node:assert/strict';
import {readTableView,readTableSnapshot} from '../web/table_exchange.mjs';
import {slotRows,slotSignature,appliedSnapshot} from '../web/llm_slot_model.mjs';
import {createVideoTasks} from '../web/video_tasks_model.mjs';
import {syncApprovedTaskRows} from '../web/video_task_rows.mjs';

const image={id:'image-a',url:'/view?filename=a.png&type=input',kind:'image',name:'a'};
function fixture(){
 const raw={fields:[{id:'text',type:'content'},{id:'image',type:'content'}],records:[{id:'one',values:{text:'first',image:[image]}},{id:'two',values:{text:'second',image:[image]}}],meta:{material_columns:true}};
 const parser={id:1,type:'DAELAB.ScriptParser',widgets:[{name:'table_data',value:JSON.stringify(raw)}]};
 const local=structuredClone(raw);local.records.forEach((r,i)=>r.selected=i===0);
 const table={id:2,type:'DAELAB.Table',inputs:[{name:'source_table',link:1}],widgets:[{name:'table_data',value:JSON.stringify(local)}]};
 const llm={id:3,type:'DAELAB.LLMStylePreviewB',inputs:[{link:2}],properties:{llmStylePreview:{}}};
 const graph={links:{1:{origin_id:1,origin_slot:0},2:{origin_id:2,origin_slot:0}},getNodeById:id=>[parser,table,llm].find(n=>n.id===id)};
 for(const node of [parser,table,llm])node.graph=graph;
 const approve=()=>{llm.properties.llmStylePreview.appliedIO={complete:true,signature:slotSignature(llm),rows:slotRows(llm).map(r=>({...r,result:'optimized '+r.text}))};return appliedSnapshot(llm);};
 return {parser,table,llm,approve};
}
test('parser changes propagate through selection and invalidate approval without replacing result',()=>{
 const {parser,table,llm,approve}=fixture();const snapshot=approve();
 assert.equal(readTableView(table).records.length,2);assert.equal(snapshot.rows.length,1);assert.deepEqual(snapshot.rows[0].image,image);
 const data=JSON.parse(parser.widgets[0].value);data.records[0].values.text='edited';parser.widgets[0].value=JSON.stringify(data);
 assert.equal(readTableSnapshot(table).records[0].values.text,'edited');assert.equal(appliedSnapshot(llm).ready,false);
 assert.equal(llm.properties.llmStylePreview.appliedIO.rows[0].result,'optimized first');
});
test('selection change, detach, mode and cycles fail closed; undo restores approval',()=>{
 const {parser,table,llm,approve}=fixture();approve();const original=table.widgets[0].value;
 const local=JSON.parse(original);local.records[1].selected=true;table.widgets[0].value=JSON.stringify(local);assert.equal(appliedSnapshot(llm).ready,false);
 table.widgets[0].value=original;assert.equal(appliedSnapshot(llm).ready,true);
 table.widgets[0].value=JSON.stringify(readTableView(table));table.inputs[0].link=null;assert.throws(()=>slotRows(llm),/断开/);
 table.inputs[0].link=1;parser.mode=4;assert.throws(()=>slotRows(llm),/不可用/);parser.mode=0;
 table.graph.links[1].origin_id=2;assert.throws(()=>slotRows(llm),/循环/);
});
test('two table instances keep independent selections and serialize/reload identical approvals',()=>{
 const a=fixture(),b=fixture();const data=JSON.parse(b.table.widgets[0].value);data.records.forEach(r=>r.selected=true);b.table.widgets[0].value=JSON.stringify(data);
 a.approve();b.approve();assert.equal(appliedSnapshot(a.llm).rows.length,1);assert.equal(appliedSnapshot(b.llm).rows.length,2);
 a.table.widgets[0].value=JSON.stringify(readTableView(a.table));assert.equal(appliedSnapshot(a.llm).ready,true);
});
test('generation keeps receipts, results and model settings across selection and restoration',()=>{
 const {approve}=fixture(),snapshot=approve(),state=createVideoTasks();
 syncApprovedTaskRows(state,snapshot);const row=state.table.records[0],result=[{kind:'video',url:'/view?filename=paid.mp4&type=output'}];
 row.values[state.fieldId]=result;row.meta.generationColumns={[state.fieldId]:{phase:'complete',task_id:'paid-once'}};
 const receipt=structuredClone(row.meta.generationColumns),settings=structuredClone(state.table.fields.find(f=>f.id===state.fieldId).generation);
 syncApprovedTaskRows(state,{version:1,ready:true,rows:[{id:'two',text:'second',image:null}]});assert.deepEqual(state.archivedTasks.find(r=>r.id===row.id).values[state.fieldId],result);
 syncApprovedTaskRows(state,snapshot);assert.deepEqual(state.table.records[0].values[state.fieldId],result);assert.deepEqual(state.table.records[0].meta.generationColumns,receipt);
 assert.deepEqual(state.table.fields.find(f=>f.id===state.fieldId).generation,settings);
 const saved=JSON.stringify(state);assert.throws(()=>syncApprovedTaskRows(state,{ready:false}),/等待/);assert.equal(JSON.stringify(state),saved);
});
test('running tasks and invalid row sets cannot be replaced',()=>{
 const state=createVideoTasks(),snapshot={version:1,ready:true,rows:[{id:'one',text:'one',image:null}]};syncApprovedTaskRows(state,snapshot);
 state.table.records[0].meta.generationColumns={[state.fieldId]:{phase:'running'}};
 assert.throws(()=>syncApprovedTaskRows(state,snapshot),/正在运行/);
 assert.throws(()=>syncApprovedTaskRows(state,{...snapshot,rows:[...snapshot.rows,...snapshot.rows]}),/镜头 ID/);
});
