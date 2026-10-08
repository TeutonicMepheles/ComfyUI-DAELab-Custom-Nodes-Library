/** Offline MOCK workflow/snapshot builder. No browser or network APIs. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [repository,output]=process.argv.slice(2);
if(!repository||!output)throw new Error('Usage: node prompt_opt_mock_seed.mjs <candidate-repository> <empty-output>');
const {normalizeTable}=await import(pathToFileURL(path.join(repository,'web/data_table_model.mjs')));
const {ensureIdentity,OptimizationRevisions,freezeSnapshot,matchesSnapshot,NAMESPACE}=await import(pathToFileURL(path.join(repository,'web/prompt_optimization_model.mjs')));
const id=()=>crypto.randomUUID();
const workflow={id:id(),revision:0,last_node_id:6,last_link_id:0,nodes:[],links:[],groups:[],config:{},extra:{ds:{scale:0.6,offset:[30,50]}},version:0.4};
const definitions=[
 {key:'valid',title:'MOCK · 单格有效建议 / 应用撤销',scope:'cell',states:['valid']},
 {key:'batch',title:'MOCK · 整列 / 有效+未改动+过期',scope:'column',states:['valid','unchanged','stale']},
 {key:'unchanged',title:'MOCK · 未改动 / 不得写入',scope:'cell',states:['unchanged']},
 {key:'invalid',title:'MOCK · 引用损坏 / 不得应用',scope:'cell',states:['invalid']},
 {key:'unknown',title:'MOCK · 提交未知 / 不得重发',scope:'cell',states:['unknown']},
 {key:'failed',title:'MOCK · 明确拒绝 / 保留原文',scope:'cell',states:['failed']},
];
const cases=[];
for(const [index,definition] of definitions.entries()){
 const fieldId=id(),sceneId=id(),batchId=id();
 const table=normalizeTable({version:1,fields:[{id:sceneId,name:'MOCK 画面文字',type:'content',width:250},{id:fieldId,name:'提示词（MOCK）',type:'json',presentation:'prompt',width:430,promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:sceneId},{type:'text',text:'。画面清晰，清楚。'}]}}],records:definition.states.map((state,i)=>({id:id(),selected:false,values:{[sceneId]:`MOCK 测试资料 ${i+1}：白猫坐在窗台上，不要文字。`},meta:{mockFixture:true}})),meta:{material_columns:true,mockFixture:true,mockLabel:definition.title}});
 const node={id:index+1,type:'DAELAB.Table',title:definition.title,pos:[60+(index%2)*1190,80+Math.floor(index/2)*740],size:[1120,610],flags:{},order:index,mode:0,inputs:[{name:'table_data',type:'STRING',widget:{name:'table_data'},link:null}],outputs:[{name:'table_json',type:'STRING',slot_index:0,links:null}],properties:{'Node name for S&R':'DAELAB.Table'},widgets_values:[]};
 const identity=ensureIdentity(workflow,node),revisions=new OptimizationRevisions();
 const records=[];
 for(const [i,state] of definition.states.entries()){
  const row=table.records[i];
  const frozen=await freezeSnapshot(table,{...identity,recordId:row.id,fieldId},revisions,{begin:true});
  let outputText=frozen.wire.input.prompt_text;
  if(state==='valid'||state==='stale')outputText=outputText.replace('。画面清晰，清楚。','。画面清晰。');
  if(state==='invalid')outputText='MOCK 人工故障：故意丢失引用标记。';
  records.push({requestId:id(),snapshot:frozen.wire,fixtureState:state,outputText});
  if(state==='stale'){
   row.values[sceneId]='MOCK 已编辑的新资料：黑猫站在门边。';
   revisions.observe(table);
   if(matchesSnapshot(table,identity,revisions,frozen))throw new Error('Stale fixture did not invalidate its snapshot');
  }
 }
 const range={scope:definition.scope,fieldId,...(definition.scope==='cell'?{recordId:table.records[0].id}:{})};
 node.properties[NAMESPACE].revisions=revisions.serialize();
 node.properties[NAMESPACE].batches=[]; // Exercise durable discovery without workflow query refs.
 node.widgets_values=[JSON.stringify(table)];
 node.widgets_values_named={table_data:node.widgets_values[0]};
 workflow.nodes.push(node);
 cases.push({key:definition.key,nodeId:node.id,title:definition.title,identity,range,batchId,rows:records});
}
workflow.extra.daelabCreativeCanvasV1={version:1,active:false,viewport:{x:40,y:40,zoom:0.65},cards:Object.fromEntries(workflow.nodes.map((node,index)=>[node.id,{x:index*1250,y:0,width:1100,expanded:true}]))};
for(const [index,definition] of definitions.entries()){
 const single=structuredClone(workflow);single.id=id();single.nodes=[structuredClone(workflow.nodes[index])];single.nodes[0].pos=[60,80];
 single.extra[NAMESPACE].nativeWorkflowId=single.id;
 single.extra.daelabCreativeCanvasV1.cards={[single.nodes[0].id]:{x:0,y:0,width:1100,expanded:true}};
 fs.writeFileSync(path.join(output,`MOCK-${definition.key}-workflow.json`),JSON.stringify(single,null,2));
 cases[index].standaloneWorkflow=`MOCK-${definition.key}-workflow.json`;
}
fs.writeFileSync(path.join(output,'MOCK-workflow.json'),JSON.stringify(workflow,null,2));
fs.writeFileSync(path.join(output,'MOCK-snapshots.json'),JSON.stringify({mock:true,realPaidRequests:0,cases},null,2));
console.log(JSON.stringify({mock:true,tables:cases.length,rows:cases.reduce((n,c)=>n+c.rows.length,0),output}));
