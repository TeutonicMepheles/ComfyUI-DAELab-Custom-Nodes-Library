import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function chainCallback(object, property, callback) {
  const original = object[property];
  if (original) {
    object[property] = function () {
      const result = original.apply(this, arguments);
      callback.apply(this, arguments);
      return result;
    };
  } else {
    object[property] = callback;
  }
}

function createButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.style.cssText = [
    "height:24px",
    "min-width:28px",
    "border:1px solid #3a3a3a",
    "border-radius:4px",
    "background:#252525",
    "color:#ddd",
    "font:12px sans-serif",
    "cursor:pointer",
    "padding:0 7px",
  ].join(";");
  button.addEventListener("click", onClick);
  return button;
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

function getImageUrl(imageName) {
  const { filename, subfolder } = splitImagePath(imageName);
  return api.apiURL(
    `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&rand=${Math.random()}`,
  );
}

function cloneBoxes(boxes) {
  return boxes.map((box) => ({ x: box.x, y: box.y, w: box.w, h: box.h }));
}

const STALE_BOOLEAN_NAMES = new Set([
  "enabled_note",
  "enabled",
  "enabled_2_note",
  "enabled_2",
  "enabled_3_note",
  "enabled_3",
  "enabled_4_note",
  "enabled_4",
]);

const LOAD_BBOX_OUTPUT_NAMES = ["image", "bboxes", "neg_bboxes", "string"];

const BBOX_PANEL_DEFAULT_HEIGHT = 410;
const BBOX_PANEL_MIN_HEIGHT = 260;
const BBOX_PANEL_MAX_HEIGHT = 1400;

function clampBBoxPanelHeight(height) {
  const numericHeight = Number(height);
  if (!Number.isFinite(numericHeight)) {
    return BBOX_PANEL_DEFAULT_HEIGHT;
  }
  return Math.max(BBOX_PANEL_MIN_HEIGHT, Math.min(BBOX_PANEL_MAX_HEIGHT, numericHeight));
}

