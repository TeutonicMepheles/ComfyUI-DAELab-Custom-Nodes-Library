import { app } from "/scripts/app.js";
import {
    HIERARCHY_GET_NODE_TYPE,
    buildRootOptions,
    buildSourceOptions,
    createMissingSnapshot,
    createValidSnapshot,
    encodeGetSnapshot,
    getOutputSlotsMatchDescriptors,
    getSnapshotOutputDescriptors,
    normalizeGetSnapshot,
    reconcileGetOutputSlots,
    resolveSourceNode,
} from "./boolean_list_hierarchy_get_model.mjs?v=get-3-dependencies";

const EXTENSION_NAME = "DAELab.BooleanListHierarchyGet";
const CONFIG_WIDGET_NAME = "config_json";
const UI_WIDGET_NAME = "boolean_hierarchy_get_editor";
const DEFAULT_WIDTH = 410;
const UI_HEIGHT = 154;
const POLL_INTERVAL_MS = 100;

const getNodes = new Set();
let pollTimer = null;
let syncQueued = false;

function chainCallback(target, property, callback) {
    const original = target[property];
    target[property] = function () {
        const result = original ? original.apply(this, arguments) : undefined;
        callback.apply(this, arguments);
        return result;
    };
}

function stopCanvasPropagation(event) {
    event.stopPropagation();
}

function createElement(tag, style = "") {
    const element = document.createElement(tag);
    if (style) element.style.cssText = style;
    return element;
}

function ensureProperties(node) {
    node.properties = node.properties || {};
    if (node.properties.boolean_get_source_node_id == null) {
        node.properties.boolean_get_source_node_id = "";
    }
    if (node.properties.boolean_get_root_item_id == null) {
        node.properties.boolean_get_root_item_id = "";
    }
    if (node.properties.boolean_get_include_root == null) {
        node.properties.boolean_get_include_root = true;
    }
    node.properties.boolean_get_source_node_id = String(
        node.properties.boolean_get_source_node_id || ""
    );
    node.properties.boolean_get_root_item_id = String(
        node.properties.boolean_get_root_item_id || ""
    );
    node.properties.boolean_get_include_root = Boolean(
        node.properties.boolean_get_include_root
    );
}

function getConfigWidget(node) {
    return (node.widgets || []).find(
        (candidate) => candidate.name === CONFIG_WIDGET_NAME
    );
}

function hideConfigWidget(node) {
    const widget = getConfigWidget(node);
    if (!widget) return;
    widget._booleanHierarchyGetConfig = true;
    widget.origType = widget.origType || widget.type;
    widget.hidden = true;
    widget.type = "converted-widget";
    widget.serialize = true;
    widget.serializeValue = () => (
        node.properties?.boolean_get_snapshot || widget.value
    );
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({
        minHeight: 0,
        maxHeight: 0,
        minWidth: 0,
    });
    widget.draw = () => {};
    for (const element of [widget.element, widget.inputEl]) {
        if (!element?.style) continue;
        element.style.display = "none";
        element.style.visibility = "hidden";
    }
}

function readStoredSnapshot(node) {
    const widget = getConfigWidget(node);
    const value = node.properties?.boolean_get_snapshot
        || widget?.value
        || node.widgets_values?.[0];
    return normalizeGetSnapshot(value);
}

function writeStoredSnapshot(node, snapshot) {
    const encoded = encodeGetSnapshot(snapshot);
    node.properties.boolean_get_snapshot = encoded;
    const widget = getConfigWidget(node);
    if (widget) widget.value = encoded;
    node._booleanHierarchyGetSnapshot = normalizeGetSnapshot(snapshot);
    return encoded;
}

function markDirty(node, resize = false) {
    if (resize && node.setSize && node.computeSize) {
        const computed = node.computeSize();
        const savedWidth = Number(node.properties?.boolean_get_width);
        const width = Number.isFinite(savedWidth) && savedWidth > 0
            ? savedWidth
            : Math.max(node.size?.[0] || 0, DEFAULT_WIDTH);
        node._booleanHierarchyGetAutoSizing = true;
        try {
            node.setSize([width, computed[1]]);
        } finally {
            node._booleanHierarchyGetAutoSizing = false;
        }
    }
    if (node.graph && typeof node.graph._version === "number") {
        node.graph._version += 1;
    }
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
}

