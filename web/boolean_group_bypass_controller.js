import { app } from "/scripts/app.js";
import {
    CONTROLLER_NODE_TYPE,
    MODE_ACTIVE,
    applyModeToNodes,
    buildGroupOptions,
    collectControllableNodes,
    desiredMode,
    findPlanConflicts,
    getGroupChildren,
    getGroupId,
    resolveBooleanSource,
    resolveGroup,
} from "./boolean_group_bypass_controller_model.mjs";

const EXTENSION_NAME = "DAELab.BooleanGroupBypassController";
const WIDGET_NAME = "boolean_group_bypass_controller_ui";
const POLL_INTERVAL_MS = 100;
const DEFAULT_WIDTH = 380;
const UI_HEIGHT = 178;

const controllers = new Set();
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

function markGraphChanged(node) {
    const graph = node.graph;
    if (graph && typeof graph._version === "number") graph._version += 1;
    graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
}

function setControllerProperty(node, key, value) {
    node.properties = node.properties || {};
    if (node.properties[key] === value) return;
    const graph = node.graph;
    graph?.beforeChange?.();
    try {
        node.properties[key] = value;
        if (graph && typeof graph._version === "number") graph._version += 1;
    } finally {
        graph?.afterChange?.();
    }
    graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    queueSync();
}

function setTemporaryNotice(node, text, tone = "error") {
    node._booleanGroupNotice = {
        text,
        tone,
        until: Date.now() + 2600,
    };
    queueSync();
}

function createElement(tag, style = "") {
    const element = document.createElement(tag);
    if (style) element.style.cssText = style;
    return element;
}

function ensureControllerProperties(node) {
    node.properties = node.properties || {};
    if (node.properties.target_group_id == null) node.properties.target_group_id = "";
    node.properties.target_group_id = String(node.properties.target_group_id || "");
    node.properties.invert = Boolean(node.properties.invert);
}

function bindContainingGroup(node) {
    const containing = [];
    for (const option of buildGroupOptions(node.graph)) {
        option.group.recomputeInsideNodes?.();
        if (getGroupChildren(option.group).includes(node)) containing.push(option);
    }
    if (containing.length === 1) {
        setControllerProperty(node, "target_group_id", containing[0].id);
        setTemporaryNotice(node, `已绑定：${containing[0].label}`, "active");
    } else if (containing.length === 0) {
        setTemporaryNotice(node, "控制器当前不在任何节点组内");
    } else {
        setTemporaryNotice(node, "控制器位于多个重叠组内，请使用下拉框选择");
    }
}

