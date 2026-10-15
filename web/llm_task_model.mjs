// Runtime-only business snapshot; the canvas owns capsule rendering and expiry.
export function createLLMTask(clock=Date.now){
    let task=null;
    return {
        start(total,mode,provider){task={id:'llm-generate',label:mode==='reverse'?'图片反推':'提示词优化',state:'running',done:0,total,countLabel:'完成',startedAt:clock(),elapsed:true,detail:provider==='mock'?'流程测试':''};},
        completeRow(){if(task?.state==='running')task={...task,done:task.done+1};},
        finish(){if(task)task={...task,state:'success',detail:'待确认',finishedAt:clock(),elapsed:false};},
        fail(detail){if(task)task={...task,state:'error',detail,elapsed:false};},
        snapshot(){return task?[{...task}]:[];},
    };
}
