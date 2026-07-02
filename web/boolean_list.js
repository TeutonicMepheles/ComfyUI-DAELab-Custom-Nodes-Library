import { app } from "/scripts/app.js";

const NODE_NAME = "BooleanList";
const MAX_OUTPUTS = 64;
const DEFAULT_WIDTH_MULTIPLIER = 2;
const DEFAULT_ITEMS = [{ label: "Boolean 1", value: false }];

function cloneDefaultItems() {
    return DEFAULT_ITEMS.map((item) => ({ ...item }));
}

function parseItems(value) {
    let parsed;
    try {
        parsed = JSON.parse(value || "[]");
    } catch {
        parsed = [];
    }

    if (!Array.isArray(parsed)) {
        parsed = [];
    }

    const items = parsed.slice(0, MAX_OUTPUTS).map((item, index) => {
        const source = item && typeof item === "object" ? item : {};
        const label = String(source.label || source.name || `Boolean ${index + 1}`).trim();
        return {
            label: label || `Boolean ${index + 1}`,
            value: Boolean(source.value),
        };
    });

    return items.length ? items : cloneDefaultItems();
}

function encodeItems(items) {
    return JSON.stringify(
        items.slice(0, MAX_OUTPUTS).map((item, index) => ({
            label: String(item.label || `Boolean ${index + 1}`).trim() || `Boolean ${index + 1}`,
            value: Boolean(item.value),
        }))
    );
}

function markDirty(node) {
    if (node.setSize && node.computeSize) {
        const computedSize = node.computeSize();
        const defaultWidth = computedSize[0] * DEFAULT_WIDTH_MULTIPLIER;
        const currentWidth = Array.isArray(node.size) && Number.isFinite(node.size[0]) ? node.size[0] : defaultWidth;
        const savedWidth = Number(node.properties?.boolean_list_width);
        const width = Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : Math.max(currentWidth, defaultWidth);

        node._booleanListAutoSizing = true;
        try {
            node.setSize([width, computedSize[1]]);
        } finally {
            node._booleanListAutoSizing = false;
        }
    }
    node.graph?.setDirtyCanvas(true, true);
    app.canvas?.setDirty(true, true);
}

function getItems(node) {
    node.properties = node.properties || {};
    const legacyWidget = node.widgets?.find((widget) => widget.name === "config_json");
    const source = node.properties.boolean_list_items || legacyWidget?.value || node.widgets_values?.[0];
    const items = parseItems(source);
    node.properties.boolean_list_items = encodeItems(items);
    return items;
}

function setItems(node, items) {
    const normalized = parseItems(encodeItems(items));
    node.properties = node.properties || {};
    node.properties.boolean_list_count = normalized.length;
    node.properties.boolean_list_items = encodeItems(normalized);
    return normalized;
}

function removeLegacyConfigControls(node) {
    if (node.widgets) {
        node.widgets = node.widgets.filter((widget) => widget.name !== "config_json");
    }

    if (node.inputs) {
        node.inputs = node.inputs.filter((input) => input.name !== "config_json");
    }
}

function removeDynamicWidgets(node) {
    if (!node.widgets) {
        return;
    }
    node.widgets = node.widgets.filter((widget) => !widget._booleanListDynamic);
}

function syncOutputs(node, items) {
    node.outputs = node.outputs || [];

    while (node.outputs.length > items.length) {
        if (typeof node.removeOutput === "function") {
            node.removeOutput(node.outputs.length - 1);
        } else {
            node.outputs.pop();
        }
    }

    while (node.outputs.length < items.length) {
        node.addOutput(`Boolean ${node.outputs.length + 1}`, "BOOLEAN");
    }

    items.forEach((item, index) => {
        const output = node.outputs[index];
        if (!output) {
            return;
        }
        const label = item.label || `Boolean ${index + 1}`;
        output.name = label;
        output.label = label;
        output.localized_name = label;
        output.type = "BOOLEAN";
    });
}

function addDynamicWidget(node, type, name, value, callback, options = {}) {
    const widget = node.addWidget(type, name, value, callback, options);
    widget._booleanListDynamic = true;
    widget.serialize = false;
    return widget;
}

