import { app } from "/scripts/app.js";
import {
    PROMPT_WIDGET_LABELS,
    PROMPT_WIDGET_PLACEHOLDERS,
    PROMPT_WIDGET_SERIALIZATION_ORDER,
    TEMPLATE_PANEL_MEMBER_WIDGET_NAMES,
    TEMPLATE_PANEL_WIDGET_NAME,
    applyPromptWidgetMetadata,
    collapseTemplatePanelInputs,
    getCanonicalPromptWidgetValues,
    migratePromptWidgetValues,
    normalizeBooleanValue,
    orderPromptPanelWidgets,
    repairPromptTextValues,
    resolveLinkedBooleanValue,
    setTemplateWidgetsDisabled,
} from "./prompt_preset_model.mjs";

const UI_VERSION = "20260806-seedream5-prompt-v11";
const SUPPORTED_NODE_NAMES = new Set([
    "SeedreamExhibitionPromptBuilder",
]);
const STYLE_URL = new URL("./styles.json", import.meta.url);
STYLE_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./thumbs/", import.meta.url);
const TONE_OPTIONS = ["标准", "明亮", "稳重", "高级", "活泼"];
const VALID_TONES = new Set(TONE_OPTIONS);
const BOOLEAN_WIDGET_NAMES = [
    "use_theme_template",
    "use_space_reference",
    "include_people_placeholder",
    "use_element_reference",
    "lock_edit_region",
];
const TEMPLATE_COLOR_WIDGET_NAMES = new Set([
    "primary_color",
    "secondary_color",
]);
const TEMPLATE_PANEL_NATIVE_WIDGET_NAMES = TEMPLATE_PANEL_MEMBER_WIDGET_NAMES.filter(
    (widgetName) => widgetName !== TEMPLATE_PANEL_WIDGET_NAME
);
const APP_PANEL_ITEM_SELECTOR = '[data-testid="app-mode-widget-item"]';
const BUILDER_PANEL_ITEM_SELECTOR = '[data-testid="builder-widget-item"]';
const PROMPT_SYNC_INTERVAL_MS = 100;
const DEFAULT_BASE_PROMPT = "生成写实展厅效果图，并在环境中添加与风格匹配的适当陈列与装饰物。";
const DEFAULT_ADDITIONAL_DETAILS = "地面以高抛光水磨石为主，结合局部PVC地材，墙面采用乳胶漆，搭配不锈钢、铝材和灯带装饰，顶面采用流线型连续灯带系统。";
const DEFAULT_STYLE_DATA = {
    aerospace: {
        label: "航天科技",
        thumbnail: "thumb_tech.webp",
        primary_color: "#567DF0",
        secondary_color: "#D0D5DD",
    },
    party_building: {
        label: "党建",
        thumbnail: "thumb_party.webp",
        primary_color: "#C33C3C",
        secondary_color: "#D4A843",
    },
};

console.info(`[GPTImagePromptPreset] UI loaded: ${UI_VERSION}`);

let styleData = DEFAULT_STYLE_DATA;
let styleLoadStarted = false;
let styleLoadPromise = null;
const promptPresetNodes = new Set();
const appPanelItemState = new WeakMap();
const templateMemberRowState = new WeakMap();
let promptSyncTimer = null;

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

