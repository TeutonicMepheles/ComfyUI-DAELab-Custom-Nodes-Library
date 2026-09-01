import { app } from "/scripts/app.js";
import { addColorPickerWidget } from "./color_picker_widget.mjs?v=20260826-2";
import {
    applyMaterialWidgetLabels,
    DEFAULT_MATERIAL_COLOR,
    DEFAULT_USE_COLOR,
    fitMaterialPromptNodeToContent,
    getMaterialSelectorLayout,
    MATERIAL_COLOR_PICKER_WIDGET_NAME,
    MATERIAL_LAYOUT_COLUMNS,
    MATERIAL_LAYOUT_GAP,
    MATERIAL_LAYOUT_HORIZONTAL_INSET,
    MATERIAL_LAYOUT_MAX_CARD_SIZE,
    MATERIAL_MIN_NODE_WIDTH,
    MATERIAL_VIEWPORT_GAP,
    MATERIAL_VIEWPORT_MAX_SIZE,
    getCanonicalMaterialWidgetValues,
    MATERIAL_PANEL_WIDGET_NAME,
    MATERIAL_WIDGET_SERIALIZATION_ORDER,
    migrateMaterialWidgetValues,
    normalizeMaterialBasePrompt,
    orderMaterialPromptWidgets,
    isMaterialColorEnabled,
    resolveMaterialColor,
} from "./material_prompt_model.mjs?v=20260827-optional-edit-target-v8";
import { normalizeColor } from "./multi_color_mask_model.mjs?v=20260819-1";
import {
    catalogEntries,
    ensureThumbnailSelectorStyles,
    makeCatalogThumbnailUrl,
    renderThumbnailGrid,
    resolveCatalogId,
} from "./thumbnail_selector.mjs";

const UI_VERSION = "20260827-gpt-image2-material-optional-edit-target-v8";
const MATERIAL_URL = new URL("./materials.json", import.meta.url);
MATERIAL_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./material_thumbs/", import.meta.url);
const MATERIAL_COLOR_OWNER_PROPERTY = "__gptImage2MaterialColorPicker";
const DEFAULT_MATERIALS = {
    dark_brushed_bronze: {
        label: "深色拉丝古铜",
        thumbnail: "dark_brushed_bronze.png",
        preview_color: "#6B3F24",
    },
    light_speckled_enamel: {
        label: "浅灰细砂珐琅",
        thumbnail: "glossy_enamel.png",
        preview_color: "#C7C7C5",
    },
    baked_enamel: { label: "烤漆", thumbnail: "baked_enamel.png", preview_color: "#C62828" },
    transparent_lacquer: { label: "透明漆", thumbnail: "transparent_lacquer.png", preview_color: "#169C98" },
    satin_gold: { label: "亚金", thumbnail: "satin_gold.png", preview_color: "#C6A15B" },
    satin_silver: { label: "亚银", thumbnail: "satin_silver.png", preview_color: "#BFC3C8" },
    glitter: { label: "闪粉", thumbnail: "glitter.png", preview_color: "#C94FA7" },
    rhinestone: { label: "水钻", thumbnail: "rhinestone.png", preview_color: "#D9F3FF" },
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

function rawMaterialColor(node) {
    return String(
        findWidget(node, "material_color")?.value
        ?? node.properties?.gpt_image2_material_color
        ?? DEFAULT_MATERIAL_COLOR
    ).trim();
}

function selectedMaterialColor(node) {
    return resolveMaterialColor(materialData, selectedMaterialId(node), rawMaterialColor(node));
}

function materialColorEnabled(node) {
    return isMaterialColorEnabled(
        findWidget(node, "use_color")?.value
        ?? node.properties?.gpt_image2_material_use_color
        ?? DEFAULT_USE_COLOR
    );
}

function setMaterialWidgetValue(node, materialId) {
    const widget = findWidget(node, "material_id");
    if (!widget) return;
    const previousValue = widget.value;
    widget.value = widgetValueForId(materialId);
    node.onWidgetChanged?.("material_id", widget.value, previousValue, widget);
}

function setMaterialColorWidgetValue(node, value, event = null) {
    const widget = findWidget(node, "material_color");
    if (!widget) return;
    const normalized = String(value).toLowerCase() === DEFAULT_MATERIAL_COLOR
        ? DEFAULT_MATERIAL_COLOR
        : normalizeColor(value, selectedMaterialColor(node));
    if (widget.value === normalized) return;
    const previousValue = widget.value;
    widget.value = normalized;
    node.onWidgetChanged?.("material_color", normalized, previousValue, widget);
    widget.callback?.(normalized, app.canvas, node, app.canvas?.graph_mouse, event);
}

function syncProperties(node) {
    node.properties ||= {};
    node.properties.gpt_image2_material_id = selectedMaterialId(node);
    node.properties.gpt_image2_material_color = rawMaterialColor(node) || DEFAULT_MATERIAL_COLOR;
    node.properties.gpt_image2_material_use_color = materialColorEnabled(node);
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
  min-width: 0;
  padding: 5px 8px;
  overflow: hidden;
  color: #ffffff;
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
        getImageUrl: (entry) => makeCatalogThumbnailUrl(
            entry,
            THUMB_BASE_URL,
            UI_VERSION
        ),
        dataKey: "materialId",
        stopEvent: stopCanvasEvent,
        onSelect: (materialId) => {
            node.properties ||= {};
            node.properties.gpt_image2_material_id = materialId;
            widget.__gptImage2MaterialValue = materialId;
            setMaterialWidgetValue(node, materialId);
            setMaterialColorWidgetValue(
                node,
                resolveMaterialColor(materialData, materialId, DEFAULT_MATERIAL_COLOR)
            );
            syncMaterialColorPicker(node);
            renderMaterialSelector(widget, node);
            markNodeDirty(node);
        },
    });
    element.appendChild(grid);
}

