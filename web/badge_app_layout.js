import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
    getRootGraphSafely,
    getSelectedInputEntries,
    resolveNode,
} from "./app_mode_bypass_model.mjs?v=20260904-scoped-input-2";
import {
    buildImageViewPath,
    normalizeImageSelection,
} from "./app_mode_load_image_preview_model.mjs?v=20260904-1";
import {
    COMPACT_COLOR_CONTEXT_ATTRIBUTE,
    COMPACT_COLOR_CONTEXT_EVENT,
} from "./compact_color_group_controls.mjs?v=20260904-color-context-2";
import {
    BADGE_APP_LAYOUT_ACTIVE_ATTRIBUTE,
    BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE,
    BADGE_APP_LAYOUT_TAB_IDS,
    createExecutionReferenceCache,
    getHierarchyStateSignature,
    getQuickControlState,
    getTabAvailability,
    getVisibleReferenceSources,
    itemValue,
    normalizeBadgeAppLayout,
    normalizeExecutionOutputImages,
    readHierarchyState,
    resolveActiveTab,
    shouldResetApplyForPolygonChange,
} from "./badge_app_layout_model.mjs?v=20260904-5";
import {
    POLYGON_MASK_CHANGE_EVENT,
} from "./polygon_mask_events.mjs?v=20260904-1";

const EXTENSION_NAME = "DAELab.BadgeAppLayoutV1";
const UI_VERSION = 2026090410;
const GLOBAL_RUNTIME_KEY = "__DAELAB_BADGE_APP_LAYOUT_RUNTIME__";
const GLOBAL_MODULE_KEY = "__DAELAB_BADGE_APP_LAYOUT_MODULE_VERSION__";
const ROOT_SELECTOR = '[data-testid="linear-widgets"]';
const ITEM_SELECTOR = ':scope > [data-testid="app-mode-widget-item"][data-widget-key]';
const OWNED_ATTRIBUTE = "data-daelab-app-layout-owned";
const STYLE_ID = "daelab-badge-app-layout-style";
const OLD_PREVIEW_ATTRIBUTE = "data-daelab-app-image-preview";
const POLL_INTERVAL_MS = 250;

