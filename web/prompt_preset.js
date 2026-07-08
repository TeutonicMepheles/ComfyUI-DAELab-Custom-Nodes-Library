import { app } from "/scripts/app.js";

const UI_VERSION = "20260707-style-labels-v1";
const SUPPORTED_NODE_NAMES = new Set([
    "GPTImageStylePromptPreset",
    "SeedreamExhibitionPromptBuilder",
]);
const STYLE_URL = new URL("./styles.json", import.meta.url);
STYLE_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./thumbs/", import.meta.url);
const VALID_TONES = new Set(["标准", "明亮", "稳重", "高级", "活泼"]);
const DEFAULT_STYLE_DATA = {
    aerospace: {
        label: "航天科技",
        thumbnail: "thumb_tech.webp",
    },
    business: {
        label: "商务",
        thumbnail: "thumb_business.webp",
    },
    party_building: {
        label: "党建",
        thumbnail: "thumb_party.webp",
    },
};

console.info(`[GPTImagePromptPreset] UI loaded: ${UI_VERSION}`);

let styleData = DEFAULT_STYLE_DATA;
let styleLoadStarted = false;
let styleLoadPromise = null;

function markNodeDirty(node) {
    if (node?.graph) {
        node.graph._version = (node.graph._version || 0) + 1;
    }
    if (app.canvas) {
        app.canvas.dirty_canvas = true;
        app.canvas.dirty_bgcanvas = true;
    }
    node?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    requestAnimationFrame(() => {
        app.canvas?.setDirty?.(true, true);
        app.canvas?.draw?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    });
}

