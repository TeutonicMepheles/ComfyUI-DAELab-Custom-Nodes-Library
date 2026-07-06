import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MIN_VERTICES = 3;
const MAX_VERTICES = 12;
const PANEL_DEFAULT_HEIGHT = 430;
const PANEL_MIN_HEIGHT = 280;
const PANEL_MAX_HEIGHT = 1400;

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
  return points.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
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

      const canvasTitle = createSectionTitle("多边形编辑画布");

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
      container.appendChild(canvasWrapper);

      const ctx = canvas.getContext("2d");

      this.polygonWidget = {
        container,
        canvas,
        ctx,
        image: null,
        imageValue: null,
        loadToken: 0,
        points: [],
        cleared: false,
        draggingIndex: -1,
        dragMoved: false,
        history: [],
        historyIndex: -1,
        lastNodeHeight: this.size?.[1] || null,
        resizeReady: false,
        suppressVertexCallback: false,
        pendingDefaultOnLoad: false,
      };

      const undoButton = createButton("Undo", "Undo last polygon edit", () => this.undoPolygon());
      const redoButton = createButton("Redo", "Redo polygon edit", () => this.redoPolygon());
      const refreshButton = createButton("Refresh", "Refresh preview image and redraw canvas", () => {
        this.loadPolygonImage(true);
        this.redrawPolygonCanvas();
      });
      const clearButton = createButton("Clear", "Clear polygon overlay", () => this.clearPolygon());
      const resetButton = createButton("Reset", "Reset polygon using current vertex count", () => this.resetPolygon());

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

      const previewTitle = createSectionTitle("原图预览");
      previewTitle.style.marginTop = "4px";
      const previewTitleWidget = this.addDOMWidget("polygon_preview_title", "polygon_preview_title", previewTitle);
      previewTitleWidget.computeSize = (width) => [width, 34];

      this.restorePolygonInfo();
      this.loadPolygonImage(false);
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();

      this.bindPolygonWidgetCallbacks();

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
        this.handlePolygonImageSelectionChanged(false);
        this.setPolygonPanelHeight(this.getPolygonPanelHeight(), false);
      });

      canvas.addEventListener("mousedown", (event) => {
        if (!this.polygonWidget.image || event.button !== 0 || this.polygonWidget.cleared) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);
        const index = this.findPolygonVertexAt(coords);
        if (index < 0) {
          return;
        }

        event.preventDefault();
        this.polygonWidget.draggingIndex = index;
        this.polygonWidget.dragMoved = false;
        canvas.style.cursor = "grabbing";
      });

      canvas.addEventListener("mousemove", (event) => {
        if (!this.polygonWidget.image) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);
        const draggingIndex = this.polygonWidget.draggingIndex;

        if (draggingIndex >= 0) {
          const point = this.polygonWidget.points[draggingIndex];
          if (point) {
            point.x = coords.x;
            point.y = coords.y;
            this.polygonWidget.dragMoved = true;
            this.updatePolygonInfo();
            this.redrawPolygonCanvas();
          }
          return;
        }

        if (!this.polygonWidget.cleared && this.findPolygonVertexAt(coords) >= 0) {
          canvas.style.cursor = "grab";
        } else if (!this.polygonWidget.cleared && this.findPolygonSegmentAt(coords) >= 0) {
          canvas.style.cursor = "copy";
        } else {
          canvas.style.cursor = "default";
        }
      });

      canvas.addEventListener("mouseup", () => {
        if (this.polygonWidget.draggingIndex < 0) {
          return;
        }

        const moved = this.polygonWidget.dragMoved;
        this.polygonWidget.draggingIndex = -1;
        this.polygonWidget.dragMoved = false;
        canvas.style.cursor = "default";

        if (moved) {
          this.pushPolygonHistory();
          this.updatePolygonButtons();
        }
      });

      canvas.addEventListener("mouseleave", () => {
        if (this.polygonWidget.draggingIndex >= 0 && this.polygonWidget.dragMoved) {
          this.pushPolygonHistory();
        }
        this.polygonWidget.draggingIndex = -1;
        this.polygonWidget.dragMoved = false;
        canvas.style.cursor = "default";
      });

      canvas.addEventListener("dblclick", (event) => {
        if (!this.polygonWidget.image || this.polygonWidget.cleared) {
          return;
        }
        event.preventDefault();

        if (this.polygonWidget.points.length >= MAX_VERTICES) {
          return;
        }

        const coords = this.getPolygonCanvasCoords(event);
        const segmentIndex = this.findPolygonSegmentAt(coords);
        if (segmentIndex < 0) {
          return;
        }

        this.polygonWidget.points.splice(segmentIndex + 1, 0, coords);
        this.setVertexCountWidgetValue(this.polygonWidget.points.length);
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
      const noteWidget = this.getPolygonWidget("polygon_note");

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

      for (const widgetName of ["color", "fill_opacity", "outline_width", "polygon_note"]) {
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

      if (noteWidget) {
        noteWidget._polygonMaskStateBound = true;
      }
    };

    nodeType.prototype.savePolygonWidgetState = function (markDirty = true) {
      this.properties = this.properties || {};

      for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_note"]) {
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

      for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_note"]) {
        const widget = this.getPolygonWidget(name);
        const propertyName = `${name}_value`;
        if (widget && Object.prototype.hasOwnProperty.call(this.properties, propertyName)) {
          widget.value = this.properties[propertyName];
        }
      }
    };

    nodeType.prototype.serializePolygonInfo = function () {
      this.properties = this.properties || {};

      if (this.polygonWidget) {
        this.properties.polygon_info = JSON.stringify({
          points: clonePoints(this.polygonWidget.points),
          cleared: Boolean(this.polygonWidget.cleared),
        });
      }

      return this.properties.polygon_info || "";
    };

    chainCallback(nodeType.prototype, "onConfigure", function () {
      setTimeout(() => {
        this.restorePolygonWidgetState?.();
      }, 0);
    });

    chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
      this.savePolygonWidgetState?.(false);
      this.serializePolygonInfo?.();
      if (serialized?.properties) {
        serialized.properties.polygon_info = this.properties?.polygon_info || "";
        serialized.properties.polygon_canvas_height = this.getPolygonPanelHeight();
        for (const name of ["image", "vertex_count", "color", "fill_opacity", "outline_width", "polygon_note"]) {
          serialized.properties[`${name}_value`] = this.properties?.[`${name}_value`] ?? "";
        }
      }
    });

    nodeType.prototype.restorePolygonInfo = function () {
      const polygonInfo = this.properties?.polygon_info;
      if (!polygonInfo) {
        return;
      }

      try {
        const info = typeof polygonInfo === "string" ? JSON.parse(polygonInfo) : polygonInfo;
        this.polygonWidget.cleared = Boolean(info?.cleared);
        if (Array.isArray(info?.points)) {
          this.polygonWidget.points = info.points
            .map((point) => ({
              x: Number(point?.x ?? point?.[0] ?? 0),
              y: Number(point?.y ?? point?.[1] ?? 0),
            }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        }
        if (!this.polygonWidget.cleared && this.polygonWidget.points.length >= MIN_VERTICES) {
          this.setVertexCountWidgetValue(this.polygonWidget.points.length);
        }
      } catch (error) {
        console.warn("Failed to restore polygon_info", error);
      }
    };

    nodeType.prototype.updatePolygonInfo = function () {
      this.serializePolygonInfo();
      app.graph.setDirtyCanvas(true, true);
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

    nodeType.prototype.createDefaultPolygon = function (count = this.getCurrentVertexCount()) {
      const image = this.polygonWidget.image;
      if (!image) {
        return [];
      }

      const vertexCount = clampVertexCount(count);
      const radius = Math.min(image.width, image.height) * 0.28;
      const centerX = image.width / 2;
      const centerY = image.height / 2;
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

    nodeType.prototype.restorePolygonState = function (state) {
      this.polygonWidget.points = clonePoints(state.points || []);
      this.polygonWidget.cleared = Boolean(state.cleared);
      if (!this.polygonWidget.cleared && this.polygonWidget.points.length >= MIN_VERTICES) {
        this.setVertexCountWidgetValue(this.polygonWidget.points.length);
      }
      this.updatePolygonInfo();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.getPolygonState = function () {
      return {
        points: clonePoints(this.polygonWidget.points),
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
      this.polygonWidget.points = [];
      this.polygonWidget.cleared = true;
      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.resetPolygon = function () {
      if (!this.polygonWidget.image) {
        this.polygonWidget.points = [];
        this.polygonWidget.cleared = false;
      } else {
        this.polygonWidget.points = this.createDefaultPolygon(this.getCurrentVertexCount());
        this.polygonWidget.cleared = false;
      }
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

      if (this.polygonWidget.cleared || this.polygonWidget.points.length < MIN_VERTICES) {
        this.polygonWidget.points = this.createDefaultPolygon(targetCount);
        this.polygonWidget.cleared = false;
      } else {
        this.adjustPolygonVertexCount(targetCount);
      }

      this.updatePolygonInfo();
      this.pushPolygonHistory();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();
    };

    nodeType.prototype.adjustPolygonVertexCount = function (targetCount) {
      const points = this.polygonWidget.points;

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
        this.polygonWidget.points = [];
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

        if (
          this.polygonWidget.pendingDefaultOnLoad ||
          (!this.polygonWidget.cleared && this.polygonWidget.points.length < MIN_VERTICES)
        ) {
          this.polygonWidget.points = this.createDefaultPolygon(this.getCurrentVertexCount());
          this.polygonWidget.cleared = false;
          this.polygonWidget.pendingDefaultOnLoad = false;
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

    nodeType.prototype.findPolygonVertexAt = function (coords) {
      const tolerance = this.getHitTolerance();
      const toleranceSquared = tolerance * tolerance;
      for (let index = this.polygonWidget.points.length - 1; index >= 0; index -= 1) {
        if (distanceSquared(coords, this.polygonWidget.points[index]) <= toleranceSquared) {
          return index;
        }
      }
      return -1;
    };

    nodeType.prototype.findPolygonSegmentAt = function (coords) {
      const points = this.polygonWidget.points;
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

    nodeType.prototype.updatePolygonButtons = function () {
      const buttons = this.polygonWidget.buttons;
      if (!buttons) {
        return;
      }

      buttons.undo.disabled = this.polygonWidget.historyIndex <= 0;
      buttons.redo.disabled = this.polygonWidget.historyIndex >= this.polygonWidget.history.length - 1;
      buttons.clear.disabled = this.polygonWidget.cleared || this.polygonWidget.points.length === 0;
      buttons.reset.disabled = !this.polygonWidget.image;

      for (const button of [buttons.undo, buttons.redo, buttons.clear, buttons.reset]) {
        button.style.opacity = button.disabled ? "0.45" : "1";
        button.style.cursor = button.disabled ? "default" : "pointer";
      }
    };

    nodeType.prototype.redrawPolygonCanvas = function () {
      const { canvas, ctx, image, points, cleared } = this.polygonWidget;
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
        ctx.fillText("Drag vertices, double-click an edge to add a point", canvas.width / 2, canvas.height / 2 + 18);
        return;
      }

      if (cleared || points.length < MIN_VERTICES) {
        return;
      }

      const color = this.getPolygonWidget("color")?.value || "#FF0000";
      const fillOpacity = clamp(Number(this.getPolygonWidget("fill_opacity")?.value ?? 35), 0, 100) / 100;
      const outlineWidth = clamp(Number(this.getPolygonWidget("outline_width")?.value ?? 3), 0, 20);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
      }
      ctx.closePath();
      if (fillOpacity > 0) {
        ctx.fillStyle = rgba(color, fillOpacity);
        ctx.fill();
      }
      if (outlineWidth > 0) {
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = rgba(color, 1);
        ctx.stroke();
      }

      const handleRadius = Math.max(4, this.getHitTolerance() * 0.45);
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = Math.max(1, outlineWidth);
        ctx.strokeStyle = rgba(color, 1);
        ctx.stroke();
      }
      ctx.restore();
    };
  },
});