app.registerExtension({
  name: "comfyui_bbox_loader.LoadImageBooleanBBox",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === "BBoxPromptReroute") {
      if (typeof LiteGraph !== "undefined") {
        nodeType.title_mode = LiteGraph.NO_TITLE;
      }
      nodeType.collapsable = false;

      chainCallback(nodeType.prototype, "onNodeCreated", function () {
        this.title = "BBox";
        this.color = "#273447";
        this.bgcolor = "#18202b";
        this.size = [170, 58];

        if (this.inputs?.[0]) {
          this.inputs[0].label = "bboxes";
        }
        if (this.inputs?.[1]) {
          this.inputs[1].label = "neg";
        }
        if (this.outputs?.[0]) {
          this.outputs[0].label = "bboxes";
        }
        if (this.outputs?.[1]) {
          this.outputs[1].label = "neg";
        }

        for (const slot of [...(this.inputs || []), ...(this.outputs || [])]) {
          if (slot) {
            slot.color_on = slot.name === "neg_bboxes" ? "#ff6b6b" : "#4aa3ff";
            slot.color_off = slot.color_on;
          }
        }
      });

      chainCallback(nodeType.prototype, "onConnectionsChange", function () {
        for (const slot of [...(this.inputs || []), ...(this.outputs || [])]) {
          if (slot) {
            slot.color_on = slot.name === "neg_bboxes" ? "#ff6b6b" : "#4aa3ff";
            slot.color_off = slot.color_on;
          }
        }
      });

      return;
    }

    if (nodeData.name !== "LoadImageBooleanBBox") {
      return;
    }

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const imageWidget = this.widgets.find((widget) => widget.name === "image");
      const stringWidget = this.widgets.find((widget) => widget.name === "string_value");

      if (!imageWidget) {
        return;
      }

      this.properties = this.properties || {};
      this.properties.bbox_info = this.properties.bbox_info || "";
      delete this.properties.boolean_count;
      delete this.properties.boolean_state;
      this.removeStaleBooleanArtifacts?.();
      this.properties.bbox_canvas_height = clampBBoxPanelHeight(this.properties.bbox_canvas_height);
      this.restoreSimpleWidgetState?.();

      const container = document.createElement("div");
      container.style.cssText = [
        "position:relative",
        "width:100%",
        "height:100%",
        "background:#101214",
        "border-radius:4px",
        "overflow:hidden",
        "display:flex",
        "flex-direction:column",
        "box-sizing:border-box",
      ].join(";");

      const toolbar = document.createElement("div");
      toolbar.style.cssText = [
        "height:32px",
        "flex:0 0 32px",
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:8px",
        "padding:4px",
        "box-sizing:border-box",
        "background:#202225",
        "border-bottom:1px solid #333",
      ].join(";");

      const leftGroup = document.createElement("div");
      leftGroup.style.cssText = "display:flex;align-items:center;gap:4px";

      const rightGroup = document.createElement("div");
      rightGroup.style.cssText = "display:flex;align-items:center;gap:4px";

      const canvasWrapper = document.createElement("div");
      canvasWrapper.style.cssText = [
        "flex:1",
        "min-height:180px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "overflow:hidden",
        "background:#0f1011",
      ].join(";");

      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      canvas.style.cssText = [
        "display:block",
        "max-width:100%",
        "max-height:100%",
        "object-fit:contain",
        "cursor:crosshair",
      ].join(";");
      canvasWrapper.appendChild(canvas);

      container.appendChild(toolbar);
      container.appendChild(canvasWrapper);

      const ctx = canvas.getContext("2d");

      this.bboxWidget = {
        container,
        canvas,
        ctx,
        image: null,
        mode: "bbox",
        bbox: [],
        neg_bbox: [],
        history: [],
        historyIndex: -1,
        isDrawingBox: false,
        currentBox: null,
        imageValue: null,
        loadToken: 0,
        lastNodeHeight: this.size?.[1] || null,
        resizeReady: false,
      };

      const bboxButton = createButton("BBox", "Draw positive bbox", () => this.setBBoxMode("bbox"));
      const negButton = createButton("Neg", "Draw negative bbox", () => this.setBBoxMode("neg_bbox"));
      const undoButton = createButton("Undo", "Undo last box action", () => this.undoBBox());
      const redoButton = createButton("Redo", "Redo box action", () => this.redoBBox());
      const refreshButton = createButton("Refresh", "Refresh canvas preview image", () => this.loadBBoxImage(true));
      const clearButton = createButton("Clear", "Clear all boxes", () => {
        if (!this.bboxWidget.bbox.length && !this.bboxWidget.neg_bbox.length) {
          return;
        }
        this.clearBBoxAnnotations(false, false);
        this.pushBBoxHistory();
        this.updateBBoxInfo();
        this.redrawBBoxCanvas();
        this.updateBBoxButtons();
      });

      leftGroup.appendChild(undoButton);
      leftGroup.appendChild(redoButton);
      leftGroup.appendChild(refreshButton);
      leftGroup.appendChild(clearButton);
      rightGroup.appendChild(bboxButton);
      rightGroup.appendChild(negButton);
      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);

      this.bboxWidget.buttons = {
        bbox: bboxButton,
        neg_bbox: negButton,
        undo: undoButton,
        redo: redoButton,
        refresh: refreshButton,
        clear: clearButton,
      };

      const domWidget = this.addDOMWidget("bbox_canvas", "bbox_canvas", container);
      domWidget.computeSize = (width) => {
        return [width, this.getBBoxPanelHeight()];
      };

      this.setBBoxMode("bbox");
      this.restoreBBoxInfo();
      this.resetBBoxHistory();
      this.loadBBoxImage(false);
      this.redrawBBoxCanvas();
      this.updateBBoxButtons();

      const originalImageCallback = imageWidget.callback;
      imageWidget.callback = (...args) => {
        const result = originalImageCallback?.apply(imageWidget, args);
        this.saveSimpleWidgetState?.(true);
        this.handleBBoxImageSelectionChanged(true);
        return result;
      };

      if (stringWidget && !stringWidget._bboxLoaderStateBound) {
        const originalStringCallback = stringWidget.callback;
        stringWidget.callback = (...args) => {
          const result = originalStringCallback?.apply(stringWidget, args);
          this.saveSimpleWidgetState?.(true);
          return result;
        };
        stringWidget._bboxLoaderStateBound = true;
      }

      chainCallback(this, "onResize", function (size) {
        const previousNodeHeight = this.bboxWidget.lastNodeHeight;
        const nextNodeHeight = Number(size?.[1]);

        if (this.bboxWidget.suppressNextResize) {
          this.bboxWidget.lastNodeHeight = nextNodeHeight;
          return;
        }

        if (!this.bboxWidget.resizeReady) {
          this.setBBoxPanelHeight(this.getBBoxPanelHeight(), false);
          this.bboxWidget.lastNodeHeight = nextNodeHeight;
          return;
        }

        if (Number.isFinite(previousNodeHeight) && Number.isFinite(nextNodeHeight)) {
          const delta = nextNodeHeight - previousNodeHeight;
          if (Math.abs(delta) >= 1) {
            this.setBBoxPanelHeight(this.getBBoxPanelHeight() + delta, false);
          }
        } else {
          this.setBBoxPanelHeight(this.getBBoxPanelHeight(), false);
        }

        this.bboxWidget.lastNodeHeight = nextNodeHeight;
      });

      chainCallback(this, "onDrawForeground", function () {
        this.handleBBoxImageSelectionChanged(false);
        this.setBBoxPanelHeight(this.getBBoxPanelHeight(), false);
      });

      const getCoords = (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * scaleX)),
          y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * scaleY)),
        };
      };

      canvas.addEventListener("mousedown", (event) => {
        if (!this.bboxWidget.image || event.button !== 0) {
          return;
        }
        event.preventDefault();
        const coords = getCoords(event);
        this.bboxWidget.isDrawingBox = true;
        this.bboxWidget.currentBox = { x: coords.x, y: coords.y, w: 0, h: 0 };
      });

      canvas.addEventListener("mousemove", (event) => {
        const { isDrawingBox, currentBox, image } = this.bboxWidget;
        if (!image || !isDrawingBox || !currentBox) {
          return;
        }
        const coords = getCoords(event);
        currentBox.w = coords.x - currentBox.x;
        currentBox.h = coords.y - currentBox.y;
        this.redrawBBoxCanvas();
      });

      canvas.addEventListener("mouseup", () => {
        const { isDrawingBox, currentBox, mode, image } = this.bboxWidget;
        if (!image || !isDrawingBox || !currentBox) {
          return;
        }

        const box = {
          x: Math.min(currentBox.x, currentBox.x + currentBox.w),
          y: Math.min(currentBox.y, currentBox.y + currentBox.h),
          w: Math.abs(currentBox.w),
          h: Math.abs(currentBox.h),
        };

        this.bboxWidget.isDrawingBox = false;
        this.bboxWidget.currentBox = null;

        if (box.w > 5 && box.h > 5) {
          this.bboxWidget[mode].push(box);
          this.pushBBoxHistory();
          this.updateBBoxInfo();
          this.updateBBoxButtons();
        }

        this.redrawBBoxCanvas();
      });

      canvas.addEventListener("mouseleave", () => {
        if (this.bboxWidget.isDrawingBox) {
          this.bboxWidget.isDrawingBox = false;
          this.bboxWidget.currentBox = null;
          this.redrawBBoxCanvas();
        }
      });

      canvas.addEventListener("contextmenu", (event) => event.preventDefault());

      container.style.height = `${this.getBBoxPanelHeight()}px`;
      setTimeout(() => {
        if (!this.bboxWidget) {
          return;
        }
        this.bboxWidget.lastNodeHeight = Number(this.size?.[1]) || this.bboxWidget.lastNodeHeight;
        this.bboxWidget.resizeReady = true;
      }, 250);
    });

    nodeType.prototype.getBBoxPanelHeight = function () {
      this.properties = this.properties || {};
      this.properties.bbox_canvas_height = clampBBoxPanelHeight(this.properties.bbox_canvas_height);
      return this.properties.bbox_canvas_height;
    };

    nodeType.prototype.setBBoxPanelHeight = function (height, markDirty = true) {
      const panelHeight = clampBBoxPanelHeight(height);
      this.properties = this.properties || {};
      this.properties.bbox_canvas_height = panelHeight;

      if (this.bboxWidget?.container) {
        this.bboxWidget.container.style.height = `${panelHeight}px`;
      }

      if (markDirty) {
        app.graph.setDirtyCanvas(true, true);
      }
    };

    nodeType.prototype.removeStaleBooleanArtifacts = function () {
      this.properties = this.properties || {};
      delete this.properties.boolean_count;
      delete this.properties.boolean_state;

      if (Array.isArray(this.widgets)) {
        this.widgets = this.widgets.filter((widget) => !STALE_BOOLEAN_NAMES.has(widget?.name));
      }

      if (Array.isArray(this.inputs)) {
        for (let index = this.inputs.length - 1; index >= 0; index -= 1) {
          if (!STALE_BOOLEAN_NAMES.has(this.inputs[index]?.name)) {
            continue;
          }

          if (typeof this.removeInput === "function") {
            this.removeInput(index);
          } else {
            this.inputs.splice(index, 1);
          }
        }
      }

      if (Array.isArray(this.outputs)) {
        for (let index = this.outputs.length - 1; index >= 0; index -= 1) {
          if (!STALE_BOOLEAN_NAMES.has(this.outputs[index]?.name)) {
            continue;
          }

          if (typeof this.removeOutput === "function") {
            this.removeOutput(index);
          } else {
            this.outputs.splice(index, 1);
          }
        }
      }

      this.normalizeLoadBBoxOutputs?.();
    };

    nodeType.prototype.normalizeLoadBBoxOutputs = function () {
      if (!Array.isArray(this.outputs)) {
        return;
      }

      const seen = new Set();
      for (let index = this.outputs.length - 1; index >= 0; index -= 1) {
        const output = this.outputs[index];
        const name = output?.name;
        if (!LOAD_BBOX_OUTPUT_NAMES.includes(name) || seen.has(name)) {
          if (typeof this.removeOutput === "function") {
            this.removeOutput(index);
          } else {
            this.outputs.splice(index, 1);
          }
          continue;
        }

        seen.add(name);
      }

      this.outputs.sort(
        (left, right) => LOAD_BBOX_OUTPUT_NAMES.indexOf(left.name) - LOAD_BBOX_OUTPUT_NAMES.indexOf(right.name),
      );
      this.reindexLoadBBoxOutputLinks?.();
    };

    nodeType.prototype.reindexLoadBBoxOutputLinks = function () {
      if (!Array.isArray(this.outputs) || !this.graph?.links) {
        return;
      }

      for (let outputIndex = 0; outputIndex < this.outputs.length; outputIndex += 1) {
        const output = this.outputs[outputIndex];
        if (!Array.isArray(output?.links)) {
          continue;
        }

        for (const linkId of output.links) {
          const link = this.graph.links[linkId];
          if (link && link.origin_id === this.id) {
            link.origin_slot = outputIndex;
          }
        }
      }
    };

    nodeType.prototype.saveSimpleWidgetState = function (markDirty = true) {
      this.properties = this.properties || {};

      const imageWidget = this.widgets?.find((widget) => widget.name === "image");
      if (imageWidget) {
        this.properties.image_value = imageWidget.value || "";
      }

      const stringWidget = this.widgets?.find((widget) => widget.name === "string_value");
      if (stringWidget) {
        this.properties.string_value = stringWidget.value ?? "";
      }

      if (markDirty) {
        app.graph.setDirtyCanvas(true, true);
      }
    };

    nodeType.prototype.restoreSimpleWidgetState = function () {
      this.properties = this.properties || {};

      const imageWidget = this.widgets?.find((widget) => widget.name === "image");
      if (imageWidget && Object.prototype.hasOwnProperty.call(this.properties, "image_value")) {
        imageWidget.value = this.properties.image_value || imageWidget.value || "";
      }

      const stringWidget = this.widgets?.find((widget) => widget.name === "string_value");
      if (stringWidget && Object.prototype.hasOwnProperty.call(this.properties, "string_value")) {
        stringWidget.value = this.properties.string_value ?? "";
      }
    };

    nodeType.prototype.serializeBBoxInfo = function () {
      this.properties = this.properties || {};

      if (this.bboxWidget) {
        this.properties.bbox_info = JSON.stringify({
          bbox: this.bboxWidget.bbox,
          neg_bbox: this.bboxWidget.neg_bbox,
        });
      }

      return this.properties.bbox_info || "";
    };

    chainCallback(nodeType.prototype, "onConfigure", function () {
      setTimeout(() => {
        if (this.properties && Object.prototype.hasOwnProperty.call(this.properties, "bbox_node_size")) {
          delete this.properties.bbox_node_size;
        }
        this.removeStaleBooleanArtifacts?.();

        this.restoreSimpleWidgetState?.();

      }, 0);
    });

    chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
      this.removeStaleBooleanArtifacts?.();
      this.saveSimpleWidgetState?.(false);
      this.serializeBBoxInfo?.();
      if (this.properties && Object.prototype.hasOwnProperty.call(this.properties, "bbox_node_size")) {
        delete this.properties.bbox_node_size;
      }
      if (this.properties && Object.prototype.hasOwnProperty.call(this.properties, "boolean_count")) {
        delete this.properties.boolean_count;
      }
      if (this.properties && Object.prototype.hasOwnProperty.call(this.properties, "boolean_state")) {
        delete this.properties.boolean_state;
      }
      if (serialized?.properties) {
        serialized.properties.image_value = this.properties?.image_value || "";
        serialized.properties.string_value = this.properties?.string_value ?? "";
        serialized.properties.bbox_info = this.properties?.bbox_info || "";
        serialized.properties.bbox_canvas_height = this.getBBoxPanelHeight();
        delete serialized.properties.bbox_node_size;
        delete serialized.properties.boolean_count;
        delete serialized.properties.boolean_state;
      }
      if (Array.isArray(serialized?.inputs)) {
        serialized.inputs = serialized.inputs.filter((input) => !STALE_BOOLEAN_NAMES.has(input?.name));
      }
      if (Array.isArray(serialized?.outputs)) {
        const seenOutputs = new Set();
        serialized.outputs = serialized.outputs
          .filter((output) => {
            const name = output?.name;
            if (!LOAD_BBOX_OUTPUT_NAMES.includes(name) || seenOutputs.has(name)) {
              return false;
            }
            seenOutputs.add(name);
            return true;
          })
          .sort(
            (left, right) => LOAD_BBOX_OUTPUT_NAMES.indexOf(left.name) - LOAD_BBOX_OUTPUT_NAMES.indexOf(right.name),
          );
      }
    });

    nodeType.prototype.setBBoxMode = function (mode) {
      this.bboxWidget.mode = mode;
      this.updateBBoxButtons();
    };

    nodeType.prototype.pushBBoxHistory = function () {
      const { bbox, neg_bbox, historyIndex } = this.bboxWidget;
      this.bboxWidget.history = this.bboxWidget.history.slice(0, Math.max(0, historyIndex + 1));
      this.bboxWidget.history.push({
        bbox: cloneBoxes(bbox),
        neg_bbox: cloneBoxes(neg_bbox),
      });
      this.bboxWidget.historyIndex = this.bboxWidget.history.length - 1;
    };

    nodeType.prototype.resetBBoxHistory = function () {
      const { bbox, neg_bbox } = this.bboxWidget;
      this.bboxWidget.history = [
        {
          bbox: cloneBoxes(bbox),
          neg_bbox: cloneBoxes(neg_bbox),
        },
      ];
      this.bboxWidget.historyIndex = 0;
    };

    nodeType.prototype.restoreBBoxState = function (state) {
      this.bboxWidget.bbox = cloneBoxes(state.bbox || []);
      this.bboxWidget.neg_bbox = cloneBoxes(state.neg_bbox || []);
      this.updateBBoxInfo();
      this.redrawBBoxCanvas();
      this.updateBBoxButtons();
    };

    nodeType.prototype.clearBBoxAnnotations = function (updateInfo = true, resetHistory = true) {
      this.bboxWidget.bbox = [];
      this.bboxWidget.neg_bbox = [];
      this.bboxWidget.currentBox = null;
      this.bboxWidget.isDrawingBox = false;
      if (resetHistory) {
        this.resetBBoxHistory();
      }
      if (updateInfo) {
        this.updateBBoxInfo();
      }
    };

    nodeType.prototype.handleBBoxImageSelectionChanged = function (forceReload = false) {
      const imageWidget = this.widgets.find((widget) => widget.name === "image");
      const imageValue = imageWidget?.value || "";

      if (imageValue === this.bboxWidget.imageValue && !forceReload) {
        return;
      }

      const changedImage = imageValue !== this.bboxWidget.imageValue;
      this.bboxWidget.imageValue = imageValue;

      if (changedImage) {
        this.clearBBoxAnnotations(true);
      }

      this.loadBBoxImage(forceReload || changedImage);
      this.updateBBoxButtons();
    };

    nodeType.prototype.undoBBox = function () {
      if (this.bboxWidget.historyIndex <= 0) {
        return;
      }
      this.bboxWidget.historyIndex -= 1;
      const state = this.bboxWidget.history[this.bboxWidget.historyIndex];
      this.restoreBBoxState(state);
    };

    nodeType.prototype.redoBBox = function () {
      if (this.bboxWidget.historyIndex >= this.bboxWidget.history.length - 1) {
        return;
      }
      this.bboxWidget.historyIndex += 1;
      const state = this.bboxWidget.history[this.bboxWidget.historyIndex];
      this.restoreBBoxState(state);
    };

    nodeType.prototype.updateBBoxButtons = function () {
      const { buttons, mode, historyIndex, history, bbox, neg_bbox } = this.bboxWidget;
      if (!buttons) {
        return;
      }

      for (const key of ["bbox", "neg_bbox"]) {
        const active = mode === key;
        buttons[key].style.background = active ? "#3f5268" : "#252525";
        buttons[key].style.color = active ? "#fff" : "#ddd";
      }

      buttons.undo.disabled = historyIndex <= 0;
      buttons.redo.disabled = historyIndex >= history.length - 1;
      buttons.clear.disabled = !bbox.length && !neg_bbox.length;

      for (const button of [buttons.undo, buttons.redo, buttons.clear]) {
        button.style.opacity = button.disabled ? "0.45" : "1";
        button.style.cursor = button.disabled ? "default" : "pointer";
      }
    };

    nodeType.prototype.restoreBBoxInfo = function () {
      const bboxInfo = this.properties?.bbox_info;
      if (!bboxInfo) {
        return;
      }

      try {
        const info = typeof bboxInfo === "string" ? JSON.parse(bboxInfo) : bboxInfo;
        if (Array.isArray(info.bbox)) {
          this.bboxWidget.bbox = info.bbox.map((box) => ({
            x: Number(box.x ?? box[0] ?? 0),
            y: Number(box.y ?? box[1] ?? 0),
            w: Number(box.w ?? ((box[2] ?? 0) - (box[0] ?? 0))),
            h: Number(box.h ?? ((box[3] ?? 0) - (box[1] ?? 0))),
          }));
        }
        if (Array.isArray(info.neg_bbox)) {
          this.bboxWidget.neg_bbox = info.neg_bbox.map((box) => ({
            x: Number(box.x ?? box[0] ?? 0),
            y: Number(box.y ?? box[1] ?? 0),
            w: Number(box.w ?? ((box[2] ?? 0) - (box[0] ?? 0))),
            h: Number(box.h ?? ((box[3] ?? 0) - (box[1] ?? 0))),
          }));
        }
      } catch (error) {
        console.warn("Failed to restore bbox_info", error);
      }
    };

    nodeType.prototype.updateBBoxInfo = function () {
      this.serializeBBoxInfo();
      app.graph.setDirtyCanvas(true, true);
    };

    nodeType.prototype.loadBBoxImage = function (force = false) {
      const imageWidget = this.widgets.find((widget) => widget.name === "image");
      if (!imageWidget?.value) {
        this.bboxWidget.image = null;
        this.redrawBBoxCanvas();
        return;
      }

      const imageValue = imageWidget.value;
      if (!force && this.bboxWidget.image && this.bboxWidget.imageValue === imageValue) {
        return;
      }

      this.bboxWidget.imageValue = imageValue;
      const loadToken = this.bboxWidget.loadToken + 1;
      this.bboxWidget.loadToken = loadToken;
      const image = new Image();
      image.onload = () => {
        if (this.bboxWidget.loadToken !== loadToken) {
          return;
        }
        this.bboxWidget.image = image;
        this.bboxWidget.canvas.width = image.width;
        this.bboxWidget.canvas.height = image.height;
        this.redrawBBoxCanvas();
      };
      image.onerror = () => {
        if (this.bboxWidget.loadToken !== loadToken) {
          return;
        }
        this.bboxWidget.image = null;
        this.redrawBBoxCanvas();
      };
      image.src = getImageUrl(imageValue);
    };

    nodeType.prototype.redrawBBoxCanvas = function () {
      const { canvas, ctx, image, bbox, neg_bbox, currentBox, mode } = this.bboxWidget;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (image) {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#111417";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#c8c8c8";
        ctx.font = "22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Select or upload an image", canvas.width / 2, canvas.height / 2 - 12);
        ctx.font = "14px sans-serif";
        ctx.fillText("Drag on the canvas to create bbox / neg_bbox", canvas.width / 2, canvas.height / 2 + 18);
      }

      const drawBoxes = (boxes, color, fill) => {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.fillStyle = fill;
        for (const box of boxes) {
          ctx.fillRect(box.x, box.y, box.w, box.h);
          ctx.strokeRect(box.x, box.y, box.w, box.h);
        }
      };

      drawBoxes(bbox, "#2f8cff", "rgba(47, 140, 255, 0.16)");
      drawBoxes(neg_bbox, "#ff4d4d", "rgba(255, 77, 77, 0.16)");

      if (currentBox) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = mode === "bbox" ? "#8bc0ff" : "#ff9a9a";
        ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
        ctx.restore();
      }
    };
  },
});
