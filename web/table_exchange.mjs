// Public table exchange owned by the table package. No consumer reads panel internals.
import {normalizeTable} from './data_table_model.mjs';
import {promptContent} from './table_prompt_template.mjs?v=20261017-sync-frames';
import {promptColumns,applyPromptContent} from './table_generation_model.mjs?v=20261017-sync-frames';
export function readTableSnapshot(node){
    if(node?.type!=='DAELAB.Table'||node.mode)throw new Error('多维表格不可用');
    return normalizeTable(node.widgets?.find(w=>w.name==='table_data')?.value||'{}');
}
export function writeTablePrompts(node,changes,{group=null}={}){
    const table=readTableSnapshot(node),editor=node.__dataTablePanel?.editor;
    if(!editor)throw new Error('多维表格尚未就绪');
    for(const change of changes){
        const row=table.records.find(r=>r.id===change.recordId),field=promptColumns(table).find(f=>f.id===change.fieldId&&!f.readonly);
        if(!row||!field)throw new Error('对应的提示词行或列已删除');
        if(JSON.stringify(promptContent(table,row,field.id))!==JSON.stringify(change.expected))throw new Error('表格提示词已变化，请重新编辑');
    }
    editor.change(next=>{
        for(const {recordId,fieldId,segments} of changes){
            applyPromptContent(next,next.records.find(r=>r.id===recordId),fieldId,segments);
        }
        next.meta.prompt_mode='reviewed';
    },{group,render:false});
    for(const {recordId,fieldId} of changes)editor.refreshCells(recordId,fieldId);
}
export function previewTableRow(node,recordId){
    const root=node?.type==='DAELAB.Table'&&!node.mode&&node.__dataTablePanel?.editor.root;
    if(!root||!recordId)return null;
    const token=crypto.randomUUID(),style=document.createElement('style');
    const row=`.dae-ui .dae-table[data-linked-task-row="${token}"] tr[data-record-id="${CSS.escape(recordId)}"]`;
    style.textContent=`${row}>td{background:var(--table-selected-content,var(--dae-secondary-container,#3f4559))!important;box-shadow:inset 0 1px var(--dae-focus),inset 0 -1px var(--dae-focus)}${row}>td.table-choice{background:var(--table-selected-header,var(--dae-secondary-container,#3f4559))!important;box-shadow:inset 3px 0 var(--dae-focus)}`;
    root.dataset.linkedTaskRow=token;root.append(style);
    return ()=>{style.remove();if(root.dataset.linkedTaskRow===token)delete root.dataset.linkedTaskRow;};
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
