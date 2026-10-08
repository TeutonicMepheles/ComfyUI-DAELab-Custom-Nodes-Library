import test from 'node:test';
import assert from 'node:assert/strict';
import {NAMESPACE,OptimizationRevisions,prepareWorkflowIdentity} from '../web/prompt_optimization_model.mjs';
import {installWorkflowGenerationHistory,preserveWorkflowGenerationHistory} from '../web/prompt_optimization_workflow_history.mjs';

const clone=value=>structuredClone(value);
const table=(phase='complete',text='优化后')=>({version:1,fields:[{id:'p',type:'text'},{id:'g',type:'content',presentation:'generation'}],records:[{id:'r',values:{p:text,g:[{id:'asset',url:'/view?filename=retained.png'}]},meta:{generationColumns:{g:{phase,requestId:'remote',stamp:'input',input:{prompt:'原文'}}}}}],meta:{}});
function fixture(type='DAELAB.Table',phase='complete'){
 const wrapped=type.includes('Storyboard'),widgetName=wrapped?'storyboard_data':'table_data',current=table(phase),old=table('running','原文');old.records[0].values.g=[];
 const properties={[NAMESPACE]:{tableId:'table'}};
 const live={id:7,type,properties:clone(properties),widgets:[{name:'unrelated'},{name:widgetName},{name:'dom',serialize:false}],...(type==='DAELAB.ScriptParser'?{__scriptTable:current}:{__dataTable:current})};
 const extra={[NAMESPACE]:{documentId:'doc',nativeWorkflowId:'native'}};
 const serialized={id:7,type,properties:clone(properties),widgets_values:['keep',JSON.stringify(wrapped?{schema_version:4,table:old}:old),null]};
 return {current,old,live,graph:{id:'native',extra:clone(extra),_nodes:[live]},data:{id:'native',extra:clone(extra),nodes:[serialized]},serialized,wrapped};
}
const decoded=f=>{const value=JSON.parse(f.serialized.widgets_values[1]);return f.wrapped?value.table:value;};

test('native clone-before-configure cannot recapture stale media and trap undo or clear redo',async()=>{
 const f=fixture();let loaded,receiver,args;
 const app={rootGraph:f.graph,isGraphReady:true,async loadGraphData(...input){receiver=this;args=input;loaded=clone(input[0]);preserveWorkflowGenerationHistory(this.rootGraph,loaded);}};
 installWorkflowGenerationHistory(app);const wrapper=app.loadGraphData;installWorkflowGenerationHistory(app);assert.equal(app.loadGraphData,wrapper);
 const workflow={},options={silentAssetErrors:true};
 await app.loadGraphData(f.data,false,false,workflow,options);
 const activeState=f.data,redo=[{next:true}],undo=[];
 // Native updateState retains the original input; its next capture compares it
 // with the configured graph. A differing media overlay would add a false edit.
 if(JSON.stringify(loaded)!==JSON.stringify(activeState)){undo.push(activeState);redo.length=0;}
 assert.equal(undo.length,0);assert.equal(redo.length,1);assert.equal(receiver,app);
 assert.equal(args[3],workflow);assert.equal(args[4],options);
 assert.equal(decoded(f).records[0].values.p,'原文');assert.equal(decoded(f).records[0].meta.generationColumns.g.phase,'complete');
});

test('history wrapper leaves ordinary loads and other documents untouched',async()=>{
 for(const mode of ['normal','view','not-ready','other-document']){
  const f=fixture();if(mode==='other-document')f.data.extra[NAMESPACE].documentId='another';
  const before=clone(f.data),app={rootGraph:f.graph,isGraphReady:mode!=='not-ready',loadGraphData(){return 'native-result';}};
  installWorkflowGenerationHistory(app);
  assert.equal(app.loadGraphData(f.data,mode==='normal',mode==='view'),'native-result');
  assert.deepEqual(f.data,before);
 }
});

test('false/false load of a copied native workflow forks identity before overlay',()=>{
 const f=fixture();f.data.id='copied-native';
 const app={rootGraph:f.graph,isGraphReady:true,loadGraphData(){}};installWorkflowGenerationHistory(app);
 app.loadGraphData(f.data,false,false);
 assert.notEqual(f.data.extra[NAMESPACE].documentId,'doc');assert.notEqual(f.serialized.properties[NAMESPACE].tableId,'table');
 assert.equal(decoded(f).records[0].meta.generationColumns.g.phase,'running');assert.deepEqual(decoded(f).records[0].values.g,[]);
});

test('restored revision and ledger references already match remount persistence, preserving redo',()=>{
 const f=fixture(),registry=new OptimizationRevisions();registry.begin(f.current,'r','p');
 f.live.properties[NAMESPACE].revisions=registry.serialize();f.live.properties[NAMESPACE].batches=[{batchId:'retained'}];
 const previous=clone(registry.current(f.current,'r','p'));
 preserveWorkflowGenerationHistory(f.graph,f.data);
 const saved=clone(f.serialized.properties[NAMESPACE]);
 registry.merge(saved.revisions);registry.observe(decoded(f));
 assert.deepEqual(registry.serialize(),saved.revisions);
 const next=registry.current(decoded(f),'r','p');
 assert.equal(next.revision,previous.revision+1);assert.equal(next.requestSeq,previous.requestSeq);
 assert.deepEqual(saved.batches,[{batchId:'retained'}]);
 // Merging a historical revision must not reinstate its older stamp.
 registry.merge(f.live.properties[NAMESPACE].revisions);registry.observe(decoded(f));
 assert.deepEqual(registry.serialize(),saved.revisions);
});

