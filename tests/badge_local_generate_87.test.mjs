import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/badge_execution_87.mjs',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')
    .replace("    const { api } = await import('/scripts/api.js');",'');
const factory=new Function('api','requestForStage','promptForRequest','getRootGraphSafely','queueBadge87','updateLocalTarget87',source+'\nreturn execute87;');
async function run(fail=false,change=false) {
    const graph={id:'test',extra:{daelabBadgeExecutionV1:{executorNodeId:200}},serialize:()=>({nodes:[]}),getNodeById:()=>({})};
    const app={rootGraph:graph}, state={}, submitted=[];
    const history={task:{
        status:fail?{status_str:'error',messages:[['execution_error',{exception_message:'Selected region is empty'}]]}:{status_str:'success'},
        outputs:{200:{badge87_report:[{preview_token:'token'}]},113:{images:[{filename:'result.png'}]}}
    }};
    const api={fetchApi:async()=>({ok:true,json:async()=>history})};
    let reads=0;
    const execute=factory(api,()=>({request:{stage:'local',apply:false},fingerprint:change&&++reads>2?'changed':'current'}),request=>request,
        ()=>graph,async(a,b,c,d,compiled)=>{submitted.push(compiled.output.apply);return {prompt_id:'task'}},()=>false);
    await execute(graph,'local',state,app,()=>{},state);
    return {submitted,state};
}
test('one generation action validates then applies without a preview click',async()=>{
    const {submitted,state}=await run();
    assert.deepEqual(submitted,[false,true]);assert.equal(state.phase,'applied');
});
test('an empty region stops before a billable apply task',async()=>{
    const {submitted,state}=await run(true);
    assert.deepEqual(submitted,[false]);assert.match(state.message,/empty/);
});
test('selection changes between validation and apply block stale execution',async()=>{
    const {submitted,state}=await run(false,true);
    assert.deepEqual(submitted,[false]);assert.equal(state.phase,'error');
});
