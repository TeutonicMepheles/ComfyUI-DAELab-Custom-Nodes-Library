import { app } from "/scripts/app.js";
import {
  RMBG_CONFIG_PANEL_WIDGET_NAME,
  collapseRMBGConfigPanelInputs,
  normalizeRMBGColor,
} from "./rmbg_config_panel.mjs?v=20260805-3";

const UI_VERSION = "20260805-3";
const PANEL_HEIGHT = 92;
const PANEL_SYNC_INTERVAL_MS = 100;
const CONFIG_WIDGET_NAMES = ["background", "background_color"];
const BACKGROUND_OPTIONS = ["Alpha", "original", "Color"];

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
  const panelRow = node.rmbgConfigPanel?.element?.closest(".lg-node-widget") || null;
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

    if (row.dataset.rmbgConfigHidden !== "true") {
      changed = true;
    }
    row.dataset.rmbgConfigHidden = "true";
    row.hidden = true;
    row.inert = true;
    row.setAttribute("aria-hidden", "true");
    row.style.setProperty("display", "none", "important");
  }
  return changed;
}

function scheduleConfiguredRefresh(graph) {
  if (!graph?.events || graph.__rmbgConfigPanelRefreshQueued) {
    return;
  }
  graph.__rmbgConfigPanelRefreshQueued = true;
  queueMicrotask(() => {
    graph.__rmbgConfigPanelRefreshQueued = false;
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

  const normalized = collapseRMBGConfigPanelInputs(data.inputs, node.id);
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
  if (!widget) {
    return;
  }

  const normalizedValue = name === "background_color"
    ? normalizeRMBGColor(value, String(widget.value || "#FFFFFF"))
    : value;
  if (
    (name === "background" && !BACKGROUND_OPTIONS.includes(normalizedValue))
    || widget.value === normalizedValue
  ) {
    syncPanelControls(node);
    return;
  }

  widget.value = normalizedValue;
  widget.callback?.(normalizedValue, app.canvas, node, null, event);
  (node.graph || app.graph)?.setDirtyCanvas?.(true, true);
  syncPanelControls(node);
}

function isConfigInputLinked(node, name) {
  return node.inputs?.find((input) => input.name === name)?.link != null;
}

function syncPanelControls(node) {
  const controls = node.rmbgConfigPanel?.controls;
  if (!controls) {
    return;
  }

  const backgroundWidget = getConfigWidget(node, "background");
  if (backgroundWidget && document.activeElement !== controls.background) {
    controls.background.value = String(backgroundWidget.value || "Alpha");
  }
  controls.background.disabled = Boolean(
    isConfigInputLinked(node, "background")
    || backgroundWidget?.disabled
    || backgroundWidget?.options?.disabled
  );

  const colorWidget = getConfigWidget(node, "background_color");
  const colorValue = normalizeRMBGColor(colorWidget?.value);
  if (document.activeElement !== controls.backgroundColorText) {
    controls.backgroundColorText.value = colorValue;
  }
  controls.backgroundColorPicker.value = colorValue;
  const colorDisabled = Boolean(
    isConfigInputLinked(node, "background_color")
    || colorWidget?.disabled
    || colorWidget?.options?.disabled
  );
  controls.backgroundColorPicker.disabled = colorDisabled;
  controls.backgroundColorText.disabled = colorDisabled;
}

function hideNativeWidgets(node) {
  for (const name of CONFIG_WIDGET_NAMES) {
    const widget = getConfigWidget(node, name);
    if (!widget || widget.__rmbgConfigPanelHidden) {
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
    widget.__rmbgConfigPanelHidden = true;
  }
}

function resizeNodeForPanel(node) {
  node.arrange?.();
  const computedSize = node.computeSize?.();
  node.size = [
    Math.max(Number(node.size?.[0]) || 0, 340),
    Math.max(Number(node.size?.[1]) || 0, Number(computedSize?.[1]) || 0),
  ];
}

function styleControl(control) {
  control.style.cssText = [
    "min-width:0",
    "height:28px",
    "box-sizing:border-box",
    "border:1px solid #45484e",
    "border-radius:6px",
    "background:#292c31",
    "color:#f0f0f0",
    "font:13px sans-serif",
    "padding:2px 8px",
    "outline:none",
  ].join(";");
}

function createPanelRow(labelText) {
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
  label.textContent = labelText;
  label.style.cssText = "width:118px;flex:0 0 118px;text-align:right";
  row.appendChild(label);
  return row;
}

function createPanelElement(node) {
  const element = document.createElement("div");
  element.className = "rmbg-config-panel";
  element.dataset.uiVersion = UI_VERSION;
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
    "border-radius:6px",
    "background:#202226",
  ].join(";");

  const background = document.createElement("select");
  background.name = "background";
  background.setAttribute("aria-label", "background");
  styleControl(background);
  background.style.flex = "1 1 auto";
  for (const value of BACKGROUND_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    background.appendChild(option);
  }
  background.addEventListener("change", (event) => {
    setConfigWidgetValue(node, "background", event.currentTarget.value, event);
  });

  const backgroundColorPicker = document.createElement("input");
  backgroundColorPicker.type = "color";
  backgroundColorPicker.setAttribute("aria-label", "background_color picker");
  backgroundColorPicker.style.cssText = [
    "width:38px",
    "height:28px",
    "flex:0 0 38px",
    "box-sizing:border-box",
    "border:1px solid #45484e",
    "border-radius:6px",
    "background:#292c31",
    "padding:2px",
    "cursor:pointer",
  ].join(";");
  backgroundColorPicker.addEventListener("input", (event) => {
    setConfigWidgetValue(node, "background_color", event.currentTarget.value, event);
  });

  const backgroundColorText = document.createElement("input");
  backgroundColorText.type = "text";
  backgroundColorText.spellcheck = false;
  backgroundColorText.maxLength = 7;
  backgroundColorText.placeholder = "#FFFFFF";
  backgroundColorText.setAttribute("aria-label", "background_color");
  styleControl(backgroundColorText);
  backgroundColorText.style.flex = "1 1 auto";
  backgroundColorText.addEventListener("input", (event) => {
    if (/^#?[0-9a-fA-F]{6}$/.test(event.currentTarget.value.trim())) {
      setConfigWidgetValue(node, "background_color", event.currentTarget.value, event);
    }
  });
  backgroundColorText.addEventListener("change", (event) => {
    setConfigWidgetValue(node, "background_color", event.currentTarget.value, event);
  });
  backgroundColorText.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  });

  const backgroundRow = createPanelRow("background");
  backgroundRow.appendChild(background);
  const colorRow = createPanelRow("background_color");
  colorRow.append(backgroundColorPicker, backgroundColorText);
  element.append(backgroundRow, colorRow);

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

  return {
    element,
    controls: {
      background,
      backgroundColorPicker,
      backgroundColorText,
    },
  };
}