function ensureControllerUI(node) {
    if (node._booleanGroupControllerUI) return node._booleanGroupControllerUI;
    ensureControllerProperties(node);

    const container = createElement(
        "div",
        "width:100%;height:178px;box-sizing:border-box;padding:9px;display:flex;flex-direction:column;gap:7px;" +
        "border:1px solid #404040;border-radius:6px;background:#191919;color:#ddd;font:12px Arial,sans-serif;overflow:hidden;"
    );
    for (const eventName of ["pointerdown", "pointerup", "click", "dblclick", "contextmenu", "keydown"]) {
        container.addEventListener(eventName, stopCanvasPropagation);
    }

    const source = createElement("div", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aaa;");
    source.textContent = "来源：等待连接";
    container.appendChild(source);

    const groupRow = createElement("div", "display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;");
    const select = createElement(
        "select",
        "min-width:0;width:100%;height:28px;padding:2px 6px;border:1px solid #4a4a4a;border-radius:4px;" +
        "background:#242424;color:#ddd;outline:none;"
    );
    select.setAttribute("aria-label", "目标组");
    select.addEventListener("change", () => setControllerProperty(node, "target_group_id", select.value));
    groupRow.appendChild(select);

    const bindButton = createElement(
        "button",
        "height:28px;padding:0 9px;border:1px solid #4a4a4a;border-radius:4px;background:#2b2b2b;color:#ddd;cursor:pointer;"
    );
    bindButton.type = "button";
    bindButton.textContent = "绑定所在组";
    bindButton.title = "将控制器绑定到它当前所在的唯一节点组";
    bindButton.addEventListener("click", (event) => {
        event.preventDefault();
        bindContainingGroup(node);
    });
    groupRow.appendChild(bindButton);
    container.appendChild(groupRow);

    const logicRow = createElement("label", "display:flex;align-items:center;gap:7px;color:#cfcfcf;cursor:pointer;");
    const invert = createElement("input");
    invert.type = "checkbox";
    invert.checked = node.properties.invert;
    invert.style.cssText = "width:16px;height:16px;margin:0;accent-color:#6ca0dc;";
    invert.addEventListener("change", () => setControllerProperty(node, "invert", invert.checked));
    logicRow.appendChild(invert);
    const invertText = createElement("span");
    invertText.textContent = "反向逻辑";
    logicRow.appendChild(invertText);
    container.appendChild(logicRow);

    const mapping = createElement("div", "font-size:11px;color:#8e8e8e;");
    container.appendChild(mapping);

    const status = createElement(
        "div",
        "margin-top:auto;height:30px;padding:0 9px;display:flex;align-items:center;border:1px solid #555;border-radius:5px;" +
        "background:#2a2a2a;color:#bbb;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    );
    status.textContent = "等待绑定";
    container.appendChild(status);

    const widget = node.addDOMWidget(WIDGET_NAME, "custom", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => UI_HEIGHT,
        getHeight: () => UI_HEIGHT,
    });
    widget.serialize = false;
    widget.inputEl = container;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, UI_HEIGHT];
    widget.computeLayoutSize = () => ({ minHeight: UI_HEIGHT, maxHeight: UI_HEIGHT, minWidth: 330 });

    node._booleanGroupControllerUI = {
        container,
        source,
        select,
        invert,
        mapping,
        status,
        optionsSignature: null,
    };
    requestAnimationFrame(() => {
        const computed = node.computeSize?.() || [DEFAULT_WIDTH, UI_HEIGHT + 50];
        const width = Math.max(node.size?.[0] || 0, DEFAULT_WIDTH);
        node.setSize?.([width, computed[1]]);
        node.graph?.setDirtyCanvas?.(true, true);
    });
    return node._booleanGroupControllerUI;
}

function syncGroupOptions(node, ui) {
    const options = buildGroupOptions(node.graph);
    const targetId = String(node.properties?.target_group_id || "");
    const signature = JSON.stringify(options.map((option) => [option.id, option.label]));
    if (ui.optionsSignature !== signature || ui.select.dataset.targetId !== targetId) {
        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "选择目标节点组…";
        fragment.appendChild(placeholder);
        if (targetId && !options.some((option) => option.id === targetId)) {
            const missing = document.createElement("option");
            missing.value = targetId;
            missing.textContent = `目标组不存在 (#${targetId})`;
            fragment.appendChild(missing);
        }
        for (const option of options) {
            const element = document.createElement("option");
            element.value = option.id;
            element.textContent = option.label;
            fragment.appendChild(element);
        }
        ui.select.replaceChildren(fragment);
        ui.select.value = targetId;
        ui.select.dataset.targetId = targetId;
        ui.optionsSignature = signature;
    }
    return options;
}

function setStatus(ui, text, tone) {
    const palette = {
        active: ["#163d28", "#3d9b63", "#8ee0ad"],
        bypass: ["#493016", "#b8752c", "#ffc071"],
        error: ["#481e1e", "#b64b4b", "#ff9a9a"],
        idle: ["#292929", "#565656", "#b8b8b8"],
    }[tone] || ["#292929", "#565656", "#b8b8b8"];
    ui.status.textContent = text;
    ui.status.title = text;
    ui.status.style.background = palette[0];
    ui.status.style.borderColor = palette[1];
    ui.status.style.color = palette[2];
}

function updateControllerUI(node, state) {
    const ui = ensureControllerUI(node);
    ensureControllerProperties(node);
    syncGroupOptions(node, ui);
    ui.invert.checked = Boolean(node.properties.invert);
    ui.mapping.textContent = node.properties.invert
        ? "映射：Bool ON → BYPASS · Bool OFF → ACTIVE"
        : "映射：Bool ON → ACTIVE · Bool OFF → BYPASS";
    ui.source.textContent = state.sourceText || "来源：等待连接";
    ui.source.title = ui.source.textContent;

    const notice = node._booleanGroupNotice;
    if (notice && notice.until > Date.now()) {
        setStatus(ui, notice.text, notice.tone);
    } else {
        node._booleanGroupNotice = null;
        setStatus(ui, state.message, state.tone);
    }
}

