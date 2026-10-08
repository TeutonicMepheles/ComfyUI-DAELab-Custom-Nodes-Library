import test from 'node:test';
import assert from 'node:assert/strict';
import {createOptimizationController,attachPromptOptimization} from '../web/prompt_optimization_controller.mjs';
import {OptimizationRevisions,freezeSnapshot,NAMESPACE} from '../web/prompt_optimization_model.mjs';

const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const makeTable=()=>({fields:[{id:'p',name:'提示词',type:'text'}],records:[{id:'r',values:{p:'一只白猫，白色的猫。'}},{id:'r2',values:{p:'女孩先合上书，然后站起来。'}}],meta:{}});

// No network or model provider is involved. The fake preserves the service's
// per-table lease, reusedExisting and queued/preparing protocol boundaries.
function fakeService(){
 const calls=[],batches=new Map(),hooks={},leases=new Map();let n=0;
 const record=(name,p)=>calls.push({name,p:clone(p)});
 const api={
  capabilities:async p=>{record('capabilities',p);return {available:true,models:['gpt-4.1-mini']};},
  estimate:async p=>{record('estimate',p);await hooks.estimate?.(p);return {status:'ready',quoteId:`quote-${++n}`,expiresAt:Date.now()+300000,budgetUpperCredits:1,estimatedCredits:0.2};},
  lease:async p=>{record('lease',p);await hooks.lease?.(p);const key=JSON.stringify(p.target),old=leases.get(key);if(old&&old.instanceId!==p.instanceId)throw Error('此表格已由另一个视图控制');const value={leaseId:old?.leaseId||`lease-${++n}`,instanceId:p.instanceId};leases.set(key,value);return clone(value);},
  submit:async p=>{record('submit',p);const supplied=await hooks.submit?.(p);if(supplied)return clone(supplied);const value={...clone(p),stopped:false,paused:false,rows:p.rows.map(r=>({...clone(r),status:'queued'}))};batches.set(p.batchId,value);return clone(value);},
  query:async p=>{record('query',p);return clone(batches.get(p.batchId));},
  recover:async p=>{record('recover',p);return clone(batches.get(p.batchId));},
  permit:async p=>{record('permit',p);batches.get(p.batchId).rows.find(r=>r.requestId===p.requestId).status='preparing';await hooks.permit?.(p);return {permitId:`permit-${++n}`};},
  advance:async p=>{record('advance',p);const batch=batches.get(p.batchId),row=batch.rows.find(r=>r.requestId===p.requestId);row.status='submitted';await hooks.advance?.(batch,row);return clone(batch);},
  continue:async p=>{record('continue',p);const batch=batches.get(p.batchId);batch.paused=false;batch.stopped=false;batch.quoteId=p.quoteId;return clone(batch);},
  skip:async p=>{record('skip',p);const batch=batches.get(p.batchId);batch.rows.find(r=>r.requestId===p.requestId).status='skipped';return clone(batch);},
  stop:async p=>{record('stop',p);const batch=batches.get(p.batchId);batch.paused=true;batch.stopped=true;for(const row of batch.rows)if(['queued','preparing'].includes(row.status))row.status='stopped';return clone(batch);},
 };
 return {api,calls,batches,hooks,count:name=>calls.filter(c=>c.name===name).length};
}

function harness(t,{service=fakeService(),table=makeTable(),revisions=new OptimizationRevisions(),recordId='r',instanceId='same-view'}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 const history=[],savedBatches=[];
 const controller=createOptimizationController({getTable:()=>table,identity:{documentId:'doc',tableId:'table'},revisions,persist(){},
  change(fn){history.push(clone(table));fn(table);},api:service.api,scope:'cell',fieldId:'p',recordId,instanceId,
  onBatch:(batchId,range)=>savedBatches.push({batchId,...range})});
 t.after(()=>controller.destroy());
 return {controller,service,table,revisions,history,savedBatches};
}

test('opening and estimating never calls submit, permit or remote advance',async t=>{
 const {controller:c,service:s}=harness(t);await flush();await c.estimate();
 assert.equal(c.getState().range.processable,1);assert.equal(c.getState().permissions.canSubmit,true);
 assert.deepEqual(s.calls.map(call=>call.name),['capabilities','estimate']);
});