function requestStyles() {
    if (styleLoadStarted) return styleLoadPromise;
    styleLoadStarted = true;
    styleLoadPromise = fetch(STYLE_URL)
        .then((res) => res.json())
        .then((data) => {
            styleData = data && Object.keys(data).length ? data : DEFAULT_STYLE_DATA;
            return styleData;
        })
        .catch((err) => {
            console.warn("[GPTImagePromptPreset] Failed to load styles.json", err);
            styleData = DEFAULT_STYLE_DATA;
            return styleData;
        });
    return styleLoadPromise;
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function updateSerializedWidgetValues(node) {
    node.widgets_values = (node.widgets || [])
        .filter((item) => item.serialize !== false)
        .map((item) => item.value);
}

function setWidgetValue(node, widgetName, value) {
    const widget = findWidget(node, widgetName);
    if (!widget) return false;
    const previousValue = widget.value;
    widget.value = value;
    node.onWidgetChanged?.(widgetName, value, previousValue, widget);
    widget.callback?.call(widget, value, app.canvas, node, app.canvas?.graph_mouse);
    updateSerializedWidgetValues(node);
    markNodeDirty(node);
    return true;
}

function syncUiPropertiesFromNativeWidgets(node) {
    node.properties ||= {};
    const styleWidget = findWidget(node, "style_id");
    node.properties.gpt_image_prompt_style_id = widgetValueToStyleId(
        styleWidget?.value || node.properties.gpt_image_prompt_style_id || getDefaultStyleId()
    );
}

function repairNativeWidgetValues(node) {
    const styleWidget = findWidget(node, "style_id");
    const toneWidget = findWidget(node, "tone");

    if (styleWidget && typeof styleWidget.value !== "string") {
        styleWidget.value = styleIdToWidgetValue(getDefaultStyleId());
    } else if (styleWidget) {
        styleWidget.value = styleIdToWidgetValue(widgetValueToStyleId(styleWidget.value));
    }
    if (toneWidget && !VALID_TONES.has(toneWidget.value)) {
        toneWidget.value = "标准";
    }
    syncUiPropertiesFromNativeWidgets(node);
    updateSerializedWidgetValues(node);
}

function getStyleEntries() {
    return Object.entries(styleData).map(([id, data]) => ({ id, ...data }));
}

function getDefaultStyleId() {
    return getStyleEntries()[0]?.id || "aerospace";
}

function styleIdToWidgetValue(styleId) {
    const style = styleData?.[styleId];
    return style?.label || styleId || getDefaultStyleId();
}

function widgetValueToStyleId(value) {
    if (styleData?.[value]) return value;
    const match = getStyleEntries().find((style) => (style.label || style.id) === value);
    return match?.id || getDefaultStyleId();
}

function getSelectedStyleId(node) {
    const widgetValue = findWidget(node, "style_id")?.value;
    const propertyValue = node.properties?.gpt_image_prompt_style_id;
    return widgetValueToStyleId(widgetValue || propertyValue || getDefaultStyleId());
}

function getThumbUrl(style) {
    if (!style.thumbnail) return "";
    const url = new URL(style.thumbnail, THUMB_BASE_URL);
    url.searchParams.set("v", UI_VERSION);
    return url.toString();
}

function ensureDomStyles() {
    if (document.getElementById("gpt-image-prompt-preset-style")) return;
    const style = document.createElement("style");
    style.id = "gpt-image-prompt-preset-style";
    style.textContent = `
.gpt-image-preset-selector {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  height: 100%;
  min-height: 90px;
  padding: 6px 0;
  pointer-events: auto;
  font-family: Arial, Helvetica, sans-serif;
  overflow: hidden;
}
.gpt-image-preset-button {
  appearance: none;
  border: 1px solid #3a404c;
  border-radius: 7px;
  background: #1a1d24;
  color: #d6dce7;
  cursor: pointer;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 18px;
  gap: 4px;
  min-width: 0;
  height: 78px;
  padding: 5px;
  overflow: hidden;
  text-align: center;
}
.gpt-image-preset-button:hover {
  border-color: #6aa8ff;
}
.gpt-image-preset-button[data-selected="true"] {
  background: #243b63;
  border-color: #6aa8ff;
  box-shadow: inset 0 0 0 1px #6aa8ff;
  color: #ffffff;
}
.gpt-image-preset-button img {
  display: block;
  width: 100%;
  height: 48px;
  object-fit: cover;
  border-radius: 5px;
  background: #2b303a;
}
.gpt-image-preset-button span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 16px;
}
`;
    document.head.appendChild(style);
}

function stopCanvasEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function selectStyle(node, widget, styleId) {
    node.properties ||= {};
    node.properties.gpt_image_prompt_style_id = styleId;
    widget.__gptImagePromptPresetValue = styleId;
    setWidgetValue(node, "style_id", styleIdToWidgetValue(styleId));
    syncUiPropertiesFromNativeWidgets(node);
    renderStyleDomWidget(widget, node);
    updateSerializedWidgetValues(node);
    markNodeDirty(node);
}

function renderStyleDomWidget(widget, node) {
    const selectedId = getSelectedStyleId(node);
    widget.__gptImagePromptPresetValue = selectedId;
    widget.__renderedStyleCount = getStyleEntries().length;
    const element = widget.element || widget.inputEl;
    if (!element) return;
    element.replaceChildren();

    for (const style of getStyleEntries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gpt-image-preset-button";
        button.dataset.styleId = style.id;
        button.dataset.selected = String(style.id === selectedId);
        button.title = style.label || style.id;

        const image = document.createElement("img");
        image.alt = style.label || style.id;
        image.draggable = false;
        image.src = getThumbUrl(style);

        const label = document.createElement("span");
        label.textContent = style.label || style.id;

        button.append(image, label);
        button.addEventListener("pointerdown", stopCanvasEvent);
        button.addEventListener("pointerup", stopCanvasEvent);
        button.addEventListener("click", (event) => {
            stopCanvasEvent(event);
            selectStyle(node, widget, style.id);
        });
        element.appendChild(button);
    }
}

function getStyleDomHeight(width = 360) {
    const count = Math.max(getStyleEntries().length, 1);
    const columns = Math.max(1, Math.min(3, Math.floor(((width || 360) - 20) / 104)));
    const rows = Math.ceil(count / columns);
    return 14 + rows * 88;
}

function makeStyleDomWidget(node) {
    ensureDomStyles();
    if (typeof node.addDOMWidget !== "function") {
        console.error("[GPTImagePromptPreset] node.addDOMWidget is not available in this ComfyUI frontend.");
        return null;
    }

    const element = document.createElement("div");
    element.className = "gpt-image-preset-selector";
    element.addEventListener("pointerdown", stopCanvasEvent);
    element.addEventListener("pointerup", stopCanvasEvent);
    element.addEventListener("click", stopCanvasEvent);

    let widget;
    widget = node.addDOMWidget("style_thumbnail_dom_selector", "custom", element, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => getStyleDomHeight(node.size?.[0] || 360),
        getHeight: () => getStyleDomHeight(node.size?.[0] || 360),
        getValue: () => widget?.__gptImagePromptPresetValue ?? getSelectedStyleId(node),
        setValue: (value) => {
            if (!widget) return;
            widget.__gptImagePromptPresetValue = value || getSelectedStyleId(node);
            renderStyleDomWidget(widget, node);
        },
    });

    widget.serialize = false;
    widget.inputEl = element;
    widget.__gptImagePromptPresetValue = getSelectedStyleId(node);
    widget.__gptImagePromptPresetDomSelector = true;
    widget.computeSize = (width) => [width || 360, getStyleDomHeight(width || 360)];
    widget.computeLayoutSize = () => ({
        minHeight: getStyleDomHeight(node.size?.[0] || 360),
        minWidth: 360,
    });
    const originalOnRemove = widget.onRemove?.bind(widget);
    widget.onRemove = () => {
        originalOnRemove?.();
        element.remove();
    };
    renderStyleDomWidget(widget, node);
    return widget;
}

