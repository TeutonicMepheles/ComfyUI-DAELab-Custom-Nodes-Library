// Only a structurally empty generic table is disposable. Empty cell values,
// hidden columns and the parser's upload state are still useful content.
export function removeEmptyTableNode(node, table) {
    if (node.type !== 'DAELAB.Table' || !node.graph ||
        !Array.isArray(table?.fields) || !Array.isArray(table?.records) ||
        (table.fields.length && table.records.length)) return false;
    node.graph.remove(node);
    return true;
}
