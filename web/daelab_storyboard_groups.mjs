import { normalizeShot } from './daelab_storyboard_model.mjs?v=20260926-batch1';

export function normalizeGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map(g => ({
        id: String(g.id || crypto.randomUUID()), name: String(g.name || '素材组'),
        mode: g.mode === 'shared' ? 'shared' : 'sequence',
        items: (Array.isArray(g.items) ? g.items : []).filter(a => a?.url).map(a => ({id: String(a.id || crypto.randomUUID()), url: String(a.url), name: String(a.name || '参考图')})),
    }));
}

// Assignment is explicit and atomic. Reordering a shot later carries its references with it.
export function applyGroups(state) {
    const groups = state.asset_groups || [];
    if (!groups.length || groups.some(g => !g.items.length)) throw new Error('请先给每个素材组添加图片');
    const count = Math.max(state.shots.length, ...groups.filter(g => g.mode === 'sequence').map(g => g.items.length), 1);
    if (count > 100) throw new Error('预览版每批最多 100 行');
    for (const g of groups) if (g.mode === 'sequence' && g.items.length !== count)
        throw new Error(`“${g.name}”有 ${g.items.length} 张图，需要 ${count} 张。公共素材请选择“每行共用”。`);
    const shots = state.shots.map(s => ({...s, group_refs: {...s.group_refs}}));
    while (shots.length < count) shots.push(normalizeShot({}, shots.length));
    for (let i = 0; i < count; i++) {
        shots[i].group_refs = Object.fromEntries(groups.map(g => [g.id, (g.mode === 'shared' ? g.items : [g.items[i]]).map(a => ({...a}))]));
        shots[i].input_changed = true;
    }
    state.shots = shots;
}

export function rowReferences(state, shot) {
    return [shot.image_url, ...(state.asset_groups || []).flatMap(g => (shot.group_refs?.[g.id] || []).map(a => a.url))].filter(Boolean);
}
