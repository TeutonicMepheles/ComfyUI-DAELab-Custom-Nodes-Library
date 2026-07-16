import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MODE_BBOX = "bbox";
const MODE_INTERACTIVE = "interactive";
const PROMPT_COLORS = [
  "#00FFFF",
  "#FFFF00",
  "#FF00FF",
  "#00FF00",
  "#FF8000",
  "#FF69B4",
  "#4169E1",
  "#20B2AA",
];
const MAX_PROMPTS = PROMPT_COLORS.length;

function chainCallback(object, property, callback) {
  const original = object[property];
  object[property] = function () {
    const result = original?.apply(this, arguments);
    callback.apply(this, arguments);
    return result;
  };
}

function hideWidget(widget) {
  if (!widget) {
    return;
  }
  widget.origType = widget.origType || widget.type;
  widget.origComputeSize = widget.origComputeSize || widget.computeSize;
  widget.hidden = true;
  widget.type = "converted-widget";
  widget.computeSize = () => [0, -4];
  widget.serialize = true;
  widget.serializeValue = () => widget.value;
  if (widget.element) {
    widget.element.style.display = "none";
    widget.element.style.visibility = "hidden";
  }
}

function button(label, title, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.title = title;
  element.style.cssText = [
    "height:24px",
    "border:1px solid #3a3a3a",
    "border-radius:4px",
    "background:#252525",
    "color:#ddd",
    "font:12px sans-serif",
    "cursor:pointer",
    "padding:0 8px",
  ].join(";");
  element.addEventListener("click", onClick);
  return element;
}

function promptTemplate(index = 0) {
  return {
    positive_points: [],
    negative_points: [],
    positive_boxes: [],
    negative_boxes: [],
    name: `Prompt ${index + 1}`,
  };
}

function clonePrompt(prompt, index) {
  return {
    positive_points: (prompt?.positive_points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
    negative_points: (prompt?.negative_points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
    positive_boxes: (prompt?.positive_boxes || []).map((box) => ({
      x1: Number(box.x1) || 0,
      y1: Number(box.y1) || 0,
      x2: Number(box.x2) || 0,
      y2: Number(box.y2) || 0,
    })),
    negative_boxes: (prompt?.negative_boxes || []).map((box) => ({
      x1: Number(box.x1) || 0,
      y1: Number(box.y1) || 0,
      x2: Number(box.x2) || 0,
      y2: Number(box.y2) || 0,
    })),
    name: prompt?.name || `Prompt ${index + 1}`,
  };
}

function parseArray(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function splitImagePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  const filename = parts.pop() || "";
  return {
    filename,
    subfolder: parts.join("/"),
  };
}

function getImageUrl(imageName, type = "input") {
  const { filename, subfolder } = splitImagePath(imageName);
  if (!filename) {
    return "";
  }
  return api.apiURL(
    `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder)}&rand=${Math.random()}`,
  );
}

function canvasCoords(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  return {
    x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / width) * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / height) * canvas.height)),
  };
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

