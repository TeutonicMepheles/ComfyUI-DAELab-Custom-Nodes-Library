import { app } from "/scripts/app.js";
import {
    applyCompactGroupSelection,
    bindCompactGroupSelection,
    compactInputStyle,
    createCompactColorControl,
    createCompactThresholdControl,
} from "./compact_color_group_controls.mjs?v=20260904-color-context-2";
import {
    LIST_EDITOR_ICONS,
    createIconButton,
    stopCanvasPropagation,
} from "./list_editor_controls.mjs?v=20260901-1";
import {
    MAX_MASK_V1_GROUPS,
    MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME,
    addMaskGroupAfter,
    collapseMultiColorMaskV1Inputs,
    encodeMaskV1Config,
    formatMaskOutputChoice,
    getMultiColorMaskV1PanelHeight,
    maskOutputChoices,
    normalizeMaskV1Config,
    removeSelectedMaskGroup,
    resolveSelectedMaskGroupId,
    setMaskOutput,
    updateMaskGroup,
} from "./multi_color_mask_v1_model.mjs?v=20260901-1";

const NODE_TYPE = "DAELabMultiColorMaskV1";
const CONFIG_PROPERTY = "multi_color_mask_v1_config";
const CONFIG_WIDGET_NAME = "config_json";
const WIDTH_PROPERTY = "multi_color_mask_v1_width";
const DEFAULT_WIDTH = 390;
const MIN_WIDTH = 340;
const UI_VERSION = "20260904-prompt-config-1";
const APP_HEADING_PROPERTY = "daelab_app_heading";
const OWNED_WIDGET_PROPERTY = "__daelabMultiColorMaskV1Panel";

function chainCallback(object, property, callback) {
    const original = object[property];
    object[property] = function () {
        const result = original?.apply(this, arguments);
        callback?.apply(this, arguments);
        return result;
    };
}

function graphTransaction(node, callback) {
    const graph = node.graph;
    graph?.beforeChange?.();
    try {
        callback();
        if (graph && typeof graph._version === "number") graph._version += 1;
    } finally {
        graph?.afterChange?.();
    }
}

function getConfig(node) {
    node.properties ||= {};
    const config = normalizeMaskV1Config(node.properties[CONFIG_PROPERTY]);
    node.properties[CONFIG_PROPERTY] = encodeMaskV1Config(config);
    return config;
}

function syncPromptConfigWidget(node, encoded) {
    const widget = node.widgets?.find((candidate) => candidate.name === CONFIG_WIDGET_NAME);
    if (!widget) return;
    widget.value = encoded;
    widget.options ||= {};
    widget.options.advanced = true;
    widget.options.serialize = true;
    widget.serialize = true;
    widget.hidden = true;
    widget.origType ||= widget.type;
    widget.origComputeSize ||= widget.computeSize;
    widget.type = "converted-widget";
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    widget.draw = () => {};
    widget.serializeValue = () => node.properties?.[CONFIG_PROPERTY] || widget.value;
    for (const element of [widget.element, widget.inputEl]) {
        if (!element?.style) continue;
        element.style.display = "none";
        element.style.visibility = "hidden";
    }
}

function storeConfig(node, value, { notify = true } = {}) {
    const config = normalizeMaskV1Config(value);
    const encoded = encodeMaskV1Config(config);
    node.properties ||= {};
    const previous = node.properties[CONFIG_PROPERTY];
    node.properties[CONFIG_PROPERTY] = encoded;
    syncPromptConfigWidget(node, encoded);
    if (notify && previous !== encoded) {
        node.onWidgetChanged?.(
            MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME,
            encoded,
            previous,
            node._multiColorMaskV1Panel?.widget,
        );
    }
    return config;
}

function normalizeAppModeInputs(node) {
    const graph = app.rootGraph;
    const data = graph?.extra?.linearData;
    if (!Array.isArray(data?.inputs) || graph.getNodeById?.(node.id) !== node) return false;
    const result = collapseMultiColorMaskV1Inputs(data.inputs, node.id);
    if (!result.changed) return false;
    graph.extra.linearData = { ...data, inputs: result.inputs };
    return true;
}

function syncOutputLabel(node, output) {
    const socket = node.outputs?.[0];
    if (!socket) return;
    socket.name = "mask";
    socket.type = "MASK";
    socket.label = output === "combined_mask" ? "combined_mask" : output;
    socket.localized_name = socket.label;
}

function applyNodeSize(node, size) {
    if (typeof node.setSize === "function") node.setSize(size);
    else node.size = size;
}

