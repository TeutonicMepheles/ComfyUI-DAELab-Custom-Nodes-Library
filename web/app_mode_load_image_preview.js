import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
    getRootGraphSafely,
    getSelectedInputEntries,
} from "./app_mode_bypass_model.mjs?v=20260904-scoped-input-2";
import {
    APP_PREVIEW_HEADING_PROPERTY,
    APP_PREVIEW_PROPERTY,
    buildImageViewPath,
    isAppPreviewEnabled,
    normalizeImageSelection,
    resolveAppPreviewHeading,
} from "./app_mode_load_image_preview_model.mjs?v=20260904-1";

const EXTENSION_NAME = "DAELab.AppModeLoadImagePreview";
const UI_VERSION = "20260904-app-image-preview-v3";
const TOGGLE_WIDGET_NAME = "应用模式显示参考图";
const OWNED_TOGGLE_PROPERTY = "__daelabAppImagePreviewToggle";
const PANEL_ATTRIBUTE = "data-daelab-app-image-preview";
const ITEM_SELECTOR = '[data-testid="app-mode-widget-item"][data-widget-key]';

let observer = null;
let pollTimer = null;
let syncQueued = false;

function ensureStyles() {
    const styleId = "daelab-app-mode-load-image-preview-style";
    const previous = document.getElementById(styleId);
    if (previous?.dataset.uiVersion === UI_VERSION) return;
    previous?.remove();

    const style = document.createElement("style");
    style.id = styleId;
    style.dataset.uiVersion = UI_VERSION;
    style.textContent = `
[${PANEL_ATTRIBUTE}] {
    box-sizing: border-box;
    margin: 6px 12px 12px;
    overflow: hidden;
    border: 1px solid var(--border-color, #4b4b4b);
    border-radius: 8px;
    background: #171717;
}
[${PANEL_ATTRIBUTE}] .daelab-app-image-preview-heading {
    box-sizing: border-box;
    min-height: 34px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color, #414141);
    color: var(--fg-color, #e7e7e7);
    font: 600 13px/18px Arial, sans-serif;
}
[${PANEL_ATTRIBUTE}] .daelab-app-image-preview-frame {
    position: relative;
    display: flex;
    height: clamp(220px, 28vw, 320px);
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background-color: #202020;
    background-image:
        linear-gradient(45deg, #292929 25%, transparent 25%),
        linear-gradient(-45deg, #292929 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #292929 75%),
        linear-gradient(-45deg, transparent 75%, #292929 75%);
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-size: 16px 16px;
}
[${PANEL_ATTRIBUTE}] img {
    display: none;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
[${PANEL_ATTRIBUTE}][data-ready="true"] img { display: block; }
[${PANEL_ATTRIBUTE}][data-ready="true"] .daelab-app-image-preview-empty { display: none; }
[${PANEL_ATTRIBUTE}] .daelab-app-image-preview-empty {
    padding: 20px;
    color: #aaa;
    font: 13px/20px Arial, sans-serif;
    text-align: center;
}
`;
    document.head.appendChild(style);
}

function markGraphChanged(node) {
    node.graph?.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
    node.graph?.events?.dispatchEvent?.(new Event("configured"));
}

function setPreviewEnabled(node, value) {
    const enabled = Boolean(value);
    if (typeof node.setProperty === "function") node.setProperty(APP_PREVIEW_PROPERTY, enabled);
    else {
        node.properties ||= {};
        node.properties[APP_PREVIEW_PROPERTY] = enabled;
    }
    markGraphChanged(node);
    queueSync();
}

function removeOwnedToggle(node) {
    const widgets = Array.isArray(node?.widgets) ? [...node.widgets] : [];
    for (const widget of widgets) {
        if (!widget?.[OWNED_TOGGLE_PROPERTY]) continue;
        try {
            node.removeWidget?.(widget);
        } catch {
            const index = node.widgets?.indexOf(widget) ?? -1;
            if (index >= 0) node.widgets.splice(index, 1);
        }
    }
}

function installToggle(node) {
    const existing = node.widgets?.find((widget) => widget?.[OWNED_TOGGLE_PROPERTY]);
    if (existing && node.__daelabAppImagePreviewVersion === UI_VERSION) {
        existing.value = isAppPreviewEnabled(node);
        return;
    }
    if (typeof node.addWidget !== "function") return;

    removeOwnedToggle(node);
    const widget = node.addWidget(
        "toggle",
        TOGGLE_WIDGET_NAME,
        isAppPreviewEnabled(node),
        (value) => setPreviewEnabled(node, value),
        {
            serialize: false,
            tooltip: "开启后，应用模式会在此上传控件下显示当前图片，便于取色和核对。",
        },
    );
    widget.serialize = false;
    widget.options ||= {};
    widget.options.serialize = false;
    widget[OWNED_TOGGLE_PROPERTY] = true;
    node.__daelabAppImagePreviewVersion = UI_VERSION;
}

