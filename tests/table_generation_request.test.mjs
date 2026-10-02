import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../web/table_generation_api.mjs',import.meta.url),'utf8');
const tasks=readFileSync(new URL('../web/table_generation_tasks.mjs',import.meta.url),'utf8');
const requestSource=source.slice(source.indexOf('export async function request(')).replaceAll('export async function','async function');
test('an unresponsive status request aborts and releases its timer without submitting again',async()=>{
 let abort,cleared=false,calls=0;
 const context=vm.createContext({AbortController,setTimeout:fn=>{abort=fn;return 1;},clearTimeout:()=>{cleared=true;},fetch:(_url,{signal})=>{
  calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'}))));
 }});
 vm.runInContext(requestSource,context);
 const pending=context.request('status',{requestIds:['original']});abort();
 await assert.rejects(pending,/原任务仍保留/);
 assert.equal(calls,1);assert.equal(cleared,true);
});
test('a definite preflight rejection preserves submitted=false and clears its timer',async()=>{
 let cleared=false;
 const context=vm.createContext({AbortController,setTimeout:()=>1,clearTimeout:()=>{cleared=true;},fetch:async()=>({status:400,ok:false,json:async()=>({error:'invalid input',submitted:false})})});
 vm.runInContext(requestSource,context);
 await assert.rejects(context.request('submit',{jobs:[]}),error=>error.preflightRejected===true);
 assert.equal(cleared,true);
});
const labelSource=tasks.slice(tasks.indexOf('const stageNames='),tasks.indexOf('export const generationTaskStyle')).replaceAll('export function','function');
test('live stage text separates platform progress from local completion',()=>{
 const context=vm.createContext({});vm.runInContext(labelSource+';this.stageText=stageText;this.liveLabel=liveLabel;',context);
 const {stageText,liveLabel}=context;
 assert.equal(stageText(undefined,'waiting'),'排队中');
 assert.equal(stageText({stage:'preparing'},'running'),'准备中');
 assert.equal(stageText({stage:'generating',progress:35},'running'),'平台生成 35%');
 assert.equal(stageText({stage:'generating'},'running'),'平台生成');
 assert.equal(stageText({stage:'writing_back',progress:100},'running'),'等待写回');
 assert.equal(stageText({stage:'downloading',progress:100},'running'),'下载中');
 const label=liveLabel({stage:'generating',progress:35,taskId:'t1',detail:'正在查询原任务',updatedAt:1000},'running',13000);
 assert.match(label,/平台生成 35% · 任务 t1 · 正在查询原任务 · 最近确认 12 秒前/);
});
