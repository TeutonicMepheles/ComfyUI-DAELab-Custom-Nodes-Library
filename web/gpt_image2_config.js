import { app } from "/scripts/app.js";
import {
  GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
  collapseGPTImage2ConfigPanelInputs,
} from "./gpt_image2_config_panel.mjs?v=20260805-1";

const UI_VERSION = "20260805-1";
const PANEL_HEIGHT = 126;
const PANEL_SYNC_INTERVAL_MS = 100;
const CONFIG_WIDGET_NAMES = ["size", "background", "quality"];
const CONFIG_OPTIONS = Object.freeze({
  size: Object.freeze([
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "2048x2048",
    "2048x1152",
    "1152x2048",
    "3840x2160",
    "2160x3840",
  ]),
  background: Object.freeze(["auto", "opaque"]),
  quality: Object.freeze(["low", "medium", "high"]),
});

const configPanelNodes = new Set();
let configPanelSyncTimer = null;

function getConfigWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function normalizeWidgetLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findVueNodeElement(node) {
  const nodeId = String(node?.id ?? "");
  if (!nodeId) {
    return null;
  }
  return Array.from(document.querySelectorAll(".lg-node[data-node-id]"))
    .find((element) => element.dataset.nodeId === nodeId) || null;
}

function hideNativeVueRows(node) {
  const nodeElement = findVueNodeElement(node);
  if (!nodeElement) {
    return false;
  }

  const rows = Array.from(
    nodeElement.querySelectorAll(".lg-node-widgets > .lg-node-widget"),
  );
  const panelRow = node.gptImage2ConfigPanel?.element?.closest(".lg-node-widget") || null;
  let changed = false;

  for (const widgetName of CONFIG_WIDGET_NAMES) {
    const normalizedName = normalizeWidgetLabel(widgetName);
    const row = rows.find((candidate) => (
      candidate !== panelRow
      && normalizeWidgetLabel(candidate.textContent).startsWith(normalizedName)
    ));
    if (!row) {
      continue;
    }

    if (row.dataset.gptImage2ConfigHidden !== "true") {
      changed = true;
    }
    row.dataset.gptImage2ConfigHidden = "true";
    row.hidden = true;
    row.inert = true;
    row.setAttribute("aria-hidden", "true");
    row.style.setProperty("display", "none", "important");
  }
  return changed;
}

function scheduleConfiguredRefresh(graph) {
  if (!graph?.events || graph.__gptImage2ConfigPanelRefreshQueued) {
    return;
  }
  graph.__gptImage2ConfigPanelRefreshQueued = true;
  queueMicrotask(() => {
    graph.__gptImage2ConfigPanelRefreshQueued = false;
    graph.events.dispatchEvent?.(new Event("configured"));
  });
}

function normalizeAppModeInputs(node) {
  const graph = app.rootGraph;
  const data = graph?.extra?.linearData;
  if (!Array.isArray(data?.inputs)) {
    return false;
  }
  if (graph.getNodeById?.(node.id) !== node) {
    return false;
  }

  const normalized = collapseGPTImage2ConfigPanelInputs(data.inputs, node.id);
  if (!normalized.changed) {
    return false;
  }

  graph.extra.linearData = {
    ...data,
    inputs: normalized.inputs,
  };
  scheduleConfiguredRefresh(graph);
  return true;
}

function setConfigWidgetValue(node, name, value, event = null) {
  const widget = getConfigWidget(node, name);
  const options = CONFIG_OPTIONS[name] || [];
  if (!widget || !options.includes(value) || widget.value === value) {
    return;
  }

  widget.value = value;
  widget.callback?.(value, app.canvas, node, null, event);
  (node.graph || app.graph)?.setDirtyCanvas?.(true, true);
  syncPanelControls(node);
}

function syncPanelControls(node) {
  const controls = node.gptImage2ConfigPanel?.controls;
  if (!controls) {
    return;
  }

  for (const name of CONFIG_WIDGET_NAMES) {
    const widget = getConfigWidget(node, name);
    const control = controls[name];
    if (!widget || !control) {
      continue;
    }
    if (document.activeElement !== control) {
      control.value = String(widget.value ?? CONFIG_OPTIONS[name][0]);
    }
    const linked = node.inputs?.find((input) => input.name === name)?.link != null;
    control.disabled = Boolean(linked || widget.disabled || widget.options?.disabled);
  }
}

function hideNativeWidgets(node) {
  for (const name of CONFIG_WIDGET_NAMES) {
    const widget = getConfigWidget(node, name);
    if (!widget || widget.__gptImage2ConfigPanelHidden) {
      continue;
    }

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
      if (!element?.style) {
        continue;
      }
      element.style.display = "none";
      element.style.visibility = "hidden";
    }
    widget.__gptImage2ConfigPanelHidden = true;
  }
}

