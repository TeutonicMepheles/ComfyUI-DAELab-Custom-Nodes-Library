// Explicit capability: 8.7 never enters the multi-material local path.
export const isBadge88 = graph => graph?.extra?.daelabBadgeLocalMaterialsV1?.version === 1;
export const localMaterialNodeId88 = graph => graph.extra.daelabBadgeLocalMaterialsV1.nodeId;
export function usesLocalMaterials88(graph, on) {
    return isBadge88(graph) && on('badge.post.local.selection.color') && on('badge.post.local.material');
}

// Assign every pixel once before filtering the preview to a selected row.
// Ties retain the first row. Alpha comes from the edit target, not the ID map.
export function previewLocalMaterials88(source, target, config, view, selectedId = null) {
    const output = new Uint8ClampedArray(source);
    const groups = (config.groups || []).map(g => ({...g,
        rgb: (g.color.slice(1).match(/.{2}/g) || []).map(v => parseInt(v, 16)),
    }));
    for (let i = 0; i < source.length; i += 4) {
        let winner = null, best = Infinity;
        if (target[i + 3] > 127) for (const group of groups) {
            const distance = group.rgb.reduce((sum, c, k) => sum + (source[i + k] - c) ** 2, 0);
            if (distance <= group.threshold ** 2 && distance < best) { winner = group; best = distance; }
        }
        const hit = winner && (!selectedId || winner.id === selectedId);
        if (view === 'mask') {
            output[i] = output[i + 1] = output[i + 2] = hit ? 255 : 0;
            output[i + 3] = 255;
        } else if (view === 'overlay' && hit) {
            [20, 220, 180].forEach((c, k) => { output[i + k] = Math.round(source[i + k] * .55 + c * .45); });
        }
    }
    return output;
}
