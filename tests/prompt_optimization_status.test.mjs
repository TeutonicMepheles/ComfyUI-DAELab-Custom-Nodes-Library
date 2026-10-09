import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationStatus as status} from '../web/prompt_optimization_status.mjs';

test('pre-submit guidance explains each gate without implying a paid request',()=>{
 const ready={quote:{status:'ready',expiresAt:200},permissions:{canSubmit:true}};
 assert.equal(status({}, {now:100}).phase,'estimate');
 assert.equal(status({...ready,deepseekKeyRequired:true},{now:100}).phase,'key');
 assert.equal(status(ready,{now:100,keyDraft:true}).phase,'key');
 assert.equal(status(ready,{now:100,composing:true}).phase,'composing');
 assert.equal(status({quote:{status:'estimating'}}).phase,'estimating');
 assert.equal(status({quote:{status:'unavailable',reason:'目标为空'}}).detail,'目标为空');
 assert.equal(status(ready,{now:201}).phase,'expired');
 assert.equal(status(ready,{now:100}).phase,'ready');
 assert.equal(status({...ready,inactiveReason:'恢复 Active'},{now:100}).phase,'inactive');
 assert.equal(status({error:'服务不可达'}).phase,'error');
});

test('all request phases are observable; elapsed time is not a completion percentage',()=>{
 for(const name of ['submit','recover','stop','continue','apply'])assert.equal(status({operationName:name}).phase,name);
 const rows=[{status:'queued'},{status:'succeeded',canApply:true}];
 assert.equal(status({rows}).phase,'queued');
 const result=status({rows,requestActivity:{phase:'request',label:'第 1 行',startedAt:1000}},{now:5500});
 assert.equal(result.phase,'running');assert.equal(result.elapsed,4);assert.equal(result.settled,1);assert.equal(result.total,2);
 assert.match(result.detail,/未提供百分比/);assert.doesNotMatch(result.detail,/4 秒/);
 assert.equal(status({rows,paused:true}).phase,'paused');
 assert.equal(status({rows:[{status:'polling'}],paused:true,error:'断网'}).phase,'disconnected');
 assert.match(status({rows:[{status:'submitting'}],stopped:true}).detail,/当前请求等待返回/);
});

test('completion distinguishes valid, unchanged, applied, stale, invalid, unknown and stopped',()=>{
 const row={status:'succeeded',suggestionStatus:'valid',canApply:true};
 assert.equal(status({rows:[row]}).title,'优化完成，等待应用');
 assert.match(status({rows:[{status:'succeeded',suggestionStatus:'unchanged'}]}).detail,/原提示词保持不变/);
 assert.equal(status({rows:[{...row,suggestionStatus:'applied',canApply:false}]}).title,'建议已应用');
 assert.equal(status({rows:[{...row,suggestionStatus:'applied',canApply:false},row]}).title,'部分建议已应用');
 for(const r of [{status:'failed'},{status:'succeeded',suggestionStatus:'invalid'},{status:'succeeded',suggestionStatus:'stale'}])assert.equal(status({rows:[row,r]}).phase,'attention');
 assert.equal(status({rows:[row,{status:'unknown'}]}).phase,'unknown');
 assert.equal(status({rows:[{status:'stopped'}]}).phase,'stopped');
 assert.equal(status({rows:[{status:'stopped'}],stopped:true,permissions:{canContinue:true}}).phase,'paused');
 assert.equal(status({rows:[row],draftActive:true}).phase,'estimate');
});
