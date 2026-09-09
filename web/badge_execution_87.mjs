import { requestForStage, promptForRequest } from './badge_execution_87_model.mjs?v=20260909-prompt-only-1';
import { getRootGraphSafely } from './app_mode_bypass_model.mjs';
import { queueBadge87 } from './badge_execution_87_queue.mjs';
import { updateLocalTarget87 } from './badge_result_target_87.mjs';

// No replacement controls or DOM listeners: the original stage runner delegates here.
export async function execute87(graph, stage, state, app, nativeQueue, localSession, validateOnly = false) {
    const { api } = await import('/scripts/api.js');
    stage ||= document.querySelector('[role="tablist"][aria-label="徽章工作流步骤"] [role="tab"][aria-selected="true"]')?.dataset.tabId;
    if (!['build','local','studio'].includes(stage)) {
        state.message = '请进入需要生成的阶段。'; return;
    }
    if (state.busy) return;
    if (stage === 'local' && !validateOnly) {
        await execute87(graph, stage, state, app, nativeQueue, localSession, true);
        if (state.phase !== 'preview-ready') return;
    }
    const workflowId = graph.id;
    let fingerprint;
    state.busy = true; state.message = '正在提交生成任务…';
    try {
        const compiled = requestForStage(graph, stage);
        const request = compiled.request;
        if (stage === 'local') request.apply = !validateOnly;
        fingerprint = compiled.fingerprint;
        if (stage === 'local' && request.apply) {
            if (state.preview !== fingerprint || !state.serverToken) throw new Error('选区已变化，请重新点击生成。');
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
        state.message = '生成中…';
        const deadline = Date.now()+20*60*1000;
        let history;
        while (Date.now() < deadline) {
            const response = await api.fetchApi(`/history/${encodeURIComponent(queued.prompt_id)}`);
            if (!response.ok) throw new Error(`读取生成状态失败 (${response.status})`);
            const records = await response.json();
            history = records[queued.prompt_id];
            if (history) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!history) throw new Error('等待生成超时，请查看任务队列；任务可能仍在运行。');
        if (history.status?.status_str === 'error') {
            const failure = history.status.messages?.find(([type]) => type === 'execution_error')?.[1];
            throw new Error(failure?.exception_message || '生成任务失败，请查看任务记录。');
        }
        const current = getRootGraphSafely(app) === graph && graph.id === workflowId;
        if (!current || requestForStage(graph, stage).fingerprint !== fingerprint) {
            state.preview = null; state.serverToken = null; state.phase = 'changed';
            state.message = '配置已变化，结果保存在任务记录中，请重新生成。'; return;
        }
        const report = history.outputs?.[String(executorId)]?.badge87_report?.[0];
        const images = history.outputs?.['113']?.images;
        if (!images?.length) throw new Error('生成任务未返回图片。');
        state.preview = fingerprint;
        state.serverToken = report?.preview_token;
        state.phase = stage === 'local' ? request.apply ? 'applied' : 'preview-ready' : 'complete';
        state.message = state.phase === 'preview-ready' ? '选区已验证，正在应用修改…' : '生成完成。';
        if (state.phase !== 'preview-ready') {
            app.nodeOutputs = {...app.nodeOutputs, '113': {images}};
            graph.getNodeById(113)?.onExecuted?.({images});
            state.images = images;
            state.seed = undefined;
            if (stage === 'build' && updateLocalTarget87(graph, images[0], localSession)) {
                state.message = '生成完成，已更新局部编辑目标图。';
            }
        }
    } catch (error) {
        state.phase = 'error'; state.preview = null; state.serverToken = null;
        state.message = error?.message || String(error);
        if (getRootGraphSafely(app) === graph && graph.id === workflowId && stage === 'local') graph.getNodeById(95)?.daelabBooleanHierarchyV1?.setItemValue('badge.post.local.apply', false);
    } finally { state.busy = false; }
}
