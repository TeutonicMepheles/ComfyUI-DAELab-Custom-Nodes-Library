import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialTable,fillMaterialColumn,fillMaterialCell,fillMaterialRow} from '../web/table_material_columns.mjs';
import {clone,setValue,SnapshotHistory,normalizeTable,pasteMatrix,transferValue} from '../web/data_table_model.mjs';
const group=n=>({assets:Array.from({length:n},(_,i)=>({filename:`${i}.${i%2?'webm':'png'}`,kind:i%2?'video':'image',nodeId:String(i)}))});
const mediaTable=()=>normalizeTable({meta:{material_columns:true},fields:[{id:'a',name:'素材 A',type:'content'},{id:'b',name:'素材 B',type:'content'}],records:[{id:'r1',values:{a:[],b:[]}},{id:'r2',values:{a:[],b:[]}}]});
test('new tables have independent image, text and generation columns',()=>{
 const a=createMaterialTable(),b=createMaterialTable();assert.deepEqual(a.fields.map(f=>f.name),['图片/视频','提示词','生成']);assert.equal(a.records.length,3);assert.equal(a.records.some(r=>r.selected),false);assert.equal(a.fields[1].width,420);
 assert.equal(a.fields[1].presentation,'prompt');assert.equal(a.fields[1].type,'json');assert.equal(a.fields[2].generation.promptFieldId,a.fields[1].id);assert.equal(a.fields[2].readonly,true);assert.equal(a.records[0].values[a.fields[1].id],'');
 fillMaterialColumn(a,a.fields[0].id,group(3));assert.equal(b.records.length,3);assert.equal(b.records[0].values[b.fields[0].id].length,0);
 setValue(a,a.records[0].id,a.fields[0].id,[{url:'/view?a'},{url:'/view?b'}]);assert.equal(a.records[0].values[a.fields[0].id].length,2);
});
test('ordered mixed media grows rows and preserves trailing rows, other columns and undo',()=>{
 const t=mediaTable(),[a,b]=t.fields,ids=t.records.map(r=>r.id);
 fillMaterialColumn(t,b.id,group(2));const other=clone(t.records[0].values[b.id]);
 const before=JSON.stringify(t),h=new SnapshotHistory();fillMaterialColumn(t,a.id,group(3));h.record(before,JSON.stringify(t));
 assert.deepEqual(t.records.slice(0,2).map(r=>r.id),ids);assert.deepEqual(t.records[0].values[b.id],other);
 assert.deepEqual(t.records.map(r=>r.values[a.id][0].kind),['image','video','image']);
 assert.deepEqual(h.restore(JSON.stringify(t)),JSON.parse(before));
 const trailing=clone(t.records.slice(1));
 fillMaterialColumn(t,a.id,group(1));assert.equal(t.records.length,3);assert.deepEqual(t.records.slice(1),trailing);
 assert.deepEqual(normalizeTable(JSON.stringify(t)),t);
});
test('invalid or missing sources do not partially overwrite cells',()=>{
 const t=mediaTable(),before=JSON.stringify(t);
 for(const g of [{},group(501),{assets:[{missing:true}]}])assert.throws(()=>fillMaterialColumn(t,t.fields[0].id,g));
 assert.equal(JSON.stringify(t),before);
});

test('empty group preserves existing rows and values',()=>{const t=mediaTable();fillMaterialColumn(t,t.fields[0].id,group(2));const before=clone(t);fillMaterialColumn(t,t.fields[0].id,group(0));assert.deepEqual(t,before);});

test('one content column mixes text and media, saves goal and round trips',()=>{
 const t=mediaTable(),f=t.fields[0];f.goal='image';
 setValue(t,t.records[0].id,f.id,'雨后的山谷\n保留自然光');
 setValue(t,t.records[1].id,f.id,[{id:'reference',url:'/view?filename=mountain.png',kind:'image'}]);
 const restored=normalizeTable(JSON.stringify(t));assert.equal(restored.fields[0].goal,'image');assert.equal(restored.records[0].values[f.id],'雨后的山谷\n保留自然光');assert.equal(restored.records[1].values[f.id][0].id,'reference');
 transferValue(restored,{record:t.records[0].id,field:f.id},{record:t.records[1].id,field:f.id},'swap');
 assert.equal(restored.records[0].values[f.id][0].id,'reference');assert.equal(restored.records[1].values[f.id],'雨后的山谷\n保留自然光');
});
test('legacy canvas columns migrate without losing source identities; paste remains atomic',()=>{
 const t=mediaTable();t.fields[0].type='assets';fillMaterialColumn(t,t.fields[0].id,group(2));const restored=normalizeTable(t);
 assert.equal(restored.fields[0].type,'content');assert.equal(restored.records[0].values[t.fields[0].id][0].id,t.records[0].values[t.fields[0].id][0].id);
 pasteMatrix(restored,restored.records[0].id,restored.fields[0].id,[[[{url:'/view?a'},{url:'/view?b'}]]]);assert.equal(restored.records[0].values[restored.fields[0].id].length,2);
 const before=JSON.stringify(restored);assert.throws(()=>pasteMatrix(restored,restored.records[0].id,restored.fields[0].id,[[[{url:'invalid'}]]]));assert.equal(JSON.stringify(restored),before);
});

test('cell drops append the entire collection without changing other rows or columns',()=>{
 const t=mediaTable(),[a,b]=t.fields,row=t.records[0],other=clone(t.records[1]);
 fillMaterialColumn(t,b.id,group(1));const untouched=clone(row.values[b.id]);
 fillMaterialCell(t,row.id,a.id,group(3));fillMaterialCell(t,row.id,a.id,group(2));
 assert.equal(row.values[a.id].length,5);assert.equal(new Set(row.values[a.id].map(a=>a.id)).size,5);
 assert.deepEqual(row.values[b.id],untouched);assert.deepEqual(t.records[1],other);assert.equal(t.records.length,2);
 assert.deepEqual(normalizeTable(JSON.stringify(t)),t);
});

test('row drops fill media columns left to right and append missing columns',()=>{
 const t=mediaTable(),row=t.records[0],other=clone(t.records[1]);
 t.fields.splice(1,0,{id:'notes',name:'备注',type:'text'});row.values.notes='保留';
 fillMaterialRow(t,row.id,group(3));
 assert.equal(t.fields.length,4);assert.equal(row.values.notes,'保留');
 assert.deepEqual(t.fields.filter(f=>f.type==='content').map(f=>row.values[f.id][0].name),['0.png','1.webm','2.png']);
 assert.deepEqual(t.records[1],other);
});
test('copying media across columns gets an independent identity and reloads',()=>{
 const t=mediaTable(),[a,b]=t.fields,r=t.records[0];setValue(t,r.id,a.id,[{id:'source',url:'/view?filename=a.png'}]);
 pasteMatrix(t,r.id,b.id,[[clone(r.values[a.id])]]);assert.equal(t.records[0].values[a.id][0].id,'source');assert.notEqual(t.records[0].values[b.id][0].id,'source');assert.doesNotThrow(()=>normalizeTable(t));
});