function removeStyleControls(node) {
    node.widgets = (node.widgets || []).filter((widget) => {
        const shouldRemove = widget.type === "GPT_IMAGE_STYLE_SELECTOR"
            || widget.type === "GPT_IMAGE_STYLE_THUMBNAIL_PREVIEW"
            || widget.type === "GPT_IMAGE_STYLE_THUMBNAIL_BUTTONS"
            || widget.type === "GPT_IMAGE_STYLE_DOM_SELECTOR"
            || widget.__gptImagePromptPresetDomSelector
            || widget.__gptImageStyleButton
            || widget.name === "Refresh Preview";
        if (shouldRemove) {
            widget.onRemove?.();
            widget.onRemoved?.();
        }
        return !shouldRemove;
    });
}

function installStyleWidgetCallback(node) {
    const styleWidget = findWidget(node, "style_id");
    if (!styleWidget || styleWidget.__gptImagePromptPresetCallbackWrapped) return;
    const originalCallback = styleWidget.callback;
    styleWidget.callback = function (value, canvas, node, pos, event) {
        originalCallback?.call(this, value, canvas, node, pos, event);
        syncUiPropertiesFromNativeWidgets(node);
        const domWidget = node.widgets?.find((widget) => widget.__gptImagePromptPresetDomSelector);
        if (domWidget) renderStyleDomWidget(domWidget, node);
        updateSerializedWidgetValues(node);
        markNodeDirty(node);
    };
    styleWidget.__gptImagePromptPresetCallbackWrapped = true;
}

function addStyleControl(node) {
    node.widgets ||= [];
    const widget = makeStyleDomWidget(node);
    if (!widget) return;
}

function getPromptPresetWidgetRank(widget) {
    if (widget.__gptImagePromptPresetDomSelector) return 20;
    if (widget.name === "style_id") return 30;
    if (widget.name === "tone") return 40;
    if (widget.name === "primary_color") return 50;
    if (widget.name === "secondary_color") return 60;
    if (widget.name === "base_prompt") return 70;
    if (widget.name === "additional_details") return 80;
    if (widget.name === "custom_append") return 100;
    return 100;
}

function reorderPromptPresetWidgets(node) {
    if (!node.widgets?.length) return;
    node.widgets = node.widgets
        .map((widget, index) => ({ widget, index }))
        .sort((a, b) => {
            const rankDiff = getPromptPresetWidgetRank(a.widget) - getPromptPresetWidgetRank(b.widget);
            return rankDiff || a.index - b.index;
        })
        .map((item) => item.widget);
    updateSerializedWidgetValues(node);
}

function resizeNodeForControls(node) {
    node.arrange?.();
    const size = node.computeSize?.();
    if (size) {
        node.size = [Math.max(node.size?.[0] || 340, 360), Math.max(node.size?.[1] || 0, size[1])];
    }
}

function installPromptPresetUi(node) {
    if (node.__gptImagePromptPresetUiInstalled === UI_VERSION) return;
    node.__gptImagePromptPresetUiInstalled = UI_VERSION;
    requestStyles().then(() => {
        const domWidget = node.widgets?.find((widget) => widget.__gptImagePromptPresetDomSelector);
        if (domWidget) {
            renderStyleDomWidget(domWidget, node);
            resizeNodeForControls(node);
            markNodeDirty(node);
        }
    });

    removeStyleControls(node);
    repairNativeWidgetValues(node);
    installStyleWidgetCallback(node);
    addStyleControl(node);
    reorderPromptPresetWidgets(node);
    resizeNodeForControls(node);
    app.graph?.setDirtyCanvas(true, true);
}

if (globalThis.__GPT_IMAGE_PROMPT_PRESET_REGISTERED_VERSION !== UI_VERSION) {
    globalThis.__GPT_IMAGE_PROMPT_PRESET_REGISTERED_VERSION = UI_VERSION;

    app.registerExtension({
        name: "Comfy.GPTImagePromptPreset.UI",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (!SUPPORTED_NODE_NAMES.has(nodeData.name)) return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                setTimeout(() => installPromptPresetUi(this), 0);
            };

            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                removeStyleControls(this);
                onRemoved?.apply(this, arguments);
            };
        },
    });
}
