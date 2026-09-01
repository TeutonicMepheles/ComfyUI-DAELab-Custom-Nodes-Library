export function findLiveOwnedWidget(node, name, ownerProperty, fallback = null) {
    if (!Array.isArray(node?.widgets)) return fallback;
    return node.widgets.find((widget) => (
        widget?.name === name && (!ownerProperty || widget[ownerProperty])
    )) ?? fallback;
}

export function removeOwnedWidgets(node, ownerProperty) {
    if (!Array.isArray(node?.widgets)) return 0;

    const ownedWidgets = node.widgets.filter((widget) => widget?.[ownerProperty]);
    for (const widget of [...ownedWidgets].reverse()) {
        if (typeof node.removeWidget === "function") {
            try {
                node.removeWidget(widget);
                continue;
            } catch {
                // Fall through for older LiteGraph builds or partially rebuilt nodes.
            }
        }

        widget.onRemove?.();
        const index = node.widgets.indexOf(widget);
        if (index >= 0) node.widgets.splice(index, 1);
        node._widgetSlotsDirty = true;
    }
    return ownedWidgets.length;
}
