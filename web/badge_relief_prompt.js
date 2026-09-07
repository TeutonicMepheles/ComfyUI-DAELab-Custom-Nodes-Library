import { app } from "/scripts/app.js";
import {
  BADGE_RELIEF_LEVELS,
  BADGE_RELIEF_NATIVE_WIDGET_NAME,
  BADGE_RELIEF_PANEL_WIDGET_NAME,
  collapseBadgeReliefPanelInputs,
  getReliefLevelSpec,
  normalizeReliefLevel,
} from "./badge_relief_prompt_panel.mjs?v=20260812-1";

const UI_VERSION = "20260812-1";
const PANEL_HEIGHT = 112;
const PANEL_SYNC_INTERVAL_MS = 100;
const panelNodes = new Set();
let panelSyncTimer = null;

function getReliefWidget(node) {
  return node.widgets?.find(
    (widget) => widget.name === BADGE_RELIEF_NATIVE_WIDGET_NAME,
  );
}

function normalizeWidgetLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findVueNodeElement(node) {
  const nodeId = String(node?.id ?? "");
  if (!nodeId) return null;
  return Array.from(document.querySelectorAll(".lg-node[data-node-id]"))
    .find((element) => element.dataset.nodeId === nodeId) || null;
}

function hideNativeVueRow(node) {
  const nodeElement = findVueNodeElement(node);
  if (!nodeElement) return false;

  const rows = Array.from(
    nodeElement.querySelectorAll(".lg-node-widgets > .lg-node-widget"),
  );
  const panelRow = node.badgeReliefPanel?.element?.closest(".lg-node-widget") || null;
  const normalizedName = normalizeWidgetLabel(BADGE_RELIEF_NATIVE_WIDGET_NAME);
  const row = rows.find((candidate) => (
    candidate !== panelRow
    && normalizeWidgetLabel(candidate.textContent).startsWith(normalizedName)
  ));
  if (!row) return false;

  row.dataset.badgeReliefHidden = "true";
  row.hidden = true;
  row.inert = true;
  row.setAttribute("aria-hidden", "true");
  row.style.setProperty("display", "none", "important");
  return true;
}

function scheduleConfiguredRefresh(graph) {
  if (!graph?.events || graph.__badgeReliefPanelRefreshQueued) return;
  graph.__badgeReliefPanelRefreshQueued = true;
  queueMicrotask(() => {
    graph.__badgeReliefPanelRefreshQueued = false;
    graph.events.dispatchEvent?.(new Event("configured"));
  });
}

function normalizeAppModeInputs(node) {
  const graph = app.rootGraph;
  const data = graph?.extra?.linearData;
  if (!Array.isArray(data?.inputs)) return false;
  if (graph.getNodeById?.(node.id) !== node) return false;

  const normalized = collapseBadgeReliefPanelInputs(data.inputs, node.id);
  if (!normalized.changed) return false;

  graph.extra.linearData = {
    ...data,
    inputs: normalized.inputs,
  };
  scheduleConfiguredRefresh(graph);
  return true;
}

function isReliefWidgetLinked(node) {
  return node.inputs?.find(
    (input) => input.name === BADGE_RELIEF_NATIVE_WIDGET_NAME,
  )?.link != null;
}

function setReliefLevel(node, value, event = null) {
  const widget = getReliefWidget(node);
  if (!widget || isReliefWidgetLinked(node)) return;

  const level = normalizeReliefLevel(value);
  if (normalizeReliefLevel(widget.value) !== level) {
    widget.value = level;
    widget.callback?.(level, app.canvas, node, null, event);
    (node.graph || app.graph)?.setDirtyCanvas?.(true, true);
  }
  syncPanelControls(node);
}

function syncPanelControls(node) {
  const panel = node.badgeReliefPanel;
  const widget = getReliefWidget(node);
  if (!panel || !widget) return;

  const level = normalizeReliefLevel(widget.value);
  const spec = getReliefLevelSpec(level);
  const disabled = Boolean(
    isReliefWidgetLinked(node) || widget.disabled || widget.options?.disabled,
  );

  panel.range.value = String(level);
  panel.range.disabled = disabled;
  panel.valueLabel.textContent = `${level} · ${spec.title}`;

  for (const button of panel.buttons) {
    const active = Number(button.dataset.level) === level;
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "#5b7cfa" : "#292c31";
    button.style.color = active ? "#ffffff" : "#b8bdc7";
    button.style.borderColor = active ? "#7f98ff" : "#45484e";
  }
}

function hideNativeWidget(node) {
  const widget = getReliefWidget(node);
  if (!widget || widget.__badgeReliefPanelHidden) return;

  widget.origComputeSize = widget.origComputeSize || widget.computeSize;
  widget.hidden = true;
  widget.options = {
    ...(widget.options || {}),
    canvasOnly: true,
    hidden: true,
  };
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
  widget.__badgeReliefPanelHidden = true;
}

