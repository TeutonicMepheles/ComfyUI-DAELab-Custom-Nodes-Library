import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MIN_VERTICES = 3;
const MAX_VERTICES = 12;
const PANEL_DEFAULT_HEIGHT = 430;
const PANEL_MIN_HEIGHT = 280;
const PANEL_MAX_HEIGHT = 1400;
const POLYGON_CACHE_PREFIX = "DAELab.LoadImagePolygonMask";
const SAM3_PROMPT_COLORS = [
  { primary: "#00FFFF", dim: "#006666" },
  { primary: "#FFFF00", dim: "#666600" },
  { primary: "#FF00FF", dim: "#660066" },
  { primary: "#00FF00", dim: "#006600" },
  { primary: "#FF8000", dim: "#663300" },
  { primary: "#FF69B4", dim: "#662944" },
  { primary: "#4169E1", dim: "#1a2a5c" },
  { primary: "#20B2AA", dim: "#0d4744" },
];
const SAM3_MAX_PROMPTS = SAM3_PROMPT_COLORS.length;

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
    "min-width:34px",
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

function applyButtonTheme(button, theme) {
  const themes = {
    green: { bg: "#2a7a2a", hover: "#3a9a3a", border: "#3a9a3a", color: "#fff" },
    blue: { bg: "#2563eb", hover: "#1d4ed8", border: "#3b82f6", color: "#fff" },
    orange: { bg: "#a50", hover: "#c60", border: "#830", color: "#fff" },
    red: { bg: "#d44", hover: "#e55", border: "#a22", color: "#fff" },
  };
  const colors = themes[theme];
  if (!button || !colors) {
    return;
  }
  button.style.background = colors.bg;
  button.style.borderColor = colors.border;
  button.style.color = colors.color;
  button.onmouseover = () => {
    if (!button.disabled) {
      button.style.background = colors.hover;
    }
  };
  button.onmouseout = () => {
    if (!button.disabled) {
      button.style.background = colors.bg;
    }
  };
}

function createSectionTitle(text) {
  const title = document.createElement("div");
  title.textContent = text;
  title.style.cssText = [
    "height:30px",
    "flex:0 0 30px",
    "display:flex",
    "align-items:center",
    "padding:0 10px",
    "box-sizing:border-box",
    "background:#181a1d",
    "border-bottom:1px solid #333",
    "color:#f0f0f0",
    "font:600 13px sans-serif",
  ].join(";");
  return title;
}

function createHelpNote(text) {
  const note = document.createElement("div");
  note.textContent = text;
  note.style.cssText = [
    "min-height:28px",
    "flex:0 0 28px",
    "display:flex",
    "align-items:center",
    "padding:0 10px",
    "box-sizing:border-box",
    "background:#16181a",
    "border-bottom:1px solid #2d2f33",
    "color:#cfd3d8",
    "font:12px sans-serif",
  ].join(";");
  return note;
}

function hideWidget(widget) {
  if (!widget) {
    return;
  }
  widget.hidden = true;
  widget.type = "converted-widget";
  widget.computeSize = () => [0, -4];
  if (widget.element) {
    widget.element.style.display = "none";
  }
}

function createSam3Prompt() {
  return {
    positive_points: [],
    negative_points: [],
    positive_boxes: [],
    negative_boxes: [],
    name: "Prompt 1",
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampVertexCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return MIN_VERTICES;
  }
  return clamp(Math.round(numeric), MIN_VERTICES, MAX_VERTICES);
}

