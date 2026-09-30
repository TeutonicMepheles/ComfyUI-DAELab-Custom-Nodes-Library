import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
// The native queue owns sign-in, token refresh, job tracking and errors. Supply
// only this workflow's compiled prompt during its submission, then restore hooks.
export async function queueBadge87(app, api, nativeQueue, graph, compiled) {
    if (app.processingQueue || typeof nativeQueue !== 'function') throw new Error(badgeText("execution_87_queue.text_001"));
    const graphToPrompt = app.graphToPrompt;
    const queuePrompt = api.queuePrompt;
    let queued;
    let failure;
    app.graphToPrompt = async function(target = this.rootGraph) {
        if (this.rootGraph !== graph || target !== graph) throw new Error(badgeText("execution_87_queue.text_002"));
        return compiled;
    };
    api.queuePrompt = async function(number, prompt, options) {
        try {
            const result = await queuePrompt.call(this, number, prompt, options);
            if (prompt === compiled) queued = result;
            return result;
        } catch (error) { failure = error; throw error; }
    };
    try {
        await nativeQueue.call(app, 0, 1);
        if (!queued?.prompt_id) throw failure || new Error(badgeText("execution_87_queue.text_003"));
        return queued;
    } finally {
        app.graphToPrompt = graphToPrompt;
        api.queuePrompt = queuePrompt;
    }
}