function installConfigPanel(node) {
  if (node.__rmbgConfigPanelInstalled === UI_VERSION) {
    syncPanelControls(node);
    return;
  }
  if (typeof node.addDOMWidget !== "function") {
    return;
  }

  const panel = createPanelElement(node);
  let widget;
  widget = node.addDOMWidget(
    RMBG_CONFIG_PANEL_WIDGET_NAME,
    "custom",
    panel.element,
    {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => PANEL_HEIGHT,
      getHeight: () => PANEL_HEIGHT,
      getValue: () => JSON.stringify({
        background: getConfigWidget(node, "background")?.value,
        background_color: getConfigWidget(node, "background_color")?.value,
      }),
      setValue: () => syncPanelControls(node),
    },
  );

  widget.serialize = false;
  widget.label = "RMBG Config";
  widget.inputEl = panel.element;
  widget.__rmbgConfigPanel = true;
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

  node.rmbgConfigPanel = {
    ...panel,
    widget,
  };
  node.__rmbgConfigPanelInstalled = UI_VERSION;
  hideNativeWidgets(node);
  hideNativeVueRows(node);
  normalizeAppModeInputs(node);
  syncPanelControls(node);
  resizeNodeForPanel(node);
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

if (globalThis.__RMBG_CONFIG_PANEL_VERSION !== UI_VERSION) {
  globalThis.__RMBG_CONFIG_PANEL_VERSION = UI_VERSION;

  app.registerExtension({
    name: "DAELab.RMBGConfig.Panel",

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== "RMBGConfig") {
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