for(const stage of ['lease','submit','permit'])test(`pause while awaiting ${stage} cannot be cleared by its late response`,async t=>{
 const {controller:c,service:s}=harness(t),entered=deferred(),release=deferred();
 s.hooks[stage]=async()=>{entered.resolve();await release.promise;};
 await flush();await c.estimate();const submitting=c.submit();
 if(stage==='permit'){await submitting;t.mock.timers.tick(1200);await flush();}
 await entered.promise;c.pause();release.resolve();await submitting;await flush();
 t.mock.timers.tick(2400);await flush();
 assert.equal(s.count('advance'),0,'A late response must not resume the paused lifecycle');
});

test('editing while lease is pending rejects the original quote without submission',async t=>{
 const {controller:c,service:s,table}=harness(t),entered=deferred(),release=deferred();
 s.hooks.lease=async()=>{entered.resolve();await release.promise;};
 await flush();await c.estimate();const submitting=c.submit();await entered.promise;
 table.records[0].values.p='已人工修改';c.observe();release.resolve();await submitting;
 assert.equal(s.count('submit'),0);assert.match(c.getState().error,/变化/);
});

test('two target controllers in the same view share the table lease identity',async t=>{
 const service=fakeService(),table=makeTable(),revisions=new OptimizationRevisions();
 const {controller:a}=harness(t,{service,table,revisions,recordId:'r'});
 // A second harness would enable mock timers twice, so construct its sibling directly.
 const b=createOptimizationController({getTable:()=>table,identity:{documentId:'doc',tableId:'table'},revisions,persist(){},change(){},
  api:service.api,scope:'cell',fieldId:'p',recordId:'r2',instanceId:'same-view'});t.after(()=>b.destroy());
 await flush();await a.estimate();await a.submit();await b.estimate();await b.submit();
 assert.equal(service.count('submit'),2);assert.equal(b.getState().error,'');
 assert.equal(new Set(service.calls.filter(c=>c.name==='lease').map(c=>c.p.instanceId)).size,1);
});

test('reused active batch restores only its authoritative request IDs without incrementing sequence',async t=>{
 const {controller:a,service:s,table,revisions}=harness(t);await flush();await a.estimate();await a.submit();
 const original=clone([...s.batches.values()][0]),seq=revisions.current(table,'r','p').requestSeq;a.destroy();
 s.hooks.submit=async()=>({...original,reusedExisting:true});
 const b=createOptimizationController({getTable:()=>table,identity:{documentId:'doc',tableId:'table'},revisions,persist(){},change(){},api:s.api,scope:'cell',fieldId:'p',recordId:'r',instanceId:'same-view'});t.after(()=>b.destroy());
 await flush();await b.estimate();await b.submit();
 assert.equal(b.getState().batchId,original.batchId);
 assert.deepEqual(b.getState().rows.map(r=>r.requestId),original.rows.map(r=>r.requestId));
 assert.equal(revisions.current(table,'r','p').requestSeq,seq);assert.equal(s.count('advance'),0);
});

test('unknown retry requires acknowledgment and sends original unknown request ID in the new submission',async t=>{
 const {controller:c,service:s}=harness(t);s.hooks.advance=async(batch,row)=>{row.status='unknown';};
 await flush();await c.estimate();await c.submit();t.mock.timers.tick(1200);await flush();
 const old=c.getState().rows[0].requestId,before=s.count('estimate');
 await c.retry();assert.equal(s.count('estimate'),before);assert.match(c.getState().error,/重复收费/);
 await c.retry({acknowledgeUnknown:true});await c.submit();
 const submissions=s.calls.filter(x=>x.name==='submit');assert.equal(submissions.length,2);
 assert.deepEqual(submissions[1].p.acknowledgeUnknownRequestIds,[old]);
 assert.notEqual(submissions[1].p.rows[0].requestId,old);
});

