import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';

// Shared controls keep their established behavior outside Badge 8.7.
export const refinedBadge87 = graph => graph?.extra?.daelabBadgeExecutionV1?.version === 1
    && graph?.extra?.daelabBadgeLocalMaterialsV1?.version !== 1;
export const removedMaterial87 = value => ['rhinestone', '水钻'].includes(String(value).trim());
export const BADGE_MODELS = [
    ['gpt-image-2.5-sunburst', badgeText("badge_refinement_87.extra_001")],
    ['gpt-image-2.5-flare', badgeText("badge_refinement_87.extra_002")],
    ['gpt-image-2', badgeText("badge_refinement_87.extra_003")],
];
export const selectedBadgeModel = (graph, stage = 'build') =>
    graph.extra?.daelabBadgePrototypeV1?.generation?.[stage]?.model || BADGE_MODELS[0][0];
const imageKey = value => JSON.stringify(normalizeImageSelection(value));
// Symbol state survives versioned imports without entering workflow JSON.
const sizeKey = Symbol.for('DAELAB.Badge87.decodedTargetSize');
export function setLocalTargetSize87(graph, source, width, height) {
    graph[sizeKey] = { key: imageKey(source), width, height };
}
export function localTargetSize87(graph) {
    const node = graph.getNodeById(graph.extra.daelabBadgePrototypeV1.localReferenceNodeId);
    const source = node?.widgets?.find(w => w.name === 'image')?.value ?? node?.widgets_values_named?.image;
    const record = graph[sizeKey];
    return record?.key === imageKey(source) ? { width: record.width, height: record.height } : { width: null, height: null };
}