function setBinding(node, changes) {
    ensureProperties(node);
    const graph = node.graph;
    graph?.beforeChange?.();
    try {
        Object.assign(node.properties, changes);
        if (graph && typeof graph._version === "number") graph._version += 1;
    } finally {
        graph?.afterChange?.();
    }
    queueSync();
}

function replaceSelectOptions(select, options, currentValue, placeholder, missingLabel) {
    const signature = JSON.stringify([
        currentValue,
        options.map((option) => [option.id, option.label]),
    ]);
    if (select.dataset.signature === signature) return;
    const fragment = document.createDocumentFragment();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    fragment.appendChild(empty);
    if (currentValue && !options.some((option) => option.id === currentValue)) {
        const missing = document.createElement("option");
        missing.value = currentValue;
        missing.textContent = missingLabel;
        fragment.appendChild(missing);
    }
    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = option.label;
        fragment.appendChild(element);
    }
    select.replaceChildren(fragment);
    select.value = currentValue;
    select.dataset.signature = signature;
}

function createSelect(labelText) {
    const wrapper = createElement(
        "label",
        "display:grid;grid-template-columns:92px minmax(0,1fr);gap:7px;align-items:center;"
    );
    const label = createElement("span", "color:#aaa;font-size:11px;");
    label.textContent = labelText;
    wrapper.appendChild(label);
    const select = createElement(
        "select",
        "min-width:0;width:100%;height:28px;padding:2px 6px;border:1px solid #4a4a4a;border-radius:4px;" +
        "background:#242424;color:#ddd;font-size:11px;outline:none;"
    );
    wrapper.appendChild(select);
    return { wrapper, select };
}

function ensureGetUI(node) {
    if (node._booleanHierarchyGetUI) return node._booleanHierarchyGetUI;
    ensureProperties(node);
    hideConfigWidget(node);

    const container = createElement(
        "div",
        `width:100%;height:${UI_HEIGHT}px;box-sizing:border-box;padding:9px;display:flex;flex-direction:column;gap:7px;` +
        "border:1px solid #404040;border-radius:6px;background:#191919;color:#ddd;font:12px Arial,sans-serif;overflow:hidden;"
    );
    for (const eventName of [
        "pointerdown",
        "pointerup",
        "click",
        "dblclick",
        "contextmenu",
        "keydown",
    ]) {
        container.addEventListener(eventName, stopCanvasPropagation);
    }

    const sourceControl = createSelect("Source");
    sourceControl.select.setAttribute("aria-label", "Boolean List Hierarchy source");
    sourceControl.select.addEventListener("change", () => {
        const sourceId = sourceControl.select.value;
        setBinding(node, {
            boolean_get_source_node_id: sourceId,
            boolean_get_root_item_id: "",
        });
    });
    container.appendChild(sourceControl.wrapper);

    const rootControl = createSelect("Root branch");
    rootControl.select.setAttribute("aria-label", "Hierarchy root branch");
    rootControl.select.addEventListener("change", () => {
        setBinding(node, {
            boolean_get_root_item_id: rootControl.select.value,
        });
    });
    container.appendChild(rootControl.wrapper);

    const bottom = createElement(
        "div",
        "display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;"
    );
    const includeLabel = createElement(
        "label",
        "display:flex;align-items:center;gap:6px;color:#bbb;font-size:11px;cursor:pointer;white-space:nowrap;"
    );
    const includeRoot = document.createElement("input");
    includeRoot.type = "checkbox";
    includeRoot.style.cssText = "width:15px;height:15px;margin:0;accent-color:#6ca0dc;";
    includeRoot.addEventListener("change", () => {
        setBinding(node, {
            boolean_get_include_root: includeRoot.checked,
        });
    });
    includeLabel.appendChild(includeRoot);
    const includeText = document.createElement("span");
    includeText.textContent = "Include Root";
    includeLabel.appendChild(includeText);
    bottom.appendChild(includeLabel);

    const status = createElement(
        "div",
        "height:28px;padding:0 8px;display:flex;align-items:center;border:1px solid #555;border-radius:5px;" +
        "background:#292929;color:#bbb;font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    );
    status.textContent = "Waiting for source";
    bottom.appendChild(status);
    container.appendChild(bottom);

    const widget = node.addDOMWidget(UI_WIDGET_NAME, "custom", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => UI_HEIGHT,
        getHeight: () => UI_HEIGHT,
    });
    widget.serialize = false;
    widget.inputEl = container;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, UI_HEIGHT];
    widget.computeLayoutSize = () => ({
        minHeight: UI_HEIGHT,
        maxHeight: UI_HEIGHT,
        minWidth: 340,
    });
    node._booleanHierarchyGetUI = {
        container,
        sourceSelect: sourceControl.select,
        rootSelect: rootControl.select,
        includeRoot,
        status,
    };
    return node._booleanHierarchyGetUI;
}

