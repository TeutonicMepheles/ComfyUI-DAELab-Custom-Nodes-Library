import { app } from "/scripts/app.js";
// Comfy Desktop may retain extension modules across reloads. Keep this version
// aligned with named-export changes in the model to avoid a partial cache hit.
import {
    MAX_BOOLEAN_OUTPUTS,
    MAX_HIERARCHY_DEPTH,
    addChildItem,
    addRootItem,
    canIndentItem,
    cloneItems,
    createExclusiveGroup,
    deleteItemRequirements,
    deleteExclusiveGroup,
    deleteItem,
    encodeItems,
    getExclusiveGroups,
    getItemDepth,
    getSubtreeIds,
    indentItem,
    isChildDisabled,
    moveItem,
    normalizeItems,
    outdentItem,
    reconcileOutputSlots,
    setItemRequirements,
    updateExclusiveGroup,
    validateDependencySelection,
    validateExclusiveGroupSelection,
} from "./boolean_list_hierarchy_model.mjs?v=hierarchy-dependencies-1";

const NODE_NAME = "BooleanListHierarchy";
const WIDGET_NAME = "boolean_hierarchy_editor";
const CONFIG_WIDGET_NAME = "config_json";
const DEFAULT_WIDTH = 520;
const TOOLBAR_HEIGHT = 36;
const ROW_HEIGHT = 34;
const EXCLUSIVE_PANEL_HEIGHT = 220;
const DEPENDENCY_PANEL_HEIGHT = 260;

const ICONS = {
    addRoot: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    addChild: '<svg viewBox="0 0 24 24"><path d="M5 5v14h5"/><path d="M14 15h6M17 12v6"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    indent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M3 9l3 3-3 3"/></svg>',
    outdent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M6 9l-3 3 3 3"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>',
    exclusive: '<svg viewBox="0 0 24 24"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg>',
    dependencies: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h3a4 4 0 0 1 4 4M8 18h3a4 4 0 0 0 4-4"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3"/></svg>',
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

function storeItems(node, items, preferredItemId = null) {
    const normalized = normalizeItems(items, { preferredItemId });
    const encodedItems = encodeItems(normalized);
    node.properties = node.properties || {};
    node.properties.boolean_list_count = normalized.length;
    node.properties.boolean_list_items = encodedItems;
    node._booleanHierarchyItems = normalized;
    syncConfigWidget(node, encodedItems);
    return normalized;
}

function calculateEditorHeight(items, panelHeight = 0) {
    return TOOLBAR_HEIGHT
        + panelHeight
        + Math.max(1, items.length) * ROW_HEIGHT
        + 8;
}

function getOpenPanelHeight(node) {
    if (node._booleanHierarchyExclusivePanelOpen) return EXCLUSIVE_PANEL_HEIGHT;
    if (node._booleanHierarchyDependencyPanelOpen) return DEPENDENCY_PANEL_HEIGHT;
    return 0;
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

function commitItems(node, nextItems, options = {}) {
    const previousItems = node._booleanHierarchyItems || getStoredItems(node);
    const normalized = normalizeItems(nextItems, {
        preferredItemId: options.preferredItemId || null,
    });
    if (encodeItems(previousItems) === encodeItems(normalized)) return false;
    graphTransaction(node, () => {
        storeItems(node, normalized, options.preferredItemId || null);
        reconcileOutputSlots(node, previousItems, normalized);
        renderEditor(node);
        markDirty(node);
    });
    return true;
}

function mutateItems(node, transform, options = {}) {
    const currentItems = cloneItems(node._booleanHierarchyItems || getStoredItems(node));
    commitItems(node, transform(currentItems), options);
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

function setTextButtonDisabled(button, disabled) {
    button.disabled = disabled;
    button.style.opacity = disabled ? "0.35" : "1";
    button.style.cursor = disabled ? "not-allowed" : "pointer";
}

function createTextButton(label, callback, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = "height:24px;padding:2px 8px;border:1px solid #4b4b4b;border-radius:4px;" +
        "background:#2b2b2b;color:#d0d0d0;font-size:10px;cursor:pointer;white-space:nowrap;";
    setTextButtonDisabled(button, disabled);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!button.disabled) callback();
    });
    button.addEventListener("pointerdown", stopCanvasPropagation);
    button.addEventListener("pointerup", stopCanvasPropagation);
    return button;
}

