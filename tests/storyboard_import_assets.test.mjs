import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeImportAssets,resolveImportRows,materializeImportRows} from '../web/storyboard_import_assets.mjs';
import {newStoryboardTable,importRows,addGenerationFields,projectStoryboard} from '../web/storyboard_table_adapter.mjs';
const row=(n,text,refs)=>initializeImportAssets({id:`r${n}`,image_prompt:text,camera_notes:'',candidate_assets:[],image_url:'',original_fields:[{name:'说明',value:'原文'}],source:{row:n},...{references:refs}});
test('multi-image selection, order, original preservation and explicit continuation are independent',async()=>{
 const a=row(2,'正文');a.references=[{url:'/a',selected:false},{url:'/b',selected:true}];
 const b=row(3,'');b.references=[{url:'/c',selected:true}];b.disposition='pending';
 assert.throws(()=>resolveImportRows([a,b]),/只有图片/);
 b.disposition='merge';const shots=await materializeImportRows([a,b],[],()=>{throw Error('must not upload URLs');});
 assert.equal(shots.length,1);assert.deepEqual(shots[0].source.rows,[2,3]);assert.deepEqual(shots[0].original_assets.map(a=>a.url),['/a','/b','/c']);
 assert.equal(shots[0].image_url,'/b');assert.deepEqual(shots[0].additional_reference_images,['/c']);
 const table=newStoryboardTable();importRows(table,{shots},'replace');const field=table.meta.storyboard.original_assets_field;
 assert.equal(table.records[0].values[field].length,3);assert(table.fields.find(f=>f.id===field).readonly);
 addGenerationFields(table);table.records[0].values[table.meta.storyboard.generation_fields.duration]=8;
 assert.equal(projectStoryboard(table).shots[0].generation_duration,8);
 assert.deepEqual(projectStoryboard(table).shots[0].additional_reference_images,['/c']);
});
test('pending row fails before uploading any originals',async()=>{
 const a=row(2,'');a.references=[{asset_id:'x',selected:true}];a.disposition='pending';let count=0;
 await assert.rejects(()=>materializeImportRows([a],[],()=>count++),/只有图片/);assert.equal(count,0);
});
