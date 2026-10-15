import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureIdentity,NAMESPACE} from '../web/prompt_optimization_model.mjs';
test('reactive workflow identities survive two table instances and reloading',()=>{
 const graph={id:'proxy-fixture',extra:{[NAMESPACE]:new Proxy({version:1,documentId:'doc',nativeWorkflowId:'proxy-fixture'}, {})}};
 const node={id:1,properties:{[NAMESPACE]:new Proxy({version:1,tableId:'table-a',revisions:{},batches:[]},{})}};
 assert.deepEqual(ensureIdentity(graph,node),{documentId:'doc',tableId:'table-a'});
 const second={id:2,properties:{}};assert.notEqual(ensureIdentity(graph,second).tableId,'table-a');
 assert.equal(ensureIdentity(graph,{id:1,properties:{}}).tableId,'table-a');
});