function fitNodeToMinimum(node) {
    if (!node?._multiColorMaskV1Panel?.widget) return;
    const savedWidth = Number(node.properties?.[WIDTH_PROPERTY]);
    const currentWidth = Number(node.size?.[0]);
    const width = Number.isFinite(savedWidth) && savedWidth >= MIN_WIDTH
        ? savedWidth
        : Math.max(DEFAULT_WIDTH, Number.isFinite(currentWidth) ? currentWidth : 0);
    const fallbackHeight = getMultiColorMaskV1PanelHeight(getConfig(node).groups.length) + 90;

    node._multiColorMaskV1AutoSizing = true;
    try {
        applyNodeSize(node, [width, 1]);
        node.arrange?.();
        const measured = Number(node.computeSize?.()?.[1]);
        applyNodeSize(node, [
            width,
            Number.isFinite(measured) && measured > 1 ? measured : fallbackHeight,
        ]);
    } finally {
        node._multiColorMaskV1AutoSizing = false;
    }
}

function scheduleFit(node) {
    if (node._multiColorMaskV1FitFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._multiColorMaskV1FitFrame = schedule(() => {
        node._multiColorMaskV1FitFrame = null;
        fitNodeToMinimum(node);
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    });
}

function commitConfig(node, config, { selectedId = null, render = false, fit = false } = {}) {
    graphTransaction(node, () => {
        const stored = storeConfig(node, config);
        node._multiColorMaskV1SelectedId = resolveSelectedMaskGroupId(
            stored,
            selectedId ?? node._multiColorMaskV1SelectedId,
        );
        syncOutputLabel(node, stored.output);
        if (render) renderPanel(node);
        if (fit) scheduleFit(node);
    });
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
}

function setSelectedGroup(node, groupId) {
    const config = getConfig(node);
    node._multiColorMaskV1SelectedId = resolveSelectedMaskGroupId(config, groupId);
    applyCompactGroupSelection(
        node._multiColorMaskV1Panel?.element,
        node._multiColorMaskV1SelectedId,
    );
}

function createColorControl(node, group, card) {
    return createCompactColorControl({
        color: group.color,
        onCommit: (value) => {
            const config = updateMaskGroup(getConfig(node), group.id, { color: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            if (!updated) return null;
            card.style.setProperty("--mask-group-color", updated.color);
            commitConfig(node, config, { selectedId: group.id });
            return updated.color;
        },
        getCurrentColor: () => getConfig(node).groups.find(({ id }) => id === group.id)?.color,
    });
}

function createThresholdControl(node, group) {
    return createCompactThresholdControl({
        threshold: group.threshold,
        onCommit: (value) => {
            const config = updateMaskGroup(getConfig(node), group.id, { threshold: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            commitConfig(node, config, { selectedId: group.id });
            return updated?.threshold;
        },
    });
}

function createInvertControl(node, group) {
    const rowLabel = document.createElement("span");
    rowLabel.textContent = "蒙版";
    rowLabel.style.cssText = "font:11px sans-serif;color:#aeb4bc;white-space:nowrap";

    const control = document.createElement("label");
    control.style.cssText = [
        "height:26px",
        "display:flex",
        "align-items:center",
        "gap:7px",
        "box-sizing:border-box",
        "padding:0 8px",
        "border:1px solid #45484e",
        "border-radius:5px",
        "background:#292c31",
        "color:#d7dade",
        "font:11px sans-serif",
        "cursor:pointer",
    ].join(";");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = group.invert;
    checkbox.setAttribute("aria-label", "反转颜色匹配结果");
    checkbox.style.cssText = "width:14px;height:14px;margin:0;accent-color:#4ca2d9";
    const text = document.createElement("span");
    text.textContent = "反转匹配结果";
    checkbox.addEventListener("change", () => {
        const config = updateMaskGroup(getConfig(node), group.id, { invert: checkbox.checked });
        const updated = config.groups.find(({ id }) => id === group.id);
        if (updated) checkbox.checked = updated.invert;
        commitConfig(node, config, { selectedId: group.id });
    });
    control.append(checkbox, text);
    return { rowLabel, control };
}

function createGroupCard(node, group, index) {
    const card = document.createElement("div");
    card.dataset.colorGroupId = group.id;
    card.setAttribute("role", "option");
    card.tabIndex = 0;
    card.style.cssText = [
        "height:64px",
        "min-height:64px",
        "display:grid",
        "grid-template-rows:26px 26px",
        "gap:4px",
        "box-sizing:border-box",
        "padding:3px 6px",
        "border:1px solid #3f4248",
        "border-radius:6px",
        "background:#23262a",
        "cursor:default",
        "transition:border-color 80ms linear,background 80ms linear",
    ].join(";");

    const firstRow = document.createElement("div");
    firstRow.style.cssText = "min-width:0;display:grid;grid-template-columns:52px minmax(110px,1fr) 96px;align-items:center;gap:6px";
    const groupLabel = document.createElement("span");
    groupLabel.textContent = `颜色 ${index + 1}`;
    groupLabel.style.cssText = "font:11px sans-serif;color:#c5c9cf;white-space:nowrap";
    firstRow.append(groupLabel, createColorControl(node, group, card), createThresholdControl(node, group));

    const secondRow = document.createElement("div");
    secondRow.style.cssText = "min-width:0;display:grid;grid-template-columns:52px minmax(0,1fr);align-items:center;gap:6px";
    const invert = createInvertControl(node, group);
    secondRow.append(invert.rowLabel, invert.control);

    card.append(firstRow, secondRow);
    bindCompactGroupSelection(card, () => setSelectedGroup(node, group.id));
    return card;
}

function createToolbar(node, config, selectedId) {
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "height:34px;min-height:34px;display:flex;align-items:center;gap:6px;padding:4px 6px;box-sizing:border-box;background:#202226";
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.addRoot,
        "在选中颜色后新增",
        () => {
            const result = addMaskGroupAfter(getConfig(node), node._multiColorMaskV1SelectedId);
            commitConfig(node, result.config, { selectedId: result.selectedId, render: true, fit: true });
        },
        config.groups.length >= MAX_MASK_V1_GROUPS,
    ));
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.remove,
        "删除选中颜色",
        () => {
            const result = removeSelectedMaskGroup(getConfig(node), node._multiColorMaskV1SelectedId);
            commitConfig(node, result.config, { selectedId: result.selectedId, render: true, fit: true });
        },
        config.groups.length <= 1 || !selectedId,
    ));

    const outputLabel = document.createElement("span");
    outputLabel.textContent = "输出";
    outputLabel.style.cssText = "font:11px sans-serif;color:#aeb4bc;margin-left:2px;white-space:nowrap";
    const output = document.createElement("select");
    output.setAttribute("aria-label", "输出蒙版");
    output.style.cssText = compactInputStyle("height:24px;min-width:105px;max-width:150px;flex:1;padding:1px 6px;cursor:pointer");
    for (const choice of maskOutputChoices(config)) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = formatMaskOutputChoice(choice);
        output.appendChild(option);
    }
    output.value = config.output;
    output.addEventListener("change", () => {
        commitConfig(node, setMaskOutput(getConfig(node), output.value), { selectedId });
    });
    toolbar.append(outputLabel, output);

    const count = document.createElement("span");
    count.className = "daelab-multi-color-mask-v1-count";
    count.textContent = `${config.groups.length}/${MAX_MASK_V1_GROUPS}`;
    count.style.cssText = "font:10px sans-serif;color:#8e949c;margin-left:auto;white-space:nowrap";
    toolbar.appendChild(count);
    return toolbar;
}

