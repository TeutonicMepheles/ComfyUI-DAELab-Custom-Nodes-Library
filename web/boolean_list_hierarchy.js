import { app } from "/scripts/app.js";
import {
    MAX_BOOLEAN_OUTPUTS,
    addChildItem,
    addRootItem,
    applyParentCascade,
    cloneItems,
    deleteItem,
    encodeItems,
    hasChildren,
    indentItem,
    isChildDisabled,
    moveItem,
    normalizeItems,
    outdentItem,
    reconcileOutputSlots,
} from "./boolean_list_hierarchy_model.mjs";

const NODE_NAME = "BooleanListHierarchy";
const WIDGET_NAME = "boolean_hierarchy_editor";
const CONFIG_WIDGET_NAME = "config_json";
const DEFAULT_WIDTH = 520;
const TOOLBAR_HEIGHT = 36;
const ROW_HEIGHT = 34;

const ICONS = {
    addRoot: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    addChild: '<svg viewBox="0 0 24 24"><path d="M5 5v14h5"/><path d="M14 15h6M17 12v6"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    indent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M3 9l3 3-3 3"/></svg>',
    outdent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M6 9l-3 3 3 3"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>',
};

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

function getStoredItems(node) {
    node.properties = node.properties || {};
    const configWidget = (node.widgets || []).find((widget) => widget.name === CONFIG_WIDGET_NAME);
    const source = node.properties.boolean_list_items
        || (configWidget ? configWidget.value : null)
        || (node.widgets_values ? node.widgets_values[0] : null);
    return normalizeItems(source);
}

function syncConfigWidget(node, encodedItems) {
    const widget = (node.widgets || []).find((candidate) => candidate.name === CONFIG_WIDGET_NAME);
    if (!widget) return;

    widget.value = encodedItems;
    widget._booleanHierarchyConfig = true;
    widget.origType = widget.origType || widget.type;
    widget.origComputeSize = widget.origComputeSize || widget.computeSize;
    widget.hidden = true;
    widget.type = "converted-widget";
    widget.serialize = true;
    widget.serializeValue = () => node.properties?.boolean_list_items || widget.value;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    widget.draw = () => {};
    for (const element of [widget.element, widget.inputEl]) {
        if (!element?.style) continue;
        element.style.display = "none";
        element.style.visibility = "hidden";
    }
}

function storeItems(node, items) {
    const normalized = applyParentCascade(normalizeItems(items));
    const encodedItems = encodeItems(normalized);
    node.properties = node.properties || {};
    node.properties.boolean_list_count = normalized.length;
    node.properties.boolean_list_items = encodedItems;
    node._booleanHierarchyItems = normalized;
    syncConfigWidget(node, encodedItems);
    return normalized;
}

function calculateEditorHeight(items) {
    return TOOLBAR_HEIGHT + Math.max(1, items.length) * ROW_HEIGHT + 8;
}

function markDirty(node) {
    if (node.setSize && node.computeSize) {
        const computedSize = node.computeSize();
        const currentWidth = Array.isArray(node.size) && Number.isFinite(node.size[0])
            ? node.size[0]
            : DEFAULT_WIDTH;
        const savedWidth = Number(node.properties?.boolean_list_width);
        const width = Number.isFinite(savedWidth) && savedWidth > 0
            ? savedWidth
            : Math.max(currentWidth, DEFAULT_WIDTH);
        node._booleanHierarchyAutoSizing = true;
        try {
            node.setSize([width, computedSize[1]]);
        } finally {
            node._booleanHierarchyAutoSizing = false;
        }
    }
    node.graph?.setDirtyCanvas(true, true);
    app.canvas?.setDirty(true, true);
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

function commitItems(node, nextItems) {
    const previousItems = node._booleanHierarchyItems || getStoredItems(node);
    const normalized = applyParentCascade(normalizeItems(nextItems));
    if (encodeItems(previousItems) === encodeItems(normalized)) return false;
    graphTransaction(node, () => {
        storeItems(node, normalized);
        reconcileOutputSlots(node, previousItems, normalized);
        renderEditor(node);
        markDirty(node);
    });
    return true;
}

function mutateItems(node, transform) {
    const currentItems = cloneItems(node._booleanHierarchyItems || getStoredItems(node));
    commitItems(node, transform(currentItems));
}

function createIconButton(icon, label, callback, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = disabled;
    button.innerHTML = icon;
    button.style.cssText = "width:24px;height:24px;padding:4px;display:inline-flex;align-items:center;justify-content:center;" +
        "border:1px solid #4b4b4b;border-radius:4px;background:#2b2b2b;color:#c9c9c9;cursor:pointer;box-sizing:border-box;";
    const svg = button.querySelector("svg");
    if (svg) {
        svg.setAttribute("width", "15");
        svg.setAttribute("height", "15");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
    }
    if (disabled) {
        button.style.opacity = "0.35";
        button.style.cursor = "not-allowed";
    } else {
        button.addEventListener("mouseenter", () => { button.style.background = "#3b3b3b"; });
        button.addEventListener("mouseleave", () => { button.style.background = "#2b2b2b"; });
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            callback();
        });
    }
    button.addEventListener("pointerdown", stopCanvasPropagation);
    button.addEventListener("pointerup", stopCanvasPropagation);
    return button;
}

