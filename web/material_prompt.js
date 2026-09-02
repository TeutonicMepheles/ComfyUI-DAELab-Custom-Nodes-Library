import { app } from "/scripts/app.js";
import {
    applyMaterialWidgetLabels,
    fitMaterialPromptNodeToContent,
    getCanonicalMaterialOutputs,
    getLegacyMaterialOutputIndexes,
    getMaterialSelectorLayout,
    MATERIAL_LAYOUT_COLUMNS,
    MATERIAL_LAYOUT_GAP,
    MATERIAL_LAYOUT_HORIZONTAL_INSET,
    MATERIAL_LAYOUT_MAX_CARD_SIZE,
    MATERIAL_MIN_NODE_WIDTH,
    MATERIAL_VIEWPORT_GAP,
    MATERIAL_VIEWPORT_MAX_SIZE,
    getCanonicalMaterialWidgetValues,
    LEGACY_MATERIAL_COLOR_PICKER_WIDGET_NAME,
    MATERIAL_PANEL_WIDGET_NAME,
    MATERIAL_WIDGET_SERIALIZATION_ORDER,
    migrateMaterialWidgetValues,
    normalizeMaterialBasePrompt,
    orderMaterialPromptWidgets,
} from "./material_prompt_model.mjs?v=20260901-drop-selected-color-v12";
import {
    catalogEntries,
    ensureThumbnailSelectorStyles,
    makeCatalogThumbnailUrl,
    renderThumbnailGrid,
    resolveCatalogId,
} from "./thumbnail_selector.mjs";

const UI_VERSION = "20260901-gpt-image2-drop-selected-color-v12";
const MATERIAL_URL = new URL("./materials.json", import.meta.url);
MATERIAL_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./material_thumbs/", import.meta.url);
const LEGACY_COLOR_WIDGET_NAMES = new Set([
    "material_color",
    "use_color",
    LEGACY_MATERIAL_COLOR_PICKER_WIDGET_NAME,
]);
const DEFAULT_MATERIALS = {
    dark_brushed_bronze: { label: "深色拉丝古铜", thumbnail: "dark_brushed_bronze.png" },
    light_speckled_enamel: { label: "浅灰细砂珐琅", thumbnail: "glossy_enamel.png" },
    baked_enamel: { label: "烤漆", thumbnail: "baked_enamel.png" },
    transparent_lacquer: { label: "透明漆", thumbnail: "transparent_lacquer.png" },
    satin_gold: { label: "亚金", thumbnail: "satin_gold.png" },
    satin_silver: { label: "亚银", thumbnail: "satin_silver.png" },
    glitter: { label: "闪粉", thumbnail: "glitter.png" },
    rhinestone: { label: "水钻", thumbnail: "rhinestone.png" },
};

let materialData = DEFAULT_MATERIALS;
let materialLoadPromise = null;

