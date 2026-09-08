export function migrateBadgeSelection(workflow) {
    if (workflow?.extra?.daelabBadgePrototypeV1?.version !== 1) return false;
    const node = workflow.nodes?.find(n => n.id === 142 && n.type === 'DAELAB.PolygonMaskV1');
    if (!node || node.outputs?.[2]?.links?.length) return false;
    const names = ['vertex_count', 'color', 'fill_opacity', 'outline_width', 'polygon_data'];
    const defaults = [4, '#FF1744', 35, 3, ''];
    node.widgets_values = names.map((name,i) => node.widgets_values_named?.[name] ?? node.widgets_values?.[i] ?? defaults[i]);
    node.widgets_values_named = Object.fromEntries(names.map((name,i) => [name,node.widgets_values[i]]));
    node.type = 'DAELAB.BadgeSelectionMaskV1';
    node.title = '徽章选区｜画笔 / Polygon';
    node.inputs = node.inputs.filter(input => input.name !== 'text');
    node.outputs = node.outputs.slice(0,2);
    node.properties['Node name for S&R'] = node.type;
    node.properties.daelab_app_heading = '徽章选区｜画笔 / Polygon';
    return true;
}
