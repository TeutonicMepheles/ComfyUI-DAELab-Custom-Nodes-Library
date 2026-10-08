/** Prepare deterministic approval fixtures. Never calls a service or provider. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {freezeSnapshot,OptimizationRevisions,NAMESPACE,DEFAULT_REQUIREMENTS,INSTRUCTION_DIGEST} from '../web/prompt_optimization_model.mjs';
import {normalizeTable} from '../web/data_table_model.mjs';
import {syncGenerationConfigOwners,syncGenerationFrameTags,generationFrameTagKey,generationFrames} from '../web/table_generation_model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'tests/fixtures/prompt-optimization');
const requests=JSON.parse(await readFile(path.join(directory,'requests.json'),'utf8'));
const byId=new Map(requests.map(item=>[item.id,item]));
const productionsNonce='0123456789abcdef0123456789abcdef';
const singles=['Q01','Q02','Q03','Q04','Q06','Q08b'],column=['Q05','Q07','Q08a'];
const uuid=seed=>{const b=createHash('sha256').update(`daelab-paid-fixture-v1:${seed}`).digest().subarray(0,16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};
const text=value=>({type:'text',text:value});
const prompt=segments=>({kind:'column-template',version:1,segments});
const asset=(id,name)=>({id,name,kind:'image',filename:`${id}.png`,subfolder:'prompt-opt-paid-fixtures',type:'input',url:`/view?filename=${id}.png&subfolder=prompt-opt-paid-fixtures&type=input`});

function makeTable(ids){
 const purposes=new Set(ids.map(id=>byId.get(id).input.purpose));assert.equal(purposes.size,1);
 const purpose=[...purposes][0],fields=[{id:'p',type:'json',presentation:'prompt',name:'待优化提示词',width:540}];
 const needScene=ids.some(id=>['Q04','Q05','Q08a','Q08b'].includes(id));
 if(needScene)fields.unshift({id:'scene',type:'content',name:'画面',width:280});
 if(ids.includes('Q07'))fields.unshift({id:'assets',type:'content',name:'角色素材',width:150});
 if(ids.includes('Q06'))fields.unshift({id:'frames',type:'content',name:'本地首尾帧测试素材',width:170});
 let generation;
 if(purpose!=='general'){
  generation={version:1,kind:purpose,model:purpose==='image'?'Lib Image':'Seedance 2.5',promptFieldId:'p',mode:ids.includes('Q06')?'frames2video':purpose==='video'?'text2video':'',settings:{}};
  fields.push({id:'g',type:'content',presentation:'generation',readonly:true,name:'用途配置（不执行媒体生成）',width:240,generation});
  fields.find(f=>f.id==='p').generationConfigFieldId='g';
 }
 const records=ids.map(id=>{
  const input=byId.get(id).input,row={id,selected:false,values:{},meta:{}};
  if(['Q04','Q05','Q08a','Q08b'].includes(id)){
   row.values.scene=input.reference_context[0].text;
   row.values.p=prompt([{type:'column',fieldId:'scene'}]);
  }else if(id==='Q07'){
   row.values.assets=[asset('paid-role','角色')];
   row.values.p=prompt([{type:'column',fieldId:'assets',assetId:'paid-role'},text('站在门口，镜中也出现'),{type:'column',fieldId:'assets',assetId:'paid-role'},text('。')]);
  }else if(id==='Q06'){
   row.values.frames=[asset('paid-first','首帧本地测试图'),asset('paid-last','尾帧本地测试图')];
   row.values.p=prompt([{type:'frame',generationFieldId:'g',role:'first'},text(' '),{type:'frame',generationFieldId:'g',role:'last'},text(' 镜头固定，镜头不要移动，让首帧平稳过渡到尾帧。')]);
   row.meta.generationFrames={g:{first:{fieldId:'frames',assetId:'paid-first'},last:{fieldId:'frames',assetId:'paid-last'}}};
   row.meta.generationFrameTags={g:generationFrameTagKey(generation)};
  }else row.values.p=prompt([text(input.prompt_text)]);
  if(generation)row.values.g=[];
  return row;
 });
 // Q05/Q08a test actual template inheritance; Q07 is the sole row override.
 if(ids.length===3){fields.find(f=>f.id==='p').promptTemplate=prompt([{type:'column',fieldId:'scene'}]);for(const row of records)if(row.id!=='Q07')delete row.values.p;}
 return normalizeTable({version:1,fields,records,view:'table',meta:{material_columns:true}});
}

function workflow(ids,scope){
 const name=scope==='column'?'column-Q05-Q07-Q08a':ids[0],nativeId=uuid(`native:${name}`),table=makeTable(ids);
 const requirement=byId.get(ids[0]).input.optimization_requirements;
 const drafts={[JSON.stringify([scope,'p',scope==='cell'?ids[0]:''])]:requirement===DEFAULT_REQUIREMENTS?'':requirement};
 const value=JSON.stringify(table),node={id:1,type:'DAELAB.Table',title:scope==='column'?'Q05 / Q07 / Q08a · 三行整列验收':`${ids[0]} · 单格提示词验收`,pos:[40,60],size:[1180,620],flags:{},order:0,mode:0,inputs:[],outputs:[{name:'table_json',type:'STRING',links:null,slot_index:0}],properties:{'Node name for S&R':'DAELAB.Table',[NAMESPACE]:{version:1,tableId:uuid(`table:${name}`),revisions:{},batches:[],preferences:{model:'gpt-4.1-mini'},drafts}},widgets_values:[value],widgets_values_named:{table_data:value}};
 return {id:nativeId,last_node_id:1,last_link_id:0,nodes:[node],links:[],groups:[],config:{},extra:{ds:{scale:0.65,offset:[0,0]},daelabCreativeCanvasV1:{version:1,active:false,viewport:{x:60,y:60,zoom:0.65},cards:{1:{x:0,y:0,width:1100,expanded:true}}},[NAMESPACE]:{version:1,documentId:uuid(`document:${name}`),nativeWorkflowId:nativeId},daelabPaidAcceptanceFixture:{version:1,scope,fieldId:'p',...(scope==='cell'?{recordId:ids[0]}:{}),cases:ids,model:'gpt-4.1-mini',requirements:requirement,maxOutputTokens:1024,notAuthorization:true,paidPostsExecuted:0}},version:0.4};
}

export function createPaidWorkflows(){return [...singles.map(id=>({filename:`paid-${id}.json`,workflow:workflow([id],'cell')})),{filename:'paid-column-Q05-Q07-Q08a.json',workflow:workflow(column,'column')}];}

export async function verifyPaidWorkflows(files){
 const results=[];
 for(const {filename,workflow:w} of files){
  assert.equal(w.nodes.length,1);const node=w.nodes[0],meta=w.extra.daelabPaidAcceptanceFixture;
  assert.equal(node.widgets_values[0],node.widgets_values_named.table_data);
  const table=normalizeTable(node.widgets_values_named.table_data);syncGenerationConfigOwners(table);
  for(const f of table.fields.filter(f=>f.presentation==='generation'))syncGenerationFrameTags(table,f.id,f.generation);
  assert.deepEqual(table.records.map(r=>r.id),meta.cases);
  const draft=node.properties[NAMESPACE].drafts[JSON.stringify([meta.scope,'p',meta.recordId||''])]||'';
  for(const row of table.records){
   const target={documentId:w.extra[NAMESPACE].documentId,tableId:node.properties[NAMESPACE].tableId,recordId:row.id,fieldId:'p'};
   const frozen=await freezeSnapshot(table,target,new OptimizationRevisions(),{begin:true,nonce:productionsNonce,requirements:draft,model:'gpt-4.1-mini',maxOutputTokens:1024});
   const normalized=JSON.parse(JSON.stringify(frozen.wire.input).replaceAll(productionsNonce,'demo'));
   assert.deepEqual(normalized,byId.get(row.id).input,`${row.id}: freezeSnapshot differs from the paid request fixture`);
   assert.equal(JSON.stringify(normalized),byId.get(row.id).inputText,`${row.id}: JSON field order/serialization mismatch`);
   assert.doesNotMatch(frozen.wire.inputText,/\/view\?|paid-first\.png|paid-last\.png|paid-role\.png/);
   if(row.id==='Q06')assert.deepEqual(generationFrames(table,row,'g',table.fields.find(f=>f.id==='g').generation).map(f=>({role:f.role,assetId:f.asset?.id})),[{role:'first',assetId:'paid-first'},{role:'last',assetId:'paid-last'}]);
   results.push({id:row.id,filename,scope:meta.scope,input:frozen.wire.input,inputText:frozen.wire.inputText,maxOutputTokens:1024});
  }
 }
 assert.deepEqual(results.map(r=>r.id).sort(),requests.map(r=>r.id).sort());return results;
}

async function main(){
 const write=process.argv.includes('--write'),files=createPaidWorkflows();
 if(write)for(const file of files)await writeFile(path.join(directory,file.filename),JSON.stringify(file.workflow,null,2)+'\n');
 const baselinePath=path.join(directory,'two-tables.json'),baseline=JSON.parse(await readFile(baselinePath,'utf8'));
 if(write){baseline.extra.daelabCreativeCanvasV1={version:1,active:false,viewport:{x:60,y:60,zoom:0.5},cards:Object.fromEntries(baseline.nodes.map((node,i)=>[node.id,{x:i*1250,y:0,width:1100,expanded:true}]))};await writeFile(baselinePath,JSON.stringify(baseline,null,2)+'\n');}
 for(const [i,node] of baseline.nodes.entries()){const card=baseline.extra.daelabCreativeCanvasV1.cards[node.id];assert.equal(card.x,i*1250);assert.equal(card.width,1100);}
 const actual=[];for(const file of files)actual.push({filename:file.filename,workflow:JSON.parse(await readFile(path.join(directory,file.filename),'utf8'))});
 const results=await verifyPaidWorkflows(actual);
 const assetIndex=process.argv.indexOf('--asset-directory');
 if(assetIndex>=0){
  const assetDirectory=path.resolve(process.argv[assetIndex+1]||'');
  const expected=path.resolve(process.env.USERPROFILE,'.codex/workspaces/prompt-opt-validation/c/input/prompt-opt-paid-fixtures');
  assert.equal(assetDirectory.toLowerCase(),expected.toLowerCase(),'Only the isolated C input fixture directory is allowed');
  await mkdir(assetDirectory,{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  for(const id of ['paid-first','paid-last','paid-role'])await writeFile(path.join(assetDirectory,`${id}.png`),png);
 }
 const python=path.join(process.env.USERPROFILE,'Documents/ComfyUI/.venv/Scripts/python.exe');
 const instructions=execFileSync(python,['-c','import ast,pathlib,sys; t=ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")); v=next(n.value for n in t.body if isinstance(n,ast.Assign) and any(getattr(x,"id","")=="INSTRUCTIONS" for x in n.targets)); sys.stdout.buffer.write(ast.literal_eval(v).encode("utf-8"))',path.join(root,'nodes/prompt_optimization/instructions.py')]).toString('utf8');
 assert.equal(createHash('sha256').update(instructions).digest('hex'),INSTRUCTION_DIGEST);
 const costs=results.map(row=>{const inputTokens=Buffer.byteLength(instructions)+Buffer.byteLength(row.inputText)+64,expectedOutputTokens=Math.min(1024,Math.max(32,Math.ceil(Buffer.byteLength(row.input.prompt_text)*0.65)));return {id:row.id,inputTokens,expectedOutputTokens,maxOutputTokens:1024,estimatedCredits:Number(((inputTokens*84.4+expectedOutputTokens*337.6)/1e6).toFixed(6)),upperCredits:Number(((inputTokens*84.4+1024*337.6)/1e6).toFixed(6))};}).sort((a,b)=>a.id.localeCompare(b.id));
 const totalInput=costs.reduce((s,x)=>s+x.inputTokens,0),totalOutput=costs.reduce((s,x)=>s+x.expectedOutputTokens,0);
 console.log(JSON.stringify({status:'verified-no-paid-request',files:files.map(f=>f.filename),singleCells:6,columnRows:3,requestInputsCompared:9,differences:[],costs,totalInput,totalOutput,totalMaxOutput:9216,estimatedCredits:Number(costs.reduce((s,x)=>s+x.estimatedCredits,0).toFixed(6)),upperCredits:Number(costs.reduce((s,x)=>s+x.upperCredits,0).toFixed(6)),aggregateFormulaUpperCredits:Number(((totalInput*84.4+9216*337.6)/1e6).toFixed(6))},null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