function refreshEditorLayout(node) {
    renderEditor(node);
    markDirty(node);
}

function getScopeItems(items, parentId) {
    return items.filter((item) => (item.parent_id || null) === (parentId || null));
}

function getExclusiveScopeOptions(items) {
    const options = [];
    const roots = getScopeItems(items, null);
    if (roots.length >= 2) {
        options.push({ parent_id: null, label: "Root level", items: roots });
    }
    for (const parent of items) {
        const children = getScopeItems(items, parent.id);
        if (children.length >= 2) {
            options.push({
                parent_id: parent.id,
                label: `Children of ${parent.label}`,
                items: children,
            });
        }
    }
    return options;
}

function renderExclusivePanel(node, items) {
    const panel = document.createElement("div");
    panel.style.cssText = `height:${EXCLUSIVE_PANEL_HEIGHT}px;max-height:${EXCLUSIVE_PANEL_HEIGHT}px;overflow-y:auto;` +
        "padding:7px;box-sizing:border-box;border-top:1px solid #404040;border-bottom:1px solid #404040;" +
        "background:#202020;";

    const groups = getExclusiveGroups(items);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    const title = document.createElement("strong");
    title.textContent = "Exclusive groups";
    title.style.cssText = "font-size:11px;color:#ddd;";
    header.appendChild(title);
    header.appendChild(createTextButton("New group", () => {
        const firstScope = getExclusiveScopeOptions(items)[0];
        node._booleanHierarchyGroupEditor = {
            mode: "create",
            groupId: null,
            parentId: firstScope?.parent_id || null,
            selectedIds: [],
        };
        refreshEditorLayout(node);
    }, getExclusiveScopeOptions(items).length === 0));
    panel.appendChild(header);

    if (!groups.length) {
        const empty = document.createElement("div");
        empty.textContent = "No exclusive groups configured.";
        empty.style.cssText = "font-size:10px;color:#888;margin:4px 0 7px;";
        panel.appendChild(empty);
    }

    for (const group of groups) {
        const groupRow = document.createElement("div");
        groupRow.style.cssText = "display:flex;align-items:center;gap:5px;min-height:28px;padding:3px 5px;" +
            "margin-bottom:4px;border:1px solid #3d4f61;border-radius:4px;background:#1d2a35;";
        const labels = group.member_ids
            .map((itemId) => itemById.get(itemId)?.label)
            .filter(Boolean);
        const summary = document.createElement("span");
        summary.textContent = labels.join("  /  ");
        summary.title = labels.join(" / ");
        summary.style.cssText = "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
            "font-size:10px;color:#b9d5ee;";
        groupRow.appendChild(summary);
        groupRow.appendChild(createIconButton(ICONS.edit, "Edit exclusive group", () => {
            node._booleanHierarchyGroupEditor = {
                mode: "edit",
                groupId: group.id,
                parentId: group.parent_id,
                selectedIds: [...group.member_ids],
            };
            refreshEditorLayout(node);
        }));
        groupRow.appendChild(createIconButton(ICONS.remove, "Delete exclusive group", () => {
            if (node._booleanHierarchyGroupEditor?.groupId === group.id) {
                node._booleanHierarchyGroupEditor = null;
            }
            mutateItems(node, (nextItems) => deleteExclusiveGroup(nextItems, group.id));
        }));
        panel.appendChild(groupRow);
    }

    let editor = node._booleanHierarchyGroupEditor;
    if (editor?.mode === "edit" && !groups.some((group) => group.id === editor.groupId)) {
        node._booleanHierarchyGroupEditor = null;
        editor = null;
    }
    if (!editor) return panel;

    const form = document.createElement("div");
    form.style.cssText = "margin-top:7px;padding:7px;border:1px solid #4a4a4a;border-radius:4px;background:#191919;";
    const formTitle = document.createElement("div");
    formTitle.textContent = editor.mode === "edit" ? "Edit group" : "Create group";
    formTitle.style.cssText = "font-size:11px;color:#ddd;margin-bottom:6px;";
    form.appendChild(formTitle);

    const scopes = getExclusiveScopeOptions(items);
    if (editor.mode === "create") {
        const scopeSelect = document.createElement("select");
        scopeSelect.setAttribute("aria-label", "Exclusive group scope");
        scopeSelect.style.cssText = "width:100%;height:25px;margin-bottom:6px;border:1px solid #444;border-radius:4px;" +
            "background:#222;color:#ddd;font-size:10px;";
        for (const scope of scopes) {
            const option = document.createElement("option");
            option.value = scope.parent_id || "__root__";
            option.textContent = scope.label;
            option.selected = (scope.parent_id || null) === (editor.parentId || null);
            scopeSelect.appendChild(option);
        }
        scopeSelect.addEventListener("change", () => {
            editor.parentId = scopeSelect.value === "__root__" ? null : scopeSelect.value;
            editor.selectedIds = [];
            refreshEditorLayout(node);
        });
        form.appendChild(scopeSelect);
    } else {
        const parent = editor.parentId ? itemById.get(editor.parentId) : null;
        const scopeLabel = document.createElement("div");
        scopeLabel.textContent = parent ? `Children of ${parent.label}` : "Root level";
        scopeLabel.style.cssText = "font-size:10px;color:#999;margin-bottom:6px;";
        form.appendChild(scopeLabel);
    }

    const candidates = getScopeItems(items, editor.parentId);
    const selectedIds = new Set(editor.selectedIds);
    let saveButton = null;
    const checklist = document.createElement("div");
    checklist.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin-bottom:7px;";
    for (const candidate of candidates) {
        const occupiedByOther = Boolean(
            candidate.exclusive_group_id
            && candidate.exclusive_group_id !== editor.groupId
        );
        const optionLabel = document.createElement("label");
        optionLabel.title = occupiedByOther ? "Already belongs to another exclusive group" : candidate.label;
        optionLabel.style.cssText = "display:flex;align-items:center;gap:4px;min-width:0;font-size:10px;color:#bbb;" +
            (occupiedByOther ? "opacity:.4;" : "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedIds.has(candidate.id);
        checkbox.disabled = occupiedByOther;
        checkbox.style.cssText = "width:14px;height:14px;margin:0;accent-color:#6ca0dc;";
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedIds.add(candidate.id);
            else selectedIds.delete(candidate.id);
            editor.selectedIds = [...selectedIds];
            editor.error = "";
            if (saveButton) setTextButtonDisabled(saveButton, selectedIds.size < 2);
        });
        const label = document.createElement("span");
        label.textContent = candidate.label;
        label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        optionLabel.append(checkbox, label);
        checklist.appendChild(optionLabel);
    }
    form.appendChild(checklist);

    if (editor.error) {
        const error = document.createElement("div");
        error.textContent = editor.error;
        error.style.cssText = "margin-bottom:6px;color:#ef9a9a;font-size:10px;";
        form.appendChild(error);
    }

    const formActions = document.createElement("div");
    formActions.style.cssText = "display:flex;justify-content:flex-end;gap:5px;";
    formActions.appendChild(createTextButton("Cancel", () => {
        node._booleanHierarchyGroupEditor = null;
        refreshEditorLayout(node);
    }));
    const canSave = selectedIds.size >= 2;
    saveButton = createTextButton("Save", () => {
        const selected = [...selectedIds];
        const mode = editor.mode;
        const groupId = editor.groupId;
        const validation = validateExclusiveGroupSelection(items, groupId, selected);
        if (!validation.valid) {
            editor.error = validation.message;
            refreshEditorLayout(node);
            return;
        }
        node._booleanHierarchyGroupEditor = null;
        if (mode === "edit") {
            mutateItems(node, (nextItems) => updateExclusiveGroup(nextItems, groupId, selected));
        } else {
            mutateItems(node, (nextItems) => createExclusiveGroup(nextItems, selected));
        }
    }, !canSave);
    formActions.appendChild(saveButton);
    form.appendChild(formActions);
    panel.appendChild(form);
    return panel;
}

