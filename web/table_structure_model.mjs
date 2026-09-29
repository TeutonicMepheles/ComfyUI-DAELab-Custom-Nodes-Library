// Reorder existing objects only: record/asset IDs and prompt bindings are untouched.
export function moveItems(items, ids, targetId = null, after = false) {
    const selected = new Set(ids);
    if (selected.has(targetId) || targetId != null && !items.some(item => item.id === targetId)) return items;
    const moving = items.filter(item => selected.has(item.id));
    if (!moving.length) return items;
    const rest = items.filter(item => !selected.has(item.id));
    const index = targetId == null ? rest.length : rest.findIndex(item => item.id === targetId) + Number(after);
    rest.splice(index, 0, ...moving);
    return rest;
}

export function moveRows(table, ids, targetId, after) {
    table.records = moveItems(table.records, ids, targetId, after);
}

export function moveColumn(table, id, targetId, after) {
    const visible = moveItems(table.fields.filter(field => !field.hidden), [id], targetId, after);
    let index = 0;
    table.fields = table.fields.map(field => field.hidden ? field : visible[index++]);
}