test('refresh recovery of preparing rows remains paused until explicit budget confirmation and continue',async t=>{
 const {controller:first,service:s,table,revisions}=harness(t);await flush();await first.estimate();await first.submit();
 const stored=[...s.batches.values()][0];stored.rows[0].status='preparing';stored.paused=true;stored.preflightSkipped=[{recordId:'empty',reason:'提示词为空'}];first.destroy();
 const c=createOptimizationController({getTable:()=>table,identity:{documentId:'doc',tableId:'table'},revisions:new OptimizationRevisions(revisions.serialize()),persist(){},change(){},api:s.api,scope:'cell',fieldId:'p',recordId:'r',instanceId:'same-view'});t.after(()=>c.destroy());
 await flush();await c.recover(stored.batchId);t.mock.timers.tick(1200);await flush();assert.equal(s.count('advance'),0);
 assert.equal(c.getState().permissions.canContinue,true);
 assert.deepEqual(c.getState().range,{total:2,processable:1,skipped:stored.preflightSkipped});
 await c.continue();assert.equal(s.count('continue'),0,'Fresh quote must be displayed before confirmation');
 await c.continue();t.mock.timers.tick(1200);await flush();assert.equal(s.count('advance'),1);
});

test('continue never reuses a new-attempt quote for the recovered frozen batch',async t=>{
 const {controller:c,service:s}=harness(t);await flush();await c.estimate();await c.submit();
 const stored=[...s.batches.values()][0];stored.paused=true;
 await c.recover(stored.batchId);assert.equal(c.getState().quote,null);
 await c.estimate();const newAttempt=s.calls.filter(x=>x.name==='estimate').at(-1).p.rows;
 assert.notDeepEqual(newAttempt,stored.rows.map(x=>x.snapshot));
 await c.continue();assert.equal(s.count('continue'),0);
 const original=s.calls.filter(x=>x.name==='estimate').at(-1).p.rows;
 assert.deepEqual(original,stored.rows.map(x=>x.snapshot));
 await c.continue();assert.equal(s.count('continue'),1);
});

test('continuation estimate cannot authorize a new request for a stopped batch',async t=>{
 const {controller:c,service:s}=harness(t);await flush();await c.estimate();await c.submit();await c.stop();
 await c.estimate();assert.equal(c.getState().permissions.canSubmit,true);
 await c.continue();assert.equal(c.getState().permissions.canSubmit,false);
 await c.submit();assert.equal(s.count('submit'),1);
});

test('leaving during continuation re-estimate discards the late quote',async t=>{
 const {controller:c,service:s}=harness(t);await flush();await c.estimate();await c.submit();
 await c.recover([...s.batches.keys()][0]);const entered=deferred(),release=deferred();
 s.hooks.estimate=async()=>{entered.resolve();await release.promise;};
 const pending=c.continue();await entered.promise;c.pause();release.resolve();await pending;
 assert.equal(c.getState().quote,null);assert.equal(s.count('continue'),0);assert.equal(s.count('advance'),0);
});

test('applied suggestion cannot be reapplied after undo/redo and request sequence never rewinds',async t=>{
 const {controller:c,service:s,table,revisions,history}=harness(t);s.hooks.advance=async(batch,row)=>{row.status='succeeded';row.suggestion={status:'valid',text:'一只白猫。'};};
 await flush();await c.estimate();await c.submit();t.mock.timers.tick(1200);await flush();
 const row=c.getState().rows[0];assert.equal(row.canApply,true);await c.apply(row.requestId);
 const applied=clone(table),high=revisions.current(table,'r','p'),count=history.length;
 Object.assign(table,clone(history[0]));c.observe();const undo=revisions.current(table,'r','p');
 assert.ok(undo.revision>high.revision);assert.equal(undo.requestSeq,high.requestSeq);
 await c.apply(row.requestId);assert.equal(history.length,count);
 Object.assign(table,applied);c.observe();assert.ok(revisions.current(table,'r','p').revision>undo.revision);
 assert.equal(s.count('advance'),1);
});