function markNodeDirty(node) {
    if (node?.graph) node.graph._version = (node.graph._version || 0) + 1;
    node?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function requestMaterials() {
    materialLoadPromise ??= fetch(MATERIAL_URL)
        .then((response) => response.json())
        .then((data) => {
            materialData = data && Object.keys(data).length ? data : DEFAULT_MATERIALS;
            return materialData;
        })
        .catch((error) => {
            console.warn("[GPTImage2MaterialPrompt] Failed to load materials.json", error);
            materialData = DEFAULT_MATERIALS;
            return materialData;
        });
    return materialLoadPromise;
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function entries() {
    return catalogEntries(materialData);
}

function defaultMaterialId() {
    return entries()[0]?.id || "dark_brushed_bronze";
}

function widgetValueForId(materialId) {
    return materialData?.[materialId]?.label || materialId || defaultMaterialId();
}

function selectedMaterialId(node) {
    const widgetValue = findWidget(node, "material_id")?.value;
    const propertyValue = node.properties?.gpt_image2_material_id;
    return resolveCatalogId(
        materialData,
        widgetValue || propertyValue,
        defaultMaterialId()
    );
}

function setMaterialWidgetValue(node, materialId) {
    const widget = findWidget(node, "material_id");
    if (!widget) return;
    const previousValue = widget.value;
    widget.value = widgetValueForId(materialId);
    node.onWidgetChanged?.("material_id", widget.value, previousValue, widget);
}

function syncProperties(node) {
    node.properties ||= {};
    node.properties.gpt_image2_material_id = selectedMaterialId(node);
    delete node.properties.gpt_image2_material_color;
    delete node.properties.gpt_image2_material_use_color;
}

function stopCanvasEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function ensureMaterialStyles() {
    ensureThumbnailSelectorStyles();
    const existingStyle = document.getElementById("gpt-image2-material-prompt-style");
    if (existingStyle?.dataset.uiVersion === UI_VERSION) return;
    existingStyle?.remove();
    const style = document.createElement("style");
    style.id = "gpt-image2-material-prompt-style";
    style.dataset.uiVersion = UI_VERSION;
    style.textContent = `
.gpt-image2-material-selector {
  box-sizing: border-box;
  width: 100%;
  min-height: 0;
  padding: 6px 0;
  pointer-events: auto;
  font-family: Arial, Helvetica, sans-serif;
  align-self: start;
}
.gpt-image2-material-viewport {
  position: relative;
  box-sizing: border-box;
  width: min(calc(100% - ${MATERIAL_LAYOUT_HORIZONTAL_INSET}px), ${MATERIAL_VIEWPORT_MAX_SIZE}px);
  aspect-ratio: 1 / 1;
  margin: 0 auto ${MATERIAL_VIEWPORT_GAP}px;
  overflow: hidden;
  border: 1px solid #6aa8ff;
  border-radius: 10px;
  background: #171a20;
  box-shadow: inset 0 0 0 1px rgba(106, 168, 255, 0.24);
}
.gpt-image2-material-viewport img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #232832;
}
.gpt-image2-material-viewport-label {
  position: absolute;
  bottom: 8px;
  left: 8px;
  box-sizing: border-box;
  max-width: calc(100% - 16px);
  padding: 5px 8px;
  overflow: hidden;
  color: #fff;
  background: rgba(12, 15, 20, 0.82);
  border-radius: 6px;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gpt-image2-material-selector .daelab-thumbnail-grid {
  grid-template-columns: repeat(${MATERIAL_LAYOUT_COLUMNS}, minmax(0, ${MATERIAL_LAYOUT_MAX_CARD_SIZE}px));
  gap: ${MATERIAL_LAYOUT_GAP}px;
  justify-content: center;
  align-content: start;
}
.gpt-image2-material-selector .daelab-thumbnail-button {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
}
.gpt-image2-material-selector .daelab-thumbnail-button img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
}
`;
    document.head.appendChild(style);
}

function selectorHeight(width = MATERIAL_MIN_NODE_WIDTH) {
    return getMaterialSelectorLayout(width, entries().length).height;
}

function renderMaterialSelector(widget, node) {
    const element = widget?.element || widget?.inputEl;
    if (!element) return;
    const selectedId = selectedMaterialId(node);
    const materialEntries = entries();
    const selectedEntry = materialEntries.find((entry) => entry.id === selectedId);
    widget.__gptImage2MaterialValue = selectedId;
    element.replaceChildren();

    if (selectedEntry) {
        const viewport = document.createElement("div");
        viewport.className = "gpt-image2-material-viewport";
        viewport.dataset.materialId = selectedEntry.id;
        viewport.title = selectedEntry.label || selectedEntry.id;

        const image = document.createElement("img");
        image.alt = `${selectedEntry.label || selectedEntry.id} 当前材质预览`;
        image.decoding = "async";
        image.draggable = false;
        image.src = makeCatalogThumbnailUrl(selectedEntry, THUMB_BASE_URL, UI_VERSION);

        const label = document.createElement("span");
        label.className = "gpt-image2-material-viewport-label";
        label.textContent = `当前材质 · ${selectedEntry.label || selectedEntry.id}`;
        viewport.append(image, label);
        element.appendChild(viewport);
    }

    const grid = document.createElement("div");
    grid.className = "daelab-thumbnail-grid";
    renderThumbnailGrid({
        container: grid,
        entries: materialEntries,
        selectedId,
        getImageUrl: (entry) => makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION),
        dataKey: "materialId",
        stopEvent: stopCanvasEvent,
        onSelect: (materialId) => {
            node.properties ||= {};
            node.properties.gpt_image2_material_id = materialId;
            widget.__gptImage2MaterialValue = materialId;
            setMaterialWidgetValue(node, materialId);
            renderMaterialSelector(widget, node);
            markNodeDirty(node);
        },
    });
    element.appendChild(grid);
}

function removeOwnedWidgets(node) {
    node.widgets = (node.widgets || []).filter((widget) => {
        const remove = widget.__gptImage2MaterialSelector
            || LEGACY_COLOR_WIDGET_NAMES.has(widget.name)
            || widget.__gptImage2MaterialColorPicker;
        if (!remove) return true;
        widget._colorPicker?.remove();
        widget.onRemove?.();
        widget.onRemoved?.();
        return false;
    });
}

function removeLegacyMaterialOutputs(node) {
    const indexes = getLegacyMaterialOutputIndexes(node?.outputs);
    if (!indexes.length) return false;

    for (const index of indexes.reverse()) {
        if (typeof node.removeOutput === "function") {
            node.removeOutput(index);
            continue;
        }

        const output = node.outputs?.[index];
        for (const linkId of output?.links || []) node.graph?.removeLink?.(linkId);
        node.outputs?.splice(index, 1);
    }
    return true;
}

function makeMaterialSelector(node) {
    ensureMaterialStyles();
    if (typeof node.addDOMWidget !== "function") return null;
    const element = document.createElement("div");
    element.className = "gpt-image2-material-selector";
    for (const eventName of ["pointerdown", "pointerup", "click", "wheel"]) {
        element.addEventListener(eventName, (event) => event.stopPropagation());
    }

    let widget;
    widget = node.addDOMWidget(MATERIAL_PANEL_WIDGET_NAME, "custom", element, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => selectorHeight(node.size?.[0] || MATERIAL_MIN_NODE_WIDTH),
        getHeight: () => selectorHeight(node.size?.[0] || MATERIAL_MIN_NODE_WIDTH),
        getValue: () => widget?.__gptImage2MaterialValue ?? selectedMaterialId(node),
        setValue: (value) => {
            if (!widget) return;
            widget.__gptImage2MaterialValue = resolveCatalogId(
                materialData,
                value,
                selectedMaterialId(node)
            );
            renderMaterialSelector(widget, node);
        },
    });
    widget.serialize = false;
    widget.label = "材质选择";
    widget.inputEl = element;
    widget.__gptImage2MaterialSelector = true;
    widget.__gptImage2MaterialValue = selectedMaterialId(node);
    widget.computeSize = (width) => [
        width || MATERIAL_MIN_NODE_WIDTH,
        selectorHeight(width || MATERIAL_MIN_NODE_WIDTH),
    ];
    widget.computeLayoutSize = () => ({
        minHeight: selectorHeight(node.size?.[0] || MATERIAL_MIN_NODE_WIDTH),
        maxHeight: selectorHeight(node.size?.[0] || MATERIAL_MIN_NODE_WIDTH),
        minWidth: MATERIAL_MIN_NODE_WIDTH,
    });
    const originalOnRemove = widget.onRemove?.bind(widget);
    widget.onRemove = () => {
        originalOnRemove?.();
        element.remove();
    };
    renderMaterialSelector(widget, node);
    return widget;
}