function renderPanel(node) {
    const panel = node._multiColorMaskV1Panel;
    if (!panel?.element) return;
    const config = getConfig(node);
    const selectedId = resolveSelectedMaskGroupId(config, node._multiColorMaskV1SelectedId);
    node._multiColorMaskV1SelectedId = selectedId;
    const panelHeight = getMultiColorMaskV1PanelHeight(config.groups.length);
    panel.element.style.height = `${panelHeight}px`;
    panel.element.style.minHeight = `${panelHeight}px`;
    panel.element.style.maxHeight = `${panelHeight}px`;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createToolbar(node, config, selectedId));
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "多颜色蒙版组");
    list.style.cssText = "min-height:0;display:flex;flex-direction:column;gap:2px;padding:4px 6px;box-sizing:border-box";
    config.groups.forEach((group, index) => list.appendChild(createGroupCard(node, group, index)));
    fragment.appendChild(list);
    panel.element.replaceChildren(fragment);

    panel.widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    panel.widget.computeLayoutSize = () => ({
        minHeight: panelHeight,
        maxHeight: panelHeight,
        minWidth: MIN_WIDTH,
    });
    panel.widget.options ||= {};
    panel.widget.options.getMinHeight = () => panelHeight;
    panel.widget.options.getHeight = () => panelHeight;
    applyCompactGroupSelection(panel.element, selectedId);
    syncOutputLabel(node, config.output);
    normalizeAppModeInputs(node);
}

