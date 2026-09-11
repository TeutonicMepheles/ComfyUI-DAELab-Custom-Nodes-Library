import { app } from '/scripts/app.js';
import { syncBadgeMediaScope87 } from './badge_media_scope_87.mjs';
import { isBadge87 } from './badge_execution_87_model.mjs';
import { getRootGraphSafely } from './app_mode_bypass_model.mjs';
import { stageSnapshot, stageNodeIds } from './badge_generation_model.mjs?v=20260909-prompt-only-1';
import { APPLY_ITEM, PROTOTYPE_PROPERTY, createPrototypeQueueHandler,
    isBadgePrototype, isSamePrototype, prototypeSnapshot, simulateRun } from './badge_app_prototype_model.mjs?v=2';

// An opt-in adapter. Existing workflows always delegate to ComfyUI unchanged.
const INSTALL_KEY = Symbol.for('DAELAB.BadgeAppPrototype.v1');
const sessions = new WeakMap();
let banner = null;
let bannerGraph = null;
function session(graph) {
    if (!sessions.has(graph) || sessions.get(graph).workflowId !== graph.id) sessions.set(graph, {
        workflowId: graph.id,
        phase: 'idle', preview: null, busy: false,
        message: '调整面板后点击模拟运行。上传图片作为原型参考素材。',
    });
    return sessions.get(graph);
}
function resetApply(graph) {
    if (!isBadgePrototype(graph)) return;
    graph.getNodeById(graph.extra[PROTOTYPE_PROPERTY].stateNodeId)
        ?.daelabBooleanHierarchyV1?.setItemValue(APPLY_ITEM, false);
}
function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
}
export function getPrototypeSession(graph, stage) {
    const state = session(graph);
    if (!stage) return state;
    state.stages ??= {};
    return state.stages[stage] ??= { phase: 'idle', preview: null, busy: false, message: isBadge87(graph) ? '就绪，点击生成。' : '' };
}
export async function run(graph, stage) {
    if (!isBadgePrototype(graph)) return;
    if (isBadge87(graph)) {
        stage ||= document.querySelector('[role="tablist"][aria-label="徽章工作流步骤"] [role="tab"][aria-selected="true"]')?.dataset.tabId;
        syncBadgeMediaScope87(graph, stage);
        const ids = ['build', 'local'].includes(stage) ? stageNodeIds(graph, stage) : stage === 'studio' ? [graph.extra.daelabBadgePrototypeV1.studioReferenceNodeId, 87] : [];
        for (const node of ids.map(id => graph.getNodeById(id)).filter(Boolean)) {
            for (const widget of node.widgets || []) widget.beforeQueued?.();
        }
        const { execute87 } = await import('./badge_execution_87.mjs?v=20260911-media-restore');
        return execute87(graph, stage, getPrototypeSession(graph, stage), app, nativeQueue, getPrototypeSession(graph, 'local'));
    }
    const workflowId = graph.id;
    const state = getPrototypeSession(graph, stage);
    if (state.busy) return;
    // Flush deferred color/polygon values just as a real queue submission would.
    const nodes = stage ? stageNodeIds(graph, stage).map(id => graph.getNodeById(id)).filter(Boolean) : graph._nodes || [];
    for (const node of nodes) {
        for (const widget of node.widgets || []) widget.beforeQueued?.();
    }
    const takeSnapshot = () => stage ? stageSnapshot(graph, stage) : prototypeSnapshot(graph);
    const snapshot = takeSnapshot();
    state.busy = true;
    state.message = '正在模拟流程…';
    sync();
    await new Promise(resolve => setTimeout(resolve, 400));
    // Never apply completion to a different workflow or a changed draft.
    if (!isSamePrototype(graph, workflowId)) {
        state.busy = false;
        return;
    }
    if (getRootGraphSafely(app) !== graph || takeSnapshot().fingerprint !== snapshot.fingerprint) {
        state.busy = false;
        state.preview = null;
        state.phase = 'changed';
        state.message = '操作条件已变化，请重新模拟。';
        if (stage !== 'build') resetApply(graph);
    } else {
        Object.assign(state, simulateRun(state, snapshot), { busy: false });
        if (stage !== 'build' && state.resetApply) resetApply(graph);
    }
    sync();
}
function sync() {
    const graph = getRootGraphSafely(app);
    syncBadgeMediaScope87(graph);
    const root = document.querySelector('[data-testid="linear-widgets"]');
    if (!isBadgePrototype(graph) || !root) {
        banner?.remove(); banner = null; bannerGraph = null;
        return;
    }
    const buildTab = graph.extra?.daelabAppLayoutV1?.tabs?.find(t => t.id === 'build');
    if (buildTab && buildTab.title !== '效果图生成') buildTab.title = '效果图生成';
    for (const [id, heading] of [[47,'标注背景与镂空区域，避免模型误判'],[49,'标注特殊材质的区域，默认整体为烤漆'],[3,'标注徽章的结构层次']]) {
        const node = graph.getNodeById(id);
        if (node) {
            node.properties ??= {}; node.properties.daelab_app_heading = heading;
            const names = {47:'multi_color_mask_v1_panel',49:'badge_material_region_v1_panel',3:'badge_height_layer_v1_panel'};
            const widget = node.widgets?.find(w => w.name === names[id]);
            if (widget) widget.label = heading;
        }
    }
    const state = session(graph);
    const snapshot = prototypeSnapshot(graph);
    if (state.preview && state.preview !== snapshot.fingerprint) {
        state.preview = null;
        state.phase = 'changed';
        state.message = '配置已变化，原型确认已失效，请重新模拟预览。';
        resetApply(graph);
    }
    if (!banner?.isConnected || banner.parentElement !== root || bannerGraph !== graph) {
        banner?.remove();
        bannerGraph = graph;
        banner = document.createElement('section');
        banner.dataset.daelabBadgePrototype = '1';
        banner.style.cssText = 'border:1px solid #547982;border-radius:10px;padding:12px;margin:8px 0;background:#172c32;color:#e4f3f6;flex:none;font-size:13px;line-height:1.6';
        const heading = document.createElement('strong');
        heading.textContent = '交互原型 · 不生成图片';
        const description = document.createElement('p');
        description.textContent = '独立于 #8.6 生成流程。局部参考图和棚拍主图由你上传；色彩分区图使用本地色彩简化预览。';
        description.style.margin = '4px 0 8px';
        const status = document.createElement('p');
        status.dataset.prototypeStatus = '1';
        status.setAttribute('role', 'status');
        status.style.margin = '4px 0 8px';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '模拟运行';
        button.style.cssText = 'background:#aad9cf;color:#10272a;border:0;border-radius:6px;padding:7px 15px;cursor:pointer';
        button.addEventListener('click', () => void run(graph));
        banner.append(heading, description, status, button);
        root.prepend(banner);
    }
    banner.dataset.phase = state.phase;
    setText(banner.querySelector('[data-prototype-status]'), state.message);
    banner.querySelector('button').disabled = state.busy;
}
let nativeQueue;
export function getBadgeNativeQueue() { return nativeQueue; }
app.registerExtension({
    name: 'DAELAB.BadgeAppPrototype',
    afterConfigureGraph() { syncBadgeMediaScope87(getRootGraphSafely(app), 'build'); },
    setup() {
        if (app[INSTALL_KEY]) return;
        app[INSTALL_KEY] = true;
        nativeQueue = app.queuePrompt;
        app.queuePrompt = createPrototypeQueueHandler(app.queuePrompt, () => getRootGraphSafely(app), run);
        setInterval(sync, 300);
    },
});