function installMaterialWidgetCallback(node) {
    const widget = findWidget(node, "material_id");
    if (!widget || widget.__gptImage2MaterialCallbackWrapped) return;
    const originalCallback = widget.callback;
    widget.callback = function (value) {
        originalCallback?.apply(this, arguments);
        node.properties ||= {};
        node.properties.gpt_image2_material_id = resolveCatalogId(
            materialData,
            value,
            defaultMaterialId()
        );
        const domWidget = node.widgets?.find((candidate) => candidate.__gptImage2MaterialSelector);
        if (domWidget) renderMaterialSelector(domWidget, node);
        markNodeDirty(node);
    };
    widget.__gptImage2MaterialCallbackWrapped = true;
}

function restoreCanonicalValues(node, serializedValues) {
    const values = migrateMaterialWidgetValues(serializedValues);
    if (!values) return false;
    for (const [index, name] of MATERIAL_WIDGET_SERIALIZATION_ORDER.entries()) {
        const widget = findWidget(node, name);
        if (widget) widget.value = values[index];
    }
    return true;
}

function migrateLegacyBasePromptWidget(node) {
    const widget = findWidget(node, "base_prompt");
    if (!widget) return false;
    const normalized = normalizeMaterialBasePrompt(widget.value);
    if (normalized === widget.value) return false;
    widget.value = normalized;
    return true;
}

