import { app } from "/scripts/app.js";
import { addColorPickerWidget } from "./color_picker_widget.mjs?v=20260827-3";
import { removeOwnedWidgets } from "./dynamic_widget_lifecycle.mjs?v=20260827-1";
import {
    addGroup,
    encodeConfig,
    layerWidgetValue,
    LAYER_LABELS,
    MAX_COLOR_GROUPS,
    normalizeConfig,
    removeLastGroup,
    updateGroup,
} from "./badge_height_layer_model.mjs?v=20260824-1";

const NODE_TYPE = "DAELabBadgeHeightLayer";
const CONFIG_PROPERTY = "badge_height_layer_config";
const DEFAULT_WIDTH = 340;
const OWNER_PROPERTY = "_daelabBadgeHeightLayer";

function chainCallback(object, property, callback) {
    const original = object[property];
    object[property] = function () {
        const result = original?.apply(this, arguments);
        callback?.apply(this, arguments);
        return result;
    };
}

function markDirty(node, { refreshInspector = true } = {}) {
    if (node.setSize && node.computeSize) {
        const computed = node.computeSize();
        const savedWidth = Number(node.properties?.badge_height_layer_width);
        const currentWidth = Number(node.size?.[0]);
        const width = Number.isFinite(savedWidth) && savedWidth >= DEFAULT_WIDTH
            ? savedWidth
            : Math.max(DEFAULT_WIDTH, Number.isFinite(currentWidth) ? currentWidth : 0);
        node._badgeHeightLayerAutoSizing = true;
        try {
            node.setSize([width, computed[1]]);
        } finally {
            node._badgeHeightLayerAutoSizing = false;
        }
    }
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    if (refreshInspector) app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
}

function getConfig(node) {
    node.properties ||= {};
    const config = normalizeConfig(node.properties[CONFIG_PROPERTY]);
    node.properties[CONFIG_PROPERTY] = encodeConfig(config);
    return config;
}

function setConfig(node, config) {
    const normalized = normalizeConfig(config);
    node.properties ||= {};
    node.properties[CONFIG_PROPERTY] = encodeConfig(normalized);
    return normalized;
}

function removeDynamicWidgets(node) {
    removeOwnedWidgets(node, OWNER_PROPERTY);
}

function addDynamicWidget(node, type, name, value, callback, options = {}) {
    const widget = node.addWidget(type, name, value, callback, options);
    widget[OWNER_PROPERTY] = true;
    widget.serialize = false;
    return widget;
}

function addSectionLabel(node, label) {
    const widget = {
        name: `section_${label}`,
        type: "daelab-badge-height-layer-section",
        value: "",
        [OWNER_PROPERTY]: true,
        serialize: false,
        computeSize: () => [node.size?.[0] || DEFAULT_WIDTH, 25],
        draw(ctx, _node, width, y, height) {
            const middle = y + Math.round(height / 2);
            ctx.save();
            ctx.globalAlpha = 0.65;
            ctx.strokeStyle = "#9aa0aa";
            ctx.fillStyle = "#d7d9de";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "left";
            ctx.beginPath();
            ctx.moveTo(14, middle);
            ctx.lineTo(50, middle);
            ctx.stroke();
            ctx.fillText(label, 58, middle + 4);
            const textWidth = ctx.measureText(label).width;
            ctx.beginPath();
            ctx.moveTo(66 + textWidth, middle);
            ctx.lineTo(Math.max(66 + textWidth, width - 14), middle);
            ctx.stroke();
            ctx.restore();
        },
    };
    return node.addCustomWidget(widget);
}

function managedWidgetName(name) {
    return /^(?:enabled|color|threshold|layer)_\d+$/.test(String(name));
}

function removeStaleAppModeInputs(node, config) {
    const graph = app.rootGraph;
    const data = graph?.extra?.linearData;
    if (!Array.isArray(data?.inputs) || graph.getNodeById?.(node.id) !== node) return false;
    const valid = new Set();
    config.groups.forEach((_group, index) => {
        const number = index + 1;
        for (const prefix of ["enabled", "color", "threshold", "layer"]) {
            valid.add(`${prefix}_${number}`);
        }
    });
    const inputs = data.inputs.filter(([nodeId, widgetName]) => (
        String(nodeId) !== String(node.id) || !managedWidgetName(widgetName) || valid.has(widgetName)
    ));
    if (inputs.length === data.inputs.length) return false;
    graph.extra.linearData = { ...data, inputs };
    return true;
}