function createToolbarButton(icon, label, callback, disabled) {
    const button = createIconButton(icon, label, callback, disabled);
    button.style.width = "auto";
    button.style.padding = "4px 8px";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:11px;margin-left:5px;white-space:nowrap;";
    button.appendChild(text);
    return button;
}

function makeRow(node, item, index, items) {
    const row = document.createElement("div");
    const isChild = Boolean(item.parent_id);
    row.dataset.itemId = item.id;
    row.style.cssText = "height:34px;display:grid;grid-template-columns:20px 22px minmax(90px,1fr) auto;" +
        "align-items:center;gap:5px;padding:4px 6px;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.07);" +
        (isChild ? "padding-left:18px;background:rgba(255,255,255,.018);" : "background:rgba(255,255,255,.035);");

    const treeMark = document.createElement("span");
    treeMark.textContent = isChild ? "└" : String(index + 1).padStart(2, "0");
    treeMark.style.cssText = "font-size:10px;color:#858585;text-align:center;user-select:none;";
    row.appendChild(treeMark);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(item.value);
    toggle.disabled = isChildDisabled(items, item);
    toggle.title = toggle.disabled ? "Parent is disabled" : item.label;
    toggle.setAttribute("aria-label", `${item.label} value`);
    toggle.style.cssText = "width:16px;height:16px;margin:0;accent-color:#6ca0dc;cursor:pointer;";
    if (toggle.disabled) toggle.style.cursor = "not-allowed";
    toggle.addEventListener("change", () => {
        mutateItems(node, (nextItems) => {
            const target = nextItems.find((candidate) => candidate.id === item.id);
            if (target) target.value = toggle.checked;
            return nextItems;
        });
    });
    row.appendChild(toggle);

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = item.label;
    labelInput.title = "Boolean label";
    labelInput.setAttribute("aria-label", `Label for Boolean ${index + 1}`);
    labelInput.style.cssText = "min-width:0;width:100%;height:24px;padding:2px 6px;box-sizing:border-box;" +
        "border:1px solid #444;border-radius:4px;background:#202020;color:#ddd;font-size:11px;outline:none;";
    labelInput.addEventListener("change", () => {
        mutateItems(node, (nextItems) => {
            const target = nextItems.find((candidate) => candidate.id === item.id);
            if (target) target.label = labelInput.value;
            return nextItems;
        });
    });
    labelInput.addEventListener("keydown", stopCanvasPropagation);
    row.appendChild(labelInput);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:3px;align-items:center;justify-content:flex-end;";
    const roots = items.filter((candidate) => !candidate.parent_id);
    const rootPosition = isChild ? -1 : roots.findIndex((candidate) => candidate.id === item.id);
    const siblings = isChild ? items.filter((candidate) => candidate.parent_id === item.parent_id) : [];
    const siblingPosition = isChild ? siblings.findIndex((candidate) => candidate.id === item.id) : -1;
    const itemHasChildren = !isChild && hasChildren(items, item.id);
    const canDelete = isChild || roots.length > 1;

    if (!isChild) {
        actions.appendChild(createIconButton(ICONS.addChild, "Add child", () => {
            mutateItems(node, (nextItems) => addChildItem(nextItems, item.id));
        }, items.length >= MAX_BOOLEAN_OUTPUTS));
    }
    actions.appendChild(createIconButton(ICONS.up, "Move up", () => {
        mutateItems(node, (nextItems) => moveItem(nextItems, item.id, "up"));
    }, isChild ? siblingPosition <= 0 : rootPosition <= 0));
    actions.appendChild(createIconButton(ICONS.down, "Move down", () => {
        mutateItems(node, (nextItems) => moveItem(nextItems, item.id, "down"));
    }, isChild ? siblingPosition < 0 || siblingPosition >= siblings.length - 1 : rootPosition < 0 || rootPosition >= roots.length - 1));
    if (isChild) {
        actions.appendChild(createIconButton(ICONS.outdent, "Promote to root", () => {
            mutateItems(node, (nextItems) => outdentItem(nextItems, item.id));
        }));
    } else {
        const indentDisabled = rootPosition <= 0 || itemHasChildren;
        const indentLabel = itemHasChildren ? "Cannot indent a parent with children" : "Indent under previous parent";
        actions.appendChild(createIconButton(ICONS.indent, indentLabel, () => {
            mutateItems(node, (nextItems) => indentItem(nextItems, item.id));
        }, indentDisabled));
    }
    actions.appendChild(createIconButton(ICONS.remove, isChild ? "Delete Boolean" : "Delete parent and children", () => {
        mutateItems(node, (nextItems) => deleteItem(nextItems, item.id));
    }, !canDelete));
    row.appendChild(actions);

    return row;
}

