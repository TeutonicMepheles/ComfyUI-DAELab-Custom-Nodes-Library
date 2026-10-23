import test from 'node:test';
import assert from 'node:assert/strict';
import {removeEmptyTableNode} from '../web/table_empty_node.mjs';

test('deleting the last row or column removes only its owning table',()=>{
    for(const table of [{fields:[{id:'f'}],records:[]},{fields:[],records:[{id:'r'}]}]){
        const removed=[],graph={remove:n=>removed.push(n)};
        const a={type:'DAELAB.Table',graph},b={type:'DAELAB.Table',graph};
        assert.equal(removeEmptyTableNode(a,table),true);
        assert.deepEqual(removed,[a]);assert.ok(!removed.includes(b));
    }
});
test('blank cells, hidden fields, parser upload states and unavailable data survive',()=>{
    const graph={remove(){assert.fail('must preserve this node');}};
    const node={type:'DAELAB.Table',graph};
    assert.equal(removeEmptyTableNode(node,{fields:[{hidden:true}],records:[{values:{}}]}),false);
    for(const table of [null,{}, {fields:[]}])assert.equal(removeEmptyTableNode(node,table),false);
    assert.equal(removeEmptyTableNode({type:'DAELAB.ScriptParser',graph},{fields:[],records:[]}),false);
    assert.equal(removeEmptyTableNode({type:'DAELAB.Table'},{fields:[],records:[]}),false);
});
