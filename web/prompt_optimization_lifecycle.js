import {app} from '/scripts/app.js';
import {prepareWorkflowIdentity} from './prompt_optimization_model.mjs';
import {preserveWorkflowGenerationHistory} from './prompt_optimization_workflow_history.mjs';

app.registerExtension({
 name:'DAELab.PromptOptimization.Identity.v1',
 beforeConfigureGraph(data){
  prepareWorkflowIdentity(data);
  if(!app.isGraphReady)return;
  const result=preserveWorkflowGenerationHistory(app.rootGraph,data);
  if(result.blocked.length)app.extensionManager?.toast?.add?.({severity:'warn',summary:'保留当前生成任务',detail:'历史版本与当前任务结构不兼容，已保留相关表格及生成结果。',life:7000});
 },
});
