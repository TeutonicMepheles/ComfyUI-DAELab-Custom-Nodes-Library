import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialTable,fillMaterialColumn} from '../web/table_material_columns.mjs';
import {clone,setValue,SnapshotHistory,normalizeTable,pasteMatrix,transferValue} from '../web/data_table_model.mjs';
const group=n=>({assets:Array.from({length:n},(_,i)=>({filename:`${i}.${i%2?'webm':'png'}`,kind:i%2?'video':'image',nodeId:String(i)}))});
test('two independent 2x2 tables with single media cells',()=>{
 const a=createMaterialTable(),b=createMaterialTable();assert.equal(a.fields.length,2);assert.equal(a.records.length,2);
 fillMaterialColumn(a,a.fields[0].id,group(3));assert.equal(b.records.length,2);assert.equal(b.records[0].values[b.fields[0].id].length,0);
 assert.throws(()=>setValue(a,a.records[0].id,a.fields[0].id,[{url:'/view?a'},{url:'/view?b'}]),/最多一个/);
});
test('ordered mixed media, stable rows and other columns, exact grow/shrink and undo',()=>{
 const t=createMaterialTable(),[a,b]=t.fields,ids=t.records.map(r=>r.id);
 fillMaterialColumn(t,b.id,group(2));const other=clone(t.records[0].values[b.id]);
 const before=JSON.stringify(t),h=new SnapshotHistory();fillMaterialColumn(t,a.id,group(3));h.record(before,JSON.stringify(t));
 assert.deepEqual(t.records.slice(0,2).map(r=>r.id),ids);assert.deepEqual(t.records[0].values[b.id],other);
 assert.deepEqual(t.records.map(r=>r.values[a.id][0].kind),['image','video','image']);
 assert.deepEqual(h.restore(JSON.stringify(t)),JSON.parse(before));
 fillMaterialColumn(t,a.id,group(1));assert.equal(t.records.length,1);
 assert.deepEqual(normalizeTable(JSON.stringify(t)),t);
});
test('invalid or missing sources do not partially overwrite cells',()=>{
 const t=createMaterialTable(),before=JSON.stringify(t);
 for(const g of [{},group(501),{assets:[{missing:true}]}])assert.throws(()=>fillMaterialColumn(t,t.fields[0].id,g));
 assert.equal(JSON.stringify(t),before);
});

test('empty group clears the rows and can be undone',()=>{const t=createMaterialTable();fillMaterialColumn(t,t.fields[0].id,group(0));assert.equal(t.records.length,0);});

test('one content column mixes text and media, saves goal and round trips',()=>{
 const t=createMaterialTable(),f=t.fields[0];f.goal='image';
 setValue(t,t.records[0].id,f.id,'雨后的山谷\n保留自然光');
 setValue(t,t.records[1].id,f.id,[{id:'reference',url:'/view?filename=mountain.png',kind:'image'}]);
 const restored=normalizeTable(JSON.stringify(t));assert.equal(restored.fields[0].goal,'image');assert.equal(restored.records[0].values[f.id],'雨后的山谷\n保留自然光');assert.equal(restored.records[1].values[f.id][0].id,'reference');
 transferValue(restored,{record:t.records[0].id,field:f.id},{record:t.records[1].id,field:f.id},'swap');
 assert.equal(restored.records[0].values[f.id][0].id,'reference');assert.equal(restored.records[1].values[f.id],'雨后的山谷\n保留自然光');
});
test('legacy canvas columns migrate without losing source identities; paste remains atomic',()=>{
 const t=createMaterialTable();t.fields[0].type='assets';fillMaterialColumn(t,t.fields[0].id,group(2));const restored=normalizeTable(t);
 assert.equal(restored.fields[0].type,'content');assert.equal(restored.records[0].values[t.fields[0].id][0].id,t.records[0].values[t.fields[0].id][0].id);
 const before=JSON.stringify(restored);assert.throws(()=>pasteMatrix(restored,restored.records[0].id,restored.fields[0].id,[[[{url:'/view?a'},{url:'/view?b'}]]]));assert.equal(JSON.stringify(restored),before);
});
test('copying media across columns gets an independent identity and reloads',()=>{
 const t=createMaterialTable(),[a,b]=t.fields,r=t.records[0];setValue(t,r.id,a.id,[{id:'source',url:'/view?filename=a.png'}]);
 pasteMatrix(t,r.id,b.id,[[clone(r.values[a.id])]]);assert.equal(t.records[0].values[a.id][0].id,'source');assert.notEqual(t.records[0].values[b.id][0].id,'source');assert.doesNotThrow(()=>normalizeTable(t));
});
