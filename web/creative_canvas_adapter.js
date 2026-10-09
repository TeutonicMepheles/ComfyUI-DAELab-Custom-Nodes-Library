import {NAMESPACE} from './prompt_optimization_model.mjs?v=20261009-progress-r4';
import {generationMaterials} from './table_material_output.mjs?v=20261002-shared-prompt-generation-config';
// Optional integration: business nodes work without the canvas extension.
// This repository alone owns knowledge of its private panel implementations.
import {createMaterialTable,fillMaterialColumn,fillMaterialRow,fillMaterialCell} from './table_material_columns.mjs?v=20261002-shared-prompt-generation-config';
import {app} from '/scripts/app.js';
const key=Symbol.for('DAELAB.CreativeCanvas.API.v1');
const tables=['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'];
let registered=false;
const materialTargetCache=new WeakMap();
function register(){
    const api=globalThis[key];if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.business',{
        menu:[{label:'多维表格',type:'DAELAB.Table',icon:'layout-grid-line'}],
        materialTargets(node){
            const root=node.__dataTablePanel?.root;if(!root)return [];
            const grid=root.querySelector('table'),cached=materialTargetCache.get(node);if(cached?.grid===grid&&cached.cellsRevision===grid?.dataset.cellsRevision)return cached.targets;
            const columns=[...root.querySelectorAll('[data-material-column]')],ids=new Set(columns.map(e=>e.dataset.materialColumn));
            const cells=[...root.querySelectorAll('td[data-field]')].filter(e=>ids.has(e.dataset.field));
            const target=(element,key,label,project=true)=>({element,key,label,project,clipElement:element.closest('.dae-table-scroll')});
            const targets=[...columns.map(e=>{const columnCells=cells.filter(c=>c.dataset.field===e.dataset.materialColumn);return {...target(e,e.dataset.materialColumn,'松开按列向下填充'),previewElements:count=>[e,...columnCells.slice(0,count)]};}),
                ...[...root.querySelectorAll('.table-choice[data-content-row]')].map(e=>({...target(e,JSON.stringify(['row',e.dataset.contentRow]),'松开按行向右填充',false),previewElements:[e,...cells.filter(c=>c.dataset.record===e.dataset.contentRow)]})),
                ...cells.map(e=>target(e,JSON.stringify(['cell',e.dataset.record,e.dataset.field]),'松开将全部素材加入此格',false))];
            materialTargetCache.set(node,{grid,targets,cellsRevision:grid?.dataset.cellsRevision});return targets;
        },
        materialSources:node=>[...(node.__dataTablePanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'})),
        outputMaterials:(node,key)=>generationMaterials(node.__dataTable,key),
        acceptMaterials(node,key,collection){const editor=node.__dataTablePanel?.editor;if(!editor)throw new Error('表格尚未就绪');editor.change(t=>{if(t.fields.some(f=>f.id===key))fillMaterialColumn(t,key,collection);else{const [kind,record,field]=JSON.parse(key);if(kind==='row')fillMaterialRow(t,record,collection);else if(kind==='cell')fillMaterialCell(t,record,field,collection);else throw new Error('素材落点已失效');}});},
        matches:node=>tables.includes(node.type)||node.type?.startsWith('DAELAB.LibTV.'),
        expanded:node=>tables.includes(node.type),
        resizable:node=>tables.includes(node.type),
        fullHeight:node=>tables.includes(node.type),
        presentation:node=>node.type==='DAELAB.Table'?'content':'card',
        selectionSurface:node=>node.type==='DAELAB.Table'?node.__dataTablePanel?.root.querySelector('.dae-table-scroll'):null,
        workspace:node=>tables.includes(node.type)&&node.type!=='DAELAB.Table',
        compactWidth:0,
        width:node=>node.type==='DAELAB.Table'?1140:tables.includes(node.type)?1060:460,
        action:node=>node.type==='DAELAB.LibTV.VideoGenerate'?{label:'生成视频',run:()=>app.queuePrompt(0,1,[node.id])}:null,
        panel:node=>{const p=node.__dataTablePanel||node.__libtvPanel;return p?{root:p.root,buttons:p.creativeButtons,fields:p.creativeFields,close:()=>p.close?.()}:null;},
        summary:node=>tables.includes(node.type)?`${node.__dataTable?.records?.length||0} 条记录`:null,
        preview:node=>({url:node.properties?.daelabLibTVResult,kind:'video'}),
        inputLabels:{first_frame:'首帧',last_frame:'尾帧',reference_images:'参考图片',reference_video:'参考视频'},
        prepareCopy(node,data){if(data.properties?.[NAMESPACE])delete data.properties[NAMESPACE];for(const [i,w] of (node.widgets||[]).entries())if(w.name==='request_id'&&data.widgets_values)data.widgets_values[i]=`copy-${crypto.randomUUID()}`;},
        onCreate(node){if(node.type==='DAELAB.Table'){node.title='多维表格';const table=createMaterialTable(),w=node.widgets?.find(w=>w.name==='table_data');if(w)w.value=JSON.stringify(table);node.__dataTable=table;node.__dataTablePanel?.render();}if(node.type==='DAELAB.LibTV.VideoGenerate'){const w=node.widgets?.find(w=>w.name==='request_id');if(w)w.value=`video-${crypto.randomUUID()}`;}},
    });
    // The single video node has no native run button; batch panels already do.
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