function setWidgetValue(node, widgetName, value, { invokeCallback = true } = {}) {
    const widget = findWidget(node, widgetName);
    if (!widget) return false;
    const previousValue = widget.value;
    widget.value = value;
    const type = widget.type || widget.options?.type || "";
    if (type.toUpperCase() === "COLOR") {
        const inputEl = widget.element || widget.inputEl;
        if (inputEl) {
            inputEl.value = value;
        }
    }
    node.onWidgetChanged?.(widgetName, value, previousValue, widget);
    if (invokeCallback) {
        widget.callback?.call(widget, value, app.canvas, node, app.canvas?.graph_mouse);
    }
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
    const basePromptWidget = findWidget(node, "base_prompt");
    const additionalDetailsWidget = findWidget(node, "additional_details");
    if (basePromptWidget || additionalDetailsWidget) {
        const repaired = repairPromptTextValues({
            basePrompt: basePromptWidget?.value ?? "",
            additionalDetails: additionalDetailsWidget?.value ?? "",
            defaultBasePrompt: DEFAULT_BASE_PROMPT,
            defaultAdditionalDetails: DEFAULT_ADDITIONAL_DETAILS,
        });
        if (basePromptWidget) basePromptWidget.value = repaired.basePrompt;
        if (additionalDetailsWidget) additionalDetailsWidget.value = repaired.additionalDetails;
    }
    for (const widgetName of BOOLEAN_WIDGET_NAMES) {
        const widget = findWidget(node, widgetName);
        if (widget) widget.value = normalizeBooleanValue(widget.value, true);
    }
    syncUiPropertiesFromNativeWidgets(node);
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  min-height: 90px;
  padding: 6px 0;
  pointer-events: auto;
  font-family: Arial, Helvetica, sans-serif;
  overflow: hidden;
}
.gpt-image-preset-thumbnails {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}
.gpt-image-preset-app-controls {
  display: none;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  padding-top: 2px;
}
.gpt-image-preset-selector[data-panel-context="builder"] .gpt-image-preset-app-controls,
.gpt-image-preset-selector[data-panel-context="select"] .gpt-image-preset-app-controls,
.gpt-image-preset-selector[data-panel-context="app"] .gpt-image-preset-app-controls {
  display: flex;
}
.gpt-image-preset-selector[data-panel-context="builder"],
.gpt-image-preset-selector[data-panel-context="select"],
.gpt-image-preset-selector[data-panel-context="app"] {
  height: auto;
  min-height: 0;
  overflow: visible;
  padding-bottom: 8px;
}
.gpt-image-preset-field {
  display: grid;
  grid-template-columns: minmax(112px, 0.8fr) minmax(150px, 1.2fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.gpt-image-preset-field--stacked {
  grid-template-columns: 1fr;
  gap: 4px;
}
.gpt-image-preset-field > label {
  min-width: 0;
  color: #aeb4be;
  font-size: 13px;
  line-height: 18px;
}
.gpt-image-preset-field select,
.gpt-image-preset-field input[type="text"],
.gpt-image-preset-field textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #3a404c;
  border-radius: 7px;
  background: #20232a;
  color: #f1f3f7;
  font: inherit;
  font-size: 13px;
  outline: none;
}
.gpt-image-preset-field select,
.gpt-image-preset-field input[type="text"] {
  height: 34px;
  padding: 0 10px;
}
.gpt-image-preset-field textarea {
  min-height: 104px;
  padding: 8px 10px;
  line-height: 1.45;
  resize: vertical;
}
.gpt-image-preset-field select:focus,
.gpt-image-preset-field input[type="text"]:focus,
.gpt-image-preset-field textarea:focus {
  border-color: #6aa8ff;
}
.gpt-image-preset-color-control {
  display: grid;
  grid-template-columns: 34px minmax(90px, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.gpt-image-preset-color-control input[type="color"] {
  width: 34px;
  height: 30px;
  padding: 2px;
  border: 1px solid #3a404c;
  border-radius: 7px;
  background: #20232a;
  cursor: pointer;
}
.gpt-image-preset-color-opacity {
  color: #f1f3f7;
  font-size: 12px;
  white-space: nowrap;
}
.gpt-image-preset-selector[data-disabled="true"] {
  filter: grayscale(0.35);
  opacity: 0.45;
  pointer-events: none;
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
.gpt-image-preset-button:disabled {
  cursor: not-allowed;
}
.gpt-image-preset-button[data-selected="true"] {
  background: #243b63;
  border-color: #6aa8ff;
  box-shadow: inset 0 0 0 1px #6aa8ff;
  color: #ffffff;
}
.seedream-template-color-disabled {
  filter: grayscale(0.35);
  opacity: 0.45;
  pointer-events: none;
}
.seedream-template-member-hidden {
  display: none !important;
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

function stopCanvasPropagation(event) {
    event.stopPropagation();
}

function selectStyle(node, widget, styleId) {
    if (widget.__seedreamTemplateDisabled) return;
    node.properties ||= {};
    node.properties.gpt_image_prompt_style_id = styleId;
    widget.__gptImagePromptPresetValue = styleId;
    setWidgetValue(node, "style_id", styleIdToWidgetValue(styleId), { invokeCallback: false });
    const style = styleData?.[styleId];
    if (style?.primary_color) {
        setWidgetValue(node, "primary_color", style.primary_color);
    }
    if (style?.secondary_color) {
        setWidgetValue(node, "secondary_color", style.secondary_color);
    }
    syncUiPropertiesFromNativeWidgets(node);
    syncStyleDomWidget(widget, node);
    markNodeDirty(node);
}

function isBuilderInputSelectionElement(element) {
    const widgetRow = element?.closest('[data-testid="node-widget"]');
    if (!widgetRow) return false;

    let candidate = element.parentElement;
    while (candidate && candidate !== widgetRow) {
        if (
            candidate.parentElement === widgetRow
            && candidate.classList.contains("pointer-events-auto")
            && candidate.classList.contains("cursor-pointer")
        ) {
            return true;
        }
        candidate = candidate.parentElement;
    }
    return false;
}

function getStylePanelContext(element) {
    if (element?.closest(BUILDER_PANEL_ITEM_SELECTOR)) return "builder";
    if (element?.closest(APP_PANEL_ITEM_SELECTOR)) return "app";
    if (isBuilderInputSelectionElement(element)) return "select";
    return "graph";
}

function normalizedPanelHex(value, fallback = "#000000") {
    const text = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : fallback;
}

function makePanelField(labelText, control, { stacked = false } = {}) {
    const field = document.createElement("div");
    field.className = `gpt-image-preset-field${stacked ? " gpt-image-preset-field--stacked" : ""}`;
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = control.id;
    field.append(label, control);
    return field;
}

function makePanelSelect(id, options) {
    const select = document.createElement("select");
    select.id = id;
    for (const { value, label } of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    return select;
}

function makeStylePanelControls(widget, node) {
    const controls = document.createElement("div");
    controls.className = "gpt-image-preset-app-controls";

    const styleSelect = makePanelSelect(
        `seedream-style-${node.id}`,
        getStyleEntries().map((style) => ({
            value: style.id,
            label: style.label || style.id,
        }))
    );
    styleSelect.addEventListener("change", (event) => {
        stopCanvasPropagation(event);
        selectStyle(node, widget, event.currentTarget.value);
    });

    const toneSelect = makePanelSelect(
        `seedream-tone-${node.id}`,
        TONE_OPTIONS.map((tone) => ({ value: tone, label: tone }))
    );
    toneSelect.addEventListener("change", (event) => {
        stopCanvasPropagation(event);
        setWidgetValue(node, "tone", event.currentTarget.value);
        syncStyleDomWidget(widget, node);
    });

    function makeColorControl(widgetName, labelText) {
        const wrapper = document.createElement("div");
        wrapper.className = "gpt-image-preset-color-control";
        wrapper.id = `seedream-${widgetName}-control-${node.id}`;
        const picker = document.createElement("input");
        picker.type = "color";
        picker.id = `seedream-${widgetName}-${node.id}`;
        picker.setAttribute("aria-label", labelText);
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.maxLength = 7;
        textInput.spellcheck = false;
        textInput.setAttribute("aria-label", `${labelText} Hex`);
        const opacity = document.createElement("span");
        opacity.className = "gpt-image-preset-color-opacity";
        opacity.textContent = "100%";

        picker.addEventListener("input", (event) => {
            stopCanvasPropagation(event);
            const value = normalizedPanelHex(event.currentTarget.value);
            textInput.value = value;
            setWidgetValue(node, widgetName, value);
        });
        textInput.addEventListener("input", (event) => {
            stopCanvasPropagation(event);
            const value = String(event.currentTarget.value || "").trim();
            if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
            const normalized = value.toUpperCase();
            picker.value = normalized;
            setWidgetValue(node, widgetName, normalized);
        });
        textInput.addEventListener("change", (event) => {
            stopCanvasPropagation(event);
            syncStyleDomWidget(widget, node);
        });
        wrapper.append(picker, textInput, opacity);
        controls.appendChild(makePanelField(labelText, wrapper));
        return { picker, textInput };
    }

    controls.appendChild(makePanelField(PROMPT_WIDGET_LABELS.style_id, styleSelect));
    controls.appendChild(makePanelField(PROMPT_WIDGET_LABELS.tone, toneSelect));
    const primaryColor = makeColorControl(
        "primary_color",
        PROMPT_WIDGET_LABELS.primary_color
    );
    const secondaryColor = makeColorControl(
        "secondary_color",
        PROMPT_WIDGET_LABELS.secondary_color
    );

    const additionalDetails = document.createElement("textarea");
    additionalDetails.id = `seedream-additional-details-${node.id}`;
    additionalDetails.placeholder = PROMPT_WIDGET_PLACEHOLDERS.additional_details;
    additionalDetails.addEventListener("input", (event) => {
        stopCanvasPropagation(event);
        setWidgetValue(node, "additional_details", event.currentTarget.value);
    });
    controls.appendChild(makePanelField(
        PROMPT_WIDGET_LABELS.additional_details,
        additionalDetails,
        { stacked: true }
    ));

    return {
        element: controls,
        styleSelect,
        toneSelect,
        primaryColor,
        secondaryColor,
        additionalDetails,
    };
}

function syncStyleDomContents(widget, node) {
    const selectedId = getSelectedStyleId(node);
    widget.__gptImagePromptPresetValue = selectedId;
    const element = widget.element || widget.inputEl;
    if (!element) return;

    for (const button of element.querySelectorAll(".gpt-image-preset-button")) {
        button.dataset.selected = String(button.dataset.styleId === selectedId);
    }

    const controls = widget.__gptImagePromptPanelControls;
    if (!controls) return;
    controls.styleSelect.value = selectedId;
    controls.toneSelect.value = findWidget(node, "tone")?.value || "标准";

    for (const [widgetName, colorControls] of [
        ["primary_color", controls.primaryColor],
        ["secondary_color", controls.secondaryColor],
    ]) {
        const value = normalizedPanelHex(findWidget(node, widgetName)?.value);
        colorControls.picker.value = value;
        if (document.activeElement !== colorControls.textInput) {
            colorControls.textInput.value = value;
        }
    }
    if (document.activeElement !== controls.additionalDetails) {
        controls.additionalDetails.value = String(
            findWidget(node, "additional_details")?.value ?? ""
        );
    }
    const disabled = element.dataset.disabled === "true";
    for (const control of element.querySelectorAll("button, input, select, textarea")) {
        control.disabled = disabled;
    }
}

function renderStyleDomWidget(widget, node) {
    const element = widget.element || widget.inputEl;
    if (!element) return;
    const context = getStylePanelContext(element);
    const selectedId = getSelectedStyleId(node);
    widget.__gptImagePromptPresetValue = selectedId;
    widget.__renderedStyleCount = getStyleEntries().length;
    widget.__renderedPanelContext = context;
    element.dataset.panelContext = context;
    element.replaceChildren();

    const thumbnails = document.createElement("div");
    thumbnails.className = "gpt-image-preset-thumbnails";

    for (const style of getStyleEntries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gpt-image-preset-button";
        button.dataset.styleId = style.id;
        button.dataset.selected = String(style.id === selectedId);
        button.title = style.label || style.id;
        button.disabled = element.dataset.disabled === "true";

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
        thumbnails.appendChild(button);
    }
    element.appendChild(thumbnails);

    widget.__gptImagePromptPanelControls = null;
    if (context !== "graph") {
        const controls = makeStylePanelControls(widget, node);
        widget.__gptImagePromptPanelControls = controls;
        element.appendChild(controls.element);
    }
    syncStyleDomContents(widget, node);
}

function syncStyleDomWidget(widget, node) {
    const element = widget?.element || widget?.inputEl;
    if (!element) return false;
    const context = getStylePanelContext(element);
    const needsRender = widget.__renderedPanelContext !== context
        || widget.__renderedStyleCount !== getStyleEntries().length;
    if (needsRender) {
        renderStyleDomWidget(widget, node);
        return true;
    }
    element.dataset.panelContext = context;
    syncStyleDomContents(widget, node);
    return false;
}

function getStyleDomHeight(width = 360) {
    const count = Math.max(getStyleEntries().length, 1);
    const columns = Math.max(1, Math.min(2, Math.floor(((width || 360) - 20) / 104)));
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
    element.addEventListener("pointerdown", stopCanvasPropagation);
    element.addEventListener("pointerup", stopCanvasPropagation);
    element.addEventListener("click", stopCanvasPropagation);
    element.addEventListener("wheel", stopCanvasPropagation);

    let widget;
    widget = node.addDOMWidget(TEMPLATE_PANEL_WIDGET_NAME, "custom", element, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => getStyleDomHeight(node.size?.[0] || 360),
        getHeight: () => getStyleDomHeight(node.size?.[0] || 360),
        getValue: () => widget?.__gptImagePromptPresetValue ?? getSelectedStyleId(node),
        setValue: (value) => {
            if (!widget) return;
            widget.__gptImagePromptPresetValue = value || getSelectedStyleId(node);
            syncStyleDomWidget(widget, node);
        },
    });

    widget.serialize = false;
    widget.label = "提示词模板";
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
        if (widget.__seedreamAppPanelItem) {
            restoreAppPanelItem(widget.__seedreamAppPanelItem);
            widget.__seedreamAppPanelItem = null;
        }
        originalOnRemove?.();
        element.remove();
    };
    renderStyleDomWidget(widget, node);
    return widget;
}

function setStyleSelectorDisabled(node, disabled) {
    const widget = node.widgets?.find(
        (candidate) => candidate.__gptImagePromptPresetDomSelector
    );
    if (!widget) return false;
    const element = widget.element || widget.inputEl;
    const nextValue = String(disabled);
    const changed = widget.__seedreamTemplateDisabled !== disabled
        || element?.dataset.disabled !== nextValue;
    widget.__seedreamTemplateDisabled = disabled;
    if (element) {
        element.dataset.disabled = nextValue;
        element.setAttribute("aria-disabled", nextValue);
        for (const control of element.querySelectorAll("button, input, select, textarea")) {
            control.disabled = disabled;
        }
        syncStyleDomWidget(widget, node);
    }
    return changed;
}

function findVueNodeElement(node) {
    const nodeId = String(node?.id ?? "");
    if (!nodeId) return null;
    return Array.from(
        document.querySelectorAll(".lg-node[data-node-id]")
    ).find((element) => element.dataset.nodeId === nodeId) || null;
}

function normalizeWidgetLabel(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function promptWidgetRowLabels(widgetName) {
    return Array.from(new Set([
        widgetName,
        PROMPT_WIDGET_LABELS[widgetName],
    ].filter(Boolean))).map(normalizeWidgetLabel);
}

function restoreBuilderTemplateMemberRow(row) {
    if (!row?.classList.contains("seedream-template-member-hidden")) return false;
    const original = templateMemberRowState.get(row);
    row.classList.remove("seedream-template-member-hidden");
    row.inert = original?.inert ?? false;
    if (original?.ariaHidden == null) row.removeAttribute("aria-hidden");
    else row.setAttribute("aria-hidden", original.ariaHidden);
    templateMemberRowState.delete(row);
    return true;
}

function setBuilderTemplateMemberRowsHidden(node, hidden) {
    const nodeElement = findVueNodeElement(node);
    if (!nodeElement) return false;
    const rows = Array.from(
        nodeElement.querySelectorAll(".lg-node-widgets > .lg-node-widget")
    );
    const panelRow = nodeElement
        .querySelector(".gpt-image-preset-selector")
        ?.closest(".lg-node-widget") || null;
    let changed = false;

    changed = restoreBuilderTemplateMemberRow(panelRow) || changed;

    for (const widgetName of TEMPLATE_PANEL_NATIVE_WIDGET_NAMES) {
        const normalizedNames = promptWidgetRowLabels(widgetName);
        const row = rows.find((candidate) => (
            candidate !== panelRow
            && normalizedNames.some((name) => (
                normalizeWidgetLabel(candidate.textContent).startsWith(name)
            ))
        ));
        if (!row) continue;

        const wasHidden = row.classList.contains("seedream-template-member-hidden");
        if (wasHidden !== hidden) changed = true;
        if (hidden) {
            if (!templateMemberRowState.has(row)) {
                templateMemberRowState.set(row, {
                    inert: row.inert,
                    ariaHidden: row.getAttribute("aria-hidden"),
                });
            }
            row.classList.add("seedream-template-member-hidden");
            row.setAttribute("aria-hidden", "true");
            row.inert = true;
        } else if (wasHidden) {
            restoreBuilderTemplateMemberRow(row);
        }
    }
    return changed;
}

function setVueColorWidgetsDisabled(node, disabled) {
    const nodeElement = findVueNodeElement(node);
    if (!nodeElement) return false;
    const rows = Array.from(
        nodeElement.querySelectorAll(".lg-node-widgets > .lg-node-widget")
    );
    let changed = false;

    for (const widgetName of TEMPLATE_COLOR_WIDGET_NAMES) {
        const normalizedNames = promptWidgetRowLabels(widgetName);
        const row = rows.find((candidate) => (
            normalizedNames.some((name) => (
                normalizeWidgetLabel(candidate.textContent).includes(name)
            ))
        ));
        if (!row) continue;

        const wasDisabled = row.classList.contains(
            "seedream-template-color-disabled"
        );
        if (wasDisabled !== disabled) changed = true;
        row.classList.toggle("seedream-template-color-disabled", disabled);
        row.setAttribute("aria-disabled", String(disabled));

        for (const control of row.querySelectorAll("button, input, select")) {
            if (!Object.hasOwn(control, "__seedreamOriginalDisabled")) {
                control.__seedreamOriginalDisabled = Boolean(control.disabled);
            }
            control.disabled = disabled
                ? true
                : control.__seedreamOriginalDisabled;
        }
    }
    return changed;
}

function installTemplateColorGuards(node) {
    for (const widget of node.widgets || []) {
        if (
            !TEMPLATE_COLOR_WIDGET_NAMES.has(widget.name)
            || widget.__seedreamTemplateColorGuardInstalled
        ) {
            continue;
        }
        const originalCallback = widget.callback;
        widget.__seedreamEnabledValue = widget.value;
        widget.callback = function (value) {
            if (this.__seedreamTemplateDisabled) {
                this.value = this.__seedreamEnabledValue;
                markNodeDirty(node);
                return;
            }
            this.__seedreamEnabledValue = value;
            return originalCallback?.apply(this, arguments);
        };
        widget.__seedreamTemplateColorGuardInstalled = true;
    }
}

function resolveTemplateEnabled(node) {
    const linkedValue = resolveLinkedBooleanValue(node, "use_theme_template");
    if (linkedValue !== null) return linkedValue;
    return normalizeBooleanValue(findWidget(node, "use_theme_template")?.value, true);
}

function restoreAppPanelItem(item) {
    const original = appPanelItemState.get(item);
    if (!original) return false;
    item.hidden = original.hidden;
    item.inert = original.inert;
    if (original.ariaHidden === null) item.removeAttribute("aria-hidden");
    else item.setAttribute("aria-hidden", original.ariaHidden);
    item.removeAttribute("data-seedream-template-hidden");
    appPanelItemState.delete(item);
    return true;
}

function syncAppModePanelVisibility(node, templateEnabled) {
    const widget = node.widgets?.find(
        (candidate) => candidate.__gptImagePromptPresetDomSelector
    );
    const element = widget?.element || widget?.inputEl;
    const item = element?.closest(APP_PANEL_ITEM_SELECTOR) || null;
    const previousItem = widget?.__seedreamAppPanelItem || null;
    let changed = false;

    if (previousItem && previousItem !== item) {
        changed = restoreAppPanelItem(previousItem) || changed;
    }
    if (widget) widget.__seedreamAppPanelItem = item;
    if (!item) return changed;

    if (templateEnabled) {
        return restoreAppPanelItem(item) || changed;
    }
    if (!appPanelItemState.has(item)) {
        appPanelItemState.set(item, {
            hidden: item.hidden,
            inert: item.inert,
            ariaHidden: item.getAttribute("aria-hidden"),
        });
    }
    const wasHidden = item.hidden
        && item.inert
        && item.getAttribute("data-seedream-template-hidden") === "true";
    item.hidden = true;
    item.inert = true;
    item.setAttribute("aria-hidden", "true");
    item.setAttribute("data-seedream-template-hidden", "true");
    return !wasHidden || changed;
}

function scheduleConfiguredRefresh(graph) {
    if (!graph?.events || graph.__seedreamTemplatePanelRefreshQueued) return;
    graph.__seedreamTemplatePanelRefreshQueued = true;
    queueMicrotask(() => {
        graph.__seedreamTemplatePanelRefreshQueued = false;
        graph.events.dispatchEvent?.(new Event("configured"));
    });
}

function normalizeAppModeTemplateInputs(node) {
    const graph = app.rootGraph;
    const data = graph?.extra?.linearData;
    if (!Array.isArray(data?.inputs)) return false;
    if (graph.getNodeById?.(node.id) !== node) return false;

    const normalized = collapseTemplatePanelInputs(data.inputs, node.id);
    if (!normalized.changed) return false;
    graph.extra.linearData = {
        ...data,
        inputs: normalized.inputs,
    };
    scheduleConfiguredRefresh(graph);
    return true;
}

function updateTemplateControlState(
    node,
    { force = false, deferRedraw = false } = {}
) {
    const templateEnabled = resolveTemplateEnabled(node);
    const stateChanged = node.__seedreamTemplateEnabled !== templateEnabled;
    const nativeChanged = setTemplateWidgetsDisabled(
        node.widgets,
        !templateEnabled
    );
    const selectorChanged = setStyleSelectorDisabled(node, !templateEnabled);
    const styleWidget = node.widgets?.find(
        (widget) => widget.__gptImagePromptPresetDomSelector
    );
    const panelChanged = syncStyleDomWidget(
        styleWidget,
        node
    );
    const memberRowsChanged = setBuilderTemplateMemberRowsHidden(
        node,
        getStylePanelContext(styleWidget?.element || styleWidget?.inputEl) === "select"
    );
    const appVisibilityChanged = syncAppModePanelVisibility(
        node,
        templateEnabled
    );
    const colorRowsChanged = setVueColorWidgetsDisabled(
        node,
        !templateEnabled
    );
    node.__seedreamTemplateEnabled = templateEnabled;
    node.updateComputedDisabled?.();
    if (
        force
        || stateChanged
        || nativeChanged
        || selectorChanged
        || panelChanged
        || memberRowsChanged
        || appVisibilityChanged
        || colorRowsChanged
    ) {
        if (deferRedraw) {
            requestAnimationFrame(() => markNodeDirty(node));
        } else {
            markNodeDirty(node);
        }
    }
    return templateEnabled;
}

function runPromptPresetSync() {
    for (const node of Array.from(promptPresetNodes)) {
        if (!node?.graph || node.__seedreamPromptPresetRemoved) continue;
        normalizeAppModeTemplateInputs(node);
        updateTemplateControlState(node);
    }
}

function registerPromptPresetNode(node) {
    node.__seedreamPromptPresetRemoved = false;
    promptPresetNodes.add(node);
    if (!promptSyncTimer) {
        promptSyncTimer = setInterval(
            runPromptPresetSync,
            PROMPT_SYNC_INTERVAL_MS
        );
    }
}

function unregisterPromptPresetNode(node) {
    node.__seedreamPromptPresetRemoved = true;
    promptPresetNodes.delete(node);
    if (!promptPresetNodes.size && promptSyncTimer) {
        clearInterval(promptSyncTimer);
        promptSyncTimer = null;
    }
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
        const selectedStyleId = getSelectedStyleId(node);
        const selectedStyle = styleData?.[selectedStyleId];
        if (selectedStyle?.primary_color) {
            setWidgetValue(node, "primary_color", selectedStyle.primary_color);
        }
        if (selectedStyle?.secondary_color) {
            setWidgetValue(node, "secondary_color", selectedStyle.secondary_color);
        }
        const domWidget = node.widgets?.find((widget) => widget.__gptImagePromptPresetDomSelector);
        if (domWidget) syncStyleDomWidget(domWidget, node);
        markNodeDirty(node);
    };
    styleWidget.__gptImagePromptPresetCallbackWrapped = true;
}

function installTemplateWidgetCallback(node) {
    const templateWidget = findWidget(node, "use_theme_template");
    if (!templateWidget || templateWidget.__seedreamTemplateCallbackWrapped) return;
    const originalCallback = templateWidget.callback;
    templateWidget.callback = function (value, canvas, node, pos, event) {
        originalCallback?.call(this, value, canvas, node, pos, event);
        updateTemplateControlState(node);
    };
    templateWidget.__seedreamTemplateCallbackWrapped = true;
}

function addStyleControl(node) {
    node.widgets ||= [];
    const widget = makeStyleDomWidget(node);
    return widget || null;
}

function orderPromptControls(node) {
    node.widgets = orderPromptPanelWidgets(node.widgets);
}

function restoreCanonicalWidgetValues(node, serializedValues) {
    const values = migratePromptWidgetValues(serializedValues);
    if (!values) return false;
    for (const [index, name] of PROMPT_WIDGET_SERIALIZATION_ORDER.entries()) {
        const widget = findWidget(node, name);
        if (widget && index < values.length) widget.value = values[index];
    }
    return true;
}

function installCanonicalSerialization(node) {
    if (node.__seedreamCanonicalSerializationInstalled) return;
    const originalOnSerialize = node.onSerialize;
    node.onSerialize = function (data) {
        originalOnSerialize?.call(this, data);
        data.widgets_values = getCanonicalPromptWidgetValues(this.widgets);
    };
    node.__seedreamCanonicalSerializationInstalled = true;
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
    if (applyPromptWidgetMetadata(node.widgets)) {
        scheduleConfiguredRefresh(node.graph);
    }
    for (const widget of node.widgets || []) {
        const placeholder = PROMPT_WIDGET_PLACEHOLDERS[widget.name];
        if (!placeholder) continue;
        for (const element of [widget.element, widget.inputEl]) {
            if (!element) continue;
            if ("placeholder" in element) element.placeholder = placeholder;
            for (const input of element.querySelectorAll?.("textarea, input") || []) {
                input.placeholder = placeholder;
            }
        }
    }
    installStyleWidgetCallback(node);
    installTemplateWidgetCallback(node);
    installTemplateColorGuards(node);
    addStyleControl(node);
    orderPromptControls(node);
    installCanonicalSerialization(node);
    normalizeAppModeTemplateInputs(node);
    updateTemplateControlState(node, { force: true });
    registerPromptPresetNode(node);
    resizeNodeForControls(node);
    app.graph?.setDirtyCanvas(true, true);
}

if (globalThis.__GPT_IMAGE_PROMPT_PRESET_REGISTERED_VERSION !== UI_VERSION) {
    globalThis.__GPT_IMAGE_PROMPT_PRESET_REGISTERED_VERSION = UI_VERSION;

    app.registerExtension({
        name: "Comfy.GPTImagePromptPreset.UI",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (!SUPPORTED_NODE_NAMES.has(nodeData.name)) return;

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                onConfigure?.apply(this, arguments);
                restoreCanonicalWidgetValues(this, info?.widgets_values);
                if (this.__gptImagePromptPresetUiInstalled === UI_VERSION) {
                    repairNativeWidgetValues(this);
                    updateTemplateControlState(this, { force: true });
                }
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const self = this;
                setTimeout(() => {
                    installPromptPresetUi(self);
                }, 0);
            };

            const onDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function () {
                onDrawForeground?.apply(this, arguments);
                if (this.__gptImagePromptPresetUiInstalled === UI_VERSION) {
                    updateTemplateControlState(this, { deferRedraw: true });
                }
            };

            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                unregisterPromptPresetNode(this);
                removeStyleControls(this);
                onRemoved?.apply(this, arguments);
            };
        },
    });
}
