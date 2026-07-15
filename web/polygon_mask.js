import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MIN_VERTICES = 3;
const MAX_VERTICES = 12;
const PANEL_DEFAULT_HEIGHT = 430;
const PANEL_MIN_HEIGHT = 280;
const PANEL_MAX_HEIGHT = 1400;
const POLYGON_CACHE_PREFIX = "DAELab.PolygonMask";

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
  name: "comfyui_polygon_mask.PolygonMask",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PolygonMask") {
      return;
    }

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      this.cleanupLegacyPolygonInputs?.();

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
        sourceImageData: null,
        sourceImageUrl: null,
        isLoadingImage: false,
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

      // ResizeObserver: re-draw once the canvas reaches its final display size.
      // Cached images can load synchronously during onConfigure, causing
      // redrawPolygonCanvas() to fire before the DOM container is laid out.
      // getBoundingClientRect() returns ~0×0 at that point, producing enormous
      // vertex handles. The observer fires once layout settles and corrects them.
      this.polygonWidget._resizeObserver = new ResizeObserver(() => {
        if (this.polygonWidget && this.polygonWidget.image) {
          this.redrawPolygonCanvas();
        }
      });
      this.polygonWidget._resizeObserver.observe(canvas);

      // Clean up the ResizeObserver when the node is removed so the canvas
      // element can be garbage-collected.
      const _polygonOnRemoved = this.onRemoved;
      this.onRemoved = function () {
        if (this.polygonWidget && this.polygonWidget._resizeObserver) {
          this.polygonWidget._resizeObserver.disconnect();
          this.polygonWidget._resizeObserver = null;
        }
        if (_polygonOnRemoved) {
          return _polygonOnRemoved.apply(this, arguments);
        }
      };

      const loadImageButton = createButton("Load Image", "Load the connected IMAGE socket into the polygon canvas", () =>
        this.loadSocketImage(),
      );
      const undoButton = createButton("Undo", "Undo last polygon edit", () => this.undoPolygon());
      const redoButton = createButton("Redo", "Redo polygon edit", () => this.redoPolygon());
      const refreshButton = createButton("Refresh", "Refresh socket image and redraw canvas", () => {
        this.loadPolygonImage(true);
        this.redrawPolygonCanvas();
      });
      const clearButton = createButton("Clear", "Delete selected polygon", () => this.clearPolygon());
      const resetButton = createButton("Reset", "Reset selected polygon using current vertex count", () =>
        this.resetPolygon(),
      );

      leftGroup.appendChild(loadImageButton);
      leftGroup.appendChild(undoButton);
      leftGroup.appendChild(redoButton);
      leftGroup.appendChild(refreshButton);
      rightGroup.appendChild(clearButton);
      rightGroup.appendChild(resetButton);
      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);

      this.polygonWidget.buttons = {
        loadImage: loadImageButton,
        undo: undoButton,
        redo: redoButton,
        refresh: refreshButton,
        clear: clearButton,
        reset: resetButton,
      };

      const domWidget = this.addDOMWidget("polygon_canvas", "polygon_canvas", container);
      domWidget.computeSize = (width) => [width, this.getPolygonPanelHeight()];

      this.restorePolygonInfo();
      this.redrawPolygonCanvas();
      this.updatePolygonButtons();

      this.bindPolygonWidgetCallbacks();
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
      const vertexWidget = this.getPolygonWidget("vertex_count");

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
        polygonDataWidget.hidden = true;
        polygonDataWidget.computeSize = () => [0, -4];
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

      for (const name of ["vertex_count", "color", "fill_opacity", "outline_width", "polygon_data"]) {
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

      for (const name of ["vertex_count", "color", "fill_opacity", "outline_width", "polygon_data"]) {
        const widget = this.getPolygonWidget(name);
        const propertyName = `${name}_value`;
        if (widget && Object.prototype.hasOwnProperty.call(this.properties, propertyName)) {
          widget.value = this.properties[propertyName];
        }
      }
    };

    nodeType.prototype.getPolygonImageValue = function () {
      return this.polygonWidget?.imageValue || this.properties?.source_image_hash || "";
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
      this.loadPolygonImage?.(false);
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

      if (!this.properties.polygon_data_value && Array.isArray(serialized?.widgets_values)) {
        const polygonDataIndex = this.widgets?.findIndex((widget) => widget.name === "polygon_data") ?? -1;
        const polygonDataValue = polygonDataIndex >= 0 ? serialized.widgets_values[polygonDataIndex] : "";
        if (polygonDataValue) {
          this.properties.polygon_data_value = polygonDataValue;
        }
      }
    };

    chainCallback(nodeType.prototype, "onConfigure", function (serialized) {
      this.cleanupLegacyPolygonInputs?.();
      this.suppressDefaultPolygonPreview?.();
      this.captureConfiguredPolygonInfo?.(serialized);
      this.restoreCachedPolygonState?.();
      setTimeout(() => {
        this.suppressDefaultPolygonPreview?.();
        this.restoreCachedPolygonState?.();
      }, 0);
    });

    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const encoded = message?.source_image?.[0];
      const imageHash = message?.source_image_hash?.[0] || "";
      if (encoded) {
        const imageValue = this.getPolygonImageValue?.() || imageHash;
        this.loadPolygonImageFromData?.(encoded, imageValue, true, true);
      }
      if (this.polygonWidget?.isLoadingImage) {
        this.polygonWidget.isLoadingImage = false;
        this.updatePolygonButtons?.();
      }
      this.suppressDefaultPolygonPreview?.();
      app.graph.setDirtyCanvas(true, true);
    });

    chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
      this.savePolygonWidgetState?.(false);
      this.serializePolygonInfo?.();
      if (serialized?.properties) {
        serialized.properties.polygon_info = this.properties?.polygon_info || "";
        serialized.properties.polygon_canvas_height = this.getPolygonPanelHeight();
        serialized.properties.polygon_data_value = this.properties?.polygon_data_value || this.properties?.polygon_info || "";
        for (const name of ["vertex_count", "color", "fill_opacity", "outline_width", "polygon_data"]) {
          serialized.properties[`${name}_value`] = this.properties?.[`${name}_value`] ?? "";
        }
      }
      if (Array.isArray(serialized?.widgets_values)) {
        const polygonDataIndex = this.widgets?.findIndex((widget) => widget.name === "polygon_data") ?? -1;
        if (polygonDataIndex >= 0) {
          serialized.widgets_values[polygonDataIndex] = this.properties?.polygon_info || "";
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
        if (info?.image) {
          this.polygonWidget.imageValue = String(info.image);
          this.properties = this.properties || {};
          this.properties.source_image_hash = String(info.image);
        }

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

    nodeType.prototype.getCurrentVertexCount = function () {
      return clampVertexCount(this.getPolygonWidget("vertex_count")?.value);
    };

    nodeType.prototype.loadSocketImage = async function () {
      if (!this.polygonWidget || this.polygonWidget.isLoadingImage) {
        return;
      }

      if (this.loadConnectedLoadImage()) {
        return;
      }

      this.polygonWidget.isLoadingImage = true;
      this.updatePolygonButtons();

      try {
        const result = app.queuePrompt(0, 1);
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (error) {
        console.error("Failed to queue Polygon Mask image load", error);
        this.polygonWidget.isLoadingImage = false;
        this.updatePolygonButtons();
      }
    };

    nodeType.prototype.getConnectedLoadImageInfo = function () {
      const imageInput = this.inputs?.find((input) => input.name === "image");
      const linkId = imageInput?.link;
      if (linkId == null || !app.graph) {
        return null;
      }

      const link = app.graph.links?.[linkId];
      const originNode = link ? app.graph.getNodeById?.(link.origin_id) : null;
      if (!originNode) {
        return null;
      }

      const imageWidget = originNode.widgets?.find((widget) => widget.name === "image");
      const imageValue = imageWidget?.value;
      if (!imageValue) {
        return null;
      }

      return {
        nodeId: originNode.id ?? "unknown",
        nodeType: originNode.type || originNode.comfyClass || "",
        imageValue,
      };
    };

    nodeType.prototype.loadConnectedLoadImage = function () {
      const info = this.getConnectedLoadImageInfo();
      if (!info) {
        return false;
      }

      const imageKey = `load-image:${info.nodeId}:${info.imageValue}`;
      this.loadPolygonImageFromUrl(getImageUrl(info.imageValue), imageKey, true);
      return true;
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

    nodeType.prototype.loadPolygonImage = function (force = false) {
      if (this.polygonWidget?.sourceImageUrl) {
        this.loadPolygonImageFromUrl(this.polygonWidget.sourceImageUrl, this.polygonWidget.imageValue, force);
        return;
      }
      if (this.polygonWidget?.sourceImageData) {
        this.loadPolygonImageFromData(this.polygonWidget.sourceImageData, this.polygonWidget.imageValue, force);
        return;
      }
      if (!this.polygonWidget) {
        return;
      }
      if (!this.loadConnectedLoadImage()) {
        this.polygonWidget.image = null;
        this.redrawPolygonCanvas();
      }
    };

    nodeType.prototype.loadPolygonImageFromData = function (encodedImage, imageHash = "", force = false, preservePolygons = false) {
      if (!encodedImage || !this.polygonWidget) {
        return;
      }
      const imageValue = imageHash || `socket-image-${encodedImage.length}`;
      this.loadPolygonImageFromUrl(`data:image/jpeg;base64,${encodedImage}`, imageValue, force, encodedImage, null, preservePolygons);
    };

    nodeType.prototype.loadPolygonImageFromUrl = function (
      imageSrc,
      imageHash = "",
      force = false,
      sourceImageData = null,
      sourceImageUrl = imageSrc,
      preservePolygons = false,
    ) {
      if (!imageSrc || !this.polygonWidget) {
        return;
      }
      const imageValue = imageHash || `socket-image-${imageSrc.length}`;
      const previousImageValue = this.polygonWidget.imageValue || "";
      const changedImage = imageValue !== previousImageValue;
      if (!force && this.polygonWidget.image && !changedImage) {
        return;
      }

      const preserveRestoredPolygon = !previousImageValue && this.polygonWidget.polygons.length > 0;
      if (changedImage && !preserveRestoredPolygon && !preservePolygons) {
        this.polygonWidget.polygons = [];
        this.polygonWidget.selectedIndex = -1;
        this.polygonWidget.cleared = false;
        this.polygonWidget.pendingDefaultOnLoad = true;
        this.polygonWidget.history = [];
        this.polygonWidget.historyIndex = -1;
      } else if (preservePolygons) {
        this.polygonWidget.pendingDefaultOnLoad = false;
      }

      this.polygonWidget.sourceImageData = sourceImageData;
      this.polygonWidget.sourceImageUrl = sourceImageUrl;
      this.polygonWidget.imageValue = imageValue;
      this.properties = this.properties || {};
      this.properties.source_image_hash = imageValue;
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

        requestAnimationFrame(() => this.redrawPolygonCanvas());
        this.updatePolygonButtons();
      };
      image.onerror = () => {
        if (this.polygonWidget.loadToken !== loadToken) {
          return;
        }
        this.polygonWidget.image = null;
        this.redrawPolygonCanvas();
      };
      image.src = imageSrc;
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
      // Guard against getBoundingClientRect() returning 0 or near-zero during
      // initial DOM layout (e.g. cached image loads synchronously during
      // workflow deserialization before the node container is sized).
      // The canvas wrapper has min-height:190px and the node is ≥200px wide,
      // so any display dimension < 100px means layout hasn't settled yet.
      const MIN_DISPLAY = 100;
      const displayW = Math.max(rect.width, MIN_DISPLAY);
      const displayH = Math.max(rect.height, MIN_DISPLAY);
      const scale = Math.max(canvas.width / displayW, canvas.height / displayH);
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

      buttons.loadImage.disabled = Boolean(this.polygonWidget.isLoadingImage);
      buttons.loadImage.textContent = this.polygonWidget.isLoadingImage ? "Loading..." : "Load Image";
      buttons.undo.disabled = this.polygonWidget.historyIndex <= 0;
      buttons.redo.disabled = this.polygonWidget.historyIndex >= this.polygonWidget.history.length - 1;
      buttons.clear.disabled = this.polygonWidget.selectedIndex < 0;
      buttons.reset.disabled = !this.polygonWidget.image || this.polygonWidget.selectedIndex < 0;

      for (const button of [buttons.loadImage, buttons.undo, buttons.redo, buttons.clear, buttons.reset]) {
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
        ctx.fillText("Connect an IMAGE input and click Load Image", canvas.width / 2, canvas.height / 2 - 12);
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



