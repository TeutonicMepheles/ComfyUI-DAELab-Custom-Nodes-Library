import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs';
import { stageSnapshot, readGenerationConfig, isPromptOnlyBuild } from './badge_generation_model.mjs?v=20260909-prompt-only-1';
import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { migrateHeightBoard } from './badge_height_board_model.mjs';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { getConnectedLoadImageInfo, getConnectedLoadImageKey } from './polygon_mask_connection.mjs';

export const isBadge87 = graph => graph?.extra?.daelabBadgeExecutionV1?.version === 1;
export function requestForStage(graph, stage) {
    if (!isBadge87(graph)) throw new Error('Not a Badge 8.7 workflow.');
    const meta = graph.extra.daelabBadgePrototypeV1;
    const h = readHierarchyState(graph.getNodeById(95));
    const on = id => itemValue(h, id);
    const node = id => graph.getNodeById(id);
    const value = (id, name) => node(id)?.widgets?.find(w => w.name === name)?.value ?? node(id)?.widgets_values_named?.[name];
    const config = (id, panel, stored) => {
        const text = value(id, panel) ?? value(id, stored) ?? '{}';
        return typeof text === 'string' ? JSON.parse(text) : structuredClone(text);
    };
    const material = id => Object.fromEntries(['material_id','base_prompt','additional_details'].map(k => [k, value(id,k) || '']));
    const image = id => normalizeImageSelection(value(id, 'image'));
    const enabled = id => { if (!isNodeAvailableInAppMode(node(id))) throw new Error('当前阶段输入被静音或跳过。'); };
    let snapshot;
    if (stage === 'build' || stage === 'local') {
        snapshot = stageSnapshot(graph, stage);
        if (snapshot.error) throw new Error(snapshot.error);
    }
    const size = readGenerationConfig(graph, stage);
    const count = size.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('生成个数必须为 1–8 张。');
    const request = { version: 1, stage, session: graph.id, width: size.width, height: size.height,
        quality: graph.extra.daelabBadgeExecutionV1.quality || 'low', count, seed: 0 };
    if (stage === 'build') {
        request.prompt = meta.buildPrompt || '';
        request.prompt_only = isPromptOnlyBuild(graph);
        request.image = request.prompt_only ? null : image(1);
        if (request.image) {
            request.material = material(55);
            if (meta.backgroundEnabled !== false) request.background = config(47, 'multi_color_mask_v1_panel', 'config_json');
            if (meta.heightEnabled !== false) {
                request.height_image = image(2);
                request.height_board = meta.heightBoard || migrateHeightBoard(config(3, 'badge_height_layer_v1_panel', 'height_layer_config'));
            }
            if (on('badge.path.flat_height.special_material')) request.regions = config(49, 'badge_material_region_v1_panel', 'material_region_config');
        }
    } else if (stage === 'local') {
        request.image = image(meta.localReferenceNodeId);
        request.selection = on('badge.post.local.selection.color') ? 'color' : 'polygon';
        request.use_map = request.selection === 'color' && on('badge.post.local.color_id_map');
        if (request.use_map) {
            const map = meta.gptColorMap;
            if (!map?.image || map.sourceKey !== JSON.stringify(request.image)) throw new Error('请先为当前目标图生成 GPT 色彩分区图。');
            request.color_map = map.image;
            request.color_map_source = map.source;
        }
        if (request.selection === 'color') request.colors = config(104, 'multi_color_mask_v1_panel', 'config_json');
        else {
            const selectionNode = node(142);
            const expected = getConnectedLoadImageKey(getConnectedLoadImageInfo(selectionNode, graph));
            if (selectionNode.polygonWidget && (!expected || selectionNode.polygonWidget.imageValue !== expected)) {
                throw new Error('画笔 / Polygon 正在同步当前目标图，请等待底图加载完成后重新预览选区；加载失败时可点击 Load Image 重试。');
            }
            request.polygon = JSON.parse(selectionNode.properties?.polygon_info || value(142,'polygon_data') || '{}');
        }
        request.edit_mode = on('badge.post.local.semantic') ? 'semantic' : 'material';
        request.prompt = value(105, 'value') || '';
        if (request.edit_mode === 'material') request.material = material(106);
        request.apply = on('badge.post.local.apply');
    } else if (stage === 'studio' || stage === 'effect') {
        const id = stage === 'studio' ? meta.studioReferenceNodeId : 96;
        enabled(id);
        request.image = image(id);
        if (!request.image) throw new Error(stage === 'studio' ? '请上传棚拍前主图。' : '请上传现有效果图。');
        if (stage === 'studio') {
            enabled(87);
            if (!on('badge.post.studio')) throw new Error('请先启用棚拍。');
            request.prompt = value(87, 'value') || '';
            if (!request.prompt.trim()) throw new Error('请填写棚拍提示词。');
        }
    } else throw new Error('Unsupported stage.');
    enabled(graph.extra.daelabBadgeExecutionV1.executorNodeId);
    return { request, fingerprint: request.use_map ? JSON.stringify([snapshot?.fingerprint, request.color_map]) : snapshot?.fingerprint ?? JSON.stringify(request) };
}

export function promptForRequest(request, executorId = 200) {
    return {
        [executorId]: { class_type: 'DAELAB.BadgeApp87V1', _meta: { title: '#8.7 阶段执行' }, inputs: { request_json: JSON.stringify(request) } },
        '113': { class_type: 'SaveImage', _meta: { title: '#8.7 生成结果' }, inputs: { images: [String(executorId), 0], filename_prefix: `Badge87/${request.stage}` } },
    };
}
