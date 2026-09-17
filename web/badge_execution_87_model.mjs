import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { usesLocalRegions87, readLocalRegions87, activeLocalRegions87 } from './badge_local_regions_87_model.mjs?v=20260917-metal-color-1';
import { refinedBadge87, selectedBadgeModel, BADGE_MODELS, localTargetSize87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs?v=20260916-content-1';
import { stageSnapshot, readGenerationConfig, isPromptOnlyBuild } from './badge_generation_model.mjs?v=20260917-dimensions-2';
import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { migrateHeightBoard, fixedHeightBoard87 } from './badge_height_board_model.mjs?v=20260916-ui-2';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs?v=20260911-88-1';
import { getConnectedLoadImageInfo, getConnectedLoadImageKey } from './polygon_mask_connection.mjs';

export const BADGE87_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
export const isBadge87 = graph => graph?.extra?.daelabBadgeExecutionV1?.version === 1;
export function requestForStage(graph, stage) {
    if (!isBadge87(graph)) throw new Error(badgeText("execution_87_model.text_001"));
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
    const enabled = id => { if (!isNodeAvailableInAppMode(node(id))) throw new Error(badgeText("execution_87_model.text_002")); };
    let snapshot;
    if (stage === 'build' || stage === 'local') {
        snapshot = stageSnapshot(graph, stage);
        if (snapshot.error) throw new Error(snapshot.error);
    }
    const size = readGenerationConfig(graph, stage);
    const count = size.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error(badgeText("execution_87_model.text_003"));
    const request = { version: 1, model: refinedBadge87(graph) ? selectedBadgeModel(graph, stage) : BADGE87_IMAGE_MODEL, ...(refinedBadge87(graph) ? {interaction_revision: 2} : {}), stage, session: graph.id, width: size.width, height: size.height,
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
                if (refinedBadge87(graph)) request.height_board = fixedHeightBoard87(request.height_board);
            }
            if (!refinedBadge87(graph) && on('badge.path.flat_height.special_material')) request.regions = config(49, 'badge_material_region_v1_panel', 'material_region_config');
        }
    } else if (stage === 'local') {
        request.image = image(meta.localReferenceNodeId);
        request.selection = on('badge.post.local.selection.color') ? 'color' : 'polygon';
        request.use_map = request.selection === 'color' && on('badge.post.local.color_id_map');
        if (request.use_map) {
            const map = meta.gptColorMap;
            if (!map?.image || map.model !== (refinedBadge87(graph) ? selectedBadgeModel(graph, 'local') : BADGE87_IMAGE_MODEL) || map.sourceKey !== JSON.stringify(request.image)) throw new Error(badgeText("execution_87_model.text_004"));
            request.color_map = map.image;
            request.color_map_source = map.source;
        }
        if (request.selection === 'color') { if (!usesLocalRegions87(graph,on)) request.colors = config(104, 'multi_color_mask_v1_panel', 'config_json'); }
        else {
            const selectionNode = node(142);
            const expected = getConnectedLoadImageKey(getConnectedLoadImageInfo(selectionNode, graph));
            if (selectionNode.polygonWidget && (!expected || selectionNode.polygonWidget.imageValue !== expected)) {
                throw new Error(badgeText("execution_87_model.text_005"));
            }
            request.polygon = JSON.parse(selectionNode.properties?.polygon_info || value(142,'polygon_data') || '{}');
        }
        request.edit_mode = on('badge.post.local.semantic') ? 'semantic' : 'material';
        request.prompt = value(105, 'value') || '';
        if (request.edit_mode === 'material') request.material = material(106);
        if (usesLocalRegions87(graph, on)) {
            request.edit_mode = 'region_materials'; request.workflow_version = '8.7';
            request.local_regions = activeLocalRegions87(readLocalRegions87(graph));
            if (!request.local_regions.groups.length) throw new Error(badgeText('regions.empty'));
            delete request.material; delete request.colors; delete request.prompt;
        }
        request.apply = on('badge.post.local.apply');
    } else if (stage === 'studio' || stage === 'effect') {
        const id = stage === 'studio' ? meta.studioReferenceNodeId : 96;
        enabled(id);
        request.image = image(id);
        if (!request.image) throw new Error(stage === 'studio' ? badgeText("execution_87_model.text_006") : badgeText("execution_87_model.text_007"));
        if (stage === 'studio') {
            enabled(87);
            if (!on('badge.post.studio')) throw new Error(badgeText("execution_87_model.text_008"));
            request.prompt = value(87, 'value') || '';
            if (!request.prompt.trim()) throw new Error(badgeText("execution_87_model.text_009"));
        }
    } else throw new Error(badgeText("execution_87_model.text_010"));
    if ((stage === 'local' || stage === 'studio') && (refinedBadge87(graph) || !normalizeImageSelection(meta.paletteReference))) {
        request.original_image = image(1);
        // Rebuild the reference from the current source and its existing removal config.
        if (request.original_image && meta.backgroundEnabled !== false && isNodeAvailableInAppMode(node(47))) {
            request.original_background = config(47, 'multi_color_mask_v1_panel', 'config_json');
        }
    }
    const palette = refinedBadge87(graph) ? null : normalizeImageSelection(meta.paletteReference);
    if (palette) {
        request.color_reference = palette;
        delete request.original_image;
        delete request.original_background;
    }
    enabled(graph.extra.daelabBadgeExecutionV1.executorNodeId);
    return { request, fingerprint: JSON.stringify([snapshot?.fingerprint, request]) };
}

export function promptForRequest(request, executorId = 200) {
    if (request.interaction_revision === 2 && request.stage === 'local' && !request.apply) return {
        [executorId]: {class_type: 'DAELAB.BadgeApp87V1', inputs: {request_json: JSON.stringify(request)}}
    };
    return {
        [executorId]: { class_type: 'DAELAB.BadgeApp87V1', _meta: { title: badgeText("execution_87_model.text_011") }, inputs: { request_json: JSON.stringify(request) } },
        '113': { class_type: 'SaveImage', _meta: { title: badgeText("execution_87_model.text_012") }, inputs: { images: [String(executorId), 0], filename_prefix: `Badge87/${request.stage}` } },
    };
}