function ensureStyles() {
    const previous = document.getElementById(STYLE_ID);
    if (previous?.dataset.uiVersion === String(UI_VERSION)) return;
    previous?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.dataset.uiVersion = String(UI_VERSION);
    style.textContent = `
[${BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE}] { display: none !important; }
[${BADGE_APP_LAYOUT_ACTIVE_ATTRIBUTE}] {
    --daelab-app-tabs-height: 48px;
    --daelab-app-dock-height: 180px;
    --daelab-app-expanded-dock-height: 180px;
}
[${OWNED_ATTRIBUTE}="tabs"] {
    position: sticky; top: 0; z-index: 31; display: flex; flex: 0 0 auto; gap: 6px;
    box-sizing: border-box; min-height: 46px; padding: 7px 10px; overflow-x: auto;
    border-bottom: 1px solid var(--border-color, #454545); background: color-mix(in srgb, var(--comfy-menu-bg, #181818) 94%, transparent);
    scrollbar-width: thin;
}
[${OWNED_ATTRIBUTE}="tabs"] [role="tab"] {
    flex: 0 0 auto; min-height: 32px; padding: 5px 12px; border: 1px solid #525252;
    border-radius: 7px; background: #242424; color: #cfcfcf; font: 600 12px/18px Arial, sans-serif;
    cursor: pointer; white-space: nowrap;
}
[${OWNED_ATTRIBUTE}="tabs"] [role="tab"][aria-selected="true"] {
    border-color: #6ea2d8; background: #27445f; color: #fff;
}
[${OWNED_ATTRIBUTE}="tabs"] [role="tab"][aria-disabled="true"] { opacity: .48; }
[${OWNED_ATTRIBUTE}="tabs"] [role="tab"]:focus-visible { outline: 2px solid #86b9ed; outline-offset: 2px; }
[${OWNED_ATTRIBUTE}="panel"] {
    position: sticky; top: var(--daelab-app-tabs-height); z-index: 30; box-sizing: border-box;
    height: clamp(140px, 24vh, 180px); max-height: var(--daelab-app-dock-height); min-height: 0;
    margin: 0; padding: 8px 10px; overflow: auto; border-bottom: 1px solid #424242;
    background: color-mix(in srgb, var(--comfy-menu-bg, #181818) 96%, transparent);
}
[${OWNED_ATTRIBUTE}="panel"][data-compact="true"] { padding-block: 5px; }
[${OWNED_ATTRIBUTE}="panel"][data-expanded-reference="true"] {
    display: flex; flex-direction: column;
    height: var(--daelab-app-expanded-dock-height); max-height: var(--daelab-app-expanded-dock-height);
}
[${OWNED_ATTRIBUTE}="panel"][data-tab-id="control"] {
    position: absolute; width: 1px; height: 1px; max-height: 1px; padding: 0; overflow: hidden;
    border: 0; clip-path: inset(50%); white-space: nowrap;
}
.daelab-app-layout-quick { display: flex; align-items: center; gap: 7px 12px; margin-bottom: 7px; overflow-x: auto; }
.daelab-app-layout-quick-group { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.daelab-app-layout-quick-label { color: #aaa; font: 600 11px/18px Arial, sans-serif; }
.daelab-app-layout-quick button {
    min-height: 27px; padding: 3px 9px; border: 1px solid #535353; border-radius: 6px;
    background: #282828; color: #ddd; font: 11px/17px Arial, sans-serif; cursor: pointer;
}
.daelab-app-layout-quick button[aria-pressed="true"] { border-color: #6e9fd0; background: #29465f; color: #fff; }
.daelab-app-layout-quick button:disabled { opacity: .4; cursor: not-allowed; }
.daelab-app-layout-reference-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px; }
.daelab-app-layout-reference-list[data-expanded="true"] {
    flex: 1 1 auto; min-height: 0; grid-template-columns: minmax(0, 1fr);
}
.daelab-app-layout-reference-list[data-expanded="true"] .daelab-app-layout-reference:not([data-expanded="true"]) { display: none; }
.daelab-app-layout-reference {
    display: grid; grid-template-columns: minmax(62px, 88px) minmax(0, 1fr); min-height: 78px; padding: 5px;
    overflow: hidden; border: 1px solid #444; border-radius: 7px; background: #202020; color: #ddd; text-align: left;
}
.daelab-app-layout-reference[data-expanded="true"] {
    grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
    width: 100%; height: 100%; min-height: 0; padding: 7px;
}
.daelab-app-layout-reference[data-emphasized="true"] { border-color: #77aee4; box-shadow: inset 0 0 0 1px #77aee4; }
button.daelab-app-layout-reference { cursor: zoom-in; }
button.daelab-app-layout-reference:disabled { cursor: default; opacity: 1; }
.daelab-app-layout-reference-frame {
    display: flex; min-height: 64px; align-items: center; justify-content: center; overflow: hidden; border-radius: 4px;
    background-color: #292929; background-image: linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%);
    background-position: 0 0,0 7px,7px -7px,-7px 0; background-size: 14px 14px;
}
.daelab-app-layout-reference img { display: none; width: 100%; height: 70px; object-fit: contain; }
.daelab-app-layout-reference[data-ready="true"] img { display: block; }
.daelab-app-layout-reference[data-expanded="true"] .daelab-app-layout-reference-frame { min-height: 0; }
.daelab-app-layout-reference[data-expanded="true"] img { height: 100%; min-height: 0; }
.daelab-app-layout-reference[data-expanded="true"] .daelab-app-layout-reference-copy {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 2px 0;
}
.daelab-app-layout-reference-copy { align-self: center; min-width: 0; padding-left: 8px; }
.daelab-app-layout-reference-title { font: 600 11px/16px Arial, sans-serif; }
.daelab-app-layout-reference-status { margin-top: 3px; color: #999; font: 10px/14px Arial, sans-serif; }
.daelab-app-layout-pending { min-height: 18px; color: #d8b878; font: 11px/18px Arial, sans-serif; }
.daelab-app-layout-sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
dialog.daelab-app-layout-dialog { width: min(94vw, 1280px); height: min(92vh, 920px); padding: 42px 12px 12px; border: 1px solid #666; border-radius: 10px; background: #151515; color: #fff; }
dialog.daelab-app-layout-dialog::backdrop { background: rgba(0,0,0,.82); }
dialog.daelab-app-layout-dialog img { width: 100%; height: 100%; object-fit: contain; }
dialog.daelab-app-layout-dialog button { position: absolute; top: 8px; right: 10px; min-width: 76px; min-height: 28px; }
`;
    document.head.appendChild(style);
}

