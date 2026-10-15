import test from 'node:test';
import assert from 'node:assert/strict';
import {createLLMTask} from '../web/llm_task_model.mjs';
test('capsules count completed rows, with no invented inference percentage',()=>{
 const task=createLLMTask(()=>100);task.start(2,'reverse','qwen');
 assert.equal(task.snapshot()[0].done,0);assert.equal(task.snapshot()[0].progress,undefined);
 task.completeRow();assert.equal(task.snapshot()[0].done,1);
 task.completeRow();task.finish();assert.equal(task.snapshot()[0].state,'success');assert.equal(task.snapshot()[0].finishedAt,100);
});
test('failure preserves completed count and instance snapshots are isolated',()=>{
 const a=createLLMTask(),b=createLLMTask();a.start(2,'polish','qwen');a.completeRow();a.fail('连接失败');
 assert.equal(a.snapshot()[0].done,1);assert.equal(a.snapshot()[0].state,'error');assert.deepEqual(b.snapshot(),[]);
 const copy=a.snapshot();copy[0].done=99;assert.equal(a.snapshot()[0].done,1);
 a.start(1,'reverse','qwen');assert.equal(a.snapshot()[0].done,0);assert.equal(a.snapshot()[0].finishedAt,undefined);
});
