import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';

// Shared controls keep their established behavior outside Badge 8.7.
export const refinedBadge87 = graph => graph?.extra?.daelabBadgeExecutionV1?.version === 1
    && graph?.extra?.daelabBadgeLocalMaterialsV1?.version !== 1;
export const BADGE_MODELS = [
    ['gpt-image-2.5-sunburst', 'GPT-Image-2.5 Sunburst'],
    ['gpt-image-2.5-flare', 'GPT-Image-2.5 Flare'],
    ['gpt-image-2', 'GPT-Image-2'],
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