function setStatus(ui, text, tone) {
    const palette = {
        ready: ["#163d28", "#3d9b63", "#8ee0ad"],
        error: ["#481e1e", "#b64b4b", "#ff9a9a"],
        idle: ["#292929", "#565656", "#b8b8b8"],
    }[tone] || ["#292929", "#565656", "#b8b8b8"];
    ui.status.textContent = text;
    ui.status.title = text;
    ui.status.style.background = palette[0];
    ui.status.style.borderColor = palette[1];
    ui.status.style.color = palette[2];
}

function resolveGetState(node, previousSnapshot) {
    ensureProperties(node);
    const sourceOptions = buildSourceOptions(node.graph);
    let sourceId = node.properties.boolean_get_source_node_id;
    if (!sourceId && sourceOptions.length === 1) {
        sourceId = sourceOptions[0].id;
        node.properties.boolean_get_source_node_id = sourceId;
    }

    const source = resolveSourceNode(node.graph, sourceId);
    const roots = buildRootOptions(source);
    const rootId = node.properties.boolean_get_root_item_id;
    const includeRoot = node.properties.boolean_get_include_root !== false;

    if (!sourceId) {
        return {
            sourceOptions,
            roots,
            snapshot: createMissingSnapshot(previousSnapshot, {
                sourceNodeId: "",
                rootItemId: "",
                includeRoot,
                preserveItems: false,
            }),
            message: "Select a Hierarchy source",
            tone: "idle",
        };
    }
    if (!source) {
        return {
            sourceOptions,
            roots,
            snapshot: createMissingSnapshot(previousSnapshot, {
                sourceNodeId: sourceId,
                rootItemId: rootId,
                includeRoot,
            }),
            message: "Source missing · outputs forced False",
            tone: "error",
        };
    }
    if (!rootId) {
        return {
            sourceOptions,
            roots,
            snapshot: createMissingSnapshot(previousSnapshot, {
                sourceNodeId: sourceId,
                rootItemId: "",
                includeRoot,
                preserveItems: false,
            }),
            message: "Select a Root branch",
            tone: "idle",
        };
    }

    const snapshot = createValidSnapshot(source, rootId, includeRoot);
    if (!snapshot) {
        return {
            sourceOptions,
            roots,
            snapshot: createMissingSnapshot(previousSnapshot, {
                sourceNodeId: sourceId,
                rootItemId: rootId,
                includeRoot,
            }),
            message: "Root missing · outputs forced False",
            tone: "error",
        };
    }
    const count = snapshot.output_item_ids.length;
    return {
        sourceOptions,
        roots,
        snapshot,
        message: `Ready · ${count} Boolean output${count === 1 ? "" : "s"}`,
        tone: "ready",
    };
}