function ensureEditorWidget(node) {
    if (node._booleanHierarchyWidget && node._booleanHierarchyContainer) return;
    const container = document.createElement("div");
    container.style.cssText = "width:100%;box-sizing:border-box;overflow:hidden;border:1px solid #3b3b3b;" +
        "border-radius:5px;background:#181818;color:#ddd;font-family:Arial,sans-serif;";
    for (const eventName of ["pointerdown", "pointerup", "click", "dblclick", "contextmenu"]) {
        container.addEventListener(eventName, stopCanvasPropagation);
    }

    const widget = node.addDOMWidget(WIDGET_NAME, "custom", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => node._booleanHierarchyHeight || calculateEditorHeight(getStoredItems(node)),
        getHeight: () => node._booleanHierarchyHeight || calculateEditorHeight(getStoredItems(node)),
    });
    widget.serialize = false;
    widget.inputEl = container;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, node._booleanHierarchyHeight || TOOLBAR_HEIGHT + ROW_HEIGHT + 8];
    widget.computeLayoutSize = () => ({
        minHeight: node._booleanHierarchyHeight || TOOLBAR_HEIGHT + ROW_HEIGHT + 8,
        maxHeight: node._booleanHierarchyHeight || TOOLBAR_HEIGHT + ROW_HEIGHT + 8,
        minWidth: 360,
    });
    node._booleanHierarchyWidget = widget;
    node._booleanHierarchyContainer = container;
}

function renderEditor(node) {
    ensureEditorWidget(node);
    const items = node._booleanHierarchyItems || getStoredItems(node);
    const container = node._booleanHierarchyContainer;
    const fragment = document.createDocumentFragment();

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "height:36px;display:flex;align-items:center;justify-content:space-between;gap:6px;" +
        "padding:5px 6px;box-sizing:border-box;background:#242424;";
    toolbar.appendChild(createToolbarButton(ICONS.addRoot, "Add root", () => {
        mutateItems(node, (nextItems) => addRootItem(nextItems));
    }, items.length >= MAX_BOOLEAN_OUTPUTS));
    const count = document.createElement("span");
    count.textContent = `${items.length}/${MAX_BOOLEAN_OUTPUTS}`;
    count.style.cssText = "font-size:10px;color:#888;margin-left:auto;";
    toolbar.appendChild(count);
    fragment.appendChild(toolbar);

    items.forEach((item, index) => fragment.appendChild(makeRow(node, item, index, items)));
    container.replaceChildren(fragment);
    node._booleanHierarchyHeight = calculateEditorHeight(items);
    container.style.height = `${node._booleanHierarchyHeight}px`;
}

function initializeNode(node) {
    const loadedItems = getStoredItems(node);
    const previousItems = node._booleanHierarchyItems || loadedItems;
    const items = storeItems(node, loadedItems);
    reconcileOutputSlots(node, previousItems, items);
    renderEditor(node);
    markDirty(node);
}

function scheduleInitialize(node) {
    if (node._booleanHierarchyFrame) cancelAnimationFrame(node._booleanHierarchyFrame);
    node._booleanHierarchyFrame = requestAnimationFrame(() => {
        node._booleanHierarchyFrame = null;
        initializeNode(node);
    });
}

app.registerExtension({
    name: "BooleanListHierarchy.DynamicOutputs",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            this.properties = this.properties || {};
            scheduleInitialize(this);
        });
        chainCallback(nodeType.prototype, "onConfigure", function () {
            scheduleInitialize(this);
        });
        chainCallback(nodeType.prototype, "onAdded", function () {
            scheduleInitialize(this);
        });
        chainCallback(nodeType.prototype, "onRemoved", function () {
            if (this._booleanHierarchyFrame) cancelAnimationFrame(this._booleanHierarchyFrame);
            this._booleanHierarchyContainer?.remove();
            this._booleanHierarchyFrame = null;
            this._booleanHierarchyWidget = null;
            this._booleanHierarchyContainer = null;
        });

        const originalOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            const result = originalOnResize?.apply(this, arguments);
            const width = Array.isArray(size) && Number.isFinite(size[0]) ? size[0] : this.size?.[0];
            if (!this._booleanHierarchyAutoSizing && Number.isFinite(width) && width > 0) {
                this.properties = this.properties || {};
                this.properties.boolean_list_width = width;
            }
            return result;
        };

        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            originalGetExtraMenuOptions?.apply(this, arguments);
            options.unshift(
                {
                    content: "Add Root Boolean",
                    disabled: (this._booleanHierarchyItems || getStoredItems(this)).length >= MAX_BOOLEAN_OUTPUTS,
                    callback: () => mutateItems(this, (items) => addRootItem(items)),
                },
                {
                    content: "Refresh Hierarchy UI",
                    callback: () => initializeNode(this),
                }
            );
        };
    },
});
