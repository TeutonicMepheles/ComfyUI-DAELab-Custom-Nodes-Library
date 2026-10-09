import {preserveGenerationHistory} from './table_generation_history.mjs';
import {scheduleTableInstall} from './table_node_install.mjs';
import {ensureIdentity,NAMESPACE} from './prompt_optimization_model.mjs?v=20261009-progress-r3';
import {attachPromptOptimization} from './prompt_optimization_controller.mjs?v=20261009-progress-r3';
import {app} from '/scripts/app.js';
import {createScriptParserPanel} from './script_parser_panel.mjs?v=20261009-progress-r3';
import {readScriptTable,assertTransition} from './script_parser_model.mjs?v=20261007-parser-review';
import {generationMaterials} from './table_material_output.mjs';
const TYPE='DAELAB.ScriptParser',widget=node=>node.widgets?.find(w=>w.name==='table_data');
const notify=(message,severity='info')=>app.extensionManager?.toast?.add?.({severity,summary:'分镜解析器',detail:message,life:8000});
function install(node){
 if(!node.graph)return;const duplicate=node.graph._nodes?.some(n=>n!==node&&n.properties?.[NAMESPACE]?.tableId&&n.properties[NAMESPACE].tableId===node.properties?.[NAMESPACE]?.tableId);ensureIdentity(node.graph,node,{duplicate});const data=widget(node);if(!data)return;
 let table;try{table=readScriptTable(data.value);if(node.__scriptTable){preserveGenerationHistory(node.__scriptTable,table);assertTransition(node.__scriptTable,table,{restoring:true});}}catch(e){notify(e.message,'error');if(node.__scriptTable)data.value=JSON.stringify(node.__scriptTable);return;}
 node.__scriptTable=table;data.value=JSON.stringify(table);data.hidden=true;data.options={...data.options,hidden:true,canvasOnly:true};data.computeSize=()=>[0,-4];data.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});data.draw=()=>{};for(const el of [data.element,data.inputEl])if(el?.style)el.style.display='none';
 if(node.__scriptPanel){node.__scriptPanel.render();return;}
 const panel=createScriptParserPanel({node,app,getTable:()=>node.__scriptTable,setTable:next=>{node.__scriptTable=next;data.value=JSON.stringify(next);data.callback?.(data.value,app.canvas,node);node.graph?.setDirtyCanvas?.(true,true);},notify});node.__scriptPanel=panel;
 const optimization=attachPromptOptimization({node,graph:node.graph,editor:panel.editor,getTable:()=>node.__scriptTable,identity:ensureIdentity(node.graph,node),fetchApi:app.api.fetchApi.bind(app.api)});
 for(const method of ['render','close','destroy']){const previous=panel[method];panel[method]=(...args)=>{optimization[method==='render'?'observe':method==='close'?'pause':'destroy']();return previous(...args);};}
 const w=node.addDOMWidget('daelab_script_parser','custom',panel.root,{serialize:false,hideOnZoom:false,getHeight:()=>panel.height(),getMinHeight:()=>panel.height(),getValue:()=>'',setValue:()=>panel.render()});w.serialize=false;w.inputEl=panel.root;w.computeSize=width=>[width||1060,panel.height()];w.computeLayoutSize=()=>({minHeight:panel.height(),maxHeight:panel.height(),minWidth:720});
 const removed=w.onRemove?.bind(w);w.onRemove=()=>{panel.destroy();removed?.();panel.root.remove();};
 requestAnimationFrame(()=>{if(node.graph)node.setSize?.([Math.max(1060,node.size[0]),Math.max(580,node.computeSize()[1])]);});
}
app.registerExtension({name:'DAELab.ScriptParser',beforeRegisterNodeDef(type,data){
 if(data.name!==TYPE)return;
 for(const method of ['onNodeCreated','onAdded','onConfigure']){const prev=type.prototype[method];type.prototype[method]=function(...args){const result=prev?.apply(this,args);if(method==='onConfigure')this.__scriptPanel?.close();scheduleTableInstall(this,install);return result;};}
 const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(...args){this.__scriptPanel?.destroy();delete this.__scriptPanel;delete this.__scriptTable;return removed?.apply(this,args);};
}});
let registered=false;
function register(){const api=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];if(registered||api?.version!==1)return;
 api.registerAdapter('daelab.script-parser',{matches:node=>node.type===TYPE,menu:[{label:'分镜剧本解析器',type:TYPE,icon:'file-text-line'}],presentation:'content',expanded:true,collapsible:false,resizable:true,fullHeight:true,workspace:()=>false,compactWidth:0,width:1060,
 panel:node=>node.__scriptPanel?{root:node.__scriptPanel.root,close:()=>node.__scriptPanel.close()}:null,
 selectionSurface:node=>node.__scriptPanel?.surface,
 materialSources:node=>[...(node.__scriptPanel?.root.querySelectorAll('[data-generation-source]')||[])].map(element=>({element,key:element.dataset.generationSource,label:'输出为素材组'})),
 outputMaterials:(node,key)=>generationMaterials(node.__scriptTable,key),summary:node=>`${node.__scriptTable?.records.length||0} 条已确认任务`,
 prepareCopy(node,data){if(data.properties?.[NAMESPACE])delete data.properties[NAMESPACE];const index=node.widgets?.findIndex(w=>w.name==='table_data');if(index<0||!data.widgets_values?.[index])return;const table=readScriptTable(data.widgets_values[index]);for(const row of table.records)if(row.meta)delete row.meta.generationColumns;delete table.meta.generationProject;data.widgets_values[index]=JSON.stringify(table);},
 });registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