function mountHarness(t,{references=[],discovered=[]}={}){
 const table=makeTable(),identity={documentId:crypto.randomUUID(),tableId:crypto.randomUUID()},graph={};
 const node={graph,properties:{[NAMESPACE]:{tableId:identity.tableId,revisions:{},batches:clone(references)}}},calls=[];
 const fetchApi=async(url,options)=>{
  const action=url.split('/').at(-1),payload=JSON.parse(options.body);calls.push({action,payload});
  const result=action==='query'?{batches:clone(discovered)}:action==='recover'?{batchId:payload.batchId,rows:[]}
   :action==='capabilities'?{available:true,models:['gpt-4.1-mini']}:{status:'ready',quoteId:'estimate',expiresAt:Date.now()+300000};
  return {ok:true,json:async()=>result};
 };
 const mounts=[];
 function mount(){
  // Skip rendering the panel; exercise actual attach/discovery/recovery code.
  const editor={change(){},onTableChange(){return()=>{};},openTextSide(){}};
  const lifecycle=attachPromptOptimization({node,graph,editor,getTable:()=>table,identity,fetchApi});mounts.push(lifecycle);
  editor.openPromptOptimization({scope:'cell',fieldId:'p',recordId:'r'});return lifecycle;
 }
 t.after(()=>mounts.forEach(m=>m.destroy()));
 return {node,calls,mount,identity};
}

test('native history restoring old node properties retains known batch references on remount',async t=>{
 const reference={batchId:'durable-reference',scope:'cell',fieldId:'p',recordId:'r'};
 const {node,calls,mount,identity}=mountHarness(t,{references:[reference]});const first=mount();await flush();
 const before=calls.filter(c=>c.action==='recover').length;assert.ok(before>=1);first.destroy();
 node.properties[NAMESPACE]={tableId:identity.tableId,revisions:{},batches:[]};
 mount();await flush();
 const after=calls.filter(c=>c.action==='recover');assert.ok(after.length>before);
 assert.ok(after.every(c=>c.payload.batchId==='durable-reference'));
 assert.ok(node.properties[NAMESPACE].batches.some(b=>b.batchId==='durable-reference'));
});

test('server target discovery recovers batches absent from workflow references',async t=>{
 const summary={batchId:'server-only',scope:'cell',fieldId:'p',recordId:'r',updatedAt:100};
 const {node,calls,mount,identity}=mountHarness(t,{discovered:[summary]});mount();await flush();
 assert.deepEqual(calls.find(c=>c.action==='query').payload.target,identity);
 assert.deepEqual(calls.filter(c=>c.action==='recover').map(c=>c.payload.batchId),['server-only']);
 assert.ok(node.properties[NAMESPACE].batches.some(b=>b.batchId==='server-only'));
 assert.equal(calls.filter(c=>['submit','advance'].includes(c.action)).length,0);
});

test('newest server-discovered batch is recovered when summaries are newest-first',async t=>{
 const newer={batchId:'newer',scope:'cell',fieldId:'p',recordId:'r',updatedAt:200};
 const older={...newer,batchId:'older',updatedAt:100};
 const {calls,mount}=mountHarness(t,{discovered:[newer,older]});mount();await flush();
 assert.deepEqual(calls.filter(c=>c.action==='recover').map(c=>c.payload.batchId),['newer']);
});

test('recovery without trustworthy revision metadata keeps suggestions stale and non-applicable',async t=>{
 const table=makeTable(),sourceRevisions=new OptimizationRevisions();
 const frozen=await freezeSnapshot(table,{documentId:'doc',tableId:'table',recordId:'r',fieldId:'p'},sourceRevisions,{begin:true});
 const service=fakeService();service.batches.set('untrusted-revision',{batchId:'untrusted-revision',paused:true,rows:[{
  requestId:'old-request',snapshot:frozen.wire,status:'succeeded',suggestion:{status:'valid',text:'一只白猫。'},
 }]});
 const {controller:c,history}=harness(t,{service,table,revisions:new OptimizationRevisions()});await flush();await c.recover('untrusted-revision');
 assert.equal(c.getState().rows[0].suggestionStatus,'stale');assert.equal(c.getState().rows[0].canApply,false);
 await c.applyAll();assert.equal(history.length,0);assert.equal(table.records[0].values.p,'一只白猫，白色的猫。');
 assert.equal(service.count('advance'),0);
});