function getItemPath(items, itemId) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const labels = [];
    const visited = new Set();
    let item = byId.get(itemId);
    while (item && !visited.has(item.id)) {
        visited.add(item.id);
        labels.unshift(item.label);
        item = item.parent_id ? byId.get(item.parent_id) : null;
    }
    return labels.join(" / ");
}

function renderDependencyPanel(node, items) {
    const panel = document.createElement("div");
    panel.style.cssText = `height:${DEPENDENCY_PANEL_HEIGHT}px;max-height:${DEPENDENCY_PANEL_HEIGHT}px;overflow-y:auto;` +
        "padding:7px;box-sizing:border-box;border-top:1px solid #404040;border-bottom:1px solid #404040;" +
        "background:#202020;";

    const rules = items.filter((item) => item.requires_ids?.length);
    const availableDependents = items.filter((item) => !item.requires_ids?.length);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    const title = document.createElement("strong");
    title.textContent = "Dependencies";
    title.style.cssText = "font-size:11px;color:#ddd;";
    header.appendChild(title);
    header.appendChild(createTextButton("New dependency", () => {
        node._booleanHierarchyDependencyEditor = {
            mode: "create",
            dependentId: availableDependents[0]?.id || "",
            selectedIds: [],
            error: "",
        };
        refreshEditorLayout(node);
    }, items.length < 2 || availableDependents.length === 0));
    panel.appendChild(header);

    if (!rules.length) {
        const empty = document.createElement("div");
        empty.textContent = "No cross-branch dependencies configured.";
        empty.style.cssText = "font-size:10px;color:#888;margin:4px 0 7px;";
        panel.appendChild(empty);
    }

    for (const dependent of rules) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:5px;min-height:28px;padding:3px 5px;" +
            "margin-bottom:4px;border:1px solid #5b4e72;border-radius:4px;background:#292237;";
        const requirements = dependent.requires_ids
            .map((requiredId) => itemById.get(requiredId)?.label)
            .filter(Boolean);
        const summary = document.createElement("span");
        summary.textContent = `${dependent.label} \u2190 ${requirements.join(" + ")}`;
        summary.title = `${getItemPath(items, dependent.id)} requires ${requirements.join(" + ")}`;
        summary.style.cssText = "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
            "font-size:10px;color:#d8c7f0;";
        row.appendChild(summary);
        row.appendChild(createIconButton(ICONS.edit, "Edit dependency", () => {
            node._booleanHierarchyDependencyEditor = {
                mode: "edit",
                dependentId: dependent.id,
                selectedIds: [...dependent.requires_ids],
                error: "",
            };
            refreshEditorLayout(node);
        }));
        row.appendChild(createIconButton(ICONS.remove, "Delete dependency", () => {
            if (node._booleanHierarchyDependencyEditor?.dependentId === dependent.id) {
                node._booleanHierarchyDependencyEditor = null;
            }
            mutateItems(node, (nextItems) => deleteItemRequirements(nextItems, dependent.id));
        }));
        panel.appendChild(row);
    }

    let editor = node._booleanHierarchyDependencyEditor;
    if (editor && !itemById.has(editor.dependentId)) {
        node._booleanHierarchyDependencyEditor = null;
        editor = null;
    }
    if (!editor) return panel;

    const form = document.createElement("div");
    form.style.cssText = "margin-top:7px;padding:7px;border:1px solid #4a4a4a;border-radius:4px;background:#191919;";
    const formTitle = document.createElement("div");
    formTitle.textContent = editor.mode === "edit" ? "Edit dependency" : "Create dependency";
    formTitle.style.cssText = "font-size:11px;color:#ddd;margin-bottom:6px;";
    form.appendChild(formTitle);

    if (editor.mode === "create") {
        const dependentSelect = document.createElement("select");
        dependentSelect.setAttribute("aria-label", "Dependent Boolean");
        dependentSelect.style.cssText = "width:100%;height:25px;margin-bottom:6px;border:1px solid #444;border-radius:4px;" +
            "background:#222;color:#ddd;font-size:10px;";
        for (const item of availableDependents) {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = getItemPath(items, item.id);
            option.selected = item.id === editor.dependentId;
            dependentSelect.appendChild(option);
        }
        dependentSelect.addEventListener("change", () => {
            editor.dependentId = dependentSelect.value;
            editor.selectedIds = [];
            editor.error = "";
            refreshEditorLayout(node);
        });
        form.appendChild(dependentSelect);
    } else {
        const dependentLabel = document.createElement("div");
        dependentLabel.textContent = getItemPath(items, editor.dependentId);
        dependentLabel.style.cssText = "font-size:10px;color:#aaa;margin-bottom:6px;";
        form.appendChild(dependentLabel);
    }

    const selectedIds = new Set(editor.selectedIds);
    const checklist = document.createElement("div");
    checklist.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin-bottom:7px;";
    for (const candidate of items) {
        if (candidate.id === editor.dependentId) continue;
        const checked = selectedIds.has(candidate.id);
        const trialIds = checked
            ? [...selectedIds]
            : [...selectedIds, candidate.id];
        const validation = validateDependencySelection(
            items,
            editor.dependentId,
            trialIds
        );
        const unavailable = !checked && !validation.valid;
        const optionLabel = document.createElement("label");
        optionLabel.title = unavailable
            ? validation.message
            : getItemPath(items, candidate.id);
        optionLabel.style.cssText = "display:flex;align-items:center;gap:4px;min-width:0;font-size:10px;color:#bbb;" +
            (unavailable ? "opacity:.4;" : "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.disabled = unavailable;
        checkbox.style.cssText = "width:14px;height:14px;margin:0;accent-color:#8d6cc7;";
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedIds.add(candidate.id);
            else selectedIds.delete(candidate.id);
            editor.selectedIds = [...selectedIds];
            editor.error = "";
            refreshEditorLayout(node);
        });
        const label = document.createElement("span");
        label.textContent = getItemPath(items, candidate.id);
        label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        optionLabel.append(checkbox, label);
        checklist.appendChild(optionLabel);
    }
    form.appendChild(checklist);

    if (editor.error) {
        const error = document.createElement("div");
        error.textContent = editor.error;
        error.style.cssText = "margin-bottom:6px;color:#ef9a9a;font-size:10px;";
        form.appendChild(error);
    }

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:5px;";
    actions.appendChild(createTextButton("Cancel", () => {
        node._booleanHierarchyDependencyEditor = null;
        refreshEditorLayout(node);
    }));
    actions.appendChild(createTextButton("Save", () => {
        const validation = validateDependencySelection(
            items,
            editor.dependentId,
            [...selectedIds]
        );
        if (!validation.valid) {
            editor.error = validation.message;
            refreshEditorLayout(node);
            return;
        }
        const dependentId = editor.dependentId;
        node._booleanHierarchyDependencyEditor = null;
        mutateItems(node, (nextItems) => setItemRequirements(
            nextItems,
            dependentId,
            validation.requires_ids
        ));
    }, selectedIds.size < 1));
    form.appendChild(actions);
    panel.appendChild(form);
    return panel;
}

