import {generationMaterials} from './table_material_output.mjs';
// Optional integration: business nodes work without the canvas extension.
// This repository alone owns knowledge of its private panel implementations.
import {createMaterialTable,fillMaterialColumn} from './table_material_columns.mjs';
import {app} from '/scripts/app.js';
const key=Symbol.for('DAELAB.CreativeCanvas.API.v1');
const tables=['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'];
let registered=false;
function register(){
    const api=globalThis[key];if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.business',{
        menu:[{label:'多维表格',type:'DAELAB.Table',icon:'layout-grid-line'}],
        materialTargets:node=>[...(node.__dataTablePanel?.root.querySelectorAll('[data-material-column]')||[])].map(element=>({element,clipElement:element.closest('.dae-table-scroll'),key:element.dataset.materialColumn,dropElements:[...element.closest('table').querySelectorAll('th[data-column],td[data-field]')].filter(cell=>(cell.dataset.column||cell.dataset.field)===element.dataset.materialColumn)})),
        materialSources:node=>[...(node.__dataTablePanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'})),
        outputMaterials:(node,key)=>generationMaterials(node.__dataTable,key),
        acceptMaterials(node,key,collection){const editor=node.__dataTablePanel?.editor;if(!editor)throw new Error('表格尚未就绪');editor.change(t=>fillMaterialColumn(t,key,collection));},
        matches:node=>tables.includes(node.type)||node.type?.startsWith('DAELAB.LibTV.'),
        expanded:node=>tables.includes(node.type),
        resizable:node=>tables.includes(node.type),
        fullHeight:node=>tables.includes(node.type),
        workspace:node=>tables.includes(node.type)&&node.type!=='DAELAB.Table',
        compactWidth:0,
        width:node=>node.type==='DAELAB.Table'?720:tables.includes(node.type)?1060:460,
        action:node=>node.type==='DAELAB.LibTV.VideoGenerate'?{label:'生成视频',run:()=>app.queuePrompt(0,1,[node.id])}:null,
        panel:node=>{const p=node.__dataTablePanel||node.__libtvPanel;return p?{root:p.root,buttons:p.creativeButtons,fields:p.creativeFields,close:()=>p.close?.()}:null;},
        summary:node=>tables.includes(node.type)?`${node.__dataTable?.records?.length||0} 条记录`:null,
        preview:node=>({url:node.properties?.daelabLibTVResult,kind:'video'}),
        inputLabels:{first_frame:'首帧',last_frame:'尾帧',reference_images:'参考图片',reference_video:'参考视频'},
        prepareCopy(node,data){for(const [i,w] of (node.widgets||[]).entries())if(w.name==='request_id'&&data.widgets_values)data.widgets_values[i]=`copy-${crypto.randomUUID()}`;},
        onCreate(node){if(node.type==='DAELAB.Table'){node.title='多维表格';const table=createMaterialTable(),w=node.widgets?.find(w=>w.name==='table_data');if(w)w.value=JSON.stringify(table);node.__dataTable=table;node.__dataTablePanel?.render();}if(node.type==='DAELAB.LibTV.VideoGenerate'){const w=node.widgets?.find(w=>w.name==='request_id');if(w)w.value=`video-${crypto.randomUUID()}`;}},
    });
    // The single video node has no native run button; batch panels already do.
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
