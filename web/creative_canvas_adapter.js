import {NAMESPACE} from './prompt_optimization_model.mjs?v=20261023-h3-size-r3';
import {generationMaterials} from './table_material_output.mjs?v=20261023-h3-size-r3';
// Optional integration: business nodes work without the canvas extension.
// This repository alone owns knowledge of its private panel implementations.
import {createMaterialTable,fillMaterialColumn,fillMaterialRow,fillMaterialCell,columnDropTypes,columnFillCount} from './table_material_columns.mjs?v=20261023-column-fill';
import {app} from '/scripts/app.js';
import {materialItem} from './table_material_item.mjs?v=20261012-client-workflow-r2';
import {videoResultAssets} from './libtv_video_model.mjs?v=20261012-client-workflow-r2';
const key=Symbol.for('DAELAB.CreativeCanvas.API.v1');
const tables=['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'];
let registered=false;
const materialTargetCache=new WeakMap();
function register(){
    const api=globalThis[key];if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.business',{
        menu:[{label:'多维表格',type:'DAELAB.Table',icon:'layout-grid-line'},{label:'生成节点',type:'DAELAB.LibTV.VideoGenerate',icon:'video-line'}],
        materialItem:(node,key)=>materialItem(node.__dataTable,key),
        materialOutput:node=>node.type==='DAELAB.LibTV.VideoGenerate',
        assets:node=>node.__libtvPanel?.assets?.()||videoResultAssets(node),
        materialTargets(node){
            if(node.type==='DAELAB.LibTV.VideoGenerate')return node.__libtvPanel?.materialTargets?.()||[];
            const root=node.__dataTablePanel?.root;if(!root)return [];
            const grid=root.querySelector('table'),cached=materialTargetCache.get(node);if(cached?.grid===grid&&cached.cellsRevision===grid?.dataset.cellsRevision)return cached.targets;
            const fields=node.__dataTable?.fields||[];
            const columns=[...root.querySelectorAll('th[data-column]')].filter(e=>columnDropTypes(fields.find(f=>f.id===e.dataset.column)).length),ids=new Set(columns.filter(e=>columnDropTypes(fields.find(f=>f.id===e.dataset.column)).includes('image')).map(e=>e.dataset.column));
            const cells=[...root.querySelectorAll('td[data-field]')].filter(e=>ids.has(e.dataset.field));
            const target=(element,key,label,project=true)=>({element,key,label,project,clipElement:element.closest('.dae-table-scroll')});
            const targets=[...columns.map(e=>{const columnCells=[...root.querySelectorAll('td[data-field]')].filter(c=>c.dataset.field===e.dataset.column);return {...target(e,e.dataset.column,'单个素材填满整列，多个素材按序向下填充'),accepts:columnDropTypes(fields.find(f=>f.id===e.dataset.column)),previewElements:count=>[e,...columnCells.slice(0,columnFillCount(count,columnCells.length))]};}),
                ...[...root.querySelectorAll('.table-choice[data-content-row]')].map(e=>({...target(e,JSON.stringify(['row',e.dataset.contentRow]),'松开按行向右填充',false),previewElements:[e,...cells.filter(c=>c.dataset.record===e.dataset.contentRow)]})),
                ...cells.map(e=>target(e,JSON.stringify(['cell',e.dataset.record,e.dataset.field]),'松开将全部素材加入此格',false))];
            materialTargetCache.set(node,{grid,targets,cellsRevision:grid?.dataset.cellsRevision});return targets;
        },
        materialSources:node=>[...(node.__dataTablePanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'})),
        outputMaterials:(node,key)=>generationMaterials(node.__dataTable,key),
        acceptMaterials(node,key,collection){if(node.type==='DAELAB.LibTV.VideoGenerate')return node.__libtvPanel.acceptMaterials(key,collection);const editor=node.__dataTablePanel?.editor;if(!editor)throw new Error('表格尚未就绪');editor.change(t=>{if(t.fields.some(f=>f.id===key))fillMaterialColumn(t,key,collection);else{const [kind,record,field]=JSON.parse(key);if(kind==='row')fillMaterialRow(t,record,collection);else if(kind==='cell')fillMaterialCell(t,record,field,collection);else throw new Error('素材落点已失效');}});},
        tasks:node=>node.__dataTablePanel?.tasks?.()||node.__libtvPanel?.tasks?.()||[],
        matches:node=>tables.includes(node.type)||node.type?.startsWith('DAELAB.LibTV.'),
        expanded:node=>tables.includes(node.type),
        resizable:node=>tables.includes(node.type)||node.type==='DAELAB.LibTV.VideoGenerate',
        minWidth:node=>node.type==='DAELAB.Table'?168+160*(node.__dataTable?.fields.filter(field=>!field.hidden).length||0):640,
        fullHeight:node=>tables.includes(node.type)||node.type==='DAELAB.LibTV.VideoGenerate',
        presentation:node=>node.type==='DAELAB.Table'?'content':'card',
        floatingHeader:node=>node.type==='DAELAB.LibTV.VideoGenerate',
        selectionSurface:node=>node.type==='DAELAB.Table'?node.__dataTablePanel?.root.querySelector('.dae-table-scroll'):null,
        workspace:node=>tables.includes(node.type)&&node.type!=='DAELAB.Table',
        compactWidth:0,
        width:node=>node.type==='DAELAB.Table'?1140:tables.includes(node.type)?1060:node.type==='DAELAB.LibTV.VideoGenerate'?900:460,
        action:()=>null,
        panel:node=>{const p=node.__dataTablePanel||node.__libtvPanel;return p?{root:p.root,buttons:p.creativeButtons,fields:p.creativeFields,close:()=>p.close?.()}:null;},
        summary:node=>tables.includes(node.type)?`${node.__dataTable?.records?.length||0} 条记录`:null,
        preview:node=>({url:node.properties?.daelabLibTVResult,kind:'video'}),
        inputLabels:{table_json:'表格任务',first_frame:'首帧',last_frame:'尾帧',reference_images:'参考图片',reference_video:'参考视频',text_input:'描述文本'},
        prepareCopy(node,data){
            if(data.properties?.[NAMESPACE])delete data.properties[NAMESPACE];
            for(const [i,w] of (node.widgets||[]).entries())if(data.widgets_values){
                if(w.name==='request_id')data.widgets_values[i]=`copy-${crypto.randomUUID()}`;
                if(w.name==='task_data'&&data.widgets_values[i]){
                    const state=JSON.parse(data.widgets_values[i]),ids=new Map(state.table.records.map(row=>[row.id,crypto.randomUUID()]));
                    for(const row of state.table.records){row.id=ids.get(row.id);if(row.meta)delete row.meta.generationColumns;}
                    state.currentId=ids.get(state.currentId);for(const input of Object.values(state.inputs||{}))input.recordId=ids.get(input.recordId);
                    data.widgets_values[i]=JSON.stringify(state);
                }
            }
        },
        onCreate(node){if(node.type==='DAELAB.Table'){node.title='多维表格';const table=createMaterialTable(),w=node.widgets?.find(w=>w.name==='table_data');if(w)w.value=JSON.stringify(table);node.__dataTable=table;node.__dataTablePanel?.render();}if(node.type==='DAELAB.LibTV.VideoGenerate'){node.title='生成节点';const w=node.widgets?.find(w=>w.name==='request_id');if(w)w.value=`video-${crypto.randomUUID()}`;}},
    });
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
