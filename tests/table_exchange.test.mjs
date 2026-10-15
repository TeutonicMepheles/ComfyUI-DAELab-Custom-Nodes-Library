import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableSnapshot,readTableSnapshot} from '../web/table_exchange.mjs';
test('output creation uses serialized table contract and avoids an existing neighbor',()=>{
    const previous=globalThis.LiteGraph;
    const graph={_nodes:[{pos:[1160,0],size:[700,600]}],add(node){node.graph=this;this._nodes.push(node);},change(){}};
    globalThis.LiteGraph={createNode:()=>({type:'DAELAB.Table',mode:0,widgets:[{name:'table_data',value:''}]})};
    try{
        const table={fields:[{id:'text',type:'content',name:'文本'}],records:[{id:'r',values:{text:'模拟结果'}}]};
        const n=createTableSnapshot(graph,table,{pos:[1160,0]});assert.equal(n.pos[0],1920);assert.equal(readTableSnapshot(n).records[0].values.text,'模拟结果');
        n.widgets[0].value='{}';assert.equal(table.records.length,1);
    }finally{globalThis.LiteGraph=previous;}
});
