import { readHierarchyState, itemValue } from './badge_app_layout_model.mjs';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';

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
export function readGenerationConfig(graph, stage) {
    const { prompt: _removedPrompt, ...saved } = graph.extra?.daelabBadgePrototypeV1?.generation?.[stage] || {};
    return { ...DEFAULT_CONFIG, ...saved };
}
export function validateDimensions({ width, height }) {
    if (![width, height].every(v => Number.isInteger(v) && v >= 1024 && v <= 3840)) return '宽、高必须为 1024–3840 的整数。';
    if (width % 16 || height % 16) return '宽、高必须为 16 的倍数。';
    if (Math.max(width, height) / Math.min(width, height) > 3) return '长宽比不能超过 3:1。';
    const pixels = width * height;
    return pixels < 655360 || pixels > 8294400 ? '总像素必须在 655,360–8,294,400 之间。' : '';
}
export function generationParameters(config) {
    const error = validateDimensions(config);
    if (error) throw new Error(error);
    return { model: 'gpt-image-2', 'model.size': config.custom ? 'Custom' : `${config.width}x${config.height}`,
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
    const n = graph.getNodeById(1);
    const image = n?.widgets?.find(w => w.name === 'image')?.value ?? n?.widgets_values_named?.image;
    return !image && Boolean(String(graph.extra.daelabBadgePrototypeV1.buildPrompt || '').trim());
}
export function stageNodeIds(graph, stage) {
    const h = readHierarchyState(graph.getNodeById(graph.extra.daelabBadgePrototypeV1.stateNodeId));
    const on = suffix => itemValue(h, suffix);
    if (stage === 'build' && isPromptOnlyBuild(graph)) return [];
    if (stage === 'build') return [1, 55,
        ...(graph.extra.daelabBadgePrototypeV1.backgroundEnabled !== false ? [47] : []),
        ...(on('badge.path.flat_height.special_material') ? [49] : []),
        ...(graph.extra.daelabBadgePrototypeV1.heightEnabled !== false ? [2, 3] : [])];
    if (stage === 'local') return [graph.extra.daelabBadgePrototypeV1.localReferenceNodeId,
        ...(on('badge.post.local.selection.color') ? [104] : []),
        ...(on('badge.post.local.selection.polygon') ? [142] : []),
        ...(on('badge.post.local.semantic') ? [105] : []),
        ...(on('badge.post.local.material') ? [106] : [])];
    throw new Error('Unsupported generation stage');
}
export function stageSnapshot(graph, stage) {
    const meta = graph.extra.daelabBadgePrototypeV1, node = id => graph.getNodeById(id);
    const h = readHierarchyState(node(meta.stateNodeId));
    const on = key => itemValue(h, key);
    const value = (id, name) => node(id)?.widgets?.find(w => w.name === name)?.value ?? node(id)?.widgets_values_named?.[name];
    const config = readGenerationConfig(graph, stage), ids = stageNodeIds(graph, stage);
    let error = validateDimensions(config);
    if (!error && stage === 'build' && !isPromptOnlyBuild(graph)) {
        if (!on('badge.path.flat_height')) error = '请先启用效果图建立路线。';
        else if (!value(1, 'image')) error = '请填写基础提示词或上传材质图。';
        else if (meta.heightEnabled !== false && !value(2, 'image')) error = '请上传高度图，或关闭高度建立。';
    }
    if (!error && stage === 'local') {
        if (!on('badge.post.local')) error = '请先启用局部编辑。';
        else if (!value(meta.localReferenceNodeId, 'image')) error = '请上传局部编辑目标图。';
        else if (on('badge.post.local.selection.color') === on('badge.post.local.selection.polygon')) error = '请选择一种选区方式。';
        else if (on('badge.post.local.semantic') === on('badge.post.local.material')) error = '请选择一种修改方式。';
        else if (on('badge.post.local.semantic') && !String(value(105, 'value') || '').trim()) error = '请填写局部修改描述。';
    }
    if (!error && ids.some(id => !isNodeAvailableInAppMode(node(id)))) error = '当前阶段的必要输入已被静音或跳过，请先恢复启用。';
    const inputs = ids.map(id => {
        const n = node(id);
        return [id, n?.mode, n?.widgets?.filter(w => w.type !== 'button' && w.name !== 'upload').map(w => [w.name, w.value]) ?? n?.widgets_values_named ?? n?.widgets_values, n?.properties?.polygon_info];
    });
    const flags = (stage === 'build' && isPromptOnlyBuild(graph) ? [] : h).filter(i => stage === 'build' ? i.id.startsWith('badge.path.flat_height') : i.id.startsWith('badge.post.local') && i.id !== 'badge.post.local.apply').map(i => [i.id, i.value]);
    const fingerprint = JSON.stringify([stage, inputs, flags, config, stage === 'build' ? [String(meta.buildPrompt || '').trim(), ...(isPromptOnlyBuild(graph) ? [] : [meta.heightEnabled !== false, meta.backgroundEnabled !== false, meta.heightBoard])] : null]);
    return { stage, error, fingerprint, local: stage === 'local', studio: false, apply: on('badge.post.local.apply'), parameters: error ? null : { ...generationParameters(config), ...(stage === 'build' ? { prompt: String(meta.buildPrompt || '').trim() } : {}) } };
}