app.registerExtension({
  name: "daelab.SAM3ComplexCollector",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SAM3ComplexCollector") {
      return;
    }

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const getWidget = (name) => this.widgets?.find((widget) => widget.name === name);
      const modeWidget = getWidget("collector_mode");
      const bboxesWidget = getWidget("bboxes");
      const negBboxesWidget = getWidget("neg_bboxes");
      const promptsWidget = getWidget("multi_prompts_store");

      hideWidget(modeWidget);
      hideWidget(bboxesWidget);
      hideWidget(negBboxesWidget);
      hideWidget(promptsWidget);

      const container = document.createElement("div");
      container.style.cssText = [
        "width:100%",
        "height:100%",
        "background:#151719",
        "border-radius:4px",
        "overflow:hidden",
        "display:flex",
        "flex-direction:column",
        "box-sizing:border-box",
      ].join(";");

      const modeBar = document.createElement("div");
      modeBar.style.cssText = [
        "height:34px",
        "display:flex",
        "gap:6px",
        "align-items:center",
        "justify-content:space-between",
        "padding:5px",
        "box-sizing:border-box",
        "background:#202225",
        "border-bottom:1px solid #333",
      ].join(";");

      const refreshButton = button("Load Image", "Load the connected IMAGE socket into the collector canvas", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.refreshSAM3ComplexImage();
      });
      refreshButton.style.background = "#315f8f";
      refreshButton.style.borderColor = "#5088c0";

      const modeTabs = document.createElement("div");
      modeTabs.setAttribute("role", "tablist");
      modeTabs.setAttribute("aria-label", "Collector mode");
      modeTabs.style.cssText = [
        "display:flex",
        "align-items:center",
        "margin-left:auto",
        "border:1px solid #3a3a3a",
        "border-radius:4px",
        "overflow:hidden",
      ].join(";");

      const bboxModeButton = button("BBox Collector", "Use bbox collector prompts", () => this.setSAM3ComplexMode(MODE_BBOX));
      const interactiveModeButton = button("Interactive Collector", "Use interactive point and box prompts", () =>
        this.setSAM3ComplexMode(MODE_INTERACTIVE),
      );
      for (const modeButton of [bboxModeButton, interactiveModeButton]) {
        modeButton.setAttribute("role", "tab");
        modeButton.style.border = "0";
        modeButton.style.borderRadius = "0";
        modeButton.style.padding = "0 10px";
      }
      bboxModeButton.style.borderRight = "1px solid #3a3a3a";
      modeTabs.appendChild(bboxModeButton);
      modeTabs.appendChild(interactiveModeButton);

      modeBar.appendChild(refreshButton);
      modeBar.appendChild(modeTabs);
      container.appendChild(modeBar);

      const bboxPane = document.createElement("div");
      bboxPane.style.cssText = "flex:1;min-height:260px;display:flex;flex-direction:column;background:#111";
      const interactivePane = document.createElement("div");
      interactivePane.style.cssText = "flex:1;min-height:260px;display:flex;flex-direction:column;background:#111";
      container.appendChild(bboxPane);
      container.appendChild(interactivePane);

      const makeCanvasPane = (parent) => {
        const toolbar = document.createElement("div");
        toolbar.style.cssText = "height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px;background:#202225;box-sizing:border-box;border-bottom:1px solid #333";
        const counter = document.createElement("div");
        counter.style.cssText = "color:#fff;font:12px monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end";
        toolbar.appendChild(counter);
        toolbar.appendChild(actions);

        const canvasWrapper = document.createElement("div");
        canvasWrapper.style.cssText = "flex:1;min-height:220px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#141414";
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        canvas.style.cssText = "display:block;max-width:100%;max-height:100%;object-fit:contain;cursor:crosshair";
        canvasWrapper.appendChild(canvas);

        parent.appendChild(toolbar);
        parent.appendChild(canvasWrapper);
        return { toolbar, counter, actions, canvas, ctx: canvas.getContext("2d") };
      };

      const bboxUi = makeCanvasPane(bboxPane);
      const bboxClear = button("Clear All", "Clear all bbox prompts", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.sam3Complex.bbox.positive = [];
        this.sam3Complex.bbox.negative = [];
        this.sam3Complex.bbox.current = null;
        this.updateSAM3ComplexStorage();
        this.redrawSAM3ComplexBBox();
      });
      bboxClear.style.background = "#8f2f2f";
      bboxClear.style.borderColor = "#a44";
      bboxUi.actions.appendChild(bboxClear);

      const interactiveUi = makeCanvasPane(interactivePane);
      const runButton = button("Run", "Queue this workflow with the active interactive prompt", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.runSAM3ComplexInteractive();
      });
      runButton.style.background = "#2a7a2a";
      runButton.style.borderColor = "#3a9a3a";
      const clearPromptButton = button("Clear Prompt", "Clear active prompt", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearSAM3ComplexActivePrompt();
      });
      const clearAllPromptsButton = button("Clear All", "Clear all prompts", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearSAM3ComplexPrompts();
      });
      interactiveUi.actions.appendChild(runButton);
      interactiveUi.actions.appendChild(clearPromptButton);
      interactiveUi.actions.appendChild(clearAllPromptsButton);

      const tabBar = document.createElement("div");
      tabBar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:#1a1a1a;border-top:1px solid #333";
      interactivePane.appendChild(tabBar);

      this.sam3Complex = {
        mode: modeWidget?.value || MODE_BBOX,
        bgImage: null,
        overlayImage: null,
        overlayMode: null,
        running: false,
        widgets: {
          mode: modeWidget,
          bboxes: bboxesWidget,
          negBboxes: negBboxesWidget,
          prompts: promptsWidget,
        },
        refreshButton,
        modeButtons: {
          bbox: bboxModeButton,
          interactive: interactiveModeButton,
        },
        bbox: {
          pane: bboxPane,
          canvas: bboxUi.canvas,
          ctx: bboxUi.ctx,
          counter: bboxUi.counter,
          positive: parseArray(bboxesWidget?.value).map((box) => ({
            x1: Number(box.x1 ?? box.x ?? 0),
            y1: Number(box.y1 ?? box.y ?? 0),
            x2: Number(box.x2 ?? ((box.x ?? 0) + (box.w ?? 0))),
            y2: Number(box.y2 ?? ((box.y ?? 0) + (box.h ?? 0))),
          })),
          negative: parseArray(negBboxesWidget?.value).map((box) => ({
            x1: Number(box.x1 ?? box.x ?? 0),
            y1: Number(box.y1 ?? box.y ?? 0),
            x2: Number(box.x2 ?? ((box.x ?? 0) + (box.w ?? 0))),
            y2: Number(box.y2 ?? ((box.y ?? 0) + (box.h ?? 0))),
          })),
          current: null,
        },
        interactive: {
          pane: interactivePane,
          canvas: interactiveUi.canvas,
          ctx: interactiveUi.ctx,
          counter: interactiveUi.counter,
          tabBar,
          runButton,
          prompts: parseArray(promptsWidget?.value, [promptTemplate(0)]).map(clonePrompt),
          activePromptIndex: 0,
          currentBox: null,
          isDrawingBox: false,
          hoveredItem: null,
        },
      };

      if (!this.sam3Complex.interactive.prompts.length) {
        this.sam3Complex.interactive.prompts = [promptTemplate(0)];
      }

      const domWidget = this.addDOMWidget("sam3_complex_collector", "sam3_complex_collector", container);
      domWidget.computeSize = (width) => [width, Math.max(420, this.size?.[1] ? this.size[1] - 80 : 520)];
      container.style.height = "520px";
      this.setSize([Math.max(430, this.size?.[0] || 430), Math.max(620, this.size?.[1] || 620)]);

      this.bindSAM3ComplexBBoxEvents();
      this.bindSAM3ComplexInteractiveEvents();
      this.rebuildSAM3ComplexPromptTabs();
      this.setSAM3ComplexMode(this.sam3Complex.mode);
      this.updateSAM3ComplexStorage();
      this.redrawSAM3ComplexAll();

      chainCallback(this, "onResize", function (size) {
        container.style.height = `${Math.max(420, Number(size?.[1] || 0) - 80)}px`;
      });

      chainCallback(this, "onDrawForeground", function () {
        for (const widget of this.widgets || []) {
          if (["collector_mode", "bboxes", "neg_bboxes", "multi_prompts_store"].includes(widget?.name)) {
            hideWidget(widget);
          }
        }
      });

      chainCallback(this, "onSerialize", function () {
        this.updateSAM3ComplexStorage?.();
      });

      chainCallback(this, "onConfigure", function () {
        setTimeout(() => {
          this.restoreSAM3ComplexFromWidgets?.();
          this.setSAM3ComplexMode?.(this.sam3Complex?.mode || MODE_BBOX);
        }, 0);
      });

      chainCallback(this, "onExecuted", function (message) {
        if (message?.bg_image?.[0]) {
          const image = new Image();
          image.onload = () => {
            this.sam3Complex.bgImage = image;
            this.resizeSAM3ComplexCanvases(image.width, image.height);
            this.redrawSAM3ComplexAll();
          };
          image.src = `data:image/jpeg;base64,${message.bg_image[0]}`;
        }

        if (message?.overlay_image?.[0]) {
          const image = new Image();
          image.onload = () => {
            this.sam3Complex.overlayImage = image;
            this.sam3Complex.overlayMode = this.sam3Complex.mode;
            this.redrawSAM3ComplexAll();
          };
          image.src = `data:image/jpeg;base64,${message.overlay_image[0]}`;
        }

        this.sam3Complex.running = false;
        this.updateSAM3ComplexRunButton();
      });
    });

    nodeType.prototype.resizeSAM3ComplexCanvases = function (width, height) {
      for (const canvas of [this.sam3Complex.bbox.canvas, this.sam3Complex.interactive.canvas]) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    nodeType.prototype.setSAM3ComplexMode = function (mode) {
      const normalized = mode === MODE_INTERACTIVE ? MODE_INTERACTIVE : MODE_BBOX;
      this.sam3Complex.mode = normalized;
      if (this.sam3Complex.widgets.mode) {
        this.sam3Complex.widgets.mode.value = normalized;
        this.sam3Complex.widgets.mode.serializeValue = () => normalized;
      }
      this.sam3Complex.bbox.pane.style.display = normalized === MODE_BBOX ? "flex" : "none";
      this.sam3Complex.interactive.pane.style.display = normalized === MODE_INTERACTIVE ? "flex" : "none";
      for (const [key, modeButton] of Object.entries(this.sam3Complex.modeButtons)) {
        const active = key === normalized;
        modeButton.style.background = active ? "#3f5268" : "#252525";
        modeButton.style.color = active ? "#fff" : "#ddd";
        modeButton.setAttribute("aria-selected", String(active));
        modeButton.tabIndex = active ? 0 : -1;
      }
      this.updateSAM3ComplexStorage();
      this.redrawSAM3ComplexAll();
    };

    nodeType.prototype.restoreSAM3ComplexFromWidgets = function () {
      const state = this.sam3Complex;
      if (!state) {
        return;
      }
      state.mode = state.widgets.mode?.value === MODE_INTERACTIVE ? MODE_INTERACTIVE : MODE_BBOX;
      state.bbox.positive = parseArray(state.widgets.bboxes?.value).map((box) => ({
        x1: Number(box.x1 ?? box.x ?? 0),
        y1: Number(box.y1 ?? box.y ?? 0),
        x2: Number(box.x2 ?? ((box.x ?? 0) + (box.w ?? 0))),
        y2: Number(box.y2 ?? ((box.y ?? 0) + (box.h ?? 0))),
      }));
      state.bbox.negative = parseArray(state.widgets.negBboxes?.value).map((box) => ({
        x1: Number(box.x1 ?? box.x ?? 0),
        y1: Number(box.y1 ?? box.y ?? 0),
        x2: Number(box.x2 ?? ((box.x ?? 0) + (box.w ?? 0))),
        y2: Number(box.y2 ?? ((box.y ?? 0) + (box.h ?? 0))),
      }));
      state.interactive.prompts = parseArray(state.widgets.prompts?.value, [promptTemplate(0)]).map(clonePrompt);
      if (!state.interactive.prompts.length) {
        state.interactive.prompts = [promptTemplate(0)];
      }
      state.interactive.activePromptIndex = Math.min(
        state.interactive.activePromptIndex,
        Math.max(0, state.interactive.prompts.length - 1),
      );
      this.rebuildSAM3ComplexPromptTabs();
      this.redrawSAM3ComplexAll();
    };

    nodeType.prototype.updateSAM3ComplexStorage = function () {
      const state = this.sam3Complex;
      if (!state) {
        return;
      }
      if (state.widgets.mode) {
        state.widgets.mode.value = state.mode;
        state.widgets.mode.serializeValue = () => state.mode;
      }
      if (state.widgets.bboxes) {
        state.widgets.bboxes.value = JSON.stringify(state.bbox.positive);
        state.widgets.bboxes.serializeValue = () => state.widgets.bboxes.value;
      }
      if (state.widgets.negBboxes) {
        state.widgets.negBboxes.value = JSON.stringify(state.bbox.negative);
        state.widgets.negBboxes.serializeValue = () => state.widgets.negBboxes.value;
      }
      if (state.widgets.prompts) {
        state.widgets.prompts.value = JSON.stringify(state.interactive.prompts.map(clonePrompt));
        state.widgets.prompts.serializeValue = () => state.widgets.prompts.value;
      }
      this.updateSAM3ComplexCounters();
      app.graph.setDirtyCanvas(true, true);
    };

    nodeType.prototype.updateSAM3ComplexCounters = function () {
      const state = this.sam3Complex;
      state.bbox.counter.textContent = `Bboxes: ${state.bbox.positive.length} pos, ${state.bbox.negative.length} neg`;
      const prompt = state.interactive.prompts[state.interactive.activePromptIndex] || promptTemplate(0);
      const points = prompt.positive_points.length + prompt.negative_points.length;
      const boxes = prompt.positive_boxes.length + prompt.negative_boxes.length;
      state.interactive.counter.textContent = `${prompt.name || "Prompt"}: ${points} pts, ${boxes} boxes`;
      this.updateSAM3ComplexRunButton();
    };

    nodeType.prototype.updateSAM3ComplexRunButton = function () {
      const state = this.sam3Complex;
      const prompt = state?.interactive.prompts[state.interactive.activePromptIndex];
      const hasPrompt =
        prompt &&
        (prompt.positive_points.length ||
          prompt.negative_points.length ||
          prompt.positive_boxes.length ||
          prompt.negative_boxes.length);
      const disabled = state?.running || !hasPrompt;
      if (state?.interactive.runButton) {
        state.interactive.runButton.disabled = disabled;
        state.interactive.runButton.style.opacity = disabled ? "0.45" : "1";
        state.interactive.runButton.style.cursor = disabled ? "default" : "pointer";
      }
    };

    nodeType.prototype.bindSAM3ComplexBBoxEvents = function () {
      const canvas = this.sam3Complex.bbox.canvas;
      canvas.addEventListener("mousedown", (event) => {
        const image = this.sam3Complex.bgImage;
        if (!image || (event.button !== 0 && event.button !== 2)) {
          return;
        }
        event.preventDefault();
        const coords = canvasCoords(canvas, event);
        const hit = this.findSAM3ComplexBBox(coords.x, coords.y);
        if (event.button === 2 && hit) {
          const list = hit.isNegative ? this.sam3Complex.bbox.negative : this.sam3Complex.bbox.positive;
          list.splice(hit.index, 1);
          this.updateSAM3ComplexStorage();
          this.redrawSAM3ComplexBBox();
          return;
        }
        this.sam3Complex.bbox.current = {
          x1: coords.x,
          y1: coords.y,
          x2: coords.x,
          y2: coords.y,
          isNegative: event.shiftKey || event.button === 2,
        };
      });

      canvas.addEventListener("mousemove", (event) => {
        const current = this.sam3Complex.bbox.current;
        if (!current) {
          return;
        }
        const coords = canvasCoords(canvas, event);
        current.x2 = coords.x;
        current.y2 = coords.y;
        this.redrawSAM3ComplexBBox();
      });

      canvas.addEventListener("mouseup", () => {
        const current = this.sam3Complex.bbox.current;
        if (!current) {
          return;
        }
        const box = {
          x1: Math.min(current.x1, current.x2),
          y1: Math.min(current.y1, current.y2),
          x2: Math.max(current.x1, current.x2),
          y2: Math.max(current.y1, current.y2),
        };
        this.sam3Complex.bbox.current = null;
        if (box.x2 - box.x1 > 5 && box.y2 - box.y1 > 5) {
          const list = current.isNegative ? this.sam3Complex.bbox.negative : this.sam3Complex.bbox.positive;
          list.push(box);
          this.updateSAM3ComplexStorage();
        }
        this.redrawSAM3ComplexBBox();
      });

      canvas.addEventListener("mouseleave", () => {
        this.sam3Complex.bbox.current = null;
        this.redrawSAM3ComplexBBox();
      });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    };

    nodeType.prototype.bindSAM3ComplexInteractiveEvents = function () {
      const canvas = this.sam3Complex.interactive.canvas;
      canvas.addEventListener("mousedown", (event) => {
        if (!this.sam3Complex.bgImage || (event.button !== 0 && event.button !== 2)) {
          return;
        }
        event.preventDefault();
        const coords = canvasCoords(canvas, event);
        const prompt = this.getSAM3ComplexActivePrompt();
        if (!prompt) {
          return;
        }
        if (event.shiftKey) {
          this.sam3Complex.interactive.currentBox = {
            x1: coords.x,
            y1: coords.y,
            x2: coords.x,
            y2: coords.y,
            isNegative: event.button === 2,
          };
          this.sam3Complex.interactive.isDrawingBox = true;
          this.redrawSAM3ComplexInteractive();
          return;
        }
        const list = event.button === 2 ? prompt.negative_points : prompt.positive_points;
        list.push({ x: coords.x, y: coords.y });
        this.updateSAM3ComplexStorage();
        this.redrawSAM3ComplexInteractive();
      });

      canvas.addEventListener("mousemove", (event) => {
        const state = this.sam3Complex.interactive;
        const coords = canvasCoords(canvas, event);
        if (state.isDrawingBox && state.currentBox) {
          state.currentBox.x2 = coords.x;
          state.currentBox.y2 = coords.y;
          this.redrawSAM3ComplexInteractive();
          return;
        }
        const hovered = this.findSAM3ComplexPromptItem(coords.x, coords.y);
        if (hovered !== state.hoveredItem) {
          state.hoveredItem = hovered;
          this.redrawSAM3ComplexInteractive();
        }
      });

      canvas.addEventListener("mouseup", () => {
        const state = this.sam3Complex.interactive;
        if (!state.isDrawingBox || !state.currentBox) {
          return;
        }
        const current = state.currentBox;
        const box = {
          x1: Math.min(current.x1, current.x2),
          y1: Math.min(current.y1, current.y2),
          x2: Math.max(current.x1, current.x2),
          y2: Math.max(current.y1, current.y2),
        };
        state.currentBox = null;
        state.isDrawingBox = false;
        if (box.x2 - box.x1 > 5 && box.y2 - box.y1 > 5) {
          const prompt = this.getSAM3ComplexActivePrompt();
          const list = current.isNegative ? prompt.negative_boxes : prompt.positive_boxes;
          list.push(box);
          this.updateSAM3ComplexStorage();
        }
        this.redrawSAM3ComplexInteractive();
      });

      canvas.addEventListener("mouseleave", () => {
        this.sam3Complex.interactive.currentBox = null;
        this.sam3Complex.interactive.isDrawingBox = false;
        this.redrawSAM3ComplexInteractive();
      });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    };

    nodeType.prototype.findSAM3ComplexBBox = function (x, y) {
      const state = this.sam3Complex.bbox;
      for (const [isNegative, boxes] of [
        [false, state.positive],
        [true, state.negative],
      ]) {
        for (let index = boxes.length - 1; index >= 0; index -= 1) {
          const box = boxes[index];
          if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
            return { index, isNegative };
          }
        }
      }
      return null;
    };

    nodeType.prototype.findSAM3ComplexPromptItem = function (x, y) {
      const state = this.sam3Complex.interactive;
      const prompt = this.getSAM3ComplexActivePrompt();
      const threshold = 10;
      for (const [type, isNegative, items] of [
        ["point", false, prompt.positive_points],
        ["point", true, prompt.negative_points],
      ]) {
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const point = items[index];
          if (Math.abs(point.x - x) <= threshold && Math.abs(point.y - y) <= threshold) {
            return { type, index, isNegative };
          }
        }
      }
      for (const [isNegative, boxes] of [
        [false, prompt.positive_boxes],
        [true, prompt.negative_boxes],
      ]) {
        for (let index = boxes.length - 1; index >= 0; index -= 1) {
          const box = boxes[index];
          if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
            return { type: "box", index, isNegative };
          }
        }
      }
      return null;
    };

    nodeType.prototype.getSAM3ComplexActivePrompt = function () {
      return this.sam3Complex.interactive.prompts[this.sam3Complex.interactive.activePromptIndex];
    };

    nodeType.prototype.rebuildSAM3ComplexPromptTabs = function () {
      const state = this.sam3Complex.interactive;
      state.tabBar.innerHTML = "";
      state.prompts.forEach((prompt, index) => {
        const color = PROMPT_COLORS[index % PROMPT_COLORS.length];
        const active = index === state.activePromptIndex;
        const tab = document.createElement("div");
        tab.style.cssText = [
          "height:24px",
          "display:flex",
          "align-items:center",
          "gap:6px",
          "border-radius:4px",
          `border:1px solid ${active ? color : "#444"}`,
          `background:${active ? "#333" : "#252525"}`,
          `color:${active ? "#fff" : "#aaa"}`,
          "font:11px sans-serif",
          "cursor:pointer",
          "padding:0 8px",
        ].join(";");
        const label = document.createElement("span");
        label.textContent = prompt.name || `Prompt ${index + 1}`;
        tab.appendChild(label);
        if (state.prompts.length > 1) {
          const remove = document.createElement("span");
          remove.textContent = "x";
          remove.title = "Delete prompt";
          remove.style.cssText = "color:#999;font-weight:700;padding:0 2px;cursor:pointer";
          remove.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            state.prompts.splice(index, 1);
            state.activePromptIndex = Math.min(state.activePromptIndex, state.prompts.length - 1);
            this.updateSAM3ComplexStorage();
            this.rebuildSAM3ComplexPromptTabs();
            this.redrawSAM3ComplexInteractive();
          };
          tab.appendChild(remove);
        }
        tab.onclick = () => {
          state.activePromptIndex = index;
          this.rebuildSAM3ComplexPromptTabs();
          this.redrawSAM3ComplexInteractive();
        };
        state.tabBar.appendChild(tab);
      });
      if (state.prompts.length < MAX_PROMPTS) {
        const add = button("+", "Add prompt", () => {
          state.prompts.push(promptTemplate(state.prompts.length));
          state.activePromptIndex = state.prompts.length - 1;
          this.updateSAM3ComplexStorage();
          this.rebuildSAM3ComplexPromptTabs();
          this.redrawSAM3ComplexInteractive();
        });
        state.tabBar.appendChild(add);
      }
      this.updateSAM3ComplexCounters();
    };

    nodeType.prototype.clearSAM3ComplexActivePrompt = function () {
      const prompt = this.getSAM3ComplexActivePrompt();
      if (!prompt) {
        return;
      }
      prompt.positive_points = [];
      prompt.negative_points = [];
      prompt.positive_boxes = [];
      prompt.negative_boxes = [];
      this.updateSAM3ComplexStorage();
      this.redrawSAM3ComplexInteractive();
    };

    nodeType.prototype.clearSAM3ComplexPrompts = function () {
      this.sam3Complex.interactive.prompts = [promptTemplate(0)];
      this.sam3Complex.interactive.activePromptIndex = 0;
      this.updateSAM3ComplexStorage();
      this.rebuildSAM3ComplexPromptTabs();
      this.redrawSAM3ComplexInteractive();
    };

    nodeType.prototype.runSAM3ComplexInteractive = async function () {
      const state = this.sam3Complex;
      const prompt = this.getSAM3ComplexActivePrompt();
      if (!prompt || state.running) {
        return;
      }
      state.running = true;
      this.setSAM3ComplexMode(MODE_INTERACTIVE);
      this.updateSAM3ComplexRunButton();
      this.updateSAM3ComplexStorage();
      try {
        const result = app.queuePrompt(0, 1);
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (error) {
        console.error("Failed to queue SAM3 Complex Collector", error);
        state.running = false;
        this.updateSAM3ComplexRunButton();
      }
    };

    nodeType.prototype.resolveSAM3ComplexImageSource = function () {
      const imageInput = this.inputs?.find((input) => input.name === "image");
      if (!imageInput?.link || !this.graph?.links) {
        return null;
      }

      const link = this.graph.links[imageInput.link];
      const origin = link ? this.graph.getNodeById(link.origin_id) : null;
      if (!origin) {
        return null;
      }

      const imageWidget = origin.widgets?.find((widget) => widget.name === "image");
      if (imageWidget?.value) {
        return getImageUrl(imageWidget.value, "input");
      }

      const uploadWidget = origin.widgets?.find((widget) => widget.name === "upload");
      if (uploadWidget?.value) {
        return getImageUrl(uploadWidget.value, "input");
      }

      const imageProperty = origin.properties?.image_value || origin.properties?.image;
      if (imageProperty) {
        return getImageUrl(imageProperty, "input");
      }

      const renderedImage = origin.imgs?.[0] || origin.image;
      if (renderedImage?.src) {
        return renderedImage.src;
      }

      return null;
    };

    nodeType.prototype.loadSAM3ComplexImageUrl = function (url) {
      if (!url) {
        return false;
      }

      const image = new Image();
      image.onload = () => {
        this.sam3Complex.bgImage = image;
        this.sam3Complex.overlayImage = null;
        this.sam3Complex.overlayMode = null;
        this.resizeSAM3ComplexCanvases(image.width, image.height);
        this.redrawSAM3ComplexAll();
      };
      image.onerror = () => {
        console.warn("Failed to load SAM3 Complex Collector image preview", url);
      };
      image.src = url;
      return true;
    };

    nodeType.prototype.refreshSAM3ComplexImage = function () {
      const state = this.sam3Complex;
      if (!state) {
        return;
      }
      state.refreshButton.disabled = true;
      state.refreshButton.style.opacity = "0.45";
      this.updateSAM3ComplexStorage();

      const url = this.resolveSAM3ComplexImageSource();
      if (!this.loadSAM3ComplexImageUrl(url)) {
        console.warn("SAM3 Complex Collector could not resolve a directly loadable image from the image socket.");
      }

      setTimeout(() => {
        state.refreshButton.disabled = false;
        state.refreshButton.style.opacity = "1";
        this.updateSAM3ComplexRunButton();
      }, 120);
    };

    nodeType.prototype.redrawSAM3ComplexAll = function () {
      this.redrawSAM3ComplexBBox();
      this.redrawSAM3ComplexInteractive();
      this.updateSAM3ComplexCounters();
    };

    nodeType.prototype.drawSAM3ComplexBackground = function (ctx, canvas, mode) {
      const state = this.sam3Complex;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const image = state.overlayMode === mode && state.overlayImage ? state.overlayImage : state.bgImage;
      if (image) {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return;
      }
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#888";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Connect an image node and click Load Image", canvas.width / 2, canvas.height / 2 - 10);
    };

    nodeType.prototype.redrawSAM3ComplexBBox = function () {
      const { canvas, ctx, positive, negative, current } = this.sam3Complex.bbox;
      this.drawSAM3ComplexBackground(ctx, canvas, MODE_BBOX);
      const drawBoxes = (boxes, color, fill, dashed = false) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = fill;
        ctx.lineWidth = 2;
        if (dashed) {
          ctx.setLineDash([4, 4]);
        }
        for (const box of boxes) {
          ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
          ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
        }
        ctx.restore();
      };
      drawBoxes(positive, "#00ffff", "rgba(0,255,255,0.14)");
      drawBoxes(negative, "#ff3333", "rgba(255,0,0,0.14)", true);
      if (current) {
        drawBoxes([current], current.isNegative ? "#ff8800" : "#ffff00", "rgba(255,255,0,0.1)", true);
      }
    };

    nodeType.prototype.redrawSAM3ComplexInteractive = function () {
      const state = this.sam3Complex.interactive;
      const { canvas, ctx, currentBox, hoveredItem } = state;
      this.drawSAM3ComplexBackground(ctx, canvas, MODE_INTERACTIVE);
      const prompt = this.getSAM3ComplexActivePrompt();
      if (!prompt) {
        return;
      }
      const color = PROMPT_COLORS[state.activePromptIndex % PROMPT_COLORS.length];

      const drawBoxes = (boxes, isNegative) => {
        for (let index = 0; index < boxes.length; index += 1) {
          const box = boxes[index];
          const hovered = hoveredItem?.type === "box" && hoveredItem.index === index && hoveredItem.isNegative === isNegative;
          ctx.save();
          ctx.fillStyle = isNegative ? "rgba(255,0,0,0.14)" : hexAlpha(color, 0.14);
          ctx.strokeStyle = hovered ? "#fff" : isNegative ? "#ff3333" : color;
          ctx.lineWidth = hovered ? 3 : 2;
          if (isNegative) {
            ctx.setLineDash([4, 4]);
          }
          ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
          ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
          ctx.restore();
        }
      };

      const drawPoints = (points, isNegative) => {
        for (let index = 0; index < points.length; index += 1) {
          const point = points[index];
          const hovered = hoveredItem?.type === "point" && hoveredItem.index === index && hoveredItem.isNegative === isNegative;
          ctx.save();
          ctx.beginPath();
          ctx.arc(point.x, point.y, hovered ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = isNegative ? "#ff3333" : color;
          ctx.fill();
          ctx.strokeStyle = hovered ? "#fff" : "#111";
          ctx.lineWidth = 2;
          ctx.stroke();
          if (isNegative) {
            ctx.strokeStyle = "#fff";
            ctx.beginPath();
            ctx.moveTo(point.x - 4, point.y - 4);
            ctx.lineTo(point.x + 4, point.y + 4);
            ctx.moveTo(point.x + 4, point.y - 4);
            ctx.lineTo(point.x - 4, point.y + 4);
            ctx.stroke();
          }
          ctx.restore();
        }
      };

      drawBoxes(prompt.positive_boxes, false);
      drawBoxes(prompt.negative_boxes, true);
      drawPoints(prompt.positive_points, false);
      drawPoints(prompt.negative_points, true);
      if (currentBox) {
        drawBoxes([currentBox], currentBox.isNegative);
      }
    };
  },
});
