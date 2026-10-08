import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {copiesReferenceContext} from '../web/prompt_optimization_context_copy.mjs';
import {restoreSuggestion} from '../web/prompt_optimization_model.mjs';

const cases=JSON.parse(await readFile(new URL('./fixtures/prompt-optimization/context-copy-cases.json',import.meta.url),'utf8')).cases;
for(const item of cases)test(`context-copy.v1: ${item.id}`,()=>{
 assert.equal(copiesReferenceContext(item.input,item.output),item.expectedBlocked,item.note);
});
test('application boundary rejects the real v1 Q04 materialization and permits generic additions',()=>{
 const item=cases.find(item=>item.id==='q04-real-materialization')||cases.find(item=>item.expectedBlocked&&item.input.reference_context.some(ref=>ref.text?.includes('一名行人')));
 assert.ok(item,'the shared cases must retain the actual failed output');
 const token=item.input.protected_tokens[0],segment={type:'column',fieldId:'scene'};
 const frozen={wire:{input:item.input},local:{original:{kind:'column-template',version:1,segments:[segment]},segments:[segment],mapping:[{token,segment}]}};
 assert.throws(()=>restoreSuggestion(frozen,item.output),/动态引用内容/);
 const safe=restoreSuggestion(frozen,token+'。画面层次清晰。');
 assert.equal(safe.status,'valid');assert.deepEqual(safe.document.segments[0],segment);
 assert.equal(restoreSuggestion(frozen,token).status,'unchanged');
});
