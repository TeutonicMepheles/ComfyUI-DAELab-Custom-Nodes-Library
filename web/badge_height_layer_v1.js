import { app } from "/scripts/app.js";
import {
    LIST_EDITOR_ICONS,
    createIconButton,
    stopCanvasPropagation,
} from "./list_editor_controls.mjs?v=20260901-1";
import {
    applyCompactGroupSelection,
    bindCompactGroupSelection,
    compactInputStyle,
    createCompactColorControl,
    createCompactThresholdControl,
} from "./compact_color_group_controls.mjs?v=20260904-color-context-2";
import {
    BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME,
    HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME,
    HEIGHT_LAYER_OPTIONS,
    MAX_HEIGHT_GROUPS,
    addHeightGroupAfter,
    collapseBadgeHeightLayerV1Inputs,
    encodeHeightConfig,
    formatHeightLayerOption,
    getBadgeHeightLayerV1PanelHeight,
    heightLayerConfigDigest,
    normalizeHeightConfig,
    removeSelectedHeightGroup,
    resolveSelectedHeightGroupId,
    syncHeightLayerPromptConfigWidget,
    updateHeightGroup,
    validateHeightLayerConfigSnapshot,
} from "./badge_height_layer_v1_model.mjs?v=20260902-sync-1";

const NODE_TYPE = "DAELabBadgeHeightLayerV1";
const CONFIG_PROPERTY = "badge_height_layer_v1_config";
const WIDTH_PROPERTY = "badge_height_layer_v1_width";
const DEFAULT_WIDTH = 390;
const MIN_WIDTH = 340;
const UI_VERSION = "20260904-chinese-heading-1";
const DIGEST_PROPERTY = "badge_height_layer_v1_config_digest";
const OWNED_WIDGET_PROPERTY = "__daelabBadgeHeightLayerV1Panel";
const APP_HEADING_PROPERTY = "daelab_app_heading";

function appHeading(node) {
    return String(node?.properties?.[APP_HEADING_PROPERTY] || "高度层级设置（按层次图取色）");
}

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
    if (node._badgeHeightLayerV1Draft) {
        return normalizeHeightConfig(node._badgeHeightLayerV1Draft);
    }
    node.properties ||= {};
    const promptWidget = getPromptConfigWidget(node);
    const source = node.properties[CONFIG_PROPERTY] || promptWidget?.value;
    const config = normalizeHeightConfig(source);
    node._badgeHeightLayerV1Draft = config;
    return config;
}

function getPromptConfigWidget(node) {
    return node.widgets?.find?.(
        ({ name }) => name === HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME,
    ) ?? null;
}

function invalidHexValues(node) {
    return [...(node._badgeHeightLayerV1InvalidHex?.values?.() || [])];
}

function updateSyncStatus(node) {
    const element = node._badgeHeightLayerV1Panel?.element?.querySelector?.("[data-role='config-status']");
    if (!element) return;
    const invalid = invalidHexValues(node);
    if (invalid.length || node._badgeHeightLayerV1LastError) {
        element.textContent = invalid.length ? "颜色格式错误｜禁止排队" : "配置不同步｜禁止排队";
        element.title = node._badgeHeightLayerV1LastError || invalid.join(", ");
        element.style.color = "#ff8585";
        return;
    }
    const digest = heightLayerConfigDigest(getConfig(node));
    element.textContent = digest.slice(0, 8);
    element.title = `后端配置 SHA-256 ${digest}`;
    element.style.color = "#85c99a";
}

function showConfigError(node, message) {
    node._badgeHeightLayerV1LastError = String(message || "高度配置同步失败");
    const detail = node._badgeHeightLayerV1LastError;
    try {
        app.extensionManager?.toast?.add?.({
            severity: "error",
            summary: "Badge Height Layer V1",
            detail,
            life: 6000,
        });
    } catch {
        console.error("[BadgeHeightLayerV1]", detail);
    }
    updateSyncStatus(node);
}