function makeOwned(tag, role) {
    const element = document.createElement(tag);
    element.setAttribute(OWNED_ATTRIBUTE, role);
    return element;
}

function safeElementId(value) {
    return `daelab-app-${String(value).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function createRuntime() {
    let disposed = false;
    let observer = null;
    let resizeObserver = null;
    let pollTimer = null;
    let syncQueued = false;
    let graph = null;
    let root = null;
    let layout = null;
    let activeTab = "control";
    let focusedInputKey = null;
    let expandedInputKey = null;
    let stateSignature = "";
    let routeSignature = "";
    let contextSignature = "";
    let unsubscribeState = null;
    let subscribedNode = null;
    let tabsBar = null;
    let tabButtons = new Map();
    let panels = new Map();
    let liveRegion = null;
    let referenceCards = new Map();
    let dialog = null;
    let dialogImage = null;
    let dialogClose = null;
    let dialogTrigger = null;
    const executionCache = createExecutionReferenceCache();

    function announce(message) {
        if (liveRegion) liveRegion.textContent = message;
    }

    function closeDialog() {
        if (!dialog) return;
        if (dialog.open && typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
    }

    function destroyDialog() {
        closeDialog();
        dialog?.remove();
        dialog = null;
        dialogImage = null;
        dialogClose = null;
        dialogTrigger = null;
    }

    function openDialog(source, trigger) {
        if (!source || !dialog || !dialogImage) return;
        dialogTrigger = trigger;
        dialogImage.src = source;
        dialogImage.alt = trigger.querySelector(".daelab-app-layout-reference-title")?.textContent || "参考图大图";
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        dialogClose?.focus();
    }

    function makeDialog() {
        destroyDialog();
        dialog = document.createElement("dialog");
        dialog.className = "daelab-app-layout-dialog";
        dialog.setAttribute("aria-label", "参考图大图查看");
        dialogImage = document.createElement("img");
        dialogClose = document.createElement("button");
        dialogClose.type = "button";
        dialogClose.textContent = "关闭大图";
        dialogClose.addEventListener("click", closeDialog);
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            closeDialog();
        });
        dialog.addEventListener("click", (event) => {
            if (event.target !== dialog) return;
            const bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right
                || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
        });
        dialog.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
            } else if (event.key === "Tab") {
                event.preventDefault();
                dialogClose?.focus();
            }
        });
        dialog.addEventListener("close", () => {
            dialogImage?.removeAttribute("src");
            const trigger = dialogTrigger;
            dialogTrigger = null;
            trigger?.isConnected && trigger.focus();
        });
        dialog.append(dialogClose, dialogImage);
        document.body.appendChild(dialog);
    }

    function clearExecutionOutputs() {
        executionCache.clear();
        updateReferenceCards();
    }

    function removeLayoutDom() {
        if (root) {
            root.removeEventListener("focusin", handleFocusIn);
            root.removeAttribute(BADGE_APP_LAYOUT_ACTIVE_ATTRIBUTE);
            root.querySelectorAll(`[${BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE}]`).forEach(
                (element) => element.removeAttribute(BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE)
            );
            root.querySelectorAll(`:scope > [${OWNED_ATTRIBUTE}]`).forEach((element) => element.remove());
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
        tabsBar = null;
        tabButtons = new Map();
        panels = new Map();
        liveRegion = null;
        referenceCards = new Map();
        contextSignature = "";
        destroyDialog();
    }

    function teardownLayout() {
        unsubscribeState?.();
        unsubscribeState = null;
        subscribedNode = null;
        removeLayoutDom();
        clearExecutionOutputs();
        graph = null;
        root = null;
        layout = null;
        activeTab = "control";
        focusedInputKey = null;
        expandedInputKey = null;
        stateSignature = "";
        routeSignature = "";
        globalThis.dispatchEvent?.(new CustomEvent("daelab:app-layout-changed", {
            detail: { active: false },
        }));
    }

    function updateDockSize() {
        if (!root || !tabsBar) return;
        const tabsHeight = Math.ceil(tabsBar.getBoundingClientRect().height || 48);
        const rootHeight = root.clientHeight || root.getBoundingClientRect().height || 0;
        root.style.setProperty("--daelab-app-tabs-height", `${tabsHeight}px`);
        const available = Math.max(0, rootHeight - tabsHeight);
        const fullHeight = Math.min(180, Math.max(140, available - 200));
        const canPreserveControls = available >= 340;
        const dockHeight = canPreserveControls
            ? fullHeight
            : Math.max(88, Math.min(132, Math.floor(available * 0.46)));
        const expandedDockHeight = canPreserveControls
            ? Math.min(560, Math.max(dockHeight, available - 200))
            : dockHeight;
        root.style.setProperty("--daelab-app-dock-height", `${dockHeight}px`);
        root.style.setProperty("--daelab-app-expanded-dock-height", `${expandedDockHeight}px`);
        for (const [tabId, panel] of panels) {
            if (tabId !== "control") panel.dataset.compact = String(!canPreserveControls);
        }
    }

    function selectTab(tabId, focus = false) {
        if (!layout) return;
        const state = readHierarchyState(layout.stateNode);
        const availability = getTabAvailability(layout, state);
        if (!availability.get(tabId)) {
            const tab = layout.tabById.get(tabId);
            announce(`需要先在控制面板开启“${tab?.title || tabId}”。`);
            if (focus) tabButtons.get(tabId)?.focus();
            return;
        }
        activeTab = tabId;
        focusedInputKey = null;
        expandedInputKey = null;
        contextSignature = "";
        render(state);
        if (focus) tabButtons.get(tabId)?.focus();
    }

    function handleTabKeydown(event) {
        const button = event.target.closest?.('[role="tab"]');
        if (!button) return;
        const currentIndex = BADGE_APP_LAYOUT_TAB_IDS.indexOf(button.dataset.tabId);
        let nextIndex = null;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % BADGE_APP_LAYOUT_TAB_IDS.length;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + BADGE_APP_LAYOUT_TAB_IDS.length) % BADGE_APP_LAYOUT_TAB_IDS.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = BADGE_APP_LAYOUT_TAB_IDS.length - 1;
        if (nextIndex !== null) {
            event.preventDefault();
            for (const candidate of tabButtons.values()) candidate.tabIndex = -1;
            const next = tabButtons.get(BADGE_APP_LAYOUT_TAB_IDS[nextIndex]);
            next.tabIndex = 0;
            next.focus();
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectTab(button.dataset.tabId, true);
        }
    }

    function buildLayoutDom() {
        root.setAttribute(BADGE_APP_LAYOUT_ACTIVE_ATTRIBUTE, "1");
        root.querySelectorAll(`[${OLD_PREVIEW_ATTRIBUTE}]`).forEach((element) => element.remove());
        tabsBar = makeOwned("div", "tabs");
        tabsBar.setAttribute("role", "tablist");
        tabsBar.setAttribute("aria-label", "徽章工作流步骤");
        const disabledDescription = document.createElement("span");
        disabledDescription.id = "daelab-app-disabled-tab-description";
        disabledDescription.className = "daelab-app-layout-sr-only";
        disabledDescription.textContent = "需要先在控制面板开启此功能。";
        tabsBar.appendChild(disabledDescription);
        tabsBar.addEventListener("keydown", handleTabKeydown);

        for (const tab of layout.tabs) {
            const button = document.createElement("button");
            button.type = "button";
            button.id = safeElementId(`tab-${tab.id}`);
            button.dataset.tabId = tab.id;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-controls", safeElementId(`panel-${tab.id}`));
            button.textContent = tab.title;
            button.addEventListener("click", () => selectTab(tab.id, true));
            tabsBar.appendChild(button);
            tabButtons.set(tab.id, button);

            const panel = makeOwned("section", "panel");
            panel.id = safeElementId(`panel-${tab.id}`);
            panel.dataset.tabId = tab.id;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", button.id);
            panels.set(tab.id, panel);
        }

        liveRegion = document.createElement("div");
        liveRegion.className = "daelab-app-layout-sr-only";
        liveRegion.setAttribute("aria-live", "polite");
        tabsBar.appendChild(liveRegion);

        const fragment = document.createDocumentFragment();
        fragment.appendChild(tabsBar);
        for (const panel of panels.values()) fragment.appendChild(panel);
        root.prepend(fragment);
        root.addEventListener("focusin", handleFocusIn);
        makeDialog();

        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(updateDockSize);
            resizeObserver.observe(root);
            resizeObserver.observe(tabsBar);
        }
        updateDockSize();
        globalThis.dispatchEvent?.(new CustomEvent("daelab:app-layout-changed", {
            detail: { active: true },
        }));
    }

    function handleFocusIn(event) {
        const item = event.target.closest?.('[data-testid="app-mode-widget-item"][data-widget-key]');
        const key = item?.getAttribute("data-widget-key") || null;
        if (!key) return;
        const nextExpandedInputKey = item.querySelector?.(`[${COMPACT_COLOR_CONTEXT_ATTRIBUTE}]`)
            ? key
            : null;
        if (key === focusedInputKey && nextExpandedInputKey === expandedInputKey) return;
        focusedInputKey = key;
        expandedInputKey = nextExpandedInputKey;
        contextSignature = "";
        render(readHierarchyState(layout?.stateNode));
    }

    function handleColorControlActivated(event) {
        const control = event?.detail?.element;
        if (!control?.isConnected || !root?.contains(control)) return;
        const item = control.closest?.('[data-testid="app-mode-widget-item"][data-widget-key]');
        const key = item?.getAttribute("data-widget-key") || null;
        if (!key || key === expandedInputKey) return;
        focusedInputKey = key;
        expandedInputKey = key;
        contextSignature = "";
        render(readHierarchyState(layout?.stateNode));
    }

    function handlePolygonMaskChanged(event) {
        const state = readHierarchyState(layout?.stateNode);
        if (!shouldResetApplyForPolygonChange(layout, graph, event?.detail, state)) return;
        layout.stateNode?.daelabBooleanHierarchyV1?.setItemValue(
            layout.polygonChange.applyItemId,
            false,
        );
        queueSync();
    }

    function bindStateApi() {
        const node = layout?.stateNode;
        if (subscribedNode === node && unsubscribeState) return;
        unsubscribeState?.();
        unsubscribeState = null;
        subscribedNode = node;
        const stateApi = node?.daelabBooleanHierarchyV1;
        if (!stateApi?.subscribe) return;
        unsubscribeState = stateApi.subscribe(() => queueSync());
    }

    function makeQuickControls(panel, state) {
        const container = document.createElement("div");
        container.className = "daelab-app-layout-quick";
        const stateApi = layout.stateNode?.daelabBooleanHierarchyV1;
        for (const rawControl of layout.quickControls[activeTab] || []) {
            const control = getQuickControlState(rawControl, state);
            const group = document.createElement("div");
            group.className = "daelab-app-layout-quick-group";
            group.setAttribute("role", "group");
            group.setAttribute("aria-label", control.label);
            const label = document.createElement("span");
            label.className = "daelab-app-layout-quick-label";
            label.textContent = control.label;
            group.appendChild(label);
            for (const choice of control.choices) {
                const button = document.createElement("button");
                button.type = "button";
                const selected = choice.value;
                button.textContent = choice.label;
                button.setAttribute("aria-pressed", String(selected));
                button.disabled = !stateApi || !choice.interactive;
                button.addEventListener("click", () => {
                    const requestedValue = control.kind === "choice" ? true : !selected;
                    const changed = stateApi?.setItemValue(choice.itemId, requestedValue);
                    if (!changed && !stateApi) announce("控制状态正在同步，请稍候。");
                });
                group.appendChild(button);
            }
            container.appendChild(group);
        }
        panel.appendChild(container);
    }

    function makeReferenceCard(source) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "daelab-app-layout-reference";
        card.dataset.ready = "false";
        card.dataset.emphasized = String(source.emphasized);
        card.dataset.expanded = "false";
        card.disabled = true;
        const frame = document.createElement("span");
        frame.className = "daelab-app-layout-reference-frame";
        const image = document.createElement("img");
        image.alt = "";
        frame.appendChild(image);
        const copy = document.createElement("span");
        copy.className = "daelab-app-layout-reference-copy";
        const title = document.createElement("span");
        title.className = "daelab-app-layout-reference-title";
        title.textContent = source.title;
        const status = document.createElement("span");
        status.className = "daelab-app-layout-reference-status";
        status.textContent = source.kind === "executionOutput" ? "尚未生成本次参考图" : "请先选择或上传图片";
        copy.append(title, status);
        card.append(frame, copy);
        card.addEventListener("click", () => openDialog(card.dataset.imageUrl, card));
        referenceCards.set(source.id, { card, image, status, source });
        return card;
    }

    function renderContextPanel(panel, state, pending) {
        panel.replaceChildren();
        referenceCards = new Map();
        makeQuickControls(panel, state);
        const pendingStatus = document.createElement("div");
        pendingStatus.className = "daelab-app-layout-pending";
        pendingStatus.textContent = pending || "";
        panel.appendChild(pendingStatus);
        const references = getVisibleReferenceSources(
            layout,
            activeTab,
            state,
            focusedInputKey,
            expandedInputKey,
        );
        panel.dataset.expandedReference = "false";
        delete panel.dataset.expandedReferenceId;
        if (references.length) {
            const list = document.createElement("div");
            list.className = "daelab-app-layout-reference-list";
            list.dataset.expanded = "false";
            for (const source of references) list.appendChild(makeReferenceCard(source));
            panel.appendChild(list);
        }
        updateReferenceCards();
    }

    function syncExpandedReferenceLayout() {
        const panel = panels.get(activeTab);
        if (!panel) return;
        const expandedEntry = [...referenceCards.values()].find(
            ({ card }) => card.dataset.expanded === "true"
        );
        panel.dataset.expandedReference = String(Boolean(expandedEntry));
        if (expandedEntry) panel.dataset.expandedReferenceId = expandedEntry.source.id;
        else delete panel.dataset.expandedReferenceId;
        const list = panel.querySelector(".daelab-app-layout-reference-list");
        if (list) list.dataset.expanded = String(Boolean(expandedEntry));
    }

    function getReferenceSelection(source) {
        if (source.kind === "inputWidget") {
            const node = resolveNode(graph, source.nodeId);
            return {
                selection: normalizeImageSelection(
                    node?.widgets?.find((widget) => widget.name === source.widgetName)?.value
                ),
                token: "input",
            };
        }
        const captured = executionCache.get(source.nodeId);
        const selection = normalizeExecutionOutputImages(captured?.output, source.outputField)[0] || null;
        return { selection, token: captured?.token || "" };
    }

    function updateReferenceCards() {
        for (const { card, image, status, source } of referenceCards.values()) {
            const { selection, token } = getReferenceSelection(source);
            card.dataset.expanded = String(Boolean(source.expanded && selection));
            const sourceKey = selection
                ? `${selection.type}:${selection.subfolder}/${selection.filename}:${token}`
                : "";
            if (card.dataset.sourceKey === sourceKey) continue;
            card.dataset.sourceKey = sourceKey;
            card.dataset.ready = "false";
            card.disabled = true;
            card.removeAttribute("data-image-url");
            image.removeAttribute("src");
            if (!selection) {
                status.textContent = source.kind === "executionOutput"
                    ? "尚未生成本次参考图"
                    : "请先选择或上传图片";
                continue;
            }
            status.textContent = "正在加载参考图…";
            const url = api.apiURL(buildImageViewPath(selection, sourceKey));
            image.onload = () => {
                card.dataset.ready = "true";
                card.disabled = false;
                status.textContent = card.dataset.expanded === "true"
                    ? "已展开用于取色 · 点击查看无损大图"
                    : "点击查看无损大图";
            };
            image.onerror = () => {
                card.dataset.ready = "false";
                card.disabled = true;
                status.textContent = "参考图加载失败";
            };
            card.dataset.imageUrl = url;
            image.src = url;
        }
        syncExpandedReferenceLayout();
    }

    function render(state) {
        if (!root || !layout) return;
        const previousTab = activeTab;
        activeTab = resolveActiveTab(layout, activeTab, state);
        if (previousTab !== activeTab) announce("当前功能已关闭，已返回控制面板。");
        const availability = getTabAvailability(layout, state);
        for (const tab of layout.tabs) {
            const button = tabButtons.get(tab.id);
            const selected = tab.id === activeTab;
            button.setAttribute("aria-selected", String(selected));
            button.setAttribute("aria-disabled", String(!availability.get(tab.id)));
            button.tabIndex = selected ? 0 : -1;
            if (!availability.get(tab.id)) button.setAttribute("aria-describedby", "daelab-app-disabled-tab-description");
            else button.removeAttribute("aria-describedby");
            const panel = panels.get(tab.id);
            panel.hidden = !selected;
        }

        const entries = getSelectedInputEntries(graph);
        const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
        const itemByKey = new Map();
        root.querySelectorAll(ITEM_SELECTOR).forEach((element) => {
            itemByKey.set(element.getAttribute("data-widget-key"), element);
        });
        const activeKeys = new Set(layout.tabById.get(activeTab).inputKeys);
        for (const [key, element] of itemByKey) {
            if (activeKeys.has(key)) element.removeAttribute(BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE);
            else element.setAttribute(BADGE_APP_LAYOUT_HIDDEN_ATTRIBUTE, "1");
            if (!element.id) element.id = safeElementId(`input-${key}`);
        }
        const activePanel = panels.get(activeTab);
        activePanel.setAttribute("aria-owns", [...activeKeys]
            .map((key) => itemByKey.get(key)?.id)
            .filter(Boolean)
            .join(" "));
        const missingActiveKeys = [...activeKeys].filter((key) => {
            const entry = entryByKey.get(key);
            return entry?.node && Number(entry.node.mode ?? 0) === 0 && !itemByKey.has(key);
        });
        const pending = missingActiveKeys.length
            ? "正在切换工作流分支…"
            : !layout.stateNode?.daelabBooleanHierarchyV1
                ? "控制状态正在同步…"
                : "";
        const nextContextSignature = `${activeTab}|${getHierarchyStateSignature(state)}|${focusedInputKey || ""}|${expandedInputKey || ""}|${pending}`;
        if (activeTab !== "control" && nextContextSignature !== contextSignature) {
            contextSignature = nextContextSignature;
            renderContextPanel(activePanel, state, pending);
        }
        updateReferenceCards();
        updateDockSize();
    }

    function setupLayout(nextGraph, nextRoot, nextLayout) {
        graph = nextGraph;
        root = nextRoot;
        layout = nextLayout;
        activeTab = layout.defaultTab;
        focusedInputKey = null;
        expandedInputKey = null;
        stateSignature = "";
        routeSignature = "";
        contextSignature = "";
        executionCache.clear();
        buildLayoutDom();
        bindStateApi();
    }

    function sync() {
        if (disposed) return;
        const nextGraph = getRootGraphSafely(app);
        const nextRoot = document.querySelector(ROOT_SELECTOR);
        const normalized = normalizeBadgeAppLayout(nextGraph);
        if (!nextGraph || !nextRoot || !normalized.ok) {
            if (layout || root) teardownLayout();
            return;
        }
        const changed = graph !== nextGraph
            || root !== nextRoot
            || layout?.signature !== normalized.layout.signature;
        if (changed) {
            if (layout || root) teardownLayout();
            setupLayout(nextGraph, nextRoot, normalized.layout);
        } else {
            layout = normalized.layout;
            bindStateApi();
        }

        const state = readHierarchyState(layout.stateNode);
        const nextStateSignature = getHierarchyStateSignature(state);
        const nextRouteSignature = [
            itemValue(state, "badge.path.flat_height"),
            itemValue(state, "badge.path.effect"),
        ].join(":");
        if (routeSignature && routeSignature !== nextRouteSignature) {
            expandedInputKey = null;
            contextSignature = "";
            clearExecutionOutputs();
        }
        routeSignature = nextRouteSignature;
        if (stateSignature !== nextStateSignature) {
            stateSignature = nextStateSignature;
            contextSignature = "";
        }
        render(state);
    }

    function queueSync() {
        if (disposed || syncQueued) return;
        syncQueued = true;
        const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
        schedule(() => {
            syncQueued = false;
            sync();
        });
    }

    function handleExecutionStart() {
        clearExecutionOutputs();
        queueSync();
    }

    function handleExecuted(event) {
        if (!layout) return;
        const nodeId = String(event?.detail?.node ?? "");
        if (!layout.referenceSources.some(
            (source) => source.kind === "executionOutput" && source.nodeId === nodeId
        )) return;
        executionCache.capture(nodeId, event.detail?.output || {});
        queueSync();
    }

    function start() {
        ensureStyles();
        if (document.body && typeof MutationObserver === "function") {
            observer = new MutationObserver(queueSync);
            observer.observe(document.body, { childList: true, subtree: true });
        }
        api.addEventListener?.("execution_start", handleExecutionStart);
        api.addEventListener?.("executed", handleExecuted);
        globalThis.addEventListener?.("daelab:app-mode-synced", queueSync);
        globalThis.addEventListener?.("daelab:boolean-hierarchy-ready", queueSync);
        globalThis.addEventListener?.(COMPACT_COLOR_CONTEXT_EVENT, handleColorControlActivated);
        globalThis.addEventListener?.(POLYGON_MASK_CHANGE_EVENT, handlePolygonMaskChanged);
        pollTimer = setInterval(queueSync, POLL_INTERVAL_MS);
        queueSync();
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        observer?.disconnect();
        observer = null;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        api.removeEventListener?.("execution_start", handleExecutionStart);
        api.removeEventListener?.("executed", handleExecuted);
        globalThis.removeEventListener?.("daelab:app-mode-synced", queueSync);
        globalThis.removeEventListener?.("daelab:boolean-hierarchy-ready", queueSync);
        globalThis.removeEventListener?.(COMPACT_COLOR_CONTEXT_EVENT, handleColorControlActivated);
        globalThis.removeEventListener?.(POLYGON_MASK_CHANGE_EVENT, handlePolygonMaskChanged);
        teardownLayout();
    }

    return { version: UI_VERSION, start, queueSync, dispose };
}

if (Number(globalThis[GLOBAL_MODULE_KEY] || 0) < UI_VERSION) {
    globalThis[GLOBAL_MODULE_KEY] = UI_VERSION;
    app.registerExtension({
        name: EXTENSION_NAME,
        setup() {
            const previous = globalThis[GLOBAL_RUNTIME_KEY];
            if (Number(previous?.version || 0) > UI_VERSION) {
                previous.queueSync?.();
                return;
            }
            previous?.dispose?.();
            const runtime = createRuntime();
            globalThis[GLOBAL_RUNTIME_KEY] = runtime;
            runtime.start();
        },
    });
}