function createPanelElement(node) {
  const element = document.createElement("div");
  element.className = "badge-relief-prompt-panel";
  element.style.cssText = [
    `height:${PANEL_HEIGHT}px`,
    `min-height:${PANEL_HEIGHT}px`,
    "width:100%",
    "display:flex",
    "flex-direction:column",
    "justify-content:center",
    "gap:8px",
    "box-sizing:border-box",
    "padding:9px 10px",
    "border:1px solid #3b3e43",
    "border-radius:7px",
    "background:#202226",
    "color:#eef0f4",
    "font:13px sans-serif",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;gap:10px;align-items:center";

  const title = document.createElement("span");
  title.textContent = "浮雕立体程度";
  title.style.cssText = "font-weight:600;color:#d9dce2";

  const valueLabel = document.createElement("span");
  valueLabel.style.cssText = "color:#9fb0ff;font-size:12px;white-space:nowrap";
  header.append(title, valueLabel);

  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "5";
  range.step = "1";
  range.setAttribute("aria-label", "浮雕立体程度");
  range.style.cssText = "width:100%;height:18px;margin:0;accent-color:#6f8cff;cursor:pointer";
  range.addEventListener("input", (event) => {
    setReliefLevel(node, event.currentTarget.value, event);
  });

  const segments = document.createElement("div");
  segments.style.cssText = "display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px";
  const buttons = BADGE_RELIEF_LEVELS.map((spec) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = String(spec.value);
    button.textContent = spec.label;
    button.title = `${spec.value} · ${spec.title}`;
    button.style.cssText = [
      "min-width:0",
      "height:25px",
      "padding:0 2px",
      "border:1px solid #45484e",
      "border-radius:4px",
      "background:#292c31",
      "color:#b8bdc7",
      "font:12px sans-serif",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", (event) => {
      setReliefLevel(node, spec.value, event);
    });
    segments.appendChild(button);
    return button;
  });

  for (const eventName of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "wheel",
    "keydown",
  ]) {
    element.addEventListener(eventName, (event) => event.stopPropagation());
  }

  element.append(header, range, segments);
  return { element, valueLabel, range, buttons };
}

function installReliefPanel(node) {
  if (node.__badgeReliefPanelInstalled === UI_VERSION) {
    syncPanelControls(node);
    return;
  }
  if (typeof node.addDOMWidget !== "function") return;

  const panel = createPanelElement(node);
  const widget = node.addDOMWidget(
    BADGE_RELIEF_PANEL_WIDGET_NAME,
    "custom",
    panel.element,
    {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => PANEL_HEIGHT,
      getHeight: () => PANEL_HEIGHT,
      getValue: () => normalizeReliefLevel(getReliefWidget(node)?.value),
      setValue: (value) => setReliefLevel(node, value),
    },
  );

  widget.serialize = false;
  widget.label = "徽章浮雕强度";
  widget.inputEl = panel.element;
  widget.__badgeReliefPanel = true;
  widget.computeSize = (width) => [width || 330, PANEL_HEIGHT];
  widget.computeLayoutSize = () => ({
    minHeight: PANEL_HEIGHT,
    minWidth: 330,
  });
  const originalOnRemove = widget.onRemove?.bind(widget);
  widget.onRemove = () => {
    originalOnRemove?.();
    panel.element.remove();
  };

  node.badgeReliefPanel = { ...panel, widget };
  node.__badgeReliefPanelInstalled = UI_VERSION;
  hideNativeWidget(node);
  hideNativeVueRow(node);
  normalizeAppModeInputs(node);
  syncPanelControls(node);
  registerPanelNode(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function runPanelSync() {
  for (const node of Array.from(panelNodes)) {
    if (!node?.graph) {
      panelNodes.delete(node);
      continue;
    }
    hideNativeWidget(node);
    hideNativeVueRow(node);
    normalizeAppModeInputs(node);
    syncPanelControls(node);
  }
}

function registerPanelNode(node) {
  panelNodes.add(node);
  if (!panelSyncTimer) {
    panelSyncTimer = setInterval(runPanelSync, PANEL_SYNC_INTERVAL_MS);
  }
  queueMicrotask(runPanelSync);
}

function unregisterPanelNode(node) {
  panelNodes.delete(node);
  if (!panelNodes.size && panelSyncTimer) {
    clearInterval(panelSyncTimer);
    panelSyncTimer = null;
  }
}

if (globalThis.__BADGE_RELIEF_PROMPT_PANEL_VERSION !== UI_VERSION) {
  globalThis.__BADGE_RELIEF_PROMPT_PANEL_VERSION = UI_VERSION;

  app.registerExtension({
    name: "DAELab.BadgeReliefPrompt.Panel",

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== "BadgeReliefPrompt") return;

      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        onNodeCreated?.apply(this, arguments);
        const node = this;
        setTimeout(() => installReliefPanel(node), 0);
      };

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        const node = this;
        setTimeout(() => {
          installReliefPanel(node);
          syncPanelControls(node);
          normalizeAppModeInputs(node);
        }, 0);
      };

      const onRemoved = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () {
        unregisterPanelNode(this);
        onRemoved?.apply(this, arguments);
      };
    },
  });
}