function verifyConfigSnapshot(node, queueValue) {
    const promptWidget = getPromptConfigWidget(node);
    return validateHeightLayerConfigSnapshot({
        draft: getConfig(node),
        propertyValue: node.properties?.[CONFIG_PROPERTY],
        widgetValue: promptWidget?.value,
        queueValue,
        invalidHex: invalidHexValues(node),
    });
}

function flushHeightLayerConfig(node, { notify = true, throwOnError = false } = {}) {
    const invalid = invalidHexValues(node);
    if (invalid.length) {
        const message = `无效颜色输入：${invalid.join(", ")}。请输入完整 #RRGGBB，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    const config = normalizeHeightConfig(getConfig(node));
    const encoded = encodeHeightConfig(config);
    node._badgeHeightLayerV1Draft = config;
    node.properties ||= {};
    node.properties[CONFIG_PROPERTY] = encoded;
    node.properties[DIGEST_PROPERTY] = heightLayerConfigDigest(config);
    const promptWidget = getPromptConfigWidget(node);
    if (!promptWidget) {
        const message = `缺少隐藏输入 ${HEIGHT_LAYER_PROMPT_CONFIG_WIDGET_NAME}，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    syncHeightLayerPromptConfigWidget(node, promptWidget, encoded, { notify });
    const snapshot = verifyConfigSnapshot(node, encoded);
    if (!snapshot.ok) {
        const message = `配置不一致：${snapshot.mismatches.join(", ")}，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    node._badgeHeightLayerV1LastError = "";
    updateSyncStatus(node);
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    return snapshot;
}

function scheduleConfigFlush(node) {
    if (node._badgeHeightLayerV1ConfigFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeHeightLayerV1ConfigFrame = schedule(() => {
        node._badgeHeightLayerV1ConfigFrame = null;
        flushHeightLayerConfig(node);
    });
}

function stageHeightLayerConfig(node, value, { flush = false } = {}) {
    node._badgeHeightLayerV1Draft = normalizeHeightConfig(value);
    if (flush) flushHeightLayerConfig(node, { throwOnError: true });
    else scheduleConfigFlush(node);
    return node._badgeHeightLayerV1Draft;
}

function configurePromptConfigWidget(node) {
    const widget = getPromptConfigWidget(node);
    if (!widget) return null;
    widget.options ||= {};
    widget.options.advanced = true;
    widget.options.serialize = true;
    widget.serialize = true;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    if (!widget._badgeHeightLayerV1StrictQueueSyncBound) {
        const originalBeforeQueued = widget.beforeQueued;
        widget.beforeQueued = function () {
            originalBeforeQueued?.apply(this, arguments);
            flushHeightLayerConfig(node, { throwOnError: true });
        };
        widget.serializeValue = function () {
            const snapshot = flushHeightLayerConfig(node, { throwOnError: true });
            return snapshot.encoded;
        };
        widget._badgeHeightLayerV1StrictQueueSyncBound = true;
    }
    flushHeightLayerConfig(node, { notify: false });
    return widget;
}

function normalizeAppModeInputs(node) {
    const graph = app.rootGraph;
    const data = graph?.extra?.linearData;
    if (!Array.isArray(data?.inputs) || graph.getNodeById?.(node.id) !== node) return false;
    const result = collapseBadgeHeightLayerV1Inputs(data.inputs, node.id);
    if (!result.changed) return false;
    graph.extra.linearData = { ...data, inputs: result.inputs };
    return true;
}

function applyNodeSize(node, size) {
    if (typeof node.setSize === "function") node.setSize(size);
    else node.size = size;
}

function fitNodeToMinimum(node) {
    if (!node?._badgeHeightLayerV1Panel?.widget) return;
    const savedWidth = Number(node.properties?.[WIDTH_PROPERTY]);
    const currentWidth = Number(node.size?.[0]);
    const width = Number.isFinite(savedWidth) && savedWidth >= MIN_WIDTH
        ? savedWidth
        : Math.max(DEFAULT_WIDTH, Number.isFinite(currentWidth) ? currentWidth : 0);
    const fallbackHeight = getBadgeHeightLayerV1PanelHeight(getConfig(node).groups.length) + 90;

    node._badgeHeightLayerV1AutoSizing = true;
    try {
        applyNodeSize(node, [width, 1]);
        node.arrange?.();
        const measured = Number(node.computeSize?.()?.[1]);
        applyNodeSize(node, [
            width,
            Number.isFinite(measured) && measured > 1 ? measured : fallbackHeight,
        ]);
    } finally {
        node._badgeHeightLayerV1AutoSizing = false;
    }
}

function scheduleFit(node) {
    if (node._badgeHeightLayerV1FitFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeHeightLayerV1FitFrame = schedule(() => {
        node._badgeHeightLayerV1FitFrame = null;
        fitNodeToMinimum(node);
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    });
}

function commitConfig(node, config, { selectedId = null, render = false, fit = false } = {}) {
    graphTransaction(node, () => {
        const stored = stageHeightLayerConfig(node, config, { flush: true }) || getConfig(node);
        node._badgeHeightLayerV1SelectedId = resolveSelectedHeightGroupId(
            stored,
            selectedId ?? node._badgeHeightLayerV1SelectedId,
        );
        if (render) renderPanel(node);
        if (fit) scheduleFit(node);
    });
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
}

function setSelectedGroup(node, groupId) {
    if (!flushHeightLayerConfig(node)) return false;
    const config = getConfig(node);
    node._badgeHeightLayerV1SelectedId = resolveSelectedHeightGroupId(config, groupId);
    applyCompactGroupSelection(
        node._badgeHeightLayerV1Panel?.element,
        node._badgeHeightLayerV1SelectedId,
    );
    return true;
}

function selectCardOnInteraction(node, card, groupId) {
    bindCompactGroupSelection(card, () => setSelectedGroup(node, groupId));
}

function createColorControl(node, group, card) {
    return createCompactColorControl({
        color: group.color,
        label: "高度图源区域颜色",
        onDraft: (value) => {
            const config = updateHeightGroup(getConfig(node), group.id, { color: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            if (!updated) return null;
            card.style.setProperty("--height-group-color", updated.color);
            node._badgeHeightLayerV1InvalidHex?.delete?.(group.id);
            stageHeightLayerConfig(node, config);
            updateSyncStatus(node);
            return updated.color;
        },
        onCommit: (value) => {
            const config = updateHeightGroup(getConfig(node), group.id, { color: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            if (!updated) return null;
            card.style.setProperty("--height-group-color", updated.color);
            node._badgeHeightLayerV1InvalidHex?.delete?.(group.id);
            stageHeightLayerConfig(node, config, { flush: true });
            return updated.color;
        },
        onInvalid: (value) => {
            node._badgeHeightLayerV1InvalidHex ||= new Map();
            if (value) node._badgeHeightLayerV1InvalidHex.set(group.id, value);
            else node._badgeHeightLayerV1InvalidHex.delete(group.id);
            updateSyncStatus(node);
        },
        onFlush: (valid) => {
            if (valid) flushHeightLayerConfig(node);
        },
        getCurrentColor: () => getConfig(node).groups.find(({ id }) => id === group.id)?.color,
    });
}

function createThresholdControl(node, group) {
    return createCompactThresholdControl({
        threshold: group.threshold,
        onCommit: (value) => {
            const config = updateHeightGroup(getConfig(node), group.id, { threshold: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            commitConfig(node, config, { selectedId: group.id });
            return updated?.threshold;
        },
    });
}

function createLayerControl(node, group) {
    const label = document.createElement("span");
    label.textContent = "层次";
    label.style.cssText = "font:11px sans-serif;color:#aeb4bc;white-space:nowrap";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "徽章相对高度层次");
    select.style.cssText = compactInputStyle("width:100%;padding:2px 7px;cursor:pointer");
    for (const optionSpec of HEIGHT_LAYER_OPTIONS) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = formatHeightLayerOption(optionSpec.value);
        select.appendChild(option);
    }
    select.value = String(group.layer);
    select.addEventListener("change", () => {
        const config = updateHeightGroup(getConfig(node), group.id, { layer: select.value });
        commitConfig(node, config, { selectedId: group.id });
    });
    return { label, select };
}

function createGroupCard(node, group, index) {
    const card = document.createElement("div");
    card.dataset.heightGroupId = group.id;
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
    const layerControl = createLayerControl(node, group);
    secondRow.append(layerControl.label, layerControl.select);

    card.append(firstRow, secondRow);
    selectCardOnInteraction(node, card, group.id);
    return card;
}

function createToolbar(node, config, selectedId) {
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "height:34px;min-height:34px;display:flex;align-items:center;gap:6px;padding:4px 6px;box-sizing:border-box;background:#202226";
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.addRoot,
        "在选中层后新增",
        () => {
            const result = addHeightGroupAfter(getConfig(node), node._badgeHeightLayerV1SelectedId);
            commitConfig(node, result.config, { selectedId: result.selectedId, render: true, fit: true });
        },
        config.groups.length >= MAX_HEIGHT_GROUPS,
    ));
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.remove,
        "删除选中层",
        () => {
            const result = removeSelectedHeightGroup(getConfig(node), node._badgeHeightLayerV1SelectedId);
            commitConfig(node, result.config, { selectedId: result.selectedId, render: true, fit: true });
        },
        config.groups.length <= 1 || !selectedId,
    ));
    const count = document.createElement("span");
    count.textContent = `${config.groups.length}/${MAX_HEIGHT_GROUPS}`;
    count.style.cssText = "font:10px sans-serif;color:#8e949c";
    const status = document.createElement("span");
    status.dataset.role = "config-status";
    status.style.cssText = "font:10px monospace;color:#85c99a;margin-left:auto";
    toolbar.append(status, count);
    return toolbar;
}

function renderPanel(node) {
    const panel = node._badgeHeightLayerV1Panel;
    if (!panel?.element) return;
    const config = getConfig(node);
    const selectedId = resolveSelectedHeightGroupId(config, node._badgeHeightLayerV1SelectedId);
    node._badgeHeightLayerV1SelectedId = selectedId;
    const panelHeight = getBadgeHeightLayerV1PanelHeight(config.groups.length);
    panel.element.style.height = `${panelHeight}px`;
    panel.element.style.minHeight = `${panelHeight}px`;
    panel.element.style.maxHeight = `${panelHeight}px`;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createToolbar(node, config, selectedId));
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "徽章高度颜色层");
    list.style.cssText = "min-height:0;display:flex;flex-direction:column;gap:2px;padding:4px 6px;box-sizing:border-box";
    config.groups.forEach((group, index) => list.appendChild(createGroupCard(node, group, index)));
    fragment.appendChild(list);
    panel.element.replaceChildren(fragment);
    updateSyncStatus(node);

    panel.widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    panel.widget.computeLayoutSize = () => ({
        minHeight: panelHeight,
        maxHeight: panelHeight,
        minWidth: MIN_WIDTH,
    });
    panel.widget.options ||= {};
    panel.widget.options.getMinHeight = () => panelHeight;
    panel.widget.options.getHeight = () => panelHeight;
    setSelectedGroup(node, selectedId);
    normalizeAppModeInputs(node);
}

function createPanelElement() {
    const element = document.createElement("div");
    element.className = "daelab-badge-height-layer-v1-panel";
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
    node._badgeHeightLayerV1Panel?.element?.remove?.();
    node._badgeHeightLayerV1Panel = null;
}

function installPanel(node) {
    if (node._badgeHeightLayerV1InstalledVersion === UI_VERSION && node._badgeHeightLayerV1Panel?.widget) {
        node._badgeHeightLayerV1Panel.widget.label = appHeading(node);
        configurePromptConfigWidget(node);
        renderPanel(node);
        scheduleFit(node);
        return;
    }
    if (typeof node.addDOMWidget !== "function") return;

    removeOwnedPanel(node);
    configurePromptConfigWidget(node);
    const element = createPanelElement();
    const config = getConfig(node);
    const panelHeight = getBadgeHeightLayerV1PanelHeight(config.groups.length);
    const widget = node.addDOMWidget(
        BADGE_HEIGHT_LAYER_V1_PANEL_WIDGET_NAME,
        "custom",
        element,
        {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => panelHeight,
            getHeight: () => panelHeight,
            getValue: () => node.properties?.[CONFIG_PROPERTY] || encodeHeightConfig(getConfig(node)),
            setValue: (value) => {
                stageHeightLayerConfig(node, value, { flush: true });
                renderPanel(node);
                scheduleFit(node);
            },
        },
    );
    widget.serialize = false;
    widget.label = appHeading(node);
    widget.inputEl = element;
    widget[OWNED_WIDGET_PROPERTY] = true;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    widget.computeLayoutSize = () => ({ minHeight: panelHeight, maxHeight: panelHeight, minWidth: MIN_WIDTH });
    const originalOnRemove = widget.onRemove?.bind(widget);
    widget.onRemove = () => {
        originalOnRemove?.();
        element.remove();
    };

    node._badgeHeightLayerV1Panel = { element, widget };
    node._badgeHeightLayerV1InstalledVersion = UI_VERSION;
    renderPanel(node);
    scheduleFit(node);
}

function scheduleInstall(node) {
    if (node._badgeHeightLayerV1InstallFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeHeightLayerV1InstallFrame = schedule(() => {
        node._badgeHeightLayerV1InstallFrame = null;
        installPanel(node);
        app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    });
}

if (globalThis.__DAELAB_BADGE_HEIGHT_LAYER_V1_VERSION !== UI_VERSION) {
    globalThis.__DAELAB_BADGE_HEIGHT_LAYER_V1_VERSION = UI_VERSION;
    app.registerExtension({
        name: "DAELab.BadgeHeightLayerV1",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== NODE_TYPE) return;
            chainCallback(nodeType.prototype, "onNodeCreated", function () {
                this.properties ||= {};
                this._badgeHeightLayerV1InvalidHex ||= new Map();
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onConfigure", function () {
                this._badgeHeightLayerV1Draft = null;
                this._badgeHeightLayerV1InvalidHex = new Map();
                this._badgeHeightLayerV1LastError = "";
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onAdded", function () {
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
                configurePromptConfigWidget(this);
                const snapshot = flushHeightLayerConfig(this, { throwOnError: true });
                serialized.properties ||= {};
                serialized.properties[CONFIG_PROPERTY] = snapshot.encoded;
                serialized.properties[DIGEST_PROPERTY] = snapshot.digest;
            });
            chainCallback(nodeType.prototype, "onResize", function (size) {
                const width = Number(size?.[0]);
                if (!this._badgeHeightLayerV1AutoSizing && Number.isFinite(width) && width >= MIN_WIDTH) {
                    this.properties ||= {};
                    this.properties[WIDTH_PROPERTY] = width;
                }
            });
            chainCallback(nodeType.prototype, "onRemoved", function () {
                const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
                if (this._badgeHeightLayerV1InstallFrame != null) cancel(this._badgeHeightLayerV1InstallFrame);
                if (this._badgeHeightLayerV1FitFrame != null) cancel(this._badgeHeightLayerV1FitFrame);
                if (this._badgeHeightLayerV1ConfigFrame != null) cancel(this._badgeHeightLayerV1ConfigFrame);
                this._badgeHeightLayerV1InstallFrame = null;
                this._badgeHeightLayerV1FitFrame = null;
                this._badgeHeightLayerV1ConfigFrame = null;
                removeOwnedPanel(this);
            });
        },
    });
}
