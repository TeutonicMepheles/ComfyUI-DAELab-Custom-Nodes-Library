import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleTableInstall} from '../web/table_node_install.mjs';

test('restored node binds once to configured saved identity, after onAdded',async()=>{
 const node={graph:{},properties:{}},seen=[];
 const install=n=>seen.push(n.properties.tableId);
 scheduleTableInstall(node,install); // onAdded
 node.properties={tableId:'saved-table'};
 scheduleTableInstall(node,install); // onConfigure
 assert.deepEqual(seen,[]);
 await Promise.resolve();assert.deepEqual(seen,['saved-table']);
});
test('removed node does not acquire a deferred controller',async()=>{
 const node={graph:{}},seen=[];
 scheduleTableInstall(node,()=>seen.push(true));node.graph=null;
 await Promise.resolve();assert.deepEqual(seen,[]);
});