function clampPanelHeight(height) {
  const numericHeight = Number(height);
  if (!Number.isFinite(numericHeight)) {
    return PANEL_DEFAULT_HEIGHT;
  }
  return clamp(numericHeight, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT);
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

function clonePoints(points) {
  return (points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
}

function clonePolygons(polygons) {
  return (polygons || []).map((polygon) => ({ points: clonePoints(polygon.points || polygon) }));
}

function isValidPolygonInfo(info) {
  if (!info || typeof info !== "object") {
    return false;
  }
  if (info.cleared === true) {
    return true;
  }
  if (Array.isArray(info.polygons)) {
    return info.polygons.some((polygon) => clonePoints(polygon?.points || polygon).length >= MIN_VERTICES);
  }
  return clonePoints(info.points || []).length >= MIN_VERTICES;
}

function distanceSquared(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) {
    return Math.sqrt(distanceSquared(point, start));
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
  return Math.sqrt(distanceSquared(point, projection));
}

function triangleArea(previous, point, next) {
  return Math.abs(
    (previous.x * (point.y - next.y) + point.x * (next.y - previous.y) + next.x * (previous.y - point.y)) / 2,
  );
}

function pointInPolygon(point, points) {
  if (!Array.isArray(points) || points.length < MIN_VERTICES) {
    return false;
  }

  let inside = false;
  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const current = points[index];
    const previous = points[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 1e-9) + current.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function parseColor(value) {
  const text = String(value || "#FF0000").trim();
  const hexMatch = text.match(/^#?([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const shortHexMatch = text.match(/^#?([0-9a-fA-F]{3})$/);
  if (shortHexMatch) {
    return {
      r: parseInt(shortHexMatch[1][0] + shortHexMatch[1][0], 16),
      g: parseInt(shortHexMatch[1][1] + shortHexMatch[1][1], 16),
      b: parseInt(shortHexMatch[1][2] + shortHexMatch[1][2], 16),
    };
  }

  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  if (numbers?.length >= 3) {
    return {
      r: clamp(Math.round(Number(numbers[0])), 0, 255),
      g: clamp(Math.round(Number(numbers[1])), 0, 255),
      b: clamp(Math.round(Number(numbers[2])), 0, 255),
    };
  }

  return { r: 255, g: 0, b: 0 };
}

function rgba(color, alpha) {
  const parsed = parseColor(color);
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

app.registerExtension({
  name: "comfyui_polygon_mask_loader.LoadImagePolygonMask",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "LoadImagePolygonMask") {
      return;
    }

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      this.cleanupLegacyPolygonInputs?.();

      const imageWidget = this.widgets?.find((widget) => widget.name === "image");
      if (!imageWidget) {
        return;
      }

      this.properties = this.properties || {};
      this.properties.polygon_info = this.properties.polygon_info || "";
      this.properties.polygon_canvas_height = clampPanelHeight(this.properties.polygon_canvas_height);
      this.restorePolygonWidgetState?.();

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

      const canvasTitle = createSectionTitle("\u591a\u8fb9\u5f62\u7f16\u8f91\u753b\u5e03");

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

      const helpNote = createHelpNote("Shift+\u5de6\u952e\uff1a\u65b0\u5efa Polygon | Shift+\u53f3\u952e\uff1a\u5220\u9664\u70b9\u51fb\u7684 Polygon");

      const canvasWrapper = document.createElement("div");
      canvasWrapper.style.cssText = [
        "flex:1",
        "min-height:190px",
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
        "cursor:default",
      ].join(";");
      canvasWrapper.appendChild(canvas);

      container.appendChild(canvasTitle);
      container.appendChild(toolbar);
      container.appendChild(helpNote);
      container.appendChild(canvasWrapper);

      const ctx = canvas.getContext("2d");

      this.polygonWidget = {
        container,
        canvas,
        ctx,
        image: null,
        imageValue: null,
        loadToken: 0,
        polygons: [],
        selectedIndex: -1,
        cleared: false,
        dragMode: "none",
        draggingPolygonIndex: -1,
        draggingVertexIndex: -1,
        dragStart: null,
        dragLast: null,
        dragOriginalPoints: [],
        dragMoved: false,
        history: [],
        historyIndex: -1,
        lastNodeHeight: this.size?.[1] || null,
        resizeReady: false,
        suppressVertexCallback: false,
        pendingDefaultOnLoad: false,
        restoredFromProperties: false,
      };

      const undoButton = createButton("Undo", "Undo last polygon edit", () => this.undoPolygon());
      const redoButton = createButton("Redo", "Redo polygon edit", () => this.redoPolygon());
      const refreshButton = createButton("Refresh", "Refresh preview image and redraw canvas", () => {
        this.loadPolygonImage(true);
        this.redrawPolygonCanvas();
      });
      const clearButton = createButton("Clear", "Delete selected polygon", () => this.clearPolygon());
      const resetButton = createButton("Reset", "Reset selected polygon using current vertex count", () =>
        this.resetPolygon(),
      );

      leftGroup.appendChild(undoButton);
      leftGroup.appendChild(redoButton);
      leftGroup.appendChild(refreshButton);
      rightGroup.appendChild(clearButton);
      rightGroup.appendChild(resetButton);
      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);

      this.polygonWidget.buttons = {
        undo: undoButton,
        redo: redoButton,
        refresh: refreshButton,
        clear: clearButton,
        reset: resetButton,
      };

      const domWidget = this.addDOMWidget("polygon_canvas", "polygon_canvas", container);
      domWidget.computeSize = (width) => [width, this.getPolygonPanelHeight()];

      const previewTitle = createSectionTitle("\u539f\u56fe\u9884\u89c8");
      previewTitle.style.marginTop = "4px";
      previewTitle.textContent = "SAM3 Prompt \u7ed8\u5236\u753b\u5e03";
      const previewTitleWidget = this.addDOMWidget("polygon_preview_title", "polygon_preview_title", previewTitle);
      previewTitleWidget.computeSize = (width) => [width, 34];

      const sam3Container = document.createElement("div");
      sam3Container.style.cssText = [
        "position:relative",
        "width:100%",
        "height:100%",
        "background:#111",
        "overflow:hidden",
        "display:flex",
        "flex-direction:column",
        "box-sizing:border-box",
        "border-radius:4px",
      ].join(";");

      const sam3InfoBar = document.createElement("div");
      sam3InfoBar.style.cssText = [
        "height:34px",
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:8px",
        "padding:5px",
        "box-sizing:border-box",
        "background:#202225",
        "border-bottom:1px solid #333",
      ].join(";");

      const sam3Counter = document.createElement("div");
      sam3Counter.style.cssText = "color:#fff;font:12px monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      sam3Counter.textContent = "Prompt 1: 0 pts, 0 boxes";

      const sam3Buttons = document.createElement("div");
      sam3Buttons.style.cssText = "display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end";
      const runSam3Button = createButton("Run", "Run SAM3 masks and visualization for the current prompts", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.runSam3Prompts();
      });
      runSam3Button.style.fontWeight = "700";
      runSam3Button.style.minWidth = "46px";
      applyButtonTheme(runSam3Button, "green");

      const loadMaskedImageButton = createButton("Load Masked Image", "Load the latest masked_image into the SAM3 prompt canvas", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.loadMaskedImageIntoSam3Canvas();
      });
      loadMaskedImageButton.style.minWidth = "118px";
      applyButtonTheme(loadMaskedImageButton, "blue");

      const clearPromptButton = createButton("Clear Prompt", "Clear active SAM3 prompt", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearSam3ActivePrompt();
      });
      applyButtonTheme(clearPromptButton, "orange");
      const clearAllPromptsButton = createButton("Clear All", "Clear all SAM3 prompts", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearAllSam3Prompts();
      });
      applyButtonTheme(clearAllPromptsButton, "red");
      sam3Buttons.appendChild(runSam3Button);
      sam3Buttons.appendChild(loadMaskedImageButton);
      sam3Buttons.appendChild(clearPromptButton);
      sam3Buttons.appendChild(clearAllPromptsButton);
      sam3InfoBar.appendChild(sam3Counter);
      sam3InfoBar.appendChild(sam3Buttons);

      const sam3CanvasWrapper = document.createElement("div");
      sam3CanvasWrapper.style.cssText = [
        "flex:1",
        "min-height:200px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "overflow:hidden",
        "background:#141414",
      ].join(";");

      const sam3Canvas = document.createElement("canvas");
      sam3Canvas.width = 512;
      sam3Canvas.height = 512;
      sam3Canvas.style.cssText = "display:block;max-width:100%;max-height:100%;object-fit:contain;cursor:crosshair";
      sam3CanvasWrapper.appendChild(sam3Canvas);

      const sam3TabBar = document.createElement("div");
      sam3TabBar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:#1a1a1a;border-top:1px solid #333";

      sam3Container.appendChild(sam3InfoBar);
      sam3Container.appendChild(sam3CanvasWrapper);
      sam3Container.appendChild(sam3TabBar);

      this.sam3Widget = {
        container: sam3Container,
        canvas: sam3Canvas,
        ctx: sam3Canvas.getContext("2d"),
        image: null,
        imageValue: null,
        maskedImage: null,
        maskedImageValue: null,
        prompts: [createSam3Prompt()],
        activePromptIndex: 0,
        currentBox: null,
        isDrawingBox: false,
        hoveredItem: null,
        isRunning: false,
        tabBar: sam3TabBar,
        counter: sam3Counter,
        runButton: runSam3Button,
      };

      const sam3Widget = this.addDOMWidget("sam3_prompt_canvas", "sam3_prompt_canvas", sam3Container);
      sam3Widget.computeSize = (width) => [width, Math.max(300, this.getPolygonPanelHeight())];

      this.restorePolygonInfo();
      this.restoreSam3Prompts();
      this.rebuildSam3TabBar();
      this.loadPolygonImage(false);
      this.redrawPolygonCanvas();
      this.redrawSam3Canvas();
      this.updateSam3RunButton();
      this.updatePolygonButtons();

      this.bindPolygonWidgetCallbacks();
      this.bindSam3CanvasEvents();
      this.suppressDefaultPolygonPreview?.();

      chainCallback(this, "onResize", function (size) {
        const previousNodeHeight = this.polygonWidget.lastNodeHeight;
        const nextNodeHeight = Number(size?.[1]);

        if (!this.polygonWidget.resizeReady) {
          this.setPolygonPanelHeight(this.getPolygonPanelHeight(), false);
          this.polygonWidget.lastNodeHeight = nextNodeHeight;
          return;
        }

        if (Number.isFinite(previousNodeHeight) && Number.isFinite(nextNodeHeight)) {
          const delta = nextNodeHeight - previousNodeHeight;
          if (Math.abs(delta) >= 1) {
            this.setPolygonPanelHeight(this.getPolygonPanelHeight() + delta, false);
          }
        } else {
          this.setPolygonPanelHeight(this.getPolygonPanelHeight(), false);
        }

        this.polygonWidget.lastNodeHeight = nextNodeHeight;
      });

      chainCallback(this, "onDrawForeground", function () {
        this.suppressDefaultPolygonPreview?.();
        this.handlePolygonImageSelectionChanged(false);
        this.setPolygonPanelHeight(this.getPolygonPanelHeight(), false);
      });

      canvas.addEventListener("mousedown", (event) => {
        if (!this.polygonWidget.image || (event.button !== 0 && event.button !== 2)) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);

        if (event.shiftKey && event.button === 0) {
          event.preventDefault();
          this.addPolygonAt(coords);
          return;
        }

        if (event.shiftKey && event.button === 2) {
          event.preventDefault();
          this.deletePolygonAt(coords);
          return;
        }

        if (event.button !== 0) {
          return;
        }

        const vertexHit = this.findPolygonVertexAt(coords, this.polygonWidget.selectedIndex);
        if (vertexHit >= 0) {
          event.preventDefault();
          this.startVertexDrag(this.polygonWidget.selectedIndex, vertexHit, coords);
          return;
        }

        const polygonHit = this.findPolygonAt(coords);
        if (polygonHit >= 0) {
          event.preventDefault();
          this.selectPolygon(polygonHit);
          this.startPolygonDrag(polygonHit, coords);
        }
      });

      canvas.addEventListener("mousemove", (event) => {
        if (!this.polygonWidget.image) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);

        if (this.polygonWidget.dragMode === "vertex") {
          this.moveDraggedVertex(coords);
          return;
        }

        if (this.polygonWidget.dragMode === "polygon") {
          this.moveDraggedPolygon(coords);
          return;
        }

        if (this.findPolygonVertexAt(coords, this.polygonWidget.selectedIndex) >= 0) {
          canvas.style.cursor = "grab";
        } else if (this.findPolygonSegmentAt(coords) >= 0) {
          canvas.style.cursor = "copy";
        } else if (this.findPolygonAt(coords) >= 0) {
          canvas.style.cursor = "move";
        } else {
          canvas.style.cursor = "default";
        }
      });

      canvas.addEventListener("mouseup", () => this.finishPolygonDrag());
      canvas.addEventListener("mouseleave", () => this.finishPolygonDrag());

      canvas.addEventListener("dblclick", (event) => {
        if (!this.polygonWidget.image || this.polygonWidget.cleared) {
          return;
        }
        event.preventDefault();

        const polygon = this.getSelectedPolygon();
        if (!polygon || polygon.points.length >= MAX_VERTICES) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);
        const segmentIndex = this.findPolygonSegmentAt(coords);
        if (segmentIndex < 0) {
          return;
        }

        polygon.points.splice(segmentIndex + 1, 0, coords);
        this.setVertexCountWidgetValue(polygon.points.length);
        this.updatePolygonInfo();
        this.pushPolygonHistory();
        this.redrawPolygonCanvas();
        this.updatePolygonButtons();
      });

      canvas.addEventListener("contextmenu", (event) => event.preventDefault());

      container.style.height = `${this.getPolygonPanelHeight()}px`;
      setTimeout(() => {
        if (!this.polygonWidget) {
          return;
        }
        this.polygonWidget.lastNodeHeight = Number(this.size?.[1]) || this.polygonWidget.lastNodeHeight;
        this.polygonWidget.resizeReady = true;
      }, 250);
    });

    nodeType.prototype.getPolygonWidget = function (name) {
      return this.widgets?.find((widget) => widget.name === name);
    };

    nodeType.prototype.suppressDefaultPolygonPreview = function () {
      this.imgs = [];
      this.imageIndex = null;
      this.overIndex = null;
    };

    nodeType.prototype.cleanupLegacyPolygonInputs = function () {
      if (!Array.isArray(this.inputs)) {
        return;
      }

      for (let index = this.inputs.length - 1; index >= 0; index -= 1) {
        if (this.inputs[index]?.name !== "input_image") {
          continue;
        }

        if (typeof this.removeInput === "function") {
          this.removeInput(index);
        } else {
          this.inputs.splice(index, 1);
        }
      }
    };

    nodeType.prototype.getPolygonPanelHeight = function () {
      this.properties = this.properties || {};
      this.properties.polygon_canvas_height = clampPanelHeight(this.properties.polygon_canvas_height);
      return this.properties.polygon_canvas_height;
    };

    nodeType.prototype.setPolygonPanelHeight = function (height, markDirty = true) {
      const panelHeight = clampPanelHeight(height);
      this.properties = this.properties || {};
      this.properties.polygon_canvas_height = panelHeight;

      if (this.polygonWidget?.container) {
        this.polygonWidget.container.style.height = `${panelHeight}px`;
      }

      if (markDirty) {
        app.graph.setDirtyCanvas(true, true);
      }
    };

    nodeType.prototype.bindPolygonWidgetCallbacks = function () {
      const imageWidget = this.getPolygonWidget("image");
      const vertexWidget = this.getPolygonWidget("vertex_count");

      if (imageWidget && !imageWidget._polygonMaskStateBound) {
        const originalImageCallback = imageWidget.callback;
        imageWidget.callback = (...args) => {
          const result = originalImageCallback?.apply(imageWidget, args);
          this.savePolygonWidgetState(true);
          this.handlePolygonImageSelectionChanged(true);
          return result;
        };
        imageWidget._polygonMaskStateBound = true;
      }

      if (vertexWidget && !vertexWidget._polygonMaskStateBound) {
        const originalVertexCallback = vertexWidget.callback;
        vertexWidget.callback = (...args) => {
          const result = originalVertexCallback?.apply(vertexWidget, args);
          if (!this.polygonWidget?.suppressVertexCallback) {
            this.handlePolygonVertexCountChanged(vertexWidget.value);
          }
          return result;
        };
        vertexWidget._polygonMaskStateBound = true;
      }

      const polygonDataWidget = this.getPolygonWidget("polygon_data");
      if (polygonDataWidget) {
        polygonDataWidget.options = polygonDataWidget.options || {};
        polygonDataWidget.options.advanced = true;
        hideWidget(polygonDataWidget);
      }

      const sam3PromptsWidget = this.getPolygonWidget("sam3_prompts_data");
      if (sam3PromptsWidget) {
        sam3PromptsWidget.value = sam3PromptsWidget.value || "[]";
        sam3PromptsWidget.options = sam3PromptsWidget.options || {};
        sam3PromptsWidget.options.advanced = true;
        hideWidget(sam3PromptsWidget);
      }

      for (const widgetName of ["color", "fill_opacity", "outline_width"]) {
        const widget = this.getPolygonWidget(widgetName);
        if (!widget || widget._polygonMaskGenericStateBound) {
          continue;
        }
        const originalCallback = widget.callback;
        widget.callback = (...args) => {
          const result = originalCallback?.apply(widget, args);
          this.savePolygonWidgetState(true);
          this.redrawPolygonCanvas();
          return result;
        };
        widget._polygonMaskGenericStateBound = true;
      }
    };

    nodeType.prototype.savePolygonWidgetState = function (markDirty = true) {
      this.properties = this.properties || {};

      for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_data", "sam3_prompts_data"]) {
        const widget = this.getPolygonWidget(name);
        if (widget) {
          this.properties[`${name}_value`] = widget.value ?? "";
        }
      }

      if (markDirty) {
        app.graph.setDirtyCanvas(true, true);
      }
    };

    nodeType.prototype.restorePolygonWidgetState = function () {
      this.properties = this.properties || {};

      for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_data", "sam3_prompts_data"]) {
        const widget = this.getPolygonWidget(name);
        const propertyName = `${name}_value`;
        if (widget && Object.prototype.hasOwnProperty.call(this.properties, propertyName)) {
          widget.value = this.properties[propertyName];
        }
      }
    };

    nodeType.prototype.getPolygonImageValue = function () {
      return this.getPolygonWidget("image")?.value || this.polygonWidget?.imageValue || "";
    };

    nodeType.prototype.getPolygonCacheKey = function (imageValue = this.getPolygonImageValue()) {
      const nodeId = this.id ?? this.properties?.id ?? "unknown";
      return `${POLYGON_CACHE_PREFIX}.${nodeId}.${encodeURIComponent(String(imageValue || ""))}`;
    };

    nodeType.prototype.persistPolygonInfoCache = function (polygonInfo) {
      const imageValue = this.getPolygonImageValue();
      if (!imageValue || !polygonInfo) {
        return;
      }
      try {
        localStorage.setItem(this.getPolygonCacheKey(imageValue), polygonInfo);
      } catch (error) {
        console.warn("Failed to cache polygon_info", error);
      }
    };

    nodeType.prototype.readPolygonInfoCache = function () {
      const imageValue = this.getPolygonImageValue();
      if (!imageValue) {
        return "";
      }
      try {
        return localStorage.getItem(this.getPolygonCacheKey(imageValue)) || "";
      } catch (error) {
        console.warn("Failed to read cached polygon_info", error);
        return "";
      }
    };

    nodeType.prototype.serializePolygonInfo = function () {
      this.properties = this.properties || {};

      if (this.polygonWidget) {
        const polygonInfo = JSON.stringify({
          polygons: clonePolygons(this.polygonWidget.polygons),
          selectedIndex: this.polygonWidget.selectedIndex,
          cleared: Boolean(this.polygonWidget.cleared),
          image: this.getPolygonImageValue(),
        });
        this.properties.polygon_info = polygonInfo;
        this.properties.polygon_data_value = polygonInfo;
        const polygonDataWidget = this.getPolygonWidget("polygon_data");
        if (polygonDataWidget) {
          polygonDataWidget.value = polygonInfo;
        }
        this.persistPolygonInfoCache(polygonInfo);
      }

      return this.properties.polygon_info || "";
    };

    nodeType.prototype.resetPolygonHistory = function () {
      if (!this.polygonWidget) {
        return;
      }
      this.polygonWidget.history = [this.getPolygonState()];
      this.polygonWidget.historyIndex = 0;
    };

    nodeType.prototype.restoreCachedPolygonState = function () {
      if (!this.polygonWidget) {
        return;
      }
      this.restorePolygonWidgetState?.();
      this.restorePolygonInfo?.();
      if (this.polygonWidget.polygons.length > 0 || this.polygonWidget.cleared) {
        this.resetPolygonHistory?.();
      } else {
        this.polygonWidget.history = [];
        this.polygonWidget.historyIndex = -1;
      }
      this.loadPolygonImage?.(true);
      this.redrawPolygonCanvas?.();
      this.updatePolygonButtons?.();
      this.polygonWidget.restoredFromProperties = true;
    };

    nodeType.prototype.captureConfiguredPolygonInfo = function (serialized) {
      this.properties = this.properties || {};
      const sourceProperties = serialized?.properties || {};

      for (const name of ["polygon_info", "polygon_data_value"]) {
        if (sourceProperties[name]) {
          this.properties[name] = sourceProperties[name];
        }
      }

      if (sourceProperties.sam3_prompts_data_value) {
        this.properties.sam3_prompts_data_value = sourceProperties.sam3_prompts_data_value;
      }

      if (!this.properties.polygon_data_value && Array.isArray(serialized?.widgets_values)) {
        const polygonDataIndex = this.widgets?.findIndex((widget) => widget.name === "polygon_data") ?? -1;
        const polygonDataValue = polygonDataIndex >= 0 ? serialized.widgets_values[polygonDataIndex] : "";
        if (polygonDataValue) {
          this.properties.polygon_data_value = polygonDataValue;
        }
      }

      if (!this.properties.sam3_prompts_data_value && Array.isArray(serialized?.widgets_values)) {
        const sam3DataIndex = this.widgets?.findIndex((widget) => widget.name === "sam3_prompts_data") ?? -1;
        const sam3DataValue = sam3DataIndex >= 0 ? serialized.widgets_values[sam3DataIndex] : "";
        if (sam3DataValue) {
          this.properties.sam3_prompts_data_value = sam3DataValue;
        }
      }
    };

    chainCallback(nodeType.prototype, "onConfigure", function (serialized) {
      this.cleanupLegacyPolygonInputs?.();
      this.suppressDefaultPolygonPreview?.();
      this.captureConfiguredPolygonInfo?.(serialized);
      this.restoreCachedPolygonState?.();
      this.restoreSam3Prompts?.();
      setTimeout(() => {
        this.suppressDefaultPolygonPreview?.();
        this.restoreCachedPolygonState?.();
        this.restoreSam3Prompts?.();
      }, 0);
    });

    chainCallback(nodeType.prototype, "onExecuted", function () {
      if (this.sam3Widget?.isRunning) {
        this.sam3Widget.isRunning = false;
        this.updateSam3RunButton?.();
      }
      this.suppressDefaultPolygonPreview?.();
      app.graph.setDirtyCanvas(true, true);
    });

    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const encoded = message?.masked_image?.[0];
      if (!encoded || !this.sam3Widget) {
        return;
      }
      const image = new Image();
      image.onload = () => {
        this.sam3Widget.maskedImage = image;
        this.sam3Widget.maskedImageValue = encoded;
        this.redrawSam3Canvas();
      };
      image.src = `data:image/jpeg;base64,${encoded}`;
    });

    chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
      this.savePolygonWidgetState?.(false);
      this.serializePolygonInfo?.();
      if (serialized?.properties) {
        serialized.properties.polygon_info = this.properties?.polygon_info || "";
        serialized.properties.polygon_canvas_height = this.getPolygonPanelHeight();
        serialized.properties.polygon_data_value = this.properties?.polygon_data_value || this.properties?.polygon_info || "";
        this.serializeSam3Prompts?.();
        serialized.properties.sam3_prompts_data_value = this.properties?.sam3_prompts_data_value || "[]";
        for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_data", "sam3_prompts_data"]) {
          serialized.properties[`${name}_value`] = this.properties?.[`${name}_value`] ?? "";
        }
      }
      if (Array.isArray(serialized?.widgets_values)) {
        const polygonDataIndex = this.widgets?.findIndex((widget) => widget.name === "polygon_data") ?? -1;
        if (polygonDataIndex >= 0) {
          serialized.widgets_values[polygonDataIndex] = this.properties?.polygon_info || "";
        }
        const sam3DataIndex = this.widgets?.findIndex((widget) => widget.name === "sam3_prompts_data") ?? -1;
        if (sam3DataIndex >= 0) {
          serialized.widgets_values[sam3DataIndex] = this.properties?.sam3_prompts_data_value || "[]";
        }
      }
    });

    nodeType.prototype.restorePolygonInfo = function () {
      const candidates = [
        this.getPolygonWidget("polygon_data")?.value,
        this.properties?.polygon_data_value,
        this.properties?.polygon_info,
        this.readPolygonInfoCache?.(),
      ].filter(Boolean);

      const polygonInfo = candidates.find((value) => {
        try {
          return isValidPolygonInfo(typeof value === "string" ? JSON.parse(value) : value);
        } catch {
          return false;
        }
      });

      if (!polygonInfo) {
        return;
      }

      try {
        const info = typeof polygonInfo === "string" ? JSON.parse(polygonInfo) : polygonInfo;
        this.polygonWidget.cleared = Boolean(info?.cleared);

        if (Array.isArray(info?.polygons)) {
          this.polygonWidget.polygons = clonePolygons(info.polygons).filter(
            (polygon) => polygon.points.length >= MIN_VERTICES,
          );
        } else if (Array.isArray(info?.points)) {
          const points = clonePoints(info.points);
          this.polygonWidget.polygons = points.length >= MIN_VERTICES ? [{ points }] : [];
        }

        if (this.polygonWidget.polygons.length > 0) {
          this.polygonWidget.cleared = false;
          this.selectPolygon(
            clamp(Number(info?.selectedIndex ?? this.polygonWidget.polygons.length - 1), 0, this.polygonWidget.polygons.length - 1),
            false,
          );
        }
        this.serializePolygonInfo();
      } catch (error) {
        console.warn("Failed to restore polygon_info", error);
      }
    };

    nodeType.prototype.updatePolygonInfo = function () {
      this.serializePolygonInfo();
      app.graph.setDirtyCanvas(true, true);
    };

    nodeType.prototype.getSam3PromptsForStorage = function () {
      return (this.sam3Widget?.prompts || []).map((prompt, index) => ({
        positive_points: clonePoints(prompt.positive_points),
        negative_points: clonePoints(prompt.negative_points),
        positive_boxes: (prompt.positive_boxes || []).map((box) => ({ ...box })),
        negative_boxes: (prompt.negative_boxes || []).map((box) => ({ ...box })),
        name: prompt.name || `Prompt ${index + 1}`,
      }));
    };

    nodeType.prototype.serializeSam3Prompts = function () {
      this.properties = this.properties || {};
      const value = JSON.stringify(this.getSam3PromptsForStorage());
      this.properties.sam3_prompts_data_value = value;
      const widget = this.getPolygonWidget("sam3_prompts_data");
      if (widget) {
        widget.value = value;
      }
      return value;
    };

    nodeType.prototype.restoreSam3Prompts = function () {
      if (!this.sam3Widget) {
        return;
      }
      const raw =
        this.getPolygonWidget("sam3_prompts_data")?.value ||
        this.properties?.sam3_prompts_data_value ||
        this.properties?.sam3_prompts_data_value_value;
      if (!raw) {
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return;
        }
        this.sam3Widget.prompts = parsed.slice(0, SAM3_MAX_PROMPTS).map((prompt, index) => ({
          positive_points: clonePoints(prompt.positive_points),
          negative_points: clonePoints(prompt.negative_points),
          positive_boxes: (prompt.positive_boxes || []).map((box) => ({
            x1: Number(box.x1) || 0,
            y1: Number(box.y1) || 0,
            x2: Number(box.x2) || 0,
            y2: Number(box.y2) || 0,
          })),
          negative_boxes: (prompt.negative_boxes || []).map((box) => ({
            x1: Number(box.x1) || 0,
            y1: Number(box.y1) || 0,
            x2: Number(box.x2) || 0,
            y2: Number(box.y2) || 0,
          })),
          name: prompt.name || `Prompt ${index + 1}`,
        }));
        this.sam3Widget.activePromptIndex = clamp(this.sam3Widget.activePromptIndex, 0, this.sam3Widget.prompts.length - 1);
        this.serializeSam3Prompts();
        this.rebuildSam3TabBar();
        this.redrawSam3Canvas();
      } catch (error) {
        console.warn("Failed to restore sam3_prompts_data", error);
      }
    };

    nodeType.prototype.updateSam3Storage = function () {
      this.serializeSam3Prompts();
      this.updateSam3Counter();
      this.updateSam3RunButton();
      app.graph.setDirtyCanvas(true, true);
    };

    nodeType.prototype.hasSam3PromptContent = function (prompt) {
      return !!(
        prompt &&
        ((prompt.positive_points || []).length > 0 ||
          (prompt.negative_points || []).length > 0 ||
          (prompt.positive_boxes || []).length > 0 ||
          (prompt.negative_boxes || []).length > 0)
      );
    };

    nodeType.prototype.getSam3ActivePrompt = function () {
      return this.sam3Widget?.prompts?.[this.sam3Widget.activePromptIndex];
    };

    nodeType.prototype.updateSam3RunButton = function () {
      const button = this.sam3Widget?.runButton;
      if (!button) {
        return;
      }
      const blocked = !!this.sam3Widget?.isRunning;
      button.textContent = "Run";
      button.disabled = blocked;
      button.style.background = blocked ? "#333" : "#2a7a2a";
      button.style.borderColor = blocked ? "#444" : "#3a9a3a";
      button.style.color = blocked ? "#555" : "#fff";
      button.style.cursor = blocked ? "default" : "pointer";
    };

    nodeType.prototype.setSam3PromptsWidgetValue = function (value) {
      this.properties = this.properties || {};
      this.properties.sam3_prompts_data_value = value;
      const widget = this.getPolygonWidget("sam3_prompts_data");
      if (widget) {
        widget.value = value;
      }
    };

    nodeType.prototype.runSam3Prompts = async function () {
      if (!this.sam3Widget || this.sam3Widget.isRunning) {
        return;
      }

      const activePrompt = this.getSam3ActivePrompt();
      if (!this.hasSam3PromptContent(activePrompt)) {
        return;
      }

      const fullPromptValue = JSON.stringify(this.getSam3PromptsForStorage());
      const activePromptValue = JSON.stringify([
        {
          positive_points: clonePoints(activePrompt.positive_points),
          negative_points: clonePoints(activePrompt.negative_points),
          positive_boxes: (activePrompt.positive_boxes || []).map((box) => ({ ...box })),
          negative_boxes: (activePrompt.negative_boxes || []).map((box) => ({ ...box })),
          name: activePrompt.name || `Prompt ${this.sam3Widget.activePromptIndex + 1}`,
        },
      ]);

      this.sam3Widget.isRunning = true;
      this.updateSam3RunButton();
      this.setSam3PromptsWidgetValue(activePromptValue);

      try {
        const result = app.queuePrompt(0, 1);
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (error) {
        console.error("Failed to queue SAM3 polygon prompt run", error);
        this.sam3Widget.isRunning = false;
        this.updateSam3RunButton();
      } finally {
        this.setSam3PromptsWidgetValue(fullPromptValue);
      }
    };

    nodeType.prototype.bindSam3CanvasEvents = function () {
      const canvas = this.sam3Widget?.canvas;
      if (!canvas || canvas._sam3PolygonBound) {
        return;
      }

      canvas.addEventListener("mousedown", (event) => {
        if (!this.sam3Widget.image || (event.button !== 0 && event.button !== 2)) {
          return;
        }
        event.preventDefault();
        const coords = this.getSam3CanvasCoords(event);
        const prompt = this.getSam3ActivePrompt();
        if (!prompt) {
          return;
        }

        if (event.shiftKey) {
          this.sam3Widget.currentBox = { x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y, isNegative: event.button === 2 };
          this.sam3Widget.isDrawingBox = true;
          this.redrawSam3Canvas();
          return;
        }

        const points = event.button === 2 ? prompt.negative_points : prompt.positive_points;
        points.push(coords);
        this.updateSam3Storage();
        this.redrawSam3Canvas();
      });

      canvas.addEventListener("mousemove", (event) => {
        if (!this.sam3Widget.image) {
          return;
        }
        const coords = this.getSam3CanvasCoords(event);
        if (this.sam3Widget.isDrawingBox && this.sam3Widget.currentBox) {
          this.sam3Widget.currentBox.x2 = coords.x;
          this.sam3Widget.currentBox.y2 = coords.y;
          this.redrawSam3Canvas();
          return;
        }
        const hovered = this.findSam3ItemAt(coords.x, coords.y);
        if (hovered !== this.sam3Widget.hoveredItem) {
          this.sam3Widget.hoveredItem = hovered;
          this.redrawSam3Canvas();
        }
      });

      canvas.addEventListener("mouseup", () => {
        if (!this.sam3Widget.isDrawingBox || !this.sam3Widget.currentBox) {
          return;
        }
        const box = this.sam3Widget.currentBox;
        const width = Math.abs(box.x2 - box.x1);
        const height = Math.abs(box.y2 - box.y1);
        if (width > 5 && height > 5) {
          const normalizedBox = {
            x1: Math.min(box.x1, box.x2),
            y1: Math.min(box.y1, box.y2),
            x2: Math.max(box.x1, box.x2),
            y2: Math.max(box.y1, box.y2),
          };
          const prompt = this.getSam3ActivePrompt();
          const boxes = box.isNegative ? prompt.negative_boxes : prompt.positive_boxes;
          boxes.push(normalizedBox);
          this.updateSam3Storage();
        }
        this.sam3Widget.currentBox = null;
        this.sam3Widget.isDrawingBox = false;
        this.redrawSam3Canvas();
      });

      canvas.addEventListener("mouseleave", () => {
        this.sam3Widget.currentBox = null;
        this.sam3Widget.isDrawingBox = false;
        this.redrawSam3Canvas();
      });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      canvas._sam3PolygonBound = true;
    };

    nodeType.prototype.getSam3CanvasCoords = function (event) {
      const canvas = this.sam3Widget.canvas;
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width, 0, canvas.width),
        y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height, 0, canvas.height),
      };
    };

    nodeType.prototype.rebuildSam3TabBar = function () {
      const widget = this.sam3Widget;
      if (!widget?.tabBar) {
        return;
      }
      widget.tabBar.innerHTML = "";
      widget.prompts.forEach((prompt, index) => {
        const color = SAM3_PROMPT_COLORS[index % SAM3_PROMPT_COLORS.length];
        const isActive = index === widget.activePromptIndex;
        const tab = document.createElement("div");
        tab.style.cssText = [
          "display:flex",
          "align-items:center",
          "gap:6px",
          "padding:4px 8px",
          `background:${isActive ? "#333" : "#2a2a2a"}`,
          `border:1px solid ${isActive ? color.primary : "#444"}`,
          "border-radius:4px",
          "cursor:pointer",
          "font:11px sans-serif",
          `color:${isActive ? "#fff" : "#aaa"}`,
        ].join(";");
        const dot = document.createElement("span");
        dot.style.cssText = `width:10px;height:10px;border-radius:2px;background:${color.primary};flex-shrink:0`;
        const label = document.createElement("span");
        label.textContent = prompt.name || `Prompt ${index + 1}`;
        label.title = "Right-click to rename";
        label.oncontextmenu = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const nextName = window.prompt("Prompt name", label.textContent);
          if (nextName !== null) {
            prompt.name = nextName.trim() || `Prompt ${index + 1}`;
            this.updateSam3Storage();
            this.rebuildSam3TabBar();
          }
        };
        tab.appendChild(dot);
        tab.appendChild(label);
        if (widget.prompts.length > 1) {
          const deleteButton = document.createElement("span");
          deleteButton.textContent = "x";
          deleteButton.style.cssText = "color:#888;cursor:pointer;font-size:13px;padding:0 2px";
          deleteButton.onclick = (event) => {
            event.stopPropagation();
            this.deleteSam3Prompt(index);
          };
          tab.appendChild(deleteButton);
        }
        tab.onclick = () => this.setSam3ActivePrompt(index);
        widget.tabBar.appendChild(tab);
      });

      if (widget.prompts.length < SAM3_MAX_PROMPTS) {
        const addButton = document.createElement("button");
        addButton.textContent = "+";
        addButton.style.cssText = "padding:4px 12px;background:#2a5a2a;border:1px solid #3a7a3a;border-radius:4px;color:#8f8;cursor:pointer;font:700 14px sans-serif";
        addButton.onclick = () => this.addSam3Prompt();
        widget.tabBar.appendChild(addButton);
      }
      this.updateSam3Counter();
      this.updateSam3RunButton();
    };

    nodeType.prototype.setSam3ActivePrompt = function (index) {
      this.sam3Widget.activePromptIndex = clamp(index, 0, this.sam3Widget.prompts.length - 1);
      this.rebuildSam3TabBar();
      this.updateSam3RunButton();
      this.redrawSam3Canvas();
    };

    nodeType.prototype.addSam3Prompt = function () {
      if (this.sam3Widget.prompts.length >= SAM3_MAX_PROMPTS) {
        return;
      }
      const prompt = createSam3Prompt();
      prompt.name = `Prompt ${this.sam3Widget.prompts.length + 1}`;
      this.sam3Widget.prompts.push(prompt);
      this.sam3Widget.activePromptIndex = this.sam3Widget.prompts.length - 1;
      this.updateSam3Storage();
      this.rebuildSam3TabBar();
      this.updateSam3RunButton();
      this.redrawSam3Canvas();
    };

    nodeType.prototype.deleteSam3Prompt = function (index) {
      if (this.sam3Widget.prompts.length <= 1) {
        this.clearSam3ActivePrompt();
        return;
      }
      this.sam3Widget.prompts.splice(index, 1);
      this.sam3Widget.activePromptIndex = clamp(this.sam3Widget.activePromptIndex, 0, this.sam3Widget.prompts.length - 1);
      this.updateSam3Storage();
      this.rebuildSam3TabBar();
      this.updateSam3RunButton();
      this.redrawSam3Canvas();
    };

    nodeType.prototype.clearSam3ActivePrompt = function () {
      const prompt = this.getSam3ActivePrompt();
      if (!prompt) {
        return;
      }
      prompt.positive_points = [];
      prompt.negative_points = [];
      prompt.positive_boxes = [];
      prompt.negative_boxes = [];
      this.updateSam3Storage();
      this.updateSam3RunButton();
      this.redrawSam3Canvas();
    };

    nodeType.prototype.clearAllSam3Prompts = function () {
      this.sam3Widget.prompts = [createSam3Prompt()];
      this.sam3Widget.activePromptIndex = 0;
      this.sam3Widget.currentBox = null;
      this.sam3Widget.isDrawingBox = false;
      this.updateSam3Storage();
      this.rebuildSam3TabBar();
      this.updateSam3RunButton();
      this.redrawSam3Canvas();
    };

    nodeType.prototype.updateSam3Counter = function () {
      const prompt = this.getSam3ActivePrompt();
      if (!prompt || !this.sam3Widget?.counter) {
        return;
      }
      const pts = prompt.positive_points.length + prompt.negative_points.length;
      const boxes = prompt.positive_boxes.length + prompt.negative_boxes.length;
      this.sam3Widget.counter.textContent = `${prompt.name || "Prompt"}: ${pts} pts, ${boxes} boxes`;
    };

    nodeType.prototype.loadMaskedImageIntoSam3Canvas = function () {
      if (!this.sam3Widget) {
        return;
      }

      if (this.sam3Widget.maskedImage) {
        this.sam3Widget.image = this.sam3Widget.maskedImage;
        this.sam3Widget.canvas.width = this.sam3Widget.maskedImage.width;
        this.sam3Widget.canvas.height = this.sam3Widget.maskedImage.height;
        this.redrawSam3Canvas();
        return;
      }

      if (!this.polygonWidget?.image) {
        return;
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = this.polygonWidget.canvas.width;
      offscreen.height = this.polygonWidget.canvas.height;
      const offscreenCtx = offscreen.getContext("2d");
      offscreenCtx.drawImage(this.polygonWidget.image, 0, 0, offscreen.width, offscreen.height);

      const color = this.getPolygonWidget("color")?.value || "#FF0000";
      const fillOpacity = clamp(Number(this.getPolygonWidget("fill_opacity")?.value ?? 35), 0, 100) / 100;
      const outlineWidth = clamp(Number(this.getPolygonWidget("outline_width")?.value ?? 3), 0, 20);
      for (const polygon of this.polygonWidget.polygons || []) {
        const points = polygon.points || [];
        if (points.length < MIN_VERTICES) {
          continue;
        }
        offscreenCtx.beginPath();
        offscreenCtx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          offscreenCtx.lineTo(points[index].x, points[index].y);
        }
        offscreenCtx.closePath();
        if (fillOpacity > 0) {
          offscreenCtx.fillStyle = rgba(color, fillOpacity);
          offscreenCtx.fill();
        }
        if (outlineWidth > 0) {
          offscreenCtx.lineWidth = outlineWidth;
          offscreenCtx.strokeStyle = rgba(color, 1);
          offscreenCtx.stroke();
        }
      }

      const image = new Image();
      image.onload = () => {
        this.sam3Widget.maskedImage = image;
        this.sam3Widget.image = image;
        this.sam3Widget.canvas.width = image.width;
        this.sam3Widget.canvas.height = image.height;
        this.redrawSam3Canvas();
      };
      image.src = offscreen.toDataURL("image/jpeg", 0.9);
    };

    nodeType.prototype.updateSam3CanvasFromMaskedImage = function () {
      this.loadMaskedImageIntoSam3Canvas();
    };

    nodeType.prototype.findSam3ItemAt = function (x, y) {
      const prompt = this.getSam3ActivePrompt();
      const threshold = 10;
      if (!prompt) {
        return null;
      }
      for (let index = 0; index < prompt.positive_points.length; index += 1) {
        if (Math.abs(prompt.positive_points[index].x - x) < threshold && Math.abs(prompt.positive_points[index].y - y) < threshold) {
          return { type: "point", index, negative: false };
        }
      }
      for (let index = 0; index < prompt.negative_points.length; index += 1) {
        if (Math.abs(prompt.negative_points[index].x - x) < threshold && Math.abs(prompt.negative_points[index].y - y) < threshold) {
          return { type: "point", index, negative: true };
        }
      }
      return null;
    };

    nodeType.prototype.colorWithAlpha = function (hexColor, alpha) {
      const parsed = parseColor(hexColor);
      return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
    };

    nodeType.prototype.drawSam3Points = function (ctx, points, color, isNegative) {
      for (const point of points || []) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = isNegative ? "rgba(255,0,0,0.8)" : this.colorWithAlpha(color, 0.8);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        if (isNegative) {
          ctx.beginPath();
          ctx.moveTo(point.x - 4, point.y - 4);
          ctx.lineTo(point.x + 4, point.y + 4);
          ctx.moveTo(point.x + 4, point.y - 4);
          ctx.lineTo(point.x - 4, point.y + 4);
          ctx.stroke();
        }
      }
    };

    nodeType.prototype.drawSam3Boxes = function (ctx, boxes, color, isNegative) {
      for (const box of boxes || []) {
        const width = box.x2 - box.x1;
        const height = box.y2 - box.y1;
        ctx.fillStyle = isNegative ? "rgba(255,0,0,0.15)" : this.colorWithAlpha(color, 0.15);
        ctx.fillRect(box.x1, box.y1, width, height);
        ctx.strokeStyle = isNegative ? "rgba(255,0,0,1)" : color;
        ctx.lineWidth = 2;
        if (isNegative) {
          ctx.setLineDash([4, 4]);
        }
        ctx.strokeRect(box.x1, box.y1, width, height);
        ctx.setLineDash([]);
      }
    };

    nodeType.prototype.redrawSam3Canvas = function () {
      const widget = this.sam3Widget;
      if (!widget) {
        return;
      }
      const { canvas, ctx, image, currentBox } = widget;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image) {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#aaa";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Select or upload an image", canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillText("Click: positive | Right-click: negative | Shift-drag: box", canvas.width / 2, canvas.height / 2 + 8);
      }

      const prompt = this.getSam3ActivePrompt();
      const color = SAM3_PROMPT_COLORS[widget.activePromptIndex % SAM3_PROMPT_COLORS.length].primary;
      if (prompt) {
        this.drawSam3Boxes(ctx, prompt.positive_boxes, color, false);
        this.drawSam3Boxes(ctx, prompt.negative_boxes, color, true);
        this.drawSam3Points(ctx, prompt.positive_points, color, false);
        this.drawSam3Points(ctx, prompt.negative_points, color, true);
      }

      if (currentBox) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = currentBox.isNegative ? "#f00" : color;
        ctx.lineWidth = 2;
        ctx.strokeRect(currentBox.x1, currentBox.y1, currentBox.x2 - currentBox.x1, currentBox.y2 - currentBox.y1);
        ctx.setLineDash([]);
      }
    };

    nodeType.prototype.getCurrentVertexCount = function () {
      return clampVertexCount(this.getPolygonWidget("vertex_count")?.value);
    };

    nodeType.prototype.setVertexCountWidgetValue = function (count) {
      const vertexWidget = this.getPolygonWidget("vertex_count");
      if (!vertexWidget) {
        return;
      }

      this.polygonWidget.suppressVertexCallback = true;
      vertexWidget.value = clampVertexCount(count);
      this.properties = this.properties || {};
      this.properties.vertex_count_value = vertexWidget.value;
      this.polygonWidget.suppressVertexCallback = false;
    };

    nodeType.prototype.getSelectedPolygon = function () {
      const index = this.polygonWidget.selectedIndex;
      return index >= 0 ? this.polygonWidget.polygons[index] : null;
    };

    nodeType.prototype.selectPolygon = function (index, updateInfo = true) {
      if (!this.polygonWidget.polygons.length) {
        this.polygonWidget.selectedIndex = -1;
        this.polygonWidget.cleared = true;
      } else {
        this.polygonWidget.selectedIndex = clamp(Math.round(Number(index) || 0), 0, this.polygonWidget.polygons.length - 1);
        this.polygonWidget.cleared = false;
        this.setVertexCountWidgetValue(this.getSelectedPolygon().points.length);
      }

      if (updateInfo) {
        this.updatePolygonInfo();
        this.redrawPolygonCanvas();
        this.updatePolygonButtons();
      }
    };

    nodeType.prototype.createDefaultPolygon = function (count = this.getCurrentVertexCount(), center = null) {
      const image = this.polygonWidget.image;
      if (!image) {
        return [];
      }

      const vertexCount = clampVertexCount(count);
      const radius = Math.min(image.width, image.height) * 0.08;
      const centerX = clamp(Number(center?.x ?? image.width / 2), radius, image.width - radius);
      const centerY = clamp(Number(center?.y ?? image.height / 2), radius, image.height - radius);
      const points = [];

      for (let index = 0; index < vertexCount; index += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / vertexCount;
        points.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }

      return points;
    };

    nodeType.prototype.getPolygonCenter = function (polygon) {
      const points = polygon?.points || [];
      if (!points.length) {
        return null;
      }
      const bounds = points.reduce(
        (acc, point) => ({
          minX: Math.min(acc.minX, point.x),
          maxX: Math.max(acc.maxX, point.x),
          minY: Math.min(acc.minY, point.y),
          maxY: Math.max(acc.maxY, point.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      return {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
    };

    nodeType.prototype.addPolygonAt = function (coords) {
      const polygon = { points: this.createDefaultPolygon(MIN_VERTICES, coords) };
      this.polygonWidget.polygons.push(polygon);
      this.polygonWidget.cleared = false;
      this.selectPolygon(this.polygonWidget.polygons.length - 1, false);
      this.setVertexCountWidgetValue(MIN_VERTICES);
      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.restorePolygonState = function (state) {
      this.polygonWidget.polygons = clonePolygons(state.polygons || []);
      this.polygonWidget.cleared = Boolean(state.cleared) || this.polygonWidget.polygons.length === 0;
      if (this.polygonWidget.cleared) {
        this.polygonWidget.selectedIndex = -1;
      } else {
        this.selectPolygon(state.selectedIndex ?? this.polygonWidget.polygons.length - 1, false);
      }
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.getPolygonState = function () {
      return {
        polygons: clonePolygons(this.polygonWidget.polygons),
        selectedIndex: this.polygonWidget.selectedIndex,
        cleared: Boolean(this.polygonWidget.cleared),
      };
    };

    nodeType.prototype.pushPolygonHistory = function () {
      const state = this.getPolygonState();
      const current = this.polygonWidget.history[this.polygonWidget.historyIndex];
      if (current && JSON.stringify(current) === JSON.stringify(state)) {
        return;
      }
      this.polygonWidget.history = this.polygonWidget.history.slice(0, this.polygonWidget.historyIndex + 1);
      this.polygonWidget.history.push(state);
      this.polygonWidget.historyIndex = this.polygonWidget.history.length - 1;
    };

    nodeType.prototype.undoPolygon = function () {
      if (this.polygonWidget.historyIndex <= 0) {
        return;
      }
      this.polygonWidget.historyIndex -= 1;
      this.restorePolygonState(this.polygonWidget.history[this.polygonWidget.historyIndex]);
    };

    nodeType.prototype.redoPolygon = function () {
      if (this.polygonWidget.historyIndex >= this.polygonWidget.history.length - 1) {
        return;
      }
      this.polygonWidget.historyIndex += 1;
      this.restorePolygonState(this.polygonWidget.history[this.polygonWidget.historyIndex]);
    };

    nodeType.prototype.clearPolygon = function () {
      const index = this.polygonWidget.selectedIndex;
      if (index < 0) {
        return;
      }

      this.polygonWidget.polygons.splice(index, 1);
      if (!this.polygonWidget.polygons.length) {
        this.polygonWidget.selectedIndex = -1;
        this.polygonWidget.cleared = true;
      } else {
        this.selectPolygon(Math.min(index, this.polygonWidget.polygons.length - 1), false);
      }
      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.deletePolygonAt = function (coords) {
      const polygonIndex = this.findPolygonAt(coords);
      if (polygonIndex < 0) {
        return;
      }

      this.selectPolygon(polygonIndex, false);
      this.polygonWidget.polygons.splice(polygonIndex, 1);
      if (!this.polygonWidget.polygons.length) {
        this.polygonWidget.selectedIndex = -1;
        this.polygonWidget.cleared = true;
      } else {
        this.selectPolygon(Math.min(polygonIndex, this.polygonWidget.polygons.length - 1), false);
      }

      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.resetPolygon = function () {
      if (!this.polygonWidget.image) {
        return;
      }

      const selected = this.getSelectedPolygon();
      if (!selected) {
        this.addPolygonAt({ x: this.polygonWidget.image.width / 2, y: this.polygonWidget.image.height / 2 });
        return;
      }

      selected.points = this.createDefaultPolygon(this.getCurrentVertexCount(), this.getPolygonCenter(selected));
      this.polygonWidget.cleared = false;
      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.handlePolygonVertexCountChanged = function (value) {
      const targetCount = clampVertexCount(value);
      this.setVertexCountWidgetValue(targetCount);

      if (!this.polygonWidget.image) {
        this.savePolygonWidgetState(true);
        return;
      }

      let selected = this.getSelectedPolygon();
      if (!selected) {
        this.addPolygonAt({ x: this.polygonWidget.image.width / 2, y: this.polygonWidget.image.height / 2 });
        selected = this.getSelectedPolygon();
      }

      this.adjustPolygonVertexCount(selected, targetCount);
      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.adjustPolygonVertexCount = function (polygon, targetCount) {
      const points = polygon?.points || [];

      while (points.length < targetCount && points.length < MAX_VERTICES) {
        let longestIndex = 0;
        let longestDistance = -1;
        for (let index = 0; index < points.length; index += 1) {
          const next = points[(index + 1) % points.length];
          const currentDistance = distanceSquared(points[index], next);
          if (currentDistance > longestDistance) {
            longestDistance = currentDistance;
            longestIndex = index;
          }
        }
        const start = points[longestIndex];
        const end = points[(longestIndex + 1) % points.length];
        points.splice(longestIndex + 1, 0, {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        });
      }

      while (points.length > targetCount && points.length > MIN_VERTICES) {
        let removeIndex = 0;
        let smallestArea = Number.POSITIVE_INFINITY;
        for (let index = 0; index < points.length; index += 1) {
          const previous = points[(index - 1 + points.length) % points.length];
          const next = points[(index + 1) % points.length];
          const area = triangleArea(previous, points[index], next);
          if (area < smallestArea) {
            smallestArea = area;
            removeIndex = index;
          }
        }
        points.splice(removeIndex, 1);
      }
    };

    nodeType.prototype.handlePolygonImageSelectionChanged = function (forceReload = false) {
      const imageWidget = this.getPolygonWidget("image");
      const imageValue = imageWidget?.value || "";

      if (imageValue === this.polygonWidget.imageValue && !forceReload) {
        return;
      }

      const changedImage = imageValue !== this.polygonWidget.imageValue;
      if (changedImage) {
        this.polygonWidget.polygons = [];
        this.polygonWidget.selectedIndex = -1;
        this.polygonWidget.cleared = false;
        this.polygonWidget.pendingDefaultOnLoad = true;
        this.polygonWidget.history = [];
        this.polygonWidget.historyIndex = -1;
      }

      this.savePolygonWidgetState(true);
      this.loadPolygonImage(forceReload || changedImage);
      this.updatePolygonButtons();
    };

    nodeType.prototype.loadPolygonImage = function (force = false) {
      const imageWidget = this.getPolygonWidget("image");
      if (!imageWidget?.value) {
        this.polygonWidget.image = null;
        this.redrawPolygonCanvas();
        return;
      }

      const imageValue = imageWidget.value;
      if (!force && this.polygonWidget.image && this.polygonWidget.imageValue === imageValue) {
        return;
      }

      this.polygonWidget.imageValue = imageValue;
      const loadToken = this.polygonWidget.loadToken + 1;
      this.polygonWidget.loadToken = loadToken;
      const image = new Image();
      image.onload = () => {
        if (this.polygonWidget.loadToken !== loadToken) {
          return;
        }
        this.polygonWidget.image = image;
        this.polygonWidget.canvas.width = image.width;
        this.polygonWidget.canvas.height = image.height;
        if (this.sam3Widget) {
          this.sam3Widget.image = image;
          this.sam3Widget.imageValue = imageValue;
          this.sam3Widget.maskedImage = null;
          this.sam3Widget.maskedImageValue = null;
          this.sam3Widget.canvas.width = image.width;
          this.sam3Widget.canvas.height = image.height;
          this.redrawSam3Canvas();
        }

        if (this.polygonWidget.pendingDefaultOnLoad) {
          this.polygonWidget.polygons = [
            { points: this.createDefaultPolygon(MIN_VERTICES, { x: image.width / 2, y: image.height / 2 }) },
          ];
          this.polygonWidget.cleared = false;
          this.polygonWidget.pendingDefaultOnLoad = false;
          this.selectPolygon(0, false);
          this.updatePolygonInfo();
        }

        if (this.polygonWidget.history.length === 0) {
          this.pushPolygonHistory();
        }

        this.redrawPolygonCanvas();
        this.updatePolygonButtons();
      };
      image.onerror = () => {
        if (this.polygonWidget.loadToken !== loadToken) {
          return;
        }
        this.polygonWidget.image = null;
        if (this.sam3Widget) {
          this.sam3Widget.image = null;
          this.sam3Widget.maskedImage = null;
          this.sam3Widget.maskedImageValue = null;
          this.redrawSam3Canvas();
        }
        this.redrawPolygonCanvas();
      };
      image.src = getImageUrl(imageValue);
    };

    nodeType.prototype.getPolygonCanvasCoords = function (event) {
      const canvas = this.polygonWidget.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: clamp((event.clientX - rect.left) * scaleX, 0, canvas.width),
        y: clamp((event.clientY - rect.top) * scaleY, 0, canvas.height),
      };
    };

    nodeType.prototype.getHitTolerance = function () {
      const canvas = this.polygonWidget.canvas;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(canvas.width / Math.max(1, rect.width), canvas.height / Math.max(1, rect.height));
      return 10 * scale;
    };

    nodeType.prototype.findPolygonVertexAt = function (coords, polygonIndex) {
      const polygon = this.polygonWidget.polygons[polygonIndex];
      if (!polygon) {
        return -1;
      }

      const tolerance = this.getHitTolerance();
      const toleranceSquared = tolerance * tolerance;
      for (let index = polygon.points.length - 1; index >= 0; index -= 1) {
        if (distanceSquared(coords, polygon.points[index]) <= toleranceSquared) {
          return index;
        }
      }
      return -1;
    };

    nodeType.prototype.findPolygonAt = function (coords) {
      for (let index = this.polygonWidget.polygons.length - 1; index >= 0; index -= 1) {
        if (pointInPolygon(coords, this.polygonWidget.polygons[index].points)) {
          return index;
        }
      }
      return -1;
    };

    nodeType.prototype.findPolygonSegmentAt = function (coords) {
      const polygon = this.getSelectedPolygon();
      const points = polygon?.points || [];
      if (points.length < MIN_VERTICES) {
        return -1;
      }

      const tolerance = this.getHitTolerance();
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < points.length; index += 1) {
        const distance = pointToSegmentDistance(coords, points[index], points[(index + 1) % points.length]);
        if (distance <= tolerance && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      return bestIndex;
    };

    nodeType.prototype.startVertexDrag = function (polygonIndex, vertexIndex, coords) {
      this.polygonWidget.dragMode = "vertex";
      this.polygonWidget.draggingPolygonIndex = polygonIndex;
      this.polygonWidget.draggingVertexIndex = vertexIndex;
      this.polygonWidget.dragStart = coords;
      this.polygonWidget.dragLast = coords;
      this.polygonWidget.dragMoved = false;
      this.polygonWidget.canvas.style.cursor = "grabbing";
    };

    nodeType.prototype.startPolygonDrag = function (polygonIndex, coords) {
      const polygon = this.polygonWidget.polygons[polygonIndex];
      this.polygonWidget.dragMode = "polygon";
      this.polygonWidget.draggingPolygonIndex = polygonIndex;
      this.polygonWidget.draggingVertexIndex = -1;
      this.polygonWidget.dragStart = coords;
      this.polygonWidget.dragLast = coords;
      this.polygonWidget.dragOriginalPoints = clonePoints(polygon.points);
      this.polygonWidget.dragMoved = false;
      this.polygonWidget.canvas.style.cursor = "grabbing";
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.moveDraggedVertex = function (coords) {
      const polygon = this.polygonWidget.polygons[this.polygonWidget.draggingPolygonIndex];
      const point = polygon?.points?.[this.polygonWidget.draggingVertexIndex];
      if (!point) {
        return;
      }

      point.x = coords.x;
      point.y = coords.y;
      this.polygonWidget.dragMoved = true;
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
    };

    nodeType.prototype.moveDraggedPolygon = function (coords) {
      const polygon = this.polygonWidget.polygons[this.polygonWidget.draggingPolygonIndex];
      const originalPoints = this.polygonWidget.dragOriginalPoints;
      const image = this.polygonWidget.image;
      if (!polygon || !originalPoints.length || !image) {
        return;
      }

      const rawDx = coords.x - this.polygonWidget.dragStart.x;
      const rawDy = coords.y - this.polygonWidget.dragStart.y;
      const bounds = originalPoints.reduce(
        (acc, point) => ({
          minX: Math.min(acc.minX, point.x),
          maxX: Math.max(acc.maxX, point.x),
          minY: Math.min(acc.minY, point.y),
          maxY: Math.max(acc.maxY, point.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      const dx = clamp(rawDx, -bounds.minX, image.width - bounds.maxX);
      const dy = clamp(rawDy, -bounds.minY, image.height - bounds.maxY);

      polygon.points = originalPoints.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }));
      this.polygonWidget.dragMoved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
    };

    nodeType.prototype.finishPolygonDrag = function () {
      if (this.polygonWidget.dragMode === "none") {
        return;
      }

      const moved = this.polygonWidget.dragMoved;
      this.polygonWidget.dragMode = "none";
      this.polygonWidget.draggingPolygonIndex = -1;
      this.polygonWidget.draggingVertexIndex = -1;
      this.polygonWidget.dragStart = null;
      this.polygonWidget.dragLast = null;
      this.polygonWidget.dragOriginalPoints = [];
      this.polygonWidget.dragMoved = false;
      this.polygonWidget.canvas.style.cursor = "default";

      if (moved) {
        this.pushPolygonHistory();
      }
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.updatePolygonButtons = function () {
      const buttons = this.polygonWidget.buttons;
      if (!buttons) {
        return;
      }

      buttons.undo.disabled = this.polygonWidget.historyIndex <= 0;
      buttons.redo.disabled = this.polygonWidget.historyIndex >= this.polygonWidget.history.length - 1;
      buttons.clear.disabled = this.polygonWidget.selectedIndex < 0;
      buttons.reset.disabled = !this.polygonWidget.image || this.polygonWidget.selectedIndex < 0;

      for (const button of [buttons.undo, buttons.redo, buttons.clear, buttons.reset]) {
        button.style.opacity = button.disabled ? "0.45" : "1";
        button.style.cursor = button.disabled ? "default" : "pointer";
      }
    };

    nodeType.prototype.redrawPolygonCanvas = function () {
      const { canvas, ctx, image, polygons, selectedIndex, cleared } = this.polygonWidget;
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
        ctx.fillText("Shift-left adds, Shift-right deletes, drag fill to move", canvas.width / 2, canvas.height / 2 + 18);
        return;
      }

      if (cleared || polygons.length === 0) {
        return;
      }

      const color = this.getPolygonWidget("color")?.value || "#FF0000";
      const fillOpacity = clamp(Number(this.getPolygonWidget("fill_opacity")?.value ?? 35), 0, 100) / 100;
      const outlineWidth = clamp(Number(this.getPolygonWidget("outline_width")?.value ?? 3), 0, 20);
      const handleRadius = Math.max(4, this.getHitTolerance() * 0.45);

      ctx.save();
      for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
        const polygon = polygons[polygonIndex];
        const points = polygon.points;
        if (points.length < MIN_VERTICES) {
          continue;
        }

        const selected = polygonIndex === selectedIndex;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.closePath();
        if (fillOpacity > 0) {
          ctx.fillStyle = rgba(color, selected ? fillOpacity : fillOpacity * 0.55);
          ctx.fill();
        }
        if (outlineWidth > 0) {
          ctx.lineWidth = selected ? Math.max(1, outlineWidth + 1) : Math.max(1, outlineWidth);
          ctx.strokeStyle = rgba(color, selected ? 1 : 0.7);
          ctx.stroke();
        }
      }

      const selectedPolygon = this.getSelectedPolygon();
      if (selectedPolygon) {
        for (const point of selectedPolygon.points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.lineWidth = Math.max(1, outlineWidth);
          ctx.strokeStyle = rgba(color, 1);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
  },
});
