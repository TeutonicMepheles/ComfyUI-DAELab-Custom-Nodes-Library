import { app } from "/scripts/app.js";
import {
    applyMaterialWidgetLabels,
    fitMaterialPromptNodeToContent,
    getCanonicalMaterialOutputs,
    getMaterialCardSelectionState,
    getLegacyMaterialOutputIndexes,
    getMaterialSelectorLayout,
    MATERIAL_CAROUSEL_BUTTON_SIZE,
    MATERIAL_CAROUSEL_CARD_SIZE,
    MATERIAL_LAYOUT_GAP,
    MATERIAL_LAYOUT_HORIZONTAL_INSET,
    MATERIAL_MIN_NODE_WIDTH,
    getCanonicalMaterialWidgetValues,
    LEGACY_MATERIAL_COLOR_PICKER_WIDGET_NAME,
    MATERIAL_PANEL_WIDGET_NAME,
    MATERIAL_WIDGET_SERIALIZATION_ORDER,
    migrateMaterialWidgetValues,
    normalizeMaterialBasePrompt,
    orderMaterialPromptWidgets,
    wrapMaterialIndex,
} from "./material_prompt_model.mjs?v=20260904-selection-v14";
import {
    catalogEntries,
    ensureThumbnailSelectorStyles,
    makeCatalogThumbnailUrl,
    resolveCatalogId,
} from "./thumbnail_selector.mjs";
import {
    ensureMaterialHoverPreviewStyles,
    hideMaterialHoverPreview,
    showMaterialHoverPreview,
} from "./material_hover_preview.mjs?v=20260904-1";

const UI_VERSION = "20260910-six-materials-v18";
const APP_HEADING_PROPERTY = "daelab_app_heading";
const MATERIAL_URL = new URL("./materials.json", import.meta.url);
MATERIAL_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./material_thumbs/", import.meta.url);
const LEGACY_COLOR_WIDGET_NAMES = new Set([
    "material_color",
    "use_color",
    LEGACY_MATERIAL_COLOR_PICKER_WIDGET_NAME,
]);
const DEFAULT_MATERIALS = {
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
    return entries()[0]?.id || "baked_enamel";
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
    const selector = node.widgets?.find((candidate) => candidate.__gptImage2MaterialSelector);
    if (selector) {
        selector.label = String(node.properties?.[APP_HEADING_PROPERTY] || "材质选择");
    }
}

function stopCanvasEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function ensureMaterialStyles() {
    ensureThumbnailSelectorStyles();
    ensureMaterialHoverPreviewStyles();
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
.gpt-image2-material-current {
  height: 22px;
  overflow: hidden;
  color: #d8e8ff;
  font-size: 11px;
  line-height: 22px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gpt-image2-material-carousel {
  display: grid;
  grid-template-columns: ${MATERIAL_CAROUSEL_BUTTON_SIZE}px minmax(0, 1fr) ${MATERIAL_CAROUSEL_BUTTON_SIZE}px;
  align-items: center;
  gap: ${MATERIAL_LAYOUT_GAP}px;
  box-sizing: border-box;
  padding: 0 ${MATERIAL_LAYOUT_HORIZONTAL_INSET / 2}px;
}
.gpt-image2-material-nav {
  width: ${MATERIAL_CAROUSEL_BUTTON_SIZE}px;
  height: ${MATERIAL_CAROUSEL_BUTTON_SIZE}px;
  padding: 0;
  border: 1px solid #4d5f77;
  border-radius: 50%;
  color: #d8e8ff;
  background: #252d38;
  cursor: pointer;
}
.gpt-image2-material-strip {
  display: flex;
  gap: ${MATERIAL_LAYOUT_GAP}px;
  height: ${MATERIAL_CAROUSEL_CARD_SIZE}px;
  overflow: hidden;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  touch-action: pan-x;
  cursor: grab;
}
.gpt-image2-material-strip::-webkit-scrollbar { display: none; }
.gpt-image2-material-strip[data-dragging="true"] { cursor: grabbing; }
.gpt-image2-material-card {
  position: relative;
  flex: 0 0 ${MATERIAL_CAROUSEL_CARD_SIZE}px;
  width: ${MATERIAL_CAROUSEL_CARD_SIZE}px;
  height: ${MATERIAL_CAROUSEL_CARD_SIZE}px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid #4a4f58;
  border-radius: 8px;
  background: #20242b;
  cursor: pointer;
}
.gpt-image2-material-card:hover {
  border-color: #6aa8ff;
}
.gpt-image2-material-card:focus {
  outline: none;
}
.gpt-image2-material-card:focus-visible {
  border-color: #6aa8ff;
  box-shadow: 0 0 0 2px rgba(106, 168, 255, .8);
}
.gpt-image2-material-card[aria-selected="true"] {
  border-color: #4ade80;
  background: #17251d;
  box-shadow: inset 0 0 0 2px rgba(74, 222, 128, .78);
}
.gpt-image2-material-check {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 0 7px 0 8px;
  color: #052e16;
  background: #4ade80;
  box-shadow: -1px 1px 0 rgba(5, 46, 22, .45);
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
  pointer-events: none;
}
.gpt-image2-material-card[aria-selected="true"]:focus-visible {
  border-color: #4ade80;
  box-shadow:
    inset 0 0 0 2px rgba(74, 222, 128, .78),
    0 0 0 2px rgba(106, 168, 255, .9);
}
.gpt-image2-material-card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
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
    hideMaterialHoverPreview(node);
    const selectedId = selectedMaterialId(node);
    const materialEntries = entries();
    const selectedEntry = materialEntries.find((entry) => entry.id === selectedId);
    widget.__gptImage2MaterialValue = selectedId;
    element.replaceChildren();

    const current = document.createElement("div");
    current.className = "gpt-image2-material-current";
    current.textContent = `当前材质 · ${selectedEntry?.label || selectedId}`;
    current.setAttribute("role", "status");
    current.setAttribute("aria-live", "polite");
    element.appendChild(current);

    const carousel = document.createElement("div");
    carousel.className = "gpt-image2-material-carousel";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "gpt-image2-material-nav";
    previous.textContent = "‹";
    previous.setAttribute("aria-label", "向左滚动材质列表");
    const strip = document.createElement("div");
    strip.className = "gpt-image2-material-strip";
    strip.setAttribute("role", "listbox");
    strip.setAttribute("aria-label", "材质选择");
    const next = document.createElement("button");
    next.type = "button";
    next.className = "gpt-image2-material-nav";
    next.textContent = "›";
    next.setAttribute("aria-label", "向右滚动材质列表");

    const selectIndex = (rawIndex, focus = false) => {
        const index = wrapMaterialIndex(rawIndex, materialEntries.length);
        const entry = materialEntries[index];
        if (!entry) return;
        node.properties ||= {};
        node.properties.gpt_image2_material_id = entry.id;
        widget.__gptImage2MaterialValue = entry.id;
        setMaterialWidgetValue(node, entry.id);
        renderMaterialSelector(widget, node);
        const selectedButton = [...element.querySelectorAll("[data-material-id]")]
            .find((candidate) => candidate.dataset.materialId === entry.id);
        selectedButton?.scrollIntoView?.({ block: "nearest", inline: "center" });
        if (focus) selectedButton?.focus?.();
        markNodeDirty(node);
    };
    const selectedIndex = Math.max(0, materialEntries.findIndex((entry) => entry.id === selectedId));
    previous.addEventListener("click", (event) => {
        stopCanvasEvent(event);
        strip.scrollBy({ left: -Math.max(180, strip.clientWidth * .8), behavior: 'smooth' });
    });
    next.addEventListener("click", (event) => {
        stopCanvasEvent(event);
        strip.scrollBy({ left: Math.max(180, strip.clientWidth * .8), behavior: 'smooth' });
    });

    materialEntries.forEach((entry, index) => {
        const selection = getMaterialCardSelectionState(entry, selectedId);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gpt-image2-material-card";
        button.dataset.materialId = entry.id;
        button.setAttribute("role", "option");
        button.setAttribute("aria-label", selection.ariaLabel);
        button.setAttribute("aria-selected", selection.ariaSelected);
        button.tabIndex = selection.tabIndex;
        const image = document.createElement("img");
        image.alt = entry.label || entry.id;
        image.decoding = "async";
        image.draggable = false;
        image.src = makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION);
        button.appendChild(image);
        if (selection.selected) {
            const check = document.createElement("span");
            check.className = "gpt-image2-material-check";
            check.textContent = "✓";
            check.setAttribute("aria-hidden", "true");
            button.appendChild(check);
        }
        button.addEventListener("click", (event) => {
            stopCanvasEvent(event);
            if (strip.__materialDragMoved) return;
            selectIndex(index, false);
        });
        const showPreview = () => showMaterialHoverPreview({
            owner: node,
            entry,
            anchorElement: button,
            imageUrl: makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION),
            active: Number(node?.mode ?? 0) === 0,
        });
        button.addEventListener("mouseenter", showPreview);
        button.addEventListener("mouseleave", () => hideMaterialHoverPreview(node));
        button.addEventListener("focus", showPreview);
        button.addEventListener("blur", () => hideMaterialHoverPreview(node));
        button.addEventListener("keydown", (event) => {
            let targetIndex = null;
            if (event.key === "ArrowLeft") targetIndex = index - 1;
            else if (event.key === "ArrowRight") targetIndex = index + 1;
            else if (event.key === "Home") targetIndex = 0;
            else if (event.key === "End") targetIndex = materialEntries.length - 1;
            else if (event.key === "Enter" || event.key === " ") targetIndex = index;
            if (targetIndex === null) return;
            stopCanvasEvent(event);
            selectIndex(targetIndex, true);
        });
        strip.appendChild(button);
    });

    strip.addEventListener("wheel", (event) => {
        if (!event.deltaX && !event.deltaY) return;
        event.preventDefault();
        event.stopPropagation();
        strip.scrollLeft += event.deltaX || event.deltaY;
    }, { passive: false });
    let dragStartX = 0;
    let dragStartScroll = 0;
    strip.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        dragStartX = event.clientX;
        dragStartScroll = strip.scrollLeft;
        strip.__materialDragMoved = false;
        strip.dataset.dragging = "true";

    });
    strip.addEventListener("pointermove", (event) => {
        if (strip.dataset.dragging !== "true") return;
        const delta = event.clientX - dragStartX;
        if (Math.abs(delta) > 4) { strip.__materialDragMoved = true; strip.setPointerCapture?.(event.pointerId); }
        strip.scrollLeft = dragStartScroll - delta;
    });
    const stopDragging = (event) => {
        if (strip.dataset.dragging !== "true") return;
        delete strip.dataset.dragging;
        if (strip.hasPointerCapture?.(event.pointerId)) strip.releasePointerCapture?.(event.pointerId);
        setTimeout(() => { strip.__materialDragMoved = false; }, 0);
    };
    strip.addEventListener("pointerup", stopDragging);
    strip.addEventListener("pointercancel", stopDragging);
    carousel.append(previous, strip, next);
    element.appendChild(carousel);
    requestAnimationFrame(() => {
        element.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
    });
}

function removeOwnedWidgets(node) {
    node.widgets = (node.widgets || []).filter((widget) => {
        const remove = widget.__gptImage2MaterialSelector
            || LEGACY_COLOR_WIDGET_NAMES.has(widget.name)
            || widget.__gptImage2MaterialColorPicker;
        if (!remove) return true;
        hideMaterialHoverPreview(node);
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
    widget.label = String(node.properties?.[APP_HEADING_PROPERTY] || "材质选择");
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
        hideMaterialHoverPreview(node);
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
        setup() {
            const previous = globalThis.__gptImage2MaterialAppModeHandler;
            if (previous) globalThis.removeEventListener?.("daelab:app-mode-synced", previous);
            const handler = () => {
                const graph = app.rootGraph || app.graph;
                for (const node of graph?.nodes || graph?._nodes || []) {
                    if (node?.comfyClass === "GPTImage2MaterialPrompt" && Number(node.mode ?? 0) !== 0) {
                        hideMaterialHoverPreview(node);
                    }
                }
            };
            globalThis.__gptImage2MaterialAppModeHandler = handler;
            globalThis.addEventListener?.("daelab:app-mode-synced", handler);
        },
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
