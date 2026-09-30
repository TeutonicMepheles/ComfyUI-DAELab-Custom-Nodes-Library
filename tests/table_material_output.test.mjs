import test from 'node:test';
import assert from 'node:assert/strict';
import {generationInput,inputStamp} from '../web/table_generation_model.mjs';
import {generationMaterials} from '../web/table_material_output.mjs';
function fixture(){
 const t={fields:[{id:'p',type:'text'},{id:'g',name:'结果',presentation:'generation',generation:{promptFieldId:'p',kind:'image',settings:{}}}],records:['a','b','c'].map(id=>({id,values:{p:'prompt',g:[{id,url:'/view?filename='+id+'.png&type=output',kind:'image'}]},meta:{}})),meta:{}};
 for(const r of t.records)r.meta.generationColumns={g:{phase:'complete',requestId:r.id,stamp:inputStamp(generationInput(t,'g',r.id))}};
 return t;
}
test('output follows row order and preserves task/material provenance',()=>{
 const t=fixture();t.records.reverse();const out=generationMaterials(t,'g');assert.deepEqual(out.assets.map(a=>a.id),['c','b','a']);assert.equal(out.assets[0].provenance.recordId,'c');assert.equal(out.assets[0].provenance.requestId,'c');assert.equal(out.skipped,0);
});
test('existing results remain outputtable regardless of task phase or changed inputs',()=>{
 const t=fixture();t.records[0].meta.generationColumns.g.phase='running';t.records[1].meta.generationColumns.g.phase='failed';t.records[2].values.p='edited';
 const out=generationMaterials(t,'g');assert.equal(out.ready,true);assert.equal(out.skipped,0);assert.deepEqual(out.assets.map(a=>a.id),['a','b','c']);
 delete t.records[0].meta.generationColumns;t.fields[1].generation.promptFieldId='deleted';assert.equal(generationMaterials(t,'g').assets.length,3);
});
test('only rows without usable image or video results are skipped',()=>{
 const t=fixture();t.records[0].values.g=[];t.records[1].values.g=[{kind:'text',url:'/view?filename=b.png&type=output'}];t.records[2].values.g[0].kind='video';
 const out=generationMaterials(t,'g');assert.equal(out.skipped,2);assert.deepEqual(out.assets.map(a=>a.id),['c']);t.records[2].values.g=[];assert.equal(generationMaterials(t,'g').ready,false);
});
