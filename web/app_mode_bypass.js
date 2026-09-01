import { app } from "/scripts/app.js";
import {
    createGraphTriggerWrapper,
    getBuilderIoAssignments,
    getRootGraphSafely,
    getSelectedInputEntries,
    isNodeAvailableInAppMode,
    refreshGraphNodesReference,
} from "./app_mode_bypass_model.mjs?v=20260819-2";

const EXTENSION_NAME = "DAELab.AppModeBypassInspector";
const STATE_ATTRIBUTE = "data-daelab-app-bypass-state";
const STYLE_ID = "daelab-app-mode-bypass-style";
const KEYED_ITEM_SELECTOR = [
    '[data-testid="builder-widget-item"][data-widget-key]',
    '[data-testid="app-mode-widget-item"][data-widget-key]',
].join(",");
const BUILDER_IO_SELECTOR = '[data-testid="builder-io-item"]';
const RELEVANT_SELECTOR = [
    KEYED_ITEM_SELECTOR,
    BUILDER_IO_SELECTOR,
    '[data-testid="linear-widgets"]',
].join(",");

const originalElementState = new WeakMap();
const knownNodeModes = new WeakMap();
const graphTriggerBindings = new WeakMap();
const polledInputModes = new WeakMap();

let observer = null;
let boundGraphEvents = null;
let modePollTimer = null;
let syncQueued = false;
let graphReadyRetryCount = 0;

