import test from 'node:test';
test('mixed group text becomes image processing requirements',()=>{
    const rows=pairInputs([{version:1,inputMode:'image-instructions',texts:['保留主体','暖色光线'],assets:[{kind:'image',filename:'a.png'},{kind:'image',filename:'b.png'}]}]);
    assert.equal(rows.length,2);assert.equal(rows[0].instruction,'保留主体\n\n暖色光线');assert.equal(rows[1].instruction,rows[0].instruction);
    assert.equal(rows[0].text,'');assert.equal(availableModes(rows).reverse,true);assert.equal(availableModes(rows).polish,false);
});
import assert from 'node:assert/strict';
import {pairInputs,availableModes,simulateRows,outputTable,tableInput} from '../web/llm_io_model.mjs';
const image=n=>({kind:'image',filename:`${n}.png`,name:`图片${n}`});
test('text, image, group and mixed input pair by ordinal; never broadcast',()=>{
    assert.equal(pairInputs([],'一段').length,1);
    assert.equal(pairInputs([],'一段\n\n二段').length,2);
    const rows=pairInputs([{version:1,assets:[image(1),image(2)]},{version:1,texts:['第一段']}]);
    assert.deepEqual(rows.map(r=>r.text),['第一段','']);assert.deepEqual(rows.map(r=>r.image.filename),['1.png','2.png']);
    assert.deepEqual(availableModes(rows),{polish:false,reverse:true,custom:true});
    assert.throws(()=>simulateRows(rows,'polish',''),/不适用/);
});
test('table keeps empty ordinal slots and original input; output is two-column editable table',()=>{
    const table={fields:[{id:'i',type:'content'},{id:'t',type:'content'}],records:[{id:'a',values:{i:[{...image(1),url:'/view?filename=1.png'}],t:'第一段'}},{id:'b',values:{i:[],t:''}},{id:'c',values:{i:[],t:'第三段'}}]};
    const before=JSON.stringify(table),rows=pairInputs([tableInput(table)]);
    const result=outputTable(simulateRows(rows,'custom','保留顺序'),'custom','保留顺序');
    assert.equal(result.fields.length,2);assert.equal(result.records.length,3);assert.equal(result.records[1].values.text,'');
    assert.equal(result.records[2].meta.llmIO.originalText,'第三段');assert.equal(JSON.stringify(table),before);
    assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
test('empty, missing, video, ambiguous table and table plus loose input fail explicitly',()=>{
    assert.throws(()=>pairInputs([],''),/先输入/);
    assert.throws(()=>pairInputs([null]),/不可用/);
    assert.throws(()=>pairInputs([{version:1,assets:[{missing:true}]}]),/缺失/);
    assert.throws(()=>pairInputs([{version:1,assets:[{kind:'video'}]}]),/非图片/);
    assert.throws(()=>pairInputs([{version:1,rows:[{text:'x',index:1}]}],'additional'),/单独处理表格/);
});
test('per-instance simulation never mutates source data',()=>{
    const a=pairInputs([],'A'),b=pairInputs([],'B'),r=simulateRows(a,'polish','要求');r[0].result='change';assert.equal(a[0].result,undefined);assert.equal(b[0].text,'B');
});