function makePanel() {
    const panel = document.createElement("section");
    panel.setAttribute(PANEL_ATTRIBUTE, "");
    panel.setAttribute("data-ready", "false");

    const heading = document.createElement("div");
    heading.className = "daelab-app-image-preview-heading";

    const frame = document.createElement("div");
    frame.className = "daelab-app-image-preview-frame";
    const image = document.createElement("img");
    image.alt = "";
    const empty = document.createElement("div");
    empty.className = "daelab-app-image-preview-empty";
    empty.textContent = "请先选择或上传图片";
    frame.append(image, empty);
    panel.append(heading, frame);
    return panel;
}

function updatePanel(panel, node) {
    const heading = panel.querySelector(".daelab-app-image-preview-heading");
    const image = panel.querySelector("img");
    const empty = panel.querySelector(".daelab-app-image-preview-empty");
    if (!heading || !image || !empty) return;

    const title = resolveAppPreviewHeading(node);
    heading.textContent = title;
    image.alt = title;

    const imageValue = node.widgets?.find((widget) => widget.name === "image")?.value;
    const selection = normalizeImageSelection(imageValue);
    const sourceKey = selection
        ? `${selection.type}:${selection.subfolder}/${selection.filename}`
        : "";
    if (panel.dataset.sourceKey === sourceKey) return;
    panel.dataset.sourceKey = sourceKey;

    if (!selection) {
        panel.dataset.ready = "false";
        image.removeAttribute("src");
        empty.textContent = "请先选择或上传图片";
        return;
    }

    panel.dataset.ready = "false";
    empty.textContent = "正在加载参考图…";
    image.onload = () => {
        panel.dataset.ready = "true";
    };
    image.onerror = () => {
        panel.dataset.ready = "false";
        empty.textContent = "参考图加载失败，请重新选择图片";
    };
    const path = buildImageViewPath(selection, encodeURIComponent(sourceKey));
    image.src = api.apiURL(path);
}

function syncPreviewPanels() {
    const graph = getRootGraphSafely(app);
    if (!graph) return;

    const items = new Map();
    document.querySelectorAll(ITEM_SELECTOR).forEach((element) => {
        items.set(element.getAttribute("data-widget-key"), element);
    });

    const retainedPanels = new Set();
    for (const entry of getSelectedInputEntries(graph)) {
        if (
            entry.widgetName !== "image"
            || entry.node?.type !== "AppModeLoadImage"
            || !isAppPreviewEnabled(entry.node)
            || Number(entry.node.mode ?? 0) !== 0
        ) continue;

        const item = items.get(entry.key);
        if (!item) continue;
        let panel = item.querySelector(`:scope > [${PANEL_ATTRIBUTE}]`);
        if (!panel) {
            panel = makePanel();
            item.appendChild(panel);
        }
        retainedPanels.add(panel);
        updatePanel(panel, entry.node);
    }

    document.querySelectorAll(`[${PANEL_ATTRIBUTE}]`).forEach((panel) => {
        if (!retainedPanels.has(panel)) panel.remove();
    });
}

function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    schedule(() => {
        syncQueued = false;
        syncPreviewPanels();
    });
}

function observeAppMode() {
    if (observer || !document.body) return;
    observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true });
}

function chainLifecycle(nodeType, name, handler) {
    const original = nodeType.prototype[name];
    nodeType.prototype[name] = function () {
        const result = original?.apply(this, arguments);
        handler(this);
        return result;
    };
}

if (globalThis.__DAELAB_APP_MODE_LOAD_IMAGE_PREVIEW_VERSION !== UI_VERSION) {
    globalThis.__DAELAB_APP_MODE_LOAD_IMAGE_PREVIEW_VERSION = UI_VERSION;
    app.registerExtension({
        name: EXTENSION_NAME,
        setup() {
            ensureStyles();
            observeAppMode();
            pollTimer ??= setInterval(queueSync, 250);
            queueSync();
        },
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "AppModeLoadImage") return;
            chainLifecycle(nodeType, "onNodeCreated", installToggle);
            chainLifecycle(nodeType, "onConfigure", installToggle);
            chainLifecycle(nodeType, "onAdded", installToggle);
            const originalOnRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                removeOwnedToggle(this);
                originalOnRemoved?.apply(this, arguments);
                queueSync();
            };
        },
        loadedGraphNode(node) {
            if (node?.type === "AppModeLoadImage") installToggle(node);
            queueSync();
        },
    });
}

export {
    APP_PREVIEW_HEADING_PROPERTY,
    APP_PREVIEW_PROPERTY,
};
