import {app} from '/scripts/app.js';
import {prepareWorkflowIdentity} from './prompt_optimization_model.mjs';

app.registerExtension({
 name:'DAELab.PromptOptimization.Identity.v1',
 beforeConfigureGraph(data){prepareWorkflowIdentity(data);},
});
