import { badgeText } from './badge_ui_text.mjs?v=20260917-dimensions-2';
import { usesLocalRegions87, readLocalRegions87 } from './badge_local_regions_87_model.mjs?v=20260917-metal-color-1';
import { refinedBadge87, selectedBadgeModel, BADGE_MODELS, localTargetSize87, removedMaterial87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { usesLocalMaterials88, localMaterialNodeId88 } from './badge_local_material_88_model.mjs?v=20260917-target87-1';
import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs?v=20260916-content-1';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs?v=20260911-88-1';

export const RATIOS = ['1:1', '2:3', '3:2', '16:9', '9:16'];
export const SIZE_PRESETS = ['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048'];
export const DEFAULT_CONFIG = Object.freeze({ ratio: '1:1', tier: '1K', width: 1024, height: 1024, custom: false, locked: true });
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function classifyPresets(sizes = SIZE_PRESETS) {
    return sizes.flatMap(size => {
        if (!/^\d+x\d+$/.test(size)) return [];
        const [width, height] = size.split('x').map(Number), divisor = gcd(width, height);
        const ratio = `${width / divisor}:${height / divisor}`, edge = Math.max(width, height);
        if (!RATIOS.includes(ratio) || edge > 2048) return [];
        return [{ size, width, height, ratio, tier: edge <= 1536 ? '1K' : '2K' }];
    });
}
// Badge 8.7 can send custom dimensions beyond the model's fixed size enum.
export function generationPresets87(sizes = SIZE_PRESETS) {
    const presets = classifyPresets(sizes);
    for (const [ratio, tier, width, height] of [['2:3', '2K', 2048, 3072], ['3:2', '2K', 3072, 2048], ['16:9', '1K', 1536, 864], ['9:16', '1K', 864, 1536]]) {
        if (!presets.some(p => p.ratio === ratio && p.tier === tier)) {
            presets.push({ size: 'Custom', width, height, ratio, tier });
        }
    }
    return presets;
}
export function readGenerationConfig(graph, stage) {
    const { prompt: _removedPrompt, ...saved } = graph.extra?.daelabBadgePrototypeV1?.generation?.[stage] || {};
    return { ...DEFAULT_CONFIG, ...saved, ...(refinedBadge87(graph) ? { model: selectedBadgeModel(graph, stage), ...(stage === 'local' ? {...localTargetSize87(graph), count: 1} : {}) } : {}) };
}
export function validateDimensions({ width, height }) {
    if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 3840)) return badgeText("generation_model.text_001");
    if (width % 16 || height % 16) return badgeText("generation_model.text_002");
    if (Math.max(width, height) / Math.min(width, height) > 3) return badgeText("generation_model.text_003");
    const pixels = width * height;
    return pixels < 655360 || pixels > 8294400 ? badgeText("generation_model.text_004") : '';
}
export function generationParameters(config) {
    const error = validateDimensions(config);
    if (error) throw new Error(error);
    return { model: config.model || 'gpt-image-2', 'model.size': config.custom || config.size === 'Custom' ? 'Custom' : `${config.width}x${config.height}`,
        'model.custom_width': config.width, 'model.custom_height': config.height };
}
export function editDimension(config, axis, value) {
    const next = { ...config, [axis]: value, custom: true };
    if (config.locked && Number.isFinite(value)) {
        const [w, h] = config.ratio.split(':').map(Number);
        next[axis === 'width' ? 'height' : 'width'] = Math.round(value * (axis === 'width' ? h / w : w / h) / 16) * 16;
    }
    return next;
}
export function isPromptOnlyBuild(graph) {
    const saved = graph.extra.daelabBadgePrototypeV1.promptOnly;
    if (typeof saved === 'boolean') return saved;
    const n = graph.getNodeById(1);
    const image = n?.widgets?.find(w => w.name === 'image')?.value ?? n?.widgets_values_named?.image;
    return !image && Boolean(String(graph.extra.daelabBadgePrototypeV1.buildPrompt || '').trim());
}
export function initializePromptOnlyBuild(graph) {
    const meta = graph.extra.daelabBadgePrototypeV1;
    if (typeof meta.promptOnly !== 'boolean') meta.promptOnly = isPromptOnlyBuild(graph);
    return meta.promptOnly;
}
export function stageNodeIds(graph, stage) {
    const h = readHierarchyState(graph.getNodeById(graph.extra.daelabBadgePrototypeV1.stateNodeId));
    const on = suffix => itemValue(h, suffix);
    if (stage === 'build' && isPromptOnlyBuild(graph)) return [];
    if (stage === 'build') return [1, 55,
        ...(graph.extra.daelabBadgePrototypeV1.backgroundEnabled !== false ? [47] : []),
        ...(!refinedBadge87(graph) && on('badge.path.flat_height.special_material') ? [49] : []),
        ...(graph.extra.daelabBadgePrototypeV1.heightEnabled !== false ? [2, 3] : [])];
    if (stage === 'local' && usesLocalMaterials88(graph, on)) return [graph.extra.daelabBadgePrototypeV1.localReferenceNodeId, localMaterialNodeId88(graph)];
    if (stage === 'local') return [graph.extra.daelabBadgePrototypeV1.localReferenceNodeId,
        ...(on('badge.post.local.selection.color') ? [104] : []),
        ...(on('badge.post.local.selection.polygon') ? [142] : []),
        ...(on('badge.post.local.semantic') ? [105] : []),
        ...(on('badge.post.local.material') ? [106] : [])];
    throw new Error(badgeText("generation_model.text_005"));
}
export function stageSnapshot(graph, stage) {
    const meta = graph.extra.daelabBadgePrototypeV1, node = id => graph.getNodeById(id);
    const h = readHierarchyState(node(meta.stateNodeId));
    const on = key => itemValue(h, key);
    const value = (id, name) => node(id)?.widgets?.find(w => w.name === name)?.value ?? node(id)?.widgets_values_named?.[name];
    const config = readGenerationConfig(graph, stage), ids = stageNodeIds(graph, stage);
    let error = validateDimensions(config);
    if (refinedBadge87(graph) && !BADGE_MODELS.some(([id]) => id === config.model)) error = badgeText("generation_model.text_006");
    if (refinedBadge87(graph) && stage === 'local' && !config.width) error = badgeText("generation_model.text_007");
    if (refinedBadge87(graph) && stage === 'build' && !isPromptOnlyBuild(graph) && meta.heightEnabled !== false && (meta.heightBoard?.count ?? 6) > 5) error = badgeText("generation_model.text_008");
    if (!error && stage === 'build' && isPromptOnlyBuild(graph) && !String(meta.buildPrompt || '').trim()) error = badgeText("generation_model.text_009");
    if (!error && stage === 'build' && !isPromptOnlyBuild(graph)) {
        if (!on('badge.path.flat_height')) error = badgeText("generation_model.text_010");
        else if (!value(1, 'image')) error = badgeText("generation_model.text_011");
        else if (meta.heightEnabled !== false && !value(2, 'image')) error = badgeText("generation_model.text_012");
    }
    if (!error && stage === 'local') {
        if (!on('badge.post.local')) error = badgeText("generation_model.text_013");
        else if (!value(meta.localReferenceNodeId, 'image')) error = badgeText("generation_model.text_014");
        else if (on('badge.post.local.selection.color') === on('badge.post.local.selection.polygon')) error = badgeText("generation_model.text_015");
        else if (on('badge.post.local.semantic') === on('badge.post.local.material')) error = badgeText("generation_model.text_016");
        else if (on('badge.post.local.semantic') && !String(value(105, 'value') || '').trim()) error = badgeText("generation_model.text_017");
        else if (refinedBadge87(graph) && on('badge.post.local.material') && !usesLocalRegions87(graph,on) && removedMaterial87(value(106, 'material_id'))) error = badgeText('refinement.removed_material');
    }
    if (!error && ids.some(id => !isNodeAvailableInAppMode(node(id)))) error = badgeText("generation_model.text_018");
    if (!error && stage === 'local' && usesLocalRegions87(graph, on)) {
        try {
            const regions = readLocalRegions87(graph);
            if (!regions?.groups?.some(g => !g.material_pending)) error = !meta.localRegions && removedMaterial87(value(106,'material_id')) ? badgeText('refinement.removed_material') : badgeText('regions.empty');
            else if (regions.groups.some(g => !g.material_pending && removedMaterial87(g.material_id))) error = badgeText('refinement.removed_material');
        } catch { error = badgeText('regions.empty'); }
    }
    const inputs = ids.map(id => {
        const n = node(id);
        return [id, n?.mode, n?.widgets?.filter(w => w.type !== 'button' && w.name !== 'upload').map(w => [w.name, w.value]) ?? n?.widgets_values_named ?? n?.widgets_values, n?.properties?.polygon_info];
    });
    if (stage === 'local' && usesLocalRegions87(graph,on)) inputs.push(['local_regions', meta.localRegions]);
    const flags = (stage === 'build' && isPromptOnlyBuild(graph) ? [] : h).filter(i => stage === 'build' ? i.id.startsWith('badge.path.flat_height') && (!refinedBadge87(graph) || !i.id.startsWith('badge.path.flat_height.special_material')) : i.id.startsWith('badge.post.local') && i.id !== 'badge.post.local.apply').map(i => [i.id, i.value]);
    const fingerprint = JSON.stringify([stage, inputs, flags, config, stage === 'build' ? [isPromptOnlyBuild(graph), String(meta.buildPrompt || '').trim(), ...(isPromptOnlyBuild(graph) ? [] : [meta.heightEnabled !== false, meta.backgroundEnabled !== false, meta.heightBoard])] : null]);
    return { stage, error, fingerprint, local: stage === 'local', studio: false, apply: on('badge.post.local.apply'), parameters: error ? null : { ...generationParameters(config), ...(stage === 'build' ? { prompt: String(meta.buildPrompt || '').trim() } : {}) } };
}