function addGroupSeparator(node, index) {
    const widget = {
        name: `group_separator_${index}`,
        type: "boolean-list-separator",
        value: "",
        _booleanListDynamic: true,
        serialize: false,
        computeSize: () => [node.size?.[0] || 320, 24],
        draw: (ctx, node, widgetWidth, y, widgetHeight) => {
            const left = 14;
            const right = Math.max(left, widgetWidth - left);
            const lineY = y + Math.round(widgetHeight / 2);

            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, lineY);
            ctx.lineTo(right, lineY);
            ctx.stroke();
            ctx.restore();
        },
    };

    node.widgets = node.widgets || [];
    node.widgets.push(widget);
    return widget;
}

function rebuildBooleanListUI(node) {
    if (node._booleanListBuilding) {
        return;
    }

    node._booleanListBuilding = true;
    try {
        let items = setItems(node, getItems(node));
        removeLegacyConfigControls(node);
        removeDynamicWidgets(node);

        addDynamicWidget(node, "button", "Add Boolean", "add", () => {
            const nextItems = getItems(node);
            if (nextItems.length >= MAX_OUTPUTS) {
                return;
            }
            nextItems.push({
                label: `Boolean ${nextItems.length + 1}`,
                value: false,
            });
            setItems(node, nextItems);
            rebuildBooleanListUI(node);
            markDirty(node);
        });

        addDynamicWidget(node, "button", "Remove Last", "remove", () => {
            const nextItems = getItems(node);
            if (nextItems.length <= 1) {
                return;
            }
            nextItems.pop();
            setItems(node, nextItems);
            rebuildBooleanListUI(node);
            markDirty(node);
        });

        addDynamicWidget(node, "button", "Refresh", "refresh", () => {
            rebuildBooleanListUI(node);
            markDirty(node);
        });

        items.forEach((item, index) => {
            const number = String(index + 1).padStart(2, "0");
            addDynamicWidget(node, "toggle", `${number}: ${item.label}`, item.value, (value) => {
                const nextItems = getItems(node);
                if (!nextItems[index]) {
                    return;
                }
                nextItems[index].value = Boolean(value);
                setItems(node, nextItems);
                markDirty(node);
            });

            addDynamicWidget(node, "string", `remark ${number}`, item.label, (value) => {
                const nextItems = getItems(node);
                if (!nextItems[index]) {
                    return;
                }
                nextItems[index].label = String(value || "").trim() || `Boolean ${index + 1}`;
                setItems(node, nextItems);
                markDirty(node);
            });

            if (index < items.length - 1) {
                addGroupSeparator(node, index + 1);
            }
        });

        syncOutputs(node, items);
        markDirty(node);
    } finally {
        node._booleanListBuilding = false;
    }
}

function scheduleRebuild(node) {
    requestAnimationFrame(() => rebuildBooleanListUI(node));
}

app.registerExtension({
    name: "BooleanList.DynamicOutputs",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) {
            return;
        }

        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalOnNodeCreated?.apply(this, arguments);
            this.properties = this.properties || {};
            scheduleRebuild(this);
        };

        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalOnConfigure?.apply(this, arguments);
            scheduleRebuild(this);
        };

        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function () {
            originalOnAdded?.apply(this, arguments);
            scheduleRebuild(this);
        };

        const originalOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            const result = originalOnResize?.apply(this, arguments);
            const width = Array.isArray(size) && Number.isFinite(size[0]) ? size[0] : this.size?.[0];
            if (!this._booleanListAutoSizing && Number.isFinite(width) && width > 0) {
                this.properties = this.properties || {};
                this.properties.boolean_list_width = width;
            }
            return result;
        };

        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            originalGetExtraMenuOptions?.apply(this, arguments);
            options.unshift(
                {
                    content: "Add Boolean",
                    callback: () => {
                        const items = getItems(this);
                        if (items.length < MAX_OUTPUTS) {
                            items.push({
                                label: `Boolean ${items.length + 1}`,
                                value: false,
                            });
                            setItems(this, items);
                            rebuildBooleanListUI(this);
                            markDirty(this);
                        }
                    },
                },
                {
                    content: "Remove Last Boolean",
                    callback: () => {
                        const items = getItems(this);
                        if (items.length > 1) {
                            items.pop();
                            setItems(this, items);
                            rebuildBooleanListUI(this);
                            markDirty(this);
                        }
                    },
                }
            );
        };
    },
});