function createSelect(name) {
  const select = document.createElement("select");
  select.name = name;
  select.setAttribute("aria-label", name);
  select.style.cssText = [
    "min-width:0",
    "height:28px",
    "flex:1 1 auto",
    "box-sizing:border-box",
    "border:1px solid #45484e",
    "border-radius:6px",
    "background:#292c31",
    "color:#f0f0f0",
    "font:13px sans-serif",
    "padding:2px 8px",
    "outline:none",
    "cursor:pointer",
  ].join(";");

  for (const value of CONFIG_OPTIONS[name]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  return select;
}

function createPanelElement(node) {
  const element = document.createElement("div");
  element.className = "gpt-image2-config-panel";
  element.style.cssText = [
    `height:${PANEL_HEIGHT}px`,
    `min-height:${PANEL_HEIGHT}px`,
    "width:100%",
    "display:flex",
    "flex-direction:column",
    "justify-content:center",
    "gap:7px",
    "box-sizing:border-box",
    "padding:8px 10px",
    "border:1px solid #3b3e43",
    "border-radius:6px",
    "background:#202226",
  ].join(";");

  const controls = {};
  for (const name of CONFIG_WIDGET_NAMES) {
    const row = document.createElement("label");
    row.style.cssText = [
      "min-width:0",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "color:#cfd2d7",
      "font:13px sans-serif",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = name;
    label.style.cssText = "width:86px;flex:0 0 86px;text-align:right";
    const select = createSelect(name);
    select.addEventListener("change", (event) => {
      setConfigWidgetValue(node, name, event.currentTarget.value, event);
    });
    controls[name] = select;
    row.append(label, select);
    element.appendChild(row);
  }

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

  return { element, controls };
}

function installConfigPanel(node) {
  if (node.__gptImage2ConfigPanelInstalled === UI_VERSION) {
    syncPanelControls(node);
    return;
  }
  if (typeof node.addDOMWidget !== "function") {
    return;
  }

  const panel = createPanelElement(node);
  let widget;
  widget = node.addDOMWidget(
    GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
    "custom",
    panel.element,
    {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => PANEL_HEIGHT,
      getHeight: () => PANEL_HEIGHT,
      getValue: () => JSON.stringify(Object.fromEntries(
        CONFIG_WIDGET_NAMES.map((name) => [name, getConfigWidget(node, name)?.value]),
      )),
      setValue: () => syncPanelControls(node),
    },
  );

  widget.serialize = false;
  widget.label = "GPT Image2 Config";
  widget.inputEl = panel.element;
  widget.__gptImage2ConfigPanel = true;
  widget.computeSize = (width) => [width || 300, PANEL_HEIGHT];
  widget.computeLayoutSize = () => ({
    minHeight: PANEL_HEIGHT,
    minWidth: 300,
  });
  const originalOnRemove = widget.onRemove?.bind(widget);
  widget.onRemove = () => {
    originalOnRemove?.();
    panel.element.remove();
  };

  node.gptImage2ConfigPanel = {
    ...panel,
    widget,
  };
  node.__gptImage2ConfigPanelInstalled = UI_VERSION;
  hideNativeWidgets(node);
  hideNativeVueRows(node);
  normalizeAppModeInputs(node);
  syncPanelControls(node);
  registerConfigPanelNode(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function runConfigPanelSync() {
  for (const node of Array.from(configPanelNodes)) {
    if (!node?.graph) {
      configPanelNodes.delete(node);
      continue;
    }
    hideNativeWidgets(node);
    hideNativeVueRows(node);
    normalizeAppModeInputs(node);
    syncPanelControls(node);
  }
}

function registerConfigPanelNode(node) {
  configPanelNodes.add(node);
  if (!configPanelSyncTimer) {
    configPanelSyncTimer = setInterval(runConfigPanelSync, PANEL_SYNC_INTERVAL_MS);
  }
  queueMicrotask(runConfigPanelSync);
}

function unregisterConfigPanelNode(node) {
  configPanelNodes.delete(node);
  if (!configPanelNodes.size && configPanelSyncTimer) {
    clearInterval(configPanelSyncTimer);
    configPanelSyncTimer = null;
  }
}

if (globalThis.__GPT_IMAGE2_CONFIG_PANEL_VERSION !== UI_VERSION) {
  globalThis.__GPT_IMAGE2_CONFIG_PANEL_VERSION = UI_VERSION;

  app.registerExtension({
    name: "DAELab.GPTImage2Config.Panel",

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== "GPTImage2Config") {
        return;
      }

      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        onNodeCreated?.apply(this, arguments);
        const node = this;
        setTimeout(() => installConfigPanel(node), 0);
      };

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        const node = this;
        setTimeout(() => {
          installConfigPanel(node);
          syncPanelControls(node);
          normalizeAppModeInputs(node);
        }, 0);
      };

      const onRemoved = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () {
        unregisterConfigPanelNode(this);
        onRemoved?.apply(this, arguments);
      };
    },
  });
}
