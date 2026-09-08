export function migrateHeightBoard(config = {}) {
    return { count: 6, fallback: 1, groups: (config.groups || []).map((g, i) => ({
        ...g, id: String(g.id ?? `height-${i}`), tier: g.layer ? Math.max(1, Math.round(g.layer * 6 / 5)) : 0,
    })) };
}
export function resizeHeightBoard(board, count) {
    count = Math.max(2, Math.min(6, Math.round(Number(count) || 6)));
    const map = tier => tier === 0 ? 0 : Math.max(1, Math.min(count, Math.round(tier * count / board.count)));
    const alphas = board.alphas ? Object.fromEntries(Array.from({length:count}, (_,i) => {
        const tier=i+1, oldTier=Math.max(1,Math.round(tier*board.count/count));
        return [tier, heightAlpha(board,oldTier)];
    })) : undefined;
    return { ...board, ...(alphas ? {alphas} : {}), count, fallback: map(board.fallback), groups: board.groups.map(g => ({ ...g, tier: map(g.tier) })) };
}
export function heightAlpha(board, tier) {
    if (tier === 0) return 0;
    const value = board.alphas?.[tier] ?? tier * 255 / board.count;
    return Math.round(Math.max(1,Math.min(10,Math.round(value*10/255)))*255/10);
}
export function heightBoardPreview(board) {
    return { fallbackGray: heightAlpha(board, board.fallback), groups: board.groups.map(g => ({
        ...g, gray: heightAlpha(board, g.tier),
    })) };
}
export function moveHeightColors(board, from, to) {
    if (from < 1 || to < 1 || from > board.count || to > board.count || from === to) return board;
    const map = tier => tier === from ? to : tier === to ? from : tier;
    return {...board, groups:board.groups.map(g=>({...g,tier:map(g.tier)}))};
}
export function insertHeightTier(board, tier) {
    if(board.count>=6 || tier<1 || tier>board.count) return board;
    const at = tier === 1 ? 2 : tier;
    const map = t=>t>=at?t+1:t;
    const alphas = Object.fromEntries(Array.from({length:board.count},(_,i)=>[map(i+1),heightAlpha(board,i+1)]));
    alphas[at] = Math.round((heightAlpha(board,at-1)+heightAlpha(board,at))/2);
    return {...board,count:board.count+1,alphas,fallback:map(board.fallback),groups:board.groups.map(g=>({...g,tier:map(g.tier)}))};
}
export function deleteHeightTier(board, tier) {
    if(board.count<=2 || tier<1 || tier>board.count) return board;
    const map = t=>t===tier?(tier===1?1:tier-1):t>tier?t-1:t;
    const alphas = Object.fromEntries(Array.from({length:board.count},(_,i)=>i+1).filter(t=>t!==tier).map(t=>[map(t),heightAlpha(board,t)]));
    return {...board,count:board.count-1,alphas,fallback:map(board.fallback),groups:board.groups.map(g=>({...g,tier:map(g.tier)}))};
}
