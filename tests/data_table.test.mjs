import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable,addField,removeField,addRecord,reorder,transferValue,parseTSV,encodeTSV,pasteMatrix,SnapshotHistory} from '../web/data_table_model.mjs';
import {newStoryboardTable,readStoryboard,projectStoryboard,serializeStoryboardTable,importRows,writeGenerationResults} from '../web/storyboard_table_adapter.mjs';
import {addAssetGroup,applyAssetGroups} from '../web/data_table_groups.mjs';

test('quoted clipboard roundtrip and invalid typed paste are atomic',()=>{
 const t=normalizeTable({fields:[{id:'text',type:'text'},{id:'n',type:'number'}],records:[{id:'r',values:{text:'old',n:1}}]});
 const matrix=[['a\tb\n"c"',3],['two',4]];pasteMatrix(t,'r','text',parseTSV(encodeTSV(matrix)));
 assert.equal(t.records.length,2);assert.deepEqual(t.records.map(r=>Object.values(r.values)),matrix);
 const before=JSON.stringify(t);assert.throws(()=>pasteMatrix(t,'r','text',[['overwrite','invalid']]));assert.equal(JSON.stringify(t),before);
});
test('fields, assets and whole records share stable identities and snapshot undo',()=>{
 const t=newStoryboardTable(),r=addRecord(t,{image_prompt:'one'}),other=addRecord(t,{image_prompt:'two'});
 const before=JSON.stringify(t),h=new SnapshotHistory();reorder(t.records,other.id,r.id);transferValue(t,{record:r.id,field:'image_prompt'},{record:other.id,field:'image_prompt'});
 h.record(before,JSON.stringify(t));assert.equal(t.records[0].id,other.id);assert.equal(t.records[0].values.image_prompt,'one');assert.deepEqual(h.restore(JSON.stringify(t)),JSON.parse(before));
});
test('moving between select fields validates both destination option sets atomically',()=>{
 const t=normalizeTable({fields:[{id:'a',type:'select',options:['one']},{id:'b',type:'select',options:['two']}],records:[{id:'r',values:{a:'one',b:'two'}}]});
 const before=JSON.stringify(t);assert.throws(()=>transferValue(t,{record:'r',field:'a'},{record:'r',field:'b'}));assert.equal(JSON.stringify(t),before);
});
test('legacy migration retains source, hidden raw fields, bindings survive rename/reorder',()=>{
 const t=readStoryboard({schema_version:3,shots:[{id:'s1',image_prompt:'mountain',original_fields:[{name:'旁白',value:'do not prompt'}],source:{table:2}}]});
 const f=t.fields.find(f=>f.id==='image_prompt');f.name='创作要求';reorder(t.fields,'image_prompt','shot_no');
 assert.equal(projectStoryboard(t).shots[0].image_prompt,'mountain');assert.equal(t.records[0].values.source.table,2);assert(t.fields.find(f=>f.id==='original_fields').hidden);
 assert.deepEqual(readStoryboard(serializeStoryboardTable(t)),t);
});
test('groups use ordinary asset fields; DOCX append never duplicates group columns',()=>{
 const t=newStoryboardTable(),g=addAssetGroup(t);g.items=[{id:'a',url:'/view?filename=a.png',name:'a'}];applyAssetGroups(t);
 const id=g.field_id,count=t.fields.length;importRows(t,{shots:[{id:'import',image_prompt:'new'}]},'append');
 assert.equal(t.fields.length,count);assert.equal(t.meta.asset_groups[0].field_id,id);assert.equal(projectStoryboard(t).shots[0].group_refs[g.id][0].id,'a');
 removeField(t,id);assert.equal(t.meta.asset_groups.length,0);
});
test('generic group validation is atomic before allocating new rows',()=>{
 const t=normalizeTable({fields:[],records:[]}),a=addAssetGroup(t),b=addAssetGroup(t);a.items=[{url:'/view?a'}];b.items=[{url:'/view?b'},{url:'/view?c'}];
 const before=JSON.stringify(t);assert.throws(()=>applyAssetGroups(t));assert.equal(JSON.stringify(t),before);
});
test('result backfill follows stable record ID after reorder; deleted mapped fields stay deleted',()=>{
 const t=newStoryboardTable(),a=addRecord(t),b=addRecord(t);reorder(t.records,b.id,a.id);writeGenerationResults(t,{rows:[{shot_id:a.id,phase:'complete',url:'/view?filename=result.mp4'}]});
 assert.equal(t.records[1].values.generation_status,'已完成');assert.equal(t.records[0].values.generation_status,undefined);
 removeField(t,'generation_status');writeGenerationResults(t,{rows:[{shot_id:a.id,phase:'running'}]});assert(!t.fields.some(f=>f.id==='generation_status'));
 removeField(t,'image_prompt');assert.throws(()=>importRows(t,{shots:[]},'append'),/绑定/);
});