function createPanelElement() {
    const element = document.createElement("div");
    element.className = "daelab-multi-color-mask-v1-panel";
    element.style.cssText = "width:100%;overflow:hidden;box-sizing:border-box;border:1px solid #36393f;border-radius:6px;background:#202226";
    for (const eventName of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
        "dblclick",
        "contextmenu",
        "wheel",
        "keydown",
    ]) {
        element.addEventListener(eventName, stopCanvasPropagation);
    }
    return element;
}

function removeOwnedPanel(node) {
    const widgets = Array.isArray(node.widgets) ? [...node.widgets] : [];
    for (const widget of widgets) {
        if (!widget?.[OWNED_WIDGET_PROPERTY]) continue;
        try {
            node.removeWidget?.(widget);
        } catch {
            widget.onRemove?.();
            const index = node.widgets?.indexOf(widget) ?? -1;
            if (index >= 0) node.widgets.splice(index, 1);
        }
    }
    node._multiColorMaskV1Panel?.element?.remove?.();
    node._multiColorMaskV1Panel = null;
}

function installPanel(node) {
    if (node._multiColorMaskV1InstalledVersion === UI_VERSION && node._multiColorMaskV1Panel?.widget) {
        node._multiColorMaskV1Panel.widget.label = String(
            node.properties?.[APP_HEADING_PROPERTY] || "多颜色选区（按参考图取色）"
        );
        renderPanel(node);
        scheduleFit(node);
        return;
    }
    if (typeof node.addDOMWidget !== "function") return;

    removeOwnedPanel(node);
    const element = createPanelElement();
    const config = getConfig(node);
    syncPromptConfigWidget(node, encodeMaskV1Config(config));
    const panelHeight = getMultiColorMaskV1PanelHeight(config.groups.length);
    const widget = node.addDOMWidget(
        MULTI_COLOR_MASK_V1_PANEL_WIDGET_NAME,
        "custom",
        element,
        {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => panelHeight,
            getHeight: () => panelHeight,
            getValue: () => node.properties?.[CONFIG_PROPERTY] || encodeMaskV1Config(getConfig(node)),
            setValue: (value) => {
                storeConfig(node, value);
                renderPanel(node);
                scheduleFit(node);
            },
        },
    );
    widget.serialize = false;
    widget.label = String(
        node.properties?.[APP_HEADING_PROPERTY] || "多颜色选区（按参考图取色）"
    );
    widget.inputEl = element;
    widget[OWNED_WIDGET_PROPERTY] = true;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    widget.computeLayoutSize = () => ({ minHeight: panelHeight, maxHeight: panelHeight, minWidth: MIN_WIDTH });
    const originalOnRemove = widget.onRemove?.bind(widget);
    widget.onRemove = () => {
        originalOnRemove?.();
        element.remove();
    };

    node._multiColorMaskV1Panel = { element, widget };
    node._multiColorMaskV1InstalledVersion = UI_VERSION;
    renderPanel(node);
    scheduleFit(node);
}

function scheduleInstall(node) {
    if (node._multiColorMaskV1InstallFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._multiColorMaskV1InstallFrame = schedule(() => {
        node._multiColorMaskV1InstallFrame = null;
        installPanel(node);
        app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    });
}

if (globalThis.__DAELAB_MULTI_COLOR_MASK_V1_VERSION !== UI_VERSION) {
    globalThis.__DAELAB_MULTI_COLOR_MASK_V1_VERSION = UI_VERSION;
    app.registerExtension({
        name: "DAELab.MultiColorMaskV1",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== NODE_TYPE) return;
            chainCallback(nodeType.prototype, "onNodeCreated", function () {
                this.properties ||= {};
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onConfigure", function () {
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onAdded", function () {
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
                serialized.properties ||= {};
                const encoded = encodeMaskV1Config(getConfig(this));
                serialized.properties[CONFIG_PROPERTY] = encoded;
                syncPromptConfigWidget(this, encoded);
            });
            chainCallback(nodeType.prototype, "onResize", function (size) {
                const width = Number(size?.[0]);
                if (!this._multiColorMaskV1AutoSizing && Number.isFinite(width) && width >= MIN_WIDTH) {
                    this.properties ||= {};
                    this.properties[WIDTH_PROPERTY] = width;
                }
            });
            chainCallback(nodeType.prototype, "onRemoved", function () {
                const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
                if (this._multiColorMaskV1InstallFrame != null) cancel(this._multiColorMaskV1InstallFrame);
                if (this._multiColorMaskV1FitFrame != null) cancel(this._multiColorMaskV1FitFrame);
                this._multiColorMaskV1InstallFrame = null;
                this._multiColorMaskV1FitFrame = null;
                removeOwnedPanel(this);
            });
        },
    });
}