for(const type of ['DAELAB.Table','DAELAB.ScriptParser','DAELAB.StoryboardImport','DAELAB.ComfyTV.GPTImageStoryboardStage'])test(`${type}: preserve completed media before native nodes are destroyed`,()=>{
 const f=fixture(type),before=clone(f.current);const result=preserveWorkflowGenerationHistory(f.graph,f.data),next=decoded(f);
 assert.deepEqual(result,{preserved:[7],blocked:[]});assert.equal(next.records[0].values.p,'原文');
 assert.equal(next.records[0].meta.generationColumns.g.phase,'complete');assert.deepEqual(next.records[0].values.g,f.current.records[0].values.g);
 assert.deepEqual(f.current,before);assert.equal(f.serialized.widgets_values[0],'keep');assert.equal(f.serialized.widgets_values[2],null);
 // Emulate configure() reconstructing a completely new object from the data.
 const replacement={properties:clone(f.serialized.properties),widgets:[{value:'keep'},{value:f.serialized.widgets_values[1]}]};
 assert.equal(replacement.__dataTable,undefined);assert.match(replacement.widgets[1].value,/retained.png/);
});

for(const conflict of ['delete-row','delete-field','invalid-json'])test(`unsafe active ${conflict} retains the safe current table without throwing from the hook`,()=>{
 const f=fixture('DAELAB.Table','running');
 if(conflict==='invalid-json')f.serialized.widgets_values[1]='invalid';else {const old=clone(f.old);if(conflict==='delete-row')old.records=[];else {old.fields=old.fields.filter(x=>x.id!=='g');delete old.records[0].meta.generationColumns;}f.serialized.widgets_values[1]=JSON.stringify(old);}
 const result=preserveWorkflowGenerationHistory(f.graph,f.data);assert.equal(result.blocked.length,1);assert.deepEqual(decoded(f),f.current);
});

test('Save As and Duplicate forked documents never receive source media or receipts',()=>{
 const f=fixture();f.data.id='new-native';prepareWorkflowIdentity(f.data);const before=clone(f.data);
 assert.deepEqual(preserveWorkflowGenerationHistory(f.graph,f.data),{preserved:[],blocked:[]});assert.deepEqual(f.data,before);
});

test('different table identities and missing document identity never merge',()=>{
 for(const mode of ['table','document']){const f=fixture();if(mode==='table')f.serialized.properties[NAMESPACE].tableId='another';else delete f.data.extra[NAMESPACE];const before=clone(f.data);preserveWorkflowGenerationHistory(f.graph,f.data);assert.deepEqual(f.data,before);}
});

test('two tables preserve only their own media despite node order changes',()=>{
 const a=fixture(),b=fixture('DAELAB.ScriptParser');b.live.id=b.serialized.id=8;b.live.properties[NAMESPACE].tableId=b.serialized.properties[NAMESPACE].tableId='table-b';b.current.records[0].values.g[0].url='/view?filename=second.png';
 a.graph._nodes.push(b.live);a.data.nodes.unshift(b.serialized);preserveWorkflowGenerationHistory(a.graph,a.data);
 assert.equal(decoded(a).records[0].values.g[0].url,'/view?filename=retained.png');assert.equal(decoded(b).records[0].values.g[0].url,'/view?filename=second.png');
});

test('current report cache replaces older serialized reports before storyboard save replay',()=>{
 const f=fixture('DAELAB.StoryboardImport');f.live.properties.daelabTableReports={batch:{started_at:200,phase:'complete'}};f.serialized.properties.daelabTableReports={batch:{started_at:100,phase:'running'}};
 preserveWorkflowGenerationHistory(f.graph,f.data);assert.deepEqual(f.serialized.properties.daelabTableReports,f.live.properties.daelabTableReports);
});

for(const namedOnly of [false,true])test(`named widget restore receives the same overlay (named-only: ${namedOnly})`,()=>{
 const f=fixture();f.serialized.widgets_values_named={table_data:f.serialized.widgets_values[1],unrelated:'keep-named'};
 if(namedOnly)delete f.serialized.widgets_values;
 preserveWorkflowGenerationHistory(f.graph,f.data);
 const restored=JSON.parse(f.serialized.widgets_values_named.table_data);
 assert.equal(restored.records[0].meta.generationColumns.g.phase,'complete');assert.match(restored.records[0].values.g[0].url,/retained/);
 assert.equal(f.serialized.widgets_values_named.unrelated,'keep-named');
 if(!namedOnly)assert.equal(f.serialized.widgets_values[1],f.serialized.widgets_values_named.table_data);
});

test('legacy storyboard receipt and bound result/status fields survive native reconstruction together',()=>{
 const f=fixture('DAELAB.StoryboardImport');
 f.current.fields.push({id:'legacy-output',type:'assets',readonly:true},{id:'legacy-status',type:'text',readonly:true});
 f.current.meta.storyboard={bindings:{video_result:'legacy-output',generation_status:'legacy-status'}};
 f.current.records[0].meta.generation={phase:'complete',request:'legacy-request'};
 f.current.records[0].values['legacy-output']=[{id:'legacy',url:'/view?filename=legacy.mp4'}];f.current.records[0].values['legacy-status']='已完成';
 const old=clone(f.current);old.records[0].meta.generation.phase='running';old.records[0].values['legacy-output']=[];old.records[0].values['legacy-status']='处理中';
 f.serialized.widgets_values[1]=JSON.stringify({table:old});preserveWorkflowGenerationHistory(f.graph,f.data);
 assert.deepEqual(decoded(f).records[0].values['legacy-output'],f.current.records[0].values['legacy-output']);
 assert.equal(decoded(f).records[0].values['legacy-status'],'已完成');assert.equal(decoded(f).records[0].meta.generation.phase,'complete');
});
