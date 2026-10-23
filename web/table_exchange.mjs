// Public table exchange owned by the table package. No consumer reads panel internals.
import {normalizeTable} from './data_table_model.mjs?v=20261023-h3-size-r3';
import {projectTableSource,selectedTableOutput} from './table_source_model.mjs?v=20261023-h3-size-r3';
import {promptContent} from './table_prompt_template.mjs?v=20261023-h3-size-r3';
import {promptColumns,applyPromptContent} from './table_generation_model.mjs?v=20261023-h3-size-r3';
export const isTableSource=node=>['DAELAB.Table','DAELAB.ScriptParser'].includes(node?.type);
export function readTableView(node,seen=new Set()){
    if(!isTableSource(node)||node.mode)throw new Error('多维表格不可用');
    if(seen.has(node))throw new Error('表格输入连线形成循环');
    seen=new Set(seen).add(node);
    const local=normalizeTable(node.widgets?.find(w=>w.name==='table_data')?.value||'{}');
    const input=node.inputs?.find(i=>i.name==='source_table');
    if(input?.link==null){if(local.meta.liveSource)throw new Error('上游表格已断开，请重新连接');return local;}
    const link=node.graph?.links[input.link],source=node.graph?.getNodeById(link?.origin_id);
    if(link?.origin_slot!==0)throw new Error('请连接上游的 table_json 输出');
    const projected=projectTableSource(local,readTableSnapshot(source,seen));
    projected.meta.liveSource.origin={nodeId:source.id,title:source.title||source.type};
    return projected;
}
// Source information belongs to the table adapter, not the optimizer or Canvas.
export function describeTableSource(node,table,fieldId){
    const saved=table.meta?.liveSource,originId=saved?.fields?.[fieldId]||fieldId;
    const input=node.inputs?.find(i=>i.name==='source_table'),link=node.graph?.links[input?.link];
    if(!saved&&input?.link==null)return {synchronized:false,available:false,reason:'此列为系统维护的只读数据，不能直接改写。'};
    const source=node.graph?.getNodeById(link?.origin_id);
    let field;try{field=source&&readTableView(source).fields.find(f=>f.id===originId);}catch{}
    return {synchronized:true,nodeId:source?.id??saved?.origin?.nodeId,title:source?.title||saved?.origin?.title||'上游表格',fieldId:originId,
        fieldName:field?.name||table.fields.find(f=>f.id===fieldId)?.name||originId,available:Boolean(source&&field&&!source.mode),
        reason:source&&!source.mode?'此列由上游同步，无法在当前表格优化。':'上游已断开或停用，无法在当前表格优化。'};
}
export function focusTableSource(node,source){
    const upstream=node.graph?.getNodeById(source.nodeId),editor=upstream?.__dataTablePanel?.editor||upstream?.__scriptPanel?.editor;
    if(!editor||upstream.mode)return false;
    const root=editor.root,context=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root),viewport=context?.getViewport();
    if(viewport){context.focus?.();const r=root.getBoundingClientRect();context.panBy((r.left+r.right)/2-(viewport.left+viewport.right)/2,(r.top+r.bottom)/2-(viewport.top+viewport.bottom)/2);}
    else {const canvas=globalThis.comfyAPI?.app?.app?.canvas;canvas?.selectNode?.(upstream);canvas?.centerOnNode?.(upstream);}
    editor.selectColumn(source.fieldId);
    root.querySelector(`th[data-column="${CSS.escape(source.fieldId)}"]`)?.focus({preventScroll:true});return true;
}
export function readTableSnapshot(node,seen){
    const table=readTableView(node,seen);
    return table.meta.liveSource?selectedTableOutput(table):table;
}
export function writeTablePrompts(node,changes,{group=null}={}){
    const table=readTableSnapshot(node),editor=node.__dataTablePanel?.editor||node.__scriptPanel?.editor;
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
