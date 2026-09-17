import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { requestForStage as request87, promptForRequest as prompt87 } from './badge_execution_87_model.mjs?v=20260917-target87-1';
import { isBadge88, localMaterialNodeId88, usesLocalMaterials88 } from './badge_local_material_88_model.mjs?v=20260917-target87-1';
import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs?v=20260916-content-1';

export function requestForStage(graph, stage) {
    if (!isBadge88(graph)) throw new Error(badgeText("execution_88_model.text_001"));
    const h = readHierarchyState(graph.getNodeById(95));
    const multi = stage === 'local' && usesLocalMaterials88(graph, key => itemValue(h, key));
    // Hide inactive single-material fields from the legacy compiler without mutating the graph.
    const view = multi ? Object.assign(Object.create(graph), {getNodeById(id) {
        if (id === 104 || id === 106) return {id, mode: 0, widgets_values_named: {}};
        return graph.getNodeById(id);
    }}) : graph;
    const compiled = request87(view, stage);
    const request = {...compiled.request, workflow_version: '8.8'};
    if (multi) {
        const node = graph.getNodeById(localMaterialNodeId88(graph));
        const raw = node?.widgets?.find(w => w.name === 'badge_material_region_v1_panel')?.value
            ?? node?.widgets_values_named?.material_region_config;
        const config = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
        if (!config?.groups?.length) throw new Error(badgeText("execution_88_model.text_002"));
        request.edit_mode = 'region_materials';
        request.local_regions = config;
        delete request.colors; delete request.material; delete request.prompt;
    }
    return {request, fingerprint: JSON.stringify([compiled.fingerprint, request])};
}

export function promptForRequest(request, executorId = 200) {
    const prompt = prompt87(request, executorId);
    prompt[executorId].class_type = 'DAELAB.BadgeApp88V1';
    prompt[executorId]._meta.title = badgeText("execution_88_model.text_003");
    prompt['113']._meta.title = badgeText("execution_88_model.text_004");
    prompt['113'].inputs.filename_prefix = `Badge88/${request.stage}`;
    return prompt;
}