const MAX_GRAPH_READY_RETRIES = 100;
const GRAPH_READY_RETRY_DELAY_MS = 50;
const MODE_POLL_INTERVAL_MS = 100;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
[${STATE_ATTRIBUTE}="hidden"] {
    display: none !important;
}
[${STATE_ATTRIBUTE}="disabled"] {
    filter: grayscale(1) !important;
    opacity: 0.45 !important;
    pointer-events: none !important;
}
`;
    document.head.appendChild(style);
}

function rememberElementState(element) {
    if (originalElementState.has(element)) return;
    originalElementState.set(element, {
        hidden: element.hidden,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
        ariaDisabled: element.getAttribute("aria-disabled"),
    });
}

function restoreAttribute(element, name, value) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
}

function clearElementState(element) {
    const original = originalElementState.get(element);
    if (!original) return;

    element.removeAttribute(STATE_ATTRIBUTE);
    element.hidden = original.hidden;
    element.inert = original.inert;
    restoreAttribute(element, "aria-hidden", original.ariaHidden);
    restoreAttribute(element, "aria-disabled", original.ariaDisabled);
    originalElementState.delete(element);
}

function setElementState(element, state) {
    if (!element) return;
    clearElementState(element);
    if (!state) return;

    rememberElementState(element);
    element.setAttribute(STATE_ATTRIBUTE, state);
    element.inert = true;

    if (state === "hidden") {
        element.hidden = true;
        element.setAttribute("aria-hidden", "true");
    } else {
        element.setAttribute("aria-disabled", "true");
    }
}

function clearManagedElements() {
    document.querySelectorAll(`[${STATE_ATTRIBUTE}]`).forEach(clearElementState);
}

function syncKeyedInspectorItems(graph) {
    const itemsByKey = new Map();
    document.querySelectorAll(KEYED_ITEM_SELECTOR).forEach((element) => {
        itemsByKey.set(element.getAttribute("data-widget-key"), element);
    });

    for (const entry of getSelectedInputEntries(graph)) {
        if (!entry.node) continue;
        const element = itemsByKey.get(entry.key);
        if (!element) continue;
        if (!isNodeAvailableInAppMode(entry.node)) setElementState(element, "hidden");
    }

    return itemsByKey;
}

function getBuilderIoMetadata(elements) {
    return elements.map((element) => ({
        title: element.querySelector('[data-testid="builder-io-item-title"]')?.textContent,
        subtitle: element.querySelector('[data-testid="builder-io-item-subtitle"]')?.textContent,
    }));
}

function syncBuilderIoItems(graph) {
    const elements = [...document.querySelectorAll(BUILDER_IO_SELECTOR)];
    const assignments = getBuilderIoAssignments(graph, getBuilderIoMetadata(elements));

    for (const assignment of assignments) {
        if (!assignment.node || isNodeAvailableInAppMode(assignment.node)) continue;
        const state = assignment.confidence === "unique-title" ? "disabled" : "hidden";
        setElementState(elements[assignment.elementIndex], state);
    }
}

function collectActivatedNodes(graph) {
    const activated = new Set();
    const graphs = [graph, ...(graph?.subgraphs?.values?.() ?? [])];

    for (const currentGraph of graphs) {
        for (const node of currentGraph?.nodes ?? currentGraph?._nodes ?? []) {
            const currentMode = Number(node.mode ?? 0);
            const hadPreviousMode = knownNodeModes.has(node);
            const previousMode = knownNodeModes.get(node);
            if (hadPreviousMode && previousMode !== 0 && currentMode === 0) activated.add(node);
            knownNodeModes.set(node, currentMode);
        }
    }
    return activated;
}

function refreshOfficialInspectorIfNeeded(graph, activatedNodes, itemsByKey) {
    if (!activatedNodes.size || !document.querySelector('[data-testid="linear-widgets"]')) return;

    const hasMissingActivatedInput = getSelectedInputEntries(graph).some(
        (entry) => activatedNodes.has(entry.node) && !itemsByKey.has(entry.key)
    );
    if (!hasMissingActivatedInput) return;

    // AppModeWidgetList keeps graph.nodes in a shallow ref, so dispatching configured
    // with the same array identity does not invalidate its computed input list.
    refreshGraphNodesReference(graph);
    graph?.events?.dispatchEvent?.(new Event("configured"));
}

function pollSelectedInputModes() {
    const graph = getRootGraphSafely(app);
    if (!graph) return;

    let changed = false;
    for (const { node } of getSelectedInputEntries(graph)) {
        if (!node) continue;
        const currentMode = Number(node.mode ?? 0);
        const hasPreviousMode = polledInputModes.has(node) || knownNodeModes.has(node);
        const previousMode = polledInputModes.has(node)
            ? polledInputModes.get(node)
            : knownNodeModes.get(node);
        if (hasPreviousMode && previousMode !== currentMode) {
            changed = true;
        }
        polledInputModes.set(node, currentMode);
    }
    if (changed) queueSync();
}

function syncInspector() {
    const graph = getRootGraphSafely(app);
    if (!graph) {
        if (graphReadyRetryCount < MAX_GRAPH_READY_RETRIES) {
            graphReadyRetryCount += 1;
            setTimeout(queueSync, GRAPH_READY_RETRY_DELAY_MS);
        }
        return;
    }

    graphReadyRetryCount = 0;
    bindGraphEvents(graph);

    const activatedNodes = collectActivatedNodes(graph);
    clearManagedElements();
    const itemsByKey = syncKeyedInspectorItems(graph);
    syncBuilderIoItems(graph);
    refreshOfficialInspectorIfNeeded(graph, activatedNodes, itemsByKey);
}

function queueSync() {
    if (syncQueued) return;
    syncQueued = true;

    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    schedule(() => {
        syncQueued = false;
        syncInspector();
    });
}

function handleGraphPropertyChanged(event) {
    if (event?.detail?.property === "mode") queueSync();
}

function bindGraphTrigger(graph) {
    if (!graph) return;

    const existing = graphTriggerBindings.get(graph);
    if (existing?.wrapped === graph.onTrigger) return;

    const original = graph.onTrigger;
    const wrapped = createGraphTriggerWrapper(original, queueSync);

    graph.onTrigger = wrapped;
    graphTriggerBindings.set(graph, { original, wrapped });
}

function bindGraphEvents(graph = getRootGraphSafely(app)) {
    if (!graph) return;

    bindGraphTrigger(graph);
    for (const subgraph of graph.subgraphs?.values?.() ?? []) bindGraphTrigger(subgraph);

    const events = graph.events;
    if (!events) return;

    if (events !== boundGraphEvents) {
        boundGraphEvents?.removeEventListener?.("node:property:changed", handleGraphPropertyChanged);
        boundGraphEvents?.removeEventListener?.("configured", queueSync);
        events.addEventListener?.("node:property:changed", handleGraphPropertyChanged);
        events.addEventListener?.("configured", queueSync);
        boundGraphEvents = events;
    }
}

function addedNodeTouchesInspector(node) {
    return node.nodeType === Node.ELEMENT_NODE
        && (node.matches?.(RELEVANT_SELECTOR) || node.querySelector?.(RELEVANT_SELECTOR));
}

function observeInspector() {
    if (observer || !document.body) return;

    observer = new MutationObserver((records) => {
        if (records.some((record) => [...record.addedNodes].some(addedNodeTouchesInspector))) {
            queueSync();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
    name: EXTENSION_NAME,
    setup() {
        ensureStyles();
        observeInspector();
        modePollTimer ??= setInterval(pollSelectedInputModes, MODE_POLL_INTERVAL_MS);
        queueSync();
    },
});
