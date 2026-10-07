import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotHistory} from '../web/data_table_model.mjs';
import {generationReceipt} from '../web/table_generation_model.mjs';
import {emptyScriptTable,readScriptTable,importTasks,ParserRequests,assertTransition} from '../web/script_parser_model.mjs';

function imported(n=1){return {document_id:'doc1',filename:'one.docx',assets:{},unassigned:[],audit:[],paragraphs:[],tables:[],tasks:Array.from({length:n},(_,i)=>({source_key:`doc1:t1/r${i+1}`,row_id:`t1/r${i+1}`,table_id:'t1',values:{scene:'原文',notes:'备注',shot_no:''},sources:{},chapter:'章节',context:[],original_cells:[],images:[],issues:['缺原始镜号']}))};}
test('append preserves edited records/results/IDs and skips same source',()=>{
 const first=importTasks(emptyScriptTable(),imported()).table;first.records[0].values['sp-scene']='手动编辑';first.records[0].values['sp-image-result']=[{id:'kept',url:'/view?a'}];
 const before=structuredClone(first),result=importTasks(first,imported());assert.deepEqual(result.table.records,before.records);assert.equal(result.skipped,1);assert.deepEqual(first,before);
});
test('append counts existing plus incoming; rejects without mutating',()=>{
 const first=importTasks(emptyScriptTable(),imported(500)).table,other=imported();other.tasks[0].source_key='new';const before=JSON.stringify(first);
 assert.throws(()=>importTasks(first,other),/500/);assert.equal(JSON.stringify(first),before);
});
test('repeated binary appears twice in one cell in source order with distinct instance IDs',()=>{
 const n=imported();n.assets.a={id:'a',url:'/view?a',filename:'a.png'};n.tasks[0].images=[{id:'o1',asset_id:'a'},{id:'o2',asset_id:'a'}];
 const t=importTasks(emptyScriptTable(),n).table,ids=t.meta.script_parser.reference_fields;assert.equal(ids.length,1);const items=t.records[0].values[ids[0]];assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);assert.deepEqual(items.map(a=>a.provenance.occurrence_id),['o1','o2']);assert.deepEqual(readScriptTable(JSON.stringify(t)).records,JSON.parse(JSON.stringify(t.records)));
});
test('missing media or field type conflict prevents partial commit',()=>{
 const t=emptyScriptTable(),n=imported();n.tasks[0].images=[{id:'bad',asset_id:'missing'}];assert.throws(()=>importTasks(t,n),/图片准备/);assert.equal(t.records.length,0);
 t.fields.find(f=>f.id==='sp-scene').type='assets';assert.throws(()=>importTasks(t,imported()),/类型冲突/);
});
test('new file revision does not overwrite original and warns',()=>{
 const t=importTasks(emptyScriptTable(),imported()).table,n=imported();n.document_id='doc2';n.tasks[0].source_key='doc2:t1/r1';const next=importTasks(t,n);assert.equal(next.newVersion,true);assert.equal(next.table.records.length,2);
});
test('replace and history cannot bypass active job structural guard',()=>{
 const t=importTasks(emptyScriptTable(),imported()).table;t.records[0].meta.generationColumns={x:{phase:'waiting'}};
 assert.throws(()=>importTasks(t,imported(),{mode:'replace'}),/禁止替换/);assert.throws(()=>assertTransition(t,emptyScriptTable()),/任务结构/);
 t.records[0].meta.generationColumns.x.phase='pausing';assert.throws(()=>importTasks(t,imported(),{mode:'replace'}),/禁止替换/);
});
test('async stale, edit, cancel, destroy and independent instance guards',()=>{
 const a=new ParserRequests(),b=new ParserRequests(),x=a.begin('before'),y=b.begin('before');assert.equal(a.valid(x,'edited'),false);a.invalidate();assert.equal(a.valid(x,'before'),false);assert.equal(b.valid(y,'before'),true);b.destroy();assert.equal(b.valid(y,'before'),false);
 assert.equal(a.owns(x),false);const latest=a.begin('new');assert.equal(a.owns(x),false);assert.equal(a.owns(latest),true);assert.equal(b.owns(y),false);
});

test('history cannot discard active receipts, including a rerun of a completed row',()=>{
 for(const phase of ['waiting','running','queued','preparing','submitting','recovering','pausing']){
  const before=importTasks(emptyScriptTable(),imported()).table,field='sp-image-result';
  const input={recordId:before.records[0].id,config:{model:'Lib Image'},prompt:'scene'};
  before.records[0].meta.generationColumns={[field]:{requestId:'previous',input,phase:'complete'}};
  const current=structuredClone(before),history=new SnapshotHistory();
  current.records[0].meta.generationColumns[field]=generationReceipt({requestId:'active',input});
  current.records[0].meta.generationColumns[field].phase=phase;
  history.record(JSON.stringify(before),JSON.stringify(current));
  const pending=JSON.parse(history.undoStack.at(-1));
  assert.throws(()=>assertTransition(current,pending,{restoring:true}),/任务凭据/);
  delete pending.records[0].meta.generationColumns;
  assert.throws(()=>assertTransition(current,pending,{restoring:true}),/任务凭据/);
  assert.throws(()=>importTasks(current,imported(),{mode:'replace'}),/禁止替换/);
  assert.equal(current.records[0].meta.generationColumns[field].requestId,'active');
  assert.equal(history.undoStack.length,1);
 }
});

test('active receipt protection allows text history and real status updates, not phase rollback',()=>{
 const current=importTasks(emptyScriptTable(),imported()).table,field='sp-image-result';
 current.records[0].meta.generationColumns={[field]:{requestId:'active',stamp:'stamp',input:{prompt:'original'},phase:'running'}};
 const edited=structuredClone(current);edited.records[0].values['sp-scene']='edited';
 assert.doesNotThrow(()=>assertTransition(current,edited,{restoring:true}));
 for(const phase of ['complete','failed','paused','needs_recovery','stale','waiting']){
  const next=structuredClone(current);next.records[0].meta.generationColumns[field].phase=phase;
  assert.doesNotThrow(()=>assertTransition(current,next));
  assert.throws(()=>assertTransition(current,next,{restoring:true}),/任务凭据/);
 }
 for(const key of ['requestId','stamp','input','forceNew']){
  const next=structuredClone(current);next.records[0].meta.generationColumns[field][key]=key==='forceNew'?true:'changed';
  assert.throws(()=>assertTransition(current,next),/任务凭据/);
 }
 const independent=importTasks(emptyScriptTable(),imported()).table;
 assert.doesNotThrow(()=>assertTransition(independent,emptyScriptTable(),{restoring:true}));
});

test('parser panel resolves shared module exports after table integration',async()=>{const panel=await import('../web/script_parser_panel.mjs');assert.equal(typeof panel.createScriptParserPanel,'function');});
