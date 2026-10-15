// Public table exchange owned by the table package. No consumer reads panel internals.
import {normalizeTable} from './data_table_model.mjs';
export function readTableSnapshot(node){
    if(node?.type!=='DAELAB.Table'||node.mode)throw new Error('多维表格不可用');
    return normalizeTable(node.widgets?.find(w=>w.name==='table_data')?.value||'{}');
}
export function createTableSnapshot(graph,table,{title='LLM 输出 · 模拟结果',pos=[0,0]}={}){
    const node=LiteGraph.createNode('DAELAB.Table');
    if(!node)throw new Error('多维表格节点尚未加载');
    const occupied=(graph._nodes||[]).filter(n=>Math.abs((n.pos?.[1]||0)-pos[1])<650);
    const outputPos=[Math.max(pos[0],...occupied.map(n=>(n.pos?.[0]||0)+(n.size?.[0]||350)+60)),pos[1]];
    node.title=title;node.pos=outputPos;
    const widget=node.widgets?.find(w=>w.name==='table_data');
    if(!widget)throw new Error('表格数据接口不可用');
    widget.value=JSON.stringify(normalizeTable(table));graph.add(node);
    globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.placeNode?.(node,{x:outputPos[0],y:outputPos[1],width:760});
    graph.change?.();return node;
}
