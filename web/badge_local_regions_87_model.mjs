import { refinedBadge87, removedMaterial87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { normalizeMaterialRegionConfig } from './badge_material_region_v1_model.mjs?v=20260917-target87-1';

export const usesLocalRegions87 = (graph, on) => refinedBadge87(graph)
    && on('badge.post.local.selection.color') && on('badge.post.local.material');
const value = (graph, id, name) => graph.getNodeById(id)?.widgets?.find(w => w.name === name)?.value
    ?? graph.getNodeById(id)?.widgets_values_named?.[name];
export const materialColorPolicy87 = material => ['satin_gold', 'satin_silver'].includes(material) ? 'material_intrinsic' : 'preserve';
export function readLocalRegions87(graph) {
    const saved = graph.extra.daelabBadgePrototypeV1.localRegions;
    if (saved) return normalizeMaterialRegionConfig({...saved, groups:saved.groups.map(g=>({...g, samples:[], invert:false, color_policy:materialColorPolicy87(g.material_id), material_strength:1.5}))});
    const raw = value(graph, 104, 'multi_color_mask_v1_panel') ?? value(graph, 104, 'config_json') ?? '{}';
    const colors = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const rawMaterial = value(graph, 106, 'material_id') || graph.getNodeById(106)?.properties?.gpt_image2_material_id || 'transparent_lacquer';
    const material = ({'烤漆':'baked_enamel','透明漆':'transparent_lacquer','亚金':'satin_gold','亚银':'satin_silver','闪粉':'glitter','水钻':'rhinestone'})[rawMaterial] || rawMaterial;
    return normalizeMaterialRegionConfig({overlap_policy: 'error', groups: (colors.groups?.length ? colors.groups : [{}]).map((g, i) => ({
        id: `local87_${i + 1}`, name: `区域 ${i + 1}`, color:g.color, threshold:g.threshold,
        material_id:material, material_pending:removedMaterial87(material),
        samples:[], color_policy:materialColorPolicy87(material), material_strength:1.5,
    }))});
}
export function writeLocalRegions87(graph, config) {
    graph.beforeChange?.();
    graph.extra.daelabBadgePrototypeV1.localRegions = normalizeMaterialRegionConfig({...config, overlap_policy:'error', groups:config.groups.map(g=>({...g,color_policy:materialColorPolicy87(g.material_id),material_strength:1.5}))});
    graph.afterChange?.(); graph.setDirtyCanvas?.(true,true);
}
export const activeLocalRegions87 = config => ({...config, overlap_policy:'error', groups:config.groups.filter(g=>!g.material_pending).map(g=>({...g,color_policy:materialColorPolicy87(g.material_id),material_strength:1.5}))});

// Assign every pixel once before filtering the preview to a selected row.
// Ties retain the first row. Alpha comes from the edit target, not the ID map.
export function previewLocalRegions87(source, target, config, view, selectedId = null) {
    const output = new Uint8ClampedArray(source);
    const groups = (config.groups || []).map(g => ({...g,
        colors: [g.color, ...(g.samples || [])].map(c => (c.slice(1).match(/.{2}/g) || []).map(v => parseInt(v, 16))),
    }));
    for (let i = 0; i < source.length; i += 4) {
        let winner = null, best = Infinity, hits = 0;
        if (target[i + 3] > 127) for (const group of groups) {
            let distance = Math.min(...group.colors.map(rgb => rgb.reduce((sum, c, k) => sum + (source[i + k] - c) ** 2, 0)));
            if (group.invert) distance = distance > group.threshold ** 2 ? 0 : Infinity;
            if (distance <= group.threshold ** 2) hits++;
            if (distance <= group.threshold ** 2 && distance < best) { winner = group; best = distance; }
        }
        const hit = winner && (!selectedId || winner.id === selectedId);
        if (view === 'conflicts') {
            if (hits > 1) { output[i] = 255; output[i + 1] = 50; output[i + 2] = 80; }
            else { output[i] *= .35; output[i + 1] *= .35; output[i + 2] *= .35; }
        } else if (view === 'mask') {
            output[i] = output[i + 1] = output[i + 2] = hit ? 255 : 0;
            output[i + 3] = 255;
        } else if (view === 'overlay' && hit) {
            [20, 220, 180].forEach((c, k) => { output[i + k] = Math.round(source[i + k] * .55 + c * .45); });
        } else if (view === 'overlay' && selectedId) {
            for (let k = 0; k < 3; k++) output[i + k] *= .4;
        }
    }
    return output;
}

export function countRegionOverlap87(source, target, config) {
    const groups = (config.groups || []).map(g => ({threshold: g.threshold ** 2, invert:g.invert,
        colors: [g.color, ...(g.samples || [])].map(c => [1,3,5].map(i=>parseInt(c.slice(i,i+2),16)))}));
    let count = 0;
    const cache = new Map();
    for (let i = 0; i < source.length; i += 4) {
        if (target[i+3] <= 127) continue;
        const key = source[i]*65536 + source[i+1]*256 + source[i+2];
        let overlap = cache.get(key);
        if (overlap === undefined) {
            let hits = 0;
            for (const group of groups) {
                if (group.colors.some(rgb => (source[i]-rgb[0])**2 + (source[i+1]-rgb[1])**2 + (source[i+2]-rgb[2])**2 <= group.threshold) !== Boolean(group.invert)) hits++;
                if (hits > 1) break;
            }
            overlap = hits > 1; cache.set(key, overlap);
        }
        if (overlap) count++;
    }
    return count;
}