function syncGetNode(node) {
    if (!node?.graph || node._booleanHierarchyGetRemoved) return;
    const ui = ensureGetUI(node);
    const previousSnapshot = node._booleanHierarchyGetSnapshot
        || readStoredSnapshot(node);
    const state = resolveGetState(node, previousSnapshot);
    const sourceId = node.properties.boolean_get_source_node_id;
    const rootId = node.properties.boolean_get_root_item_id;

    replaceSelectOptions(
        ui.sourceSelect,
        state.sourceOptions,
        sourceId,
        "Select source…",
        `Source missing (#${sourceId})`
    );
    replaceSelectOptions(
        ui.rootSelect,
        state.roots,
        rootId,
        "Select root…",
        `Root missing (#${String(rootId).slice(0, 8)})`
    );
    ui.rootSelect.disabled = !resolveSourceNode(node.graph, sourceId);
    ui.includeRoot.checked = node.properties.boolean_get_include_root !== false;
    setStatus(ui, state.message, state.tone);

    const previousDescriptors = getSnapshotOutputDescriptors(previousSnapshot);
    const nextDescriptors = getSnapshotOutputDescriptors(state.snapshot);
    const previousStructure = JSON.stringify(
        previousDescriptors.map((item) => [item.key, item.label])
    );
    const nextStructure = JSON.stringify(
        nextDescriptors.map((item) => [item.key, item.label])
    );
    const previousEncoded = encodeGetSnapshot(previousSnapshot);
    const nextEncoded = encodeGetSnapshot(state.snapshot);
    const structureChanged = previousStructure !== nextStructure;
    const slotsChanged = !getOutputSlotsMatchDescriptors(
        node,
        nextDescriptors
    );
    const outputsChanged = structureChanged || slotsChanged;

    if (
        previousEncoded !== nextEncoded
        || !node._booleanHierarchyGetSnapshot
        || outputsChanged
    ) {
        if (outputsChanged) node.graph?.beforeChange?.();
        try {
            writeStoredSnapshot(node, state.snapshot);
            if (outputsChanged) {
                reconcileGetOutputSlots(
                    node,
                    previousDescriptors,
                    nextDescriptors
                );
            }
        } finally {
            if (outputsChanged) node.graph?.afterChange?.();
        }
        markDirty(node, outputsChanged);
    }
}

function runSync() {
    syncQueued = false;
    for (const node of Array.from(getNodes)) syncGetNode(node);
}

function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    setTimeout(runSync, 0);
}

function registerGetNode(node) {
    node._booleanHierarchyGetRemoved = false;
    getNodes.add(node);
    if (!pollTimer) pollTimer = setInterval(runSync, POLL_INTERVAL_MS);
    requestAnimationFrame(() => {
        syncGetNode(node);
        const computed = node.computeSize?.() || [DEFAULT_WIDTH, UI_HEIGHT + 30];
        const width = Math.max(node.size?.[0] || 0, DEFAULT_WIDTH);
        node.setSize?.([width, computed[1]]);
    });
}

function unregisterGetNode(node) {
    node._booleanHierarchyGetRemoved = true;
    getNodes.delete(node);
    if (!getNodes.size && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

app.registerExtension({
    name: EXTENSION_NAME,
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== HIERARCHY_GET_NODE_TYPE) return;

        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            ensureProperties(this);
            hideConfigWidget(this);
            ensureGetUI(this);
        });
        chainCallback(nodeType.prototype, "onConfigure", function () {
            ensureProperties(this);
            hideConfigWidget(this);
            this._booleanHierarchyGetSnapshot = readStoredSnapshot(this);
            requestAnimationFrame(() => {
                ensureGetUI(this);
                queueSync();
            });
        });
        chainCallback(nodeType.prototype, "onAdded", function () {
            registerGetNode(this);
        });
        chainCallback(nodeType.prototype, "onRemoved", function () {
            unregisterGetNode(this);
            this._booleanHierarchyGetUI?.container?.remove();
            this._booleanHierarchyGetUI = null;
        });

        const originalOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            const result = originalOnResize?.apply(this, arguments);
            const width = Array.isArray(size) && Number.isFinite(size[0])
                ? size[0]
                : this.size?.[0];
            if (
                !this._booleanHierarchyGetAutoSizing
                && Number.isFinite(width)
                && width > 0
            ) {
                ensureProperties(this);
                this.properties.boolean_get_width = width;
            }
            return result;
        };

        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            originalGetExtraMenuOptions?.apply(this, arguments);
            options.unshift({
                content: "Refresh Hierarchy Get",
                callback: () => syncGetNode(this),
            });
        };
    },
});