function removeMaterialSelector(node) {
    node.widgets = (node.widgets || []).filter((widget) => {
        if (!widget.__gptImage2MaterialSelector && !widget[MATERIAL_COLOR_OWNER_PROPERTY]) {
            return true;
        }
        widget._colorPicker?.remove();
        widget.onRemove?.();
        widget.onRemoved?.();
        return false;
    });
}

function getMaterialColorPicker(node) {
    return node.widgets?.find((widget) => widget[MATERIAL_COLOR_OWNER_PROPERTY]);
}

function syncMaterialColorPicker(node) {
    const widget = getMaterialColorPicker(node);
    if (!widget) return;
    widget.value = selectedMaterialColor(node);
    const enabled = materialColorEnabled(node);
    if (!widget.__gptImage2MaterialVisibilityInstalled) {
        widget.__gptImage2MaterialVisibilityInstalled = true;
        widget.__gptImage2MaterialOriginalHidden = widget.hidden;
        widget.__gptImage2MaterialOriginalComputeSize = widget.computeSize;
        widget.__gptImage2MaterialOriginalComputeLayoutSize = widget.computeLayoutSize;
    }
    widget.hidden = enabled ? widget.__gptImage2MaterialOriginalHidden : true;
    widget.computeSize = enabled
        ? widget.__gptImage2MaterialOriginalComputeSize
        : () => [0, -4];
    widget.computeLayoutSize = enabled
        ? widget.__gptImage2MaterialOriginalComputeLayoutSize
        : () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    if (!enabled) widget._colorPicker?.remove();
    widget.triggerDraw?.();
}

function makeMaterialColorPicker(node) {
    const widget = addColorPickerWidget(
        node,
        MATERIAL_COLOR_PICKER_WIDGET_NAME,
        selectedMaterialColor(node),
        (value) => {
            setMaterialColorWidgetValue(node, value);
            syncProperties(node);
            markNodeDirty(node);
        },
        MATERIAL_COLOR_OWNER_PROPERTY
    );
    widget.label = "颜色";
    return widget;
}

function hideNativeMaterialColorWidget(node) {
    const widget = findWidget(node, "material_color");
    if (!widget || widget.__gptImage2MaterialColorHidden) return;
    widget.origComputeSize = widget.origComputeSize || widget.computeSize;
    widget.hidden = true;
    widget.options = {
        ...(widget.options || {}),
        canvasOnly: true,
        hidden: true,
    };
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    widget.draw = () => {};
    for (const element of [widget.element, widget.inputEl]) {
        if (element?.style) element.style.display = "none";
    }
    widget.__gptImage2MaterialColorHidden = true;
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
        const materialId = resolveCatalogId(materialData, value, defaultMaterialId());
        node.properties ||= {};
        node.properties.gpt_image2_material_id = materialId;
        setMaterialColorWidgetValue(
            node,
            resolveMaterialColor(materialData, materialId, DEFAULT_MATERIAL_COLOR)
        );
        syncMaterialColorPicker(node);
        const domWidget = node.widgets?.find(
            (candidate) => candidate.__gptImage2MaterialSelector
        );
        if (domWidget) renderMaterialSelector(domWidget, node);
        markNodeDirty(node);
    };
    widget.__gptImage2MaterialCallbackWrapped = true;
}

function installUseColorWidgetCallback(node) {
    const widget = findWidget(node, "use_color");
    if (!widget || widget.__gptImage2MaterialUseColorCallbackWrapped) return;
    const originalCallback = widget.callback;
    widget.callback = function (value) {
        originalCallback?.apply(this, arguments);
        widget.value = isMaterialColorEnabled(value);
        syncProperties(node);
        syncMaterialColorPicker(node);
        scheduleCompactNodeSize(node);
        markNodeDirty(node);
    };
    widget.__gptImage2MaterialUseColorCallbackWrapped = true;
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
        originalOnSerialize?.call(this, data);
        data.widgets_values = getCanonicalMaterialWidgetValues(this.widgets);
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
    removeMaterialSelector(node);
    applyMaterialWidgetLabels(node.widgets);
    migrateLegacyBasePromptWidget(node);
    syncProperties(node);
    installMaterialWidgetCallback(node);
    installUseColorWidgetCallback(node);
    makeMaterialSelector(node);
    makeMaterialColorPicker(node);
    syncMaterialColorPicker(node);
    hideNativeMaterialColorWidget(node);
    node.widgets = orderMaterialPromptWidgets(node.widgets);
    installCanonicalSerialization(node);
    scheduleCompactNodeSize(node);
    requestMaterials().then(() => {
        syncProperties(node);
        syncMaterialColorPicker(node);
        const selector = node.widgets?.find(
            (candidate) => candidate.__gptImage2MaterialSelector
        );
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
                removeMaterialSelector(this);
                onRemoved?.apply(this, arguments);
            };
        },
    });
}
