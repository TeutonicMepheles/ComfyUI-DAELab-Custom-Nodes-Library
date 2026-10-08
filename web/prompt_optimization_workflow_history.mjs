import {NAMESPACE,OptimizationRevisions,prepareWorkflowIdentity} from './prompt_optimization_model.mjs';
import {preserveGenerationHistory} from './table_generation_history.mjs';
import {assertTransition} from './script_parser_model.mjs?v=20261007-parser-review';
import {serializeStoryboardTable} from './storyboard_table_adapter.mjs?v=20261001-frame-tags-dedup';

const widgetNames={
 'DAELAB.Table':'table_data',
 'DAELAB.ScriptParser':'table_data',
 'DAELAB.StoryboardImport':'storyboard_data',
 'DAELAB.ComfyTV.GPTImageStoryboardStage':'storyboard_data',
};
const installed=new WeakSet();

/** Amend the source history snapshot before the host clones it for configure.
 * The host retains this exact argument as activeState after undo/redo. Overlaying
 * only its configure clone makes the next capture reinsert the obsolete state,
 * trapping undo on the same step and discarding redo. Keep the host's queues and
 * restore implementation intact; only our same-document media fields change.
 */
export function installWorkflowGenerationHistory(app){
 if(installed.has(app))return;
 installed.add(app);
 const load=app.loadGraphData;
 app.loadGraphData=function(data,clean=true,restoreView=true,...rest){
  if(clean===false&&restoreView===false&&app.isGraphReady&&data&&typeof data==='object'&&!Array.isArray(data)){
   prepareWorkflowIdentity(data);
   preserveWorkflowGenerationHistory(app.rootGraph,data);
  }
  return load.call(this,data,clean,restoreView,...rest);
 };
}
function readTable(value,wrapped){
 const decoded=typeof value==='string'?JSON.parse(value):value;
 const table=wrapped?decoded?.table:decoded;
 if(!table||!Array.isArray(table.fields)||!Array.isArray(table.records))throw new Error('历史表格数据不完整');
 return structuredClone(table);
}

/**
 * Run before rootGraph.configure clears the old nodes. Native undo rebuilds node
 * objects, so onConfigure cannot recover remote state from the new node itself.
 * The caller must prepare workflow identity first: Save As / Duplicate gets a
 * different document ID and must never inherit live state from its source.
 */
export function preserveWorkflowGenerationHistory(graph,data){
 const result={preserved:[],blocked:[]};
 const documentId=graph?.extra?.[NAMESPACE]?.documentId;
 if(!documentId||data?.extra?.[NAMESPACE]?.documentId!==documentId)return result;
 const byTable=new Map(),ambiguous=new Set();
 for(const node of graph._nodes||[]){
  const id=node.properties?.[NAMESPACE]?.tableId;
  if(!id||!widgetNames[node.type])continue;
  if(byTable.has(id))ambiguous.add(id);else byTable.set(id,node);
 }
 for(const serialized of data.nodes||[]){
  const id=serialized.properties?.[NAMESPACE]?.tableId;
  const live=byTable.get(id);
  if(!live||ambiguous.has(id)||live.type!==serialized.type)continue;
  const current=live.type==='DAELAB.ScriptParser'?live.__scriptTable:live.__dataTable;
  if(!current)continue;
  // LiteGraph preserves widget indexes in widgets_values (nonserialized DOM
  // widgets occupy null positions). Resolve by the live schema's widget name,
  // never by a guessed numeric offset or a matching JSON-looking string.
  const name=widgetNames[live.type],index=live.widgets?.findIndex(w=>w.name===name)??-1;
  const named=serialized.widgets_values_named,hasNamed=named&&Object.hasOwn(named,name);
  if(index<0||(!Array.isArray(serialized.widgets_values)&&!hasNamed))continue;
  const wrapped=name==='storyboard_data';let restored;
  try{
   restored=readTable(hasNamed?named[name]:serialized.widgets_values[index],wrapped);
   preserveGenerationHistory(current,restored);
   assertTransition(current,restored,{restoring:true});
  }catch(error){
   // Extension hook exceptions are swallowed by the native frontend. Replace
   // the unsafe historical table before configure rather than throwing here.
   restored=structuredClone(current);
   result.blocked.push({nodeId:serialized.id,reason:error.message});
  }
  const value=wrapped?serializeStoryboardTable(restored):JSON.stringify(restored);
  if(Array.isArray(serialized.widgets_values))serialized.widgets_values[index]=value;
  // Frontend 1.52.7 emits both forms and namedValuesRestore may prefer the map.
  // Keep them in agreement so either native restore path receives the overlay.
  if(named&&typeof named==='object')named[name]=value;
  // Restoration itself is a new prompt revision. Project it into the source
  // snapshot too, otherwise remount persists newer metadata and the next native
  // capture treats that derived update as an edit, clearing the redo queue.
  const latest=live.properties[NAMESPACE],revisions=new OptimizationRevisions(latest.revisions);
  revisions.observe(restored);
  serialized.properties[NAMESPACE].revisions=revisions.serialize();
  serialized.properties[NAMESPACE].batches=structuredClone(latest.batches||[]);
  // Storyboard save() replays these reports after configure; keep its live
  // receipt source too, otherwise an older report can overwrite the overlay.
  if(live.properties?.daelabTableReports!==undefined)serialized.properties.daelabTableReports=structuredClone(live.properties.daelabTableReports);
  else delete serialized.properties.daelabTableReports;
  result.preserved.push(serialized.id);
 }
 return result;
}