function installCanonicalSerialization(node) {
    if (node.__gptImage2MaterialSerializationInstalled === UI_VERSION) return;
    const originalOnSerialize = node.onSerialize;
    node.onSerialize = function (data) {
        removeLegacyMaterialOutputs(this);
        originalOnSerialize?.call(this, data);
        data.widgets_values = getCanonicalMaterialWidgetValues(this.widgets);
        if (Array.isArray(data.outputs)) {
            data.outputs = getCanonicalMaterialOutputs(data.outputs);
        }
    };
    node.__gptImage2MaterialSerializationInstalled = UI_VERSION;
}

function scheduleCompactNodeSize(node) {
    if (node.__gptImage2MaterialCompactSizeScheduled) return;
    node.__gptImage2MaterialCompactSizeScheduled = true;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    schedule(() => {
        node.__gptImage2MaterialCompactSizeScheduled = false;
        node.__gptImage2MaterialAutoSizing = true;
        try {
            fitMaterialPromptNodeToContent(node);
        } finally {
            node.__gptImage2MaterialAutoSizing = false;
        }
        markNodeDirty(node);
    });
}

function installMaterialPromptUi(node) {
    if (node.__gptImage2MaterialUiInstalled === UI_VERSION) return;
    node.__gptImage2MaterialUiInstalled = UI_VERSION;
    removeLegacyMaterialOutputs(node);
    removeOwnedWidgets(node);
    applyMaterialWidgetLabels(node.widgets);
    migrateLegacyBasePromptWidget(node);
    syncProperties(node);
    installMaterialWidgetCallback(node);
    makeMaterialSelector(node);
    node.widgets = orderMaterialPromptWidgets(node.widgets);
    installCanonicalSerialization(node);
    scheduleCompactNodeSize(node);
    requestMaterials().then(() => {
        syncProperties(node);
        const selector = node.widgets?.find((candidate) => candidate.__gptImage2MaterialSelector);
        if (selector) renderMaterialSelector(selector, node);
        scheduleCompactNodeSize(node);
        markNodeDirty(node);
    });
}

if (globalThis.__GPT_IMAGE2_MATERIAL_PROMPT_UI_VERSION !== UI_VERSION) {
    globalThis.__GPT_IMAGE2_MATERIAL_PROMPT_UI_VERSION = UI_VERSION;
    app.registerExtension({
        name: "DAELab.GPTImage2MaterialPrompt.UI",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "GPTImage2MaterialPrompt") return;

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                onConfigure?.apply(this, arguments);
                removeLegacyMaterialOutputs(this);
                restoreCanonicalValues(this, info?.widgets_values);
                syncProperties(this);
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const self = this;
                setTimeout(() => installMaterialPromptUi(self), 0);
            };

            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                removeOwnedWidgets(this);
                onRemoved?.apply(this, arguments);
            };
        },
    });
}