function resolveControllerPlan(controller) {
    ensureControllerProperties(controller);
    const source = resolveBooleanSource(controller);
    const sourceText = source.ok
        ? `来源：${source.sourceLabel} / ${source.itemLabel}`
        : "来源：等待有效连接";
    if (!source.ok) {
        return { valid: false, sourceText, message: source.message, tone: source.code === "unconnected" ? "idle" : "error" };
    }

    const targetId = String(controller.properties.target_group_id || "");
    if (!targetId) {
        return { valid: false, sourceText, message: "请选择目标节点组", tone: "idle" };
    }
    const group = resolveGroup(controller.graph, targetId);
    if (!group) {
        return { valid: false, sourceText, message: "错误：目标节点组不存在", tone: "error" };
    }

    group.recomputeInsideNodes?.();
    const nodes = collectControllableNodes(group, controller);
    const mode = desiredMode(source.value, controller.properties.invert);
    return {
        valid: true,
        controller,
        graph: controller.graph,
        group,
        groupId: getGroupId(group),
        nodes,
        mode,
        source,
        sourceText,
        message: nodes.length ? "" : "目标组内没有可控节点",
        tone: nodes.length ? "idle" : "idle",
    };
}

function applyPlan(plan) {
    const changed = applyModeToNodes(plan.nodes, plan.mode);
    plan.group.rgthree_hasAnyActiveNode = plan.mode === MODE_ACTIVE;
    if (changed) markGraphChanged(plan.controller);
    return changed;
}

function runSync() {
    syncQueued = false;
    const liveControllers = Array.from(controllers).filter((node) => node?.graph && !node._booleanGroupRemoved);
    const resolved = new Map();
    const plans = [];
    for (const controller of liveControllers) {
        const state = resolveControllerPlan(controller);
        resolved.set(controller, state);
        if (state.valid) plans.push(state);
    }

    const conflicts = findPlanConflicts(plans);
    for (const controller of liveControllers) {
        const state = resolved.get(controller);
        const conflict = conflicts.get(controller);
        if (conflict) {
            updateControllerUI(controller, { ...state, message: conflict, tone: "error" });
            continue;
        }
        if (!state.valid) {
            updateControllerUI(controller, state);
            continue;
        }
        applyPlan(state);
        const isActive = state.mode === MODE_ACTIVE;
        const boolLabel = state.source.value ? "ON" : "OFF";
        updateControllerUI(controller, {
            ...state,
            message: isActive ? `ACTIVE · Bool ${boolLabel}` : `BYPASS · Bool ${boolLabel}`,
            tone: isActive ? "active" : "bypass",
        });
    }
}

function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    setTimeout(runSync, 0);
}

function registerController(node) {
    node._booleanGroupRemoved = false;
    controllers.add(node);
    if (!pollTimer) pollTimer = setInterval(runSync, POLL_INTERVAL_MS);
    queueSync();
}

function unregisterController(node) {
    node._booleanGroupRemoved = true;
    controllers.delete(node);
    if (!controllers.size && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

app.registerExtension({
    name: EXTENSION_NAME,
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== CONTROLLER_NODE_TYPE) return;

        nodeType.prototype.isVirtualNode = true;
        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            this.isVirtualNode = true;
            ensureControllerProperties(this);
            ensureControllerUI(this);
        });
        chainCallback(nodeType.prototype, "onConfigure", function () {
            this.isVirtualNode = true;
            ensureControllerProperties(this);
            requestAnimationFrame(() => {
                ensureControllerUI(this);
                queueSync();
            });
        });
        chainCallback(nodeType.prototype, "onAdded", function () {
            registerController(this);
        });
        chainCallback(nodeType.prototype, "onConnectionsChange", function () {
            queueSync();
        });
        chainCallback(nodeType.prototype, "onRemoved", function () {
            unregisterController(this);
            this._booleanGroupControllerUI?.container?.remove();
            this._booleanGroupControllerUI = null;
        });
    },
});