function makeRow(node, item, index, items) {
    const row = document.createElement("div");
    const depth = getItemDepth(items, item);
    const isDescendant = depth > 0;
    row.dataset.itemId = item.id;
    row.style.cssText = "height:34px;display:grid;grid-template-columns:20px 22px minmax(90px,1fr) auto;" +
        "align-items:center;gap:5px;padding:4px 6px;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.07);" +
        `padding-left:${6 + Math.max(depth, 0) * 12}px;` +
        (isDescendant ? "background:rgba(255,255,255,.018);" : "background:rgba(255,255,255,.035);");

    const treeMark = document.createElement("span");
    const roots = items.filter((candidate) => !candidate.parent_id);
    const rootPosition = roots.findIndex((candidate) => candidate.id === item.id);
    treeMark.textContent = depth === 0
        ? String(rootPosition + 1).padStart(2, "0")
        : depth === 1 ? "└" : "·└";
    treeMark.style.cssText = "font-size:10px;color:#858585;text-align:center;user-select:none;";
    row.appendChild(treeMark);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(item.value);
    toggle.disabled = isChildDisabled(items, item);
    const requiredItems = (item.requires_ids || [])
        .map((requiredId) => items.find((candidate) => candidate.id === requiredId))
        .filter(Boolean);
    const unmetRequirements = requiredItems.filter((required) => !required.value);
    toggle.title = toggle.disabled
        ? "Parent is disabled"
        : unmetRequirements.length
            ? `Enabling also enables: ${unmetRequirements.map((required) => required.label).join(" + ")}`
            : item.label;
    toggle.setAttribute("aria-label", `${item.label} value`);
    toggle.style.cssText = "width:16px;height:16px;margin:0;accent-color:#6ca0dc;cursor:pointer;";
    if (toggle.disabled) toggle.style.cursor = "not-allowed";
    toggle.addEventListener("change", () => {
        mutateItems(node, (nextItems) => {
            const target = nextItems.find((candidate) => candidate.id === item.id);
            if (target) target.value = toggle.checked;
            return nextItems;
        }, { preferredItemId: toggle.checked ? item.id : null });
    });
    row.appendChild(toggle);

    const labelCell = document.createElement("div");
    labelCell.style.cssText = "min-width:0;display:flex;align-items:center;gap:4px;";
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
    labelCell.appendChild(labelInput);
    if (item.exclusive_group_id) {
        const memberLabels = items
            .filter((candidate) => candidate.exclusive_group_id === item.exclusive_group_id)
            .map((candidate) => candidate.label);
        const badge = document.createElement("span");
        badge.textContent = "EX";
        badge.title = `Exclusive group: ${memberLabels.join(" / ")}`;
        badge.style.cssText = "flex:0 0 auto;padding:2px 4px;border:1px solid #52789b;border-radius:3px;" +
            "background:#20384d;color:#b9d9f5;font-size:8px;font-weight:700;line-height:12px;user-select:none;";
        labelCell.appendChild(badge);
    }
    if (item.requires_ids?.length) {
        const badge = document.createElement("span");
        badge.textContent = "REQ";
        badge.title = `Requires: ${requiredItems.map((required) => required.label).join(" + ")}`;
        badge.style.cssText = "flex:0 0 auto;padding:2px 4px;border:1px solid #8067a5;border-radius:3px;" +
            "background:#35284a;color:#ddcaf7;font-size:8px;font-weight:700;line-height:12px;user-select:none;";
        labelCell.appendChild(badge);
    }
    row.appendChild(labelCell);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:3px;align-items:center;justify-content:flex-end;";
    const parentId = item.parent_id || null;
    const siblings = items.filter(
        (candidate) => (candidate.parent_id || null) === parentId
    );
    const siblingPosition = siblings.findIndex((candidate) => candidate.id === item.id);
    const subtreeIds = getSubtreeIds(items, item.id);
    const canDelete = items.length - subtreeIds.size >= 1;
    const canAddChild = depth >= 0
        && depth < MAX_HIERARCHY_DEPTH
        && items.length < MAX_BOOLEAN_OUTPUTS;

    if (depth < MAX_HIERARCHY_DEPTH) {
        actions.appendChild(createIconButton(ICONS.addChild, "Add child", () => {
            mutateItems(node, (nextItems) => addChildItem(nextItems, item.id));
        }, !canAddChild));
    }
    actions.appendChild(createIconButton(ICONS.up, "Move up", () => {
        mutateItems(node, (nextItems) => moveItem(nextItems, item.id, "up"));
    }, siblingPosition <= 0));
    actions.appendChild(createIconButton(ICONS.down, "Move down", () => {
        mutateItems(node, (nextItems) => moveItem(nextItems, item.id, "down"));
    }, siblingPosition < 0 || siblingPosition >= siblings.length - 1));
    if (depth < MAX_HIERARCHY_DEPTH) {
        const indentDisabled = !canIndentItem(items, item.id);
        const indentLabel = indentDisabled
            ? "Cannot indent at the current position or depth"
            : "Indent under previous sibling";
        actions.appendChild(createIconButton(ICONS.indent, indentLabel, () => {
            mutateItems(node, (nextItems) => indentItem(nextItems, item.id));
        }, indentDisabled));
    }
    if (isDescendant) {
        actions.appendChild(createIconButton(ICONS.outdent, "Promote one level", () => {
            mutateItems(node, (nextItems) => outdentItem(nextItems, item.id));
        }));
    }
    const deleteLabel = subtreeIds.size > 1 ? "Delete Boolean subtree" : "Delete Boolean";
    actions.appendChild(createIconButton(ICONS.remove, deleteLabel, () => {
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
        getMinHeight: () => node._booleanHierarchyHeight || calculateEditorHeight(
            getStoredItems(node),
            getOpenPanelHeight(node)
        ),
        getHeight: () => node._booleanHierarchyHeight || calculateEditorHeight(
            getStoredItems(node),
            getOpenPanelHeight(node)
        ),
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
    toolbar.appendChild(createToolbarButton(ICONS.exclusive, "Exclusive groups", () => {
        node._booleanHierarchyExclusivePanelOpen = !node._booleanHierarchyExclusivePanelOpen;
        node._booleanHierarchyDependencyPanelOpen = false;
        node._booleanHierarchyDependencyEditor = null;
        if (!node._booleanHierarchyExclusivePanelOpen) {
            node._booleanHierarchyGroupEditor = null;
        }
        refreshEditorLayout(node);
    }, false));
    toolbar.appendChild(createToolbarButton(ICONS.dependencies, "Dependencies", () => {
        node._booleanHierarchyDependencyPanelOpen = !node._booleanHierarchyDependencyPanelOpen;
        node._booleanHierarchyExclusivePanelOpen = false;
        node._booleanHierarchyGroupEditor = null;
        if (!node._booleanHierarchyDependencyPanelOpen) {
            node._booleanHierarchyDependencyEditor = null;
        }
        refreshEditorLayout(node);
    }, false));
    const count = document.createElement("span");
    count.textContent = `${items.length}/${MAX_BOOLEAN_OUTPUTS}`;
    count.style.cssText = "font-size:10px;color:#888;margin-left:auto;";
    toolbar.appendChild(count);
    fragment.appendChild(toolbar);
    if (node._booleanHierarchyExclusivePanelOpen) {
        fragment.appendChild(renderExclusivePanel(node, items));
    } else if (node._booleanHierarchyDependencyPanelOpen) {
        fragment.appendChild(renderDependencyPanel(node, items));
    }

    items.forEach((item, index) => fragment.appendChild(makeRow(node, item, index, items)));
    container.replaceChildren(fragment);
    node._booleanHierarchyHeight = calculateEditorHeight(
        items,
        getOpenPanelHeight(node)
    );
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
            this._booleanHierarchyGroupEditor = null;
            this._booleanHierarchyDependencyEditor = null;
            this._booleanHierarchyExclusivePanelOpen = false;
            this._booleanHierarchyDependencyPanelOpen = false;
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
