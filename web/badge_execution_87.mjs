import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { isBadge88 } from './badge_local_material_88_model.mjs?v=20260917-target87-1';
import { requestForStage as request88, promptForRequest as prompt88 } from './badge_execution_88_model.mjs?v=20260917-target87-1';
import { requestForStage as request87, promptForRequest as prompt87 } from './badge_execution_87_model.mjs?v=20260917-target87-1';
import { getRootGraphSafely } from './app_mode_bypass_model.mjs?v=20260911-88-1';
import { queueBadge87 } from './badge_execution_87_queue.mjs?v=20260916-content-1';
import { updateLocalTarget87 } from './badge_result_target_87.mjs?v=20260917-target87-1';

// No replacement controls or DOM listeners: the original stage runner delegates here.
export async function execute87(graph, stage, state, app, nativeQueue, localSession, validateOnly = false) {
    const requestForStage = isBadge88(graph) ? request88 : request87;
    const promptForRequest = isBadge88(graph) ? prompt88 : prompt87;
    const { api } = await import('/scripts/api.js');
    stage ||= document.querySelector(`[role="tablist"][aria-label=${JSON.stringify(badgeText("app_layout.text_005"))}] [role="tab"][aria-selected="true"]`)?.dataset.tabId;
    if (!['build','local','studio'].includes(stage)) {
        state.message = badgeText("execution_87.text_002"); return;
    }
    if (state.busy) return;
    if (stage === 'local' && !validateOnly) {
        await execute87(graph, stage, state, app, nativeQueue, localSession, true);
        if (state.phase !== 'preview-ready') return;
    }
    const workflowId = graph.id;
    let fingerprint;
    state.busy = true; state.message = badgeText("execution_87.text_003");
    try {
        const compiled = requestForStage(graph, stage);
        const request = compiled.request;
        if (stage === 'local') request.apply = !validateOnly;
        fingerprint = compiled.fingerprint;
        if (stage === 'local' && request.apply) {
            if (state.preview !== fingerprint || !state.serverToken) throw new Error(badgeText("execution_87.text_004"));
            request.preview_token = state.serverToken;
        }
        request.nonce = crypto.randomUUID();
        request.seed = state.seed ??= Math.floor(Math.random()*2147483647);
        const executorId = graph.extra.daelabBadgeExecutionV1.executorNodeId;
        const workflow = graph.serialize();
        const executor = workflow.nodes.find(n => n.id === executorId);
        if (executor) { executor.widgets_values = [JSON.stringify(request)]; executor.widgets_values_named = {request_json: JSON.stringify(request)}; }
        const queued = await queueBadge87(app, api, nativeQueue, graph, {output: promptForRequest(request, executorId), workflow});
        state.promptId = queued.prompt_id;
        state.message = badgeText("execution_87.text_005");
        const deadline = Date.now()+20*60*1000;
        let history;
        while (Date.now() < deadline) {
            const response = await api.fetchApi(`/history/${encodeURIComponent(queued.prompt_id)}`);
            if (!response.ok) throw new Error(badgeText("execution_87.text_006", {p0: (response.status)}));
            const records = await response.json();
            history = records[queued.prompt_id];
            if (history) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!history) throw new Error(badgeText("execution_87.text_007"));
        if (history.status?.status_str === 'error') {
            const failure = history.status.messages?.find(([type]) => type === 'execution_error')?.[1];
            throw new Error(failure?.exception_message || badgeText("execution_87.text_008"));
        }
        const current = getRootGraphSafely(app) === graph && graph.id === workflowId;
        if (!current || requestForStage(graph, stage).fingerprint !== fingerprint) {
            state.preview = null; state.serverToken = null; state.phase = 'changed';
            state.message = badgeText("execution_87.text_009"); return;
        }
        const report = history.outputs?.[String(executorId)]?.badge87_report?.[0];
        const images = history.outputs?.['113']?.images;
        if (!(request.interaction_revision === 2 && stage === 'local' && !request.apply) && !images?.length) throw new Error(badgeText("execution_87.text_010"));
        state.preview = fingerprint;
        state.serverToken = report?.preview_token;
        state.phase = stage === 'local' ? request.apply ? 'applied' : 'preview-ready' : 'complete';
        state.message = state.phase === 'preview-ready' ? badgeText("execution_87.text_011") : badgeText("execution_87.text_012");
        if (state.phase !== 'preview-ready') {
            app.nodeOutputs = {...app.nodeOutputs, '113': {images}};
            graph.getNodeById(113)?.onExecuted?.({images});
            state.images = images;
            state.seed = undefined;
            if (stage === 'build') {
                const updated = updateLocalTarget87(graph, images, localSession);
                state.message = updated ? badgeText("execution_87.text_013", {p0: (images.length)}) : badgeText("execution_87.text_014", {p0: (images.length)});
            }
        }
    } catch (error) {
        state.phase = 'error'; state.preview = null; state.serverToken = null;
        state.message = error?.message || String(error);
        if (getRootGraphSafely(app) === graph && graph.id === workflowId && stage === 'local') graph.getNodeById(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
    } finally { state.busy = false; }
}