function rebuildUI(node) {
    if (node._badgeHeightLayerBuilding) return;
    node._badgeHeightLayerBuilding = true;
    try {
        let config = setConfig(node, getConfig(node));
        removeDynamicWidgets(node);
        addDynamicWidget(node, "button", "Add Color Group", null, () => {
            config = setConfig(node, addGroup(getConfig(node)));
            rebuildUI(node);
            markDirty(node);
        });
        if (config.groups.length > 1) {
            addDynamicWidget(node, "button", "Remove Last Group", null, () => {
                config = setConfig(node, removeLastGroup(getConfig(node)));
                removeStaleAppModeInputs(node, config);
                rebuildUI(node);
                markDirty(node);
            });
        }

        config.groups.forEach((group, index) => {
            const number = index + 1;
            addSectionLabel(node, `Color ${number}`);
            addDynamicWidget(node, "toggle", `enabled_${number}`, group.enabled, (value) => {
                config = setConfig(node, updateGroup(getConfig(node), index, { enabled: value }));
                markDirty(node);
            });
            addColorPickerWidget(node, `color_${number}`, group.color, (value) => {
                config = setConfig(node, updateGroup(getConfig(node), index, { color: value }));
                markDirty(node);
            }, OWNER_PROPERTY);
            addDynamicWidget(
                node,
                "number",
                `threshold_${number}`,
                group.threshold,
                (value) => {
                    config = setConfig(node, updateGroup(getConfig(node), index, { threshold: value }));
                    markDirty(node);
                },
                { min: 0, max: 255, step: 1, precision: 0 }
            );
            addDynamicWidget(
                node,
                "combo",
                `layer_${number}`,
                layerWidgetValue(group.layer),
                (value) => {
                    config = setConfig(node, updateGroup(getConfig(node), index, { layer: value }));
                    markDirty(node);
                },
                { values: [...LAYER_LABELS] }
            );
        });
        removeStaleAppModeInputs(node, config);
        markDirty(node, { refreshInspector: false });
    } finally {
        node._badgeHeightLayerBuilding = false;
    }
}

function scheduleRebuild(node) {
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    schedule(() => {
        rebuildUI(node);
        app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    });
}

app.registerExtension({
    name: "DAELab.BadgeHeightLayer",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            this.properties ||= {};
            scheduleRebuild(this);
        });
        chainCallback(nodeType.prototype, "onConfigure", function () {
            scheduleRebuild(this);
        });
        chainCallback(nodeType.prototype, "onAdded", function () {
            scheduleRebuild(this);
        });
        chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
            const config = setConfig(this, getConfig(this));
            serialized.properties ||= {};
            serialized.properties[CONFIG_PROPERTY] = encodeConfig(config);
        });
        chainCallback(nodeType.prototype, "onResize", function (size) {
            const width = Number(size?.[0]);
            if (!this._badgeHeightLayerAutoSizing && Number.isFinite(width) && width >= DEFAULT_WIDTH) {
                this.properties ||= {};
                this.properties.badge_height_layer_width = width;
            }
        });

        const originalMenu = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            originalMenu?.apply(this, arguments);
            options.unshift(
                {
                    content: `Add Color Group (${getConfig(this).groups.length}/${MAX_COLOR_GROUPS})`,
                    callback: () => {
                        setConfig(this, addGroup(getConfig(this)));
                        rebuildUI(this);
                        markDirty(this);
                    },
                },
                {
                    content: "Remove Last Color Group",
                    callback: () => {
                        const config = setConfig(this, removeLastGroup(getConfig(this)));
                        removeStaleAppModeInputs(this, config);
                        rebuildUI(this);
                        markDirty(this);
                    },
                }
            );
            return options;
        };
    },
});
