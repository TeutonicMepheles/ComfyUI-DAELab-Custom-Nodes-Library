import test from 'node:test';
import assert from 'node:assert/strict';
import {newStoryboardTable,writeGenerationResults} from '../web/storyboard_table_adapter.mjs';
import {addRecord} from '../web/data_table_model.mjs';
import {storyboardTaskState,selectedTaskSummary} from '../web/storyboard_task_state.mjs';

test('preflight marks missing cells and counts only selected records',()=>{
 const table=newStoryboardTable(),a=addRecord(table),b=addRecord(table,{image_prompt:'A landscape'});a.selected=false;
 assert.equal(storyboardTaskState(table,a).key,'invalid');assert.equal(selectedTaskSummary(table).invalid,0);
 table.meta.asset_groups=[{id:'g',field_id:'ref',name:'场景'}];table.fields.push({id:'ref',type:'assets',name:'场景',video_reference:true});
 assert.equal(storyboardTaskState(table,b).issues[0].field,'ref');
 b.values.ref=[{url:'/view?filename=ref.png'}];assert.equal(storyboardTaskState(table,b).key,'ready');
});
test('task status follows stable ID; unchanged report cannot erase modified-input warning',()=>{
 const table=newStoryboardTable(),row=addRecord(table,{image_prompt:'Original'});
 const report={batch_id:'b',rows:[{shot_id:row.id,phase:'running'}]};writeGenerationResults(table,report);
 assert.equal(storyboardTaskState(table,row).key,'running');
 report.rows[0].phase='complete';writeGenerationResults(table,report);assert.equal(storyboardTaskState(table,row).key,'complete');
 row.values.image_prompt='Changed';writeGenerationResults(table,report);assert.equal(storyboardTaskState(table,row).key,'changed');
 report.batch_id='new';writeGenerationResults(table,report);assert.equal(storyboardTaskState(table,row).key,'complete');
});
test('recovery error remains visible and renamed prompt keeps its role',()=>{
 const table=newStoryboardTable(),row=addRecord(table,{image_prompt:'Original'});table.fields.find(f=>f.id==='image_prompt').name='新的列名';
 writeGenerationResults(table,{batch_id:'b',rows:[{shot_id:row.id,phase:'needs_recovery',error:'检查远程任务状态'}]});
 const state=storyboardTaskState(table,row);assert.equal(state.key,'recovery');assert.equal(state.hint,'检查远程任务状态');
});
