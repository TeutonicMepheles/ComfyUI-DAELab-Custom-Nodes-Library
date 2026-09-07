import { app } from "/scripts/app.js";
import {
    LIST_EDITOR_ICONS,
    createIconButton,
    stopCanvasPropagation,
} from "./list_editor_controls.mjs?v=20260901-1";
import {
    applyCompactGroupSelection,
    bindCompactGroupSelection,
    compactInputStyle,
    createCompactColorControl,
    createCompactThresholdControl,
} from "./compact_color_group_controls.mjs?v=20260904-color-context-2";
import {
    BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME,
    DEFAULT_COLOR_POLICY,
    DEFAULT_MATERIAL_STRENGTH,
    DEFAULT_REGION_MATERIAL_ID,
    MAX_MATERIAL_STRENGTH,
    MATERIAL_INTRINSIC_COLOR_POLICY,
    MIN_MATERIAL_STRENGTH,
    MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME,
    MAX_MATERIAL_REGION_GROUPS,
    addMaterialRegionAfter,
    advanceMaterialRegionConfig,
    collapseBadgeMaterialRegionV1Inputs,
    encodeMaterialRegionConfig,
    getBadgeMaterialRegionV1PanelHeight,
    getMaterialDropdownPosition,
    getMaterialDropdownTargetIndex,
    materialRegionConfigDigest,
    normalizeMaterialRegionConfig,
    removeSelectedMaterialRegion,
    resolveSelectedMaterialRegionId,
    rerollSelectedMaterialRegion,
    syncMaterialRegionPromptConfigWidget,
    updateMaterialRegion,
    validateMaterialRegionConfigSnapshot,
} from "./badge_material_region_v1_model.mjs?v=20260904-material-menu-v6";
import {
    catalogEntries,
    makeCatalogThumbnailUrl,
} from "./thumbnail_selector.mjs";
import {
    ensureMaterialHoverPreviewStyles,
    hideMaterialHoverPreview,
    showMaterialHoverPreview,
} from "./material_hover_preview.mjs?v=20260904-1";

const NODE_TYPE = "DAELabBadgeMaterialRegionV1";
const CONFIG_PROPERTY = "badge_material_region_v1_config";
const WIDTH_PROPERTY = "badge_material_region_v1_width";
const MAX_GROUPS_PROPERTY = "badge_material_region_v1_max_groups";
const DEFAULT_WIDTH = 410;
const MIN_WIDTH = 360;
const UI_VERSION = "20260904-material-menu-v7";
const APP_HEADING_PROPERTY = "daelab_app_heading";
const DIGEST_PROPERTY = "badge_material_region_v1_config_digest";
const OWNED_WIDGET_PROPERTY = "__daelabBadgeMaterialRegionV1Panel";
const MATERIAL_URL = new URL("./materials.json", import.meta.url);
MATERIAL_URL.searchParams.set("v", UI_VERSION);
const THUMB_BASE_URL = new URL("./material_thumbs/", import.meta.url);
const DEFAULT_MATERIALS = {
    dark_brushed_bronze: { label: "深色拉丝古铜", thumbnail: "dark_brushed_bronze.png" },
    light_speckled_enamel: { label: "浅灰细砂珐琅", thumbnail: "glossy_enamel.png" },
    baked_enamel: { label: "烤漆", thumbnail: "baked_enamel.png" },
    transparent_lacquer: { label: "透明漆", thumbnail: "transparent_lacquer.png" },
    satin_gold: { label: "亚金", thumbnail: "satin_gold.png", intrinsic_color_hex: "#c8a86b" },
    satin_silver: { label: "亚银", thumbnail: "satin_silver.png", intrinsic_color_hex: "#c7cbd0" },
    glitter: { label: "闪粉", thumbnail: "glitter.png" },
    rhinestone: { label: "水钻", thumbnail: "rhinestone.png" },
};

let materialData = DEFAULT_MATERIALS;
let materialLoadPromise = null;
let executionActive = false;

function requestMaterials() {
    materialLoadPromise ??= fetch(MATERIAL_URL)
        .then((response) => response.json())
        .then((data) => {
            materialData = data && Object.keys(data).length ? data : DEFAULT_MATERIALS;
            return materialData;
        })
        .catch((error) => {
            console.warn("[BadgeMaterialRegionV1] Failed to load materials.json", error);
            materialData = DEFAULT_MATERIALS;
            return materialData;
        });
    return materialLoadPromise;
}

function materialEntries() {
    return catalogEntries(materialData);
}

function materialEntry(materialId) {
    const entries = materialEntries();
    return entries.find(({ id }) => id === materialId)
        ?? entries.find(({ id }) => id === DEFAULT_REGION_MATERIAL_ID)
        ?? entries[0];
}

function maximumMaterialGroups(node) {
    const requested = Number(node?.properties?.[MAX_GROUPS_PROPERTY]);
    if (!Number.isFinite(requested)) return MAX_MATERIAL_REGION_GROUPS;
    return Math.max(1, Math.min(MAX_MATERIAL_REGION_GROUPS, Math.round(requested)));
}

function normalizeConfigForNode(node, value) {
    const config = normalizeMaterialRegionConfig(value);
    const maximum = maximumMaterialGroups(node);
    if (config.groups.length > maximum) config.groups = config.groups.slice(0, maximum);
    return config;
}

function ensureMaterialMenuStyles() {
    ensureMaterialHoverPreviewStyles();
    const styleId = "daelab-badge-material-menu-style";
    const existing = document.getElementById(styleId);
    if (existing?.dataset.uiVersion === UI_VERSION) return;
    existing?.remove();
    const style = document.createElement("style");
    style.id = styleId;
    style.dataset.uiVersion = UI_VERSION;
    style.textContent = `
.daelab-badge-material-trigger {
  width: 100%;
  height: 26px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14px;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid #50545b;
  border-radius: 5px;
  color: #e1e5eb;
  background: #292c31;
  cursor: pointer;
  box-sizing: border-box;
  font: 11px sans-serif;
  text-align: left;
}
.daelab-badge-material-trigger:focus-visible {
  border-color: #6aa8ff;
  outline: 1px solid #6aa8ff;
}
.daelab-badge-material-trigger span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.daelab-badge-material-trigger span:last-child {
  color: #b7c7da;
  text-align: center;
}
.daelab-badge-material-menu {
  position: fixed;
  z-index: 2147482000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: min(288px, calc(100vh - 16px));
  padding: 4px;
  overflow-y: auto;
  border: 1px solid #5a6472;
  border-radius: 7px;
  color: #e7ebf0;
  background: rgba(38, 42, 48, .99);
  box-shadow: 0 10px 28px rgba(0,0,0,.48);
  box-sizing: border-box;
}
.daelab-badge-material-option {
  flex: 0 0 32px;
  width: 100%;
  min-height: 32px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: 12px sans-serif;
  text-align: left;
}
.daelab-badge-material-option:hover,
.daelab-badge-material-option:focus-visible {
  border-color: #6aa8ff;
  background: #30445f;
  outline: none;
}
.daelab-badge-material-option[aria-selected="true"] {
  color: #fff;
  background: #3d6a9c;
}
`;
    document.head.appendChild(style);
}

function hideMaterialDropdown(node, { restoreFocus = false } = {}) {
    const state = node?._badgeMaterialRegionV1Dropdown;
    hideMaterialHoverPreview(node);
    if (!state) return;
    document.removeEventListener?.("pointerdown", state.onDocumentPointerDown, true);
    document.removeEventListener?.("scroll", state.onDocumentScroll, true);
    globalThis.removeEventListener?.("resize", state.dismiss);
    globalThis.removeEventListener?.("blur", state.dismiss);
    state.trigger?.setAttribute?.("aria-expanded", "false");
    state.popup?.remove?.();
    node._badgeMaterialRegionV1Dropdown = null;
    if (restoreFocus && state.trigger?.isConnected) state.trigger.focus?.();
}

function selectMaterialForGroup(node, groupId, materialId) {
    const selectedEntry = materialEntry(materialId);
    const config = updateMaterialRegion(getConfig(node), groupId, {
        material_id: selectedEntry?.id || materialId,
        ...(!selectedEntry?.intrinsic_color_hex ? { color_policy: DEFAULT_COLOR_POLICY } : {}),
    });
    hideMaterialDropdown(node);
    commitConfig(node, config, { selectedId: groupId, render: true });
}

function showMaterialDropdown(node, group, trigger, focusIndex = null) {
    if (!trigger?.isConnected || Number(node?.mode ?? 0) !== 0) return false;
    hideMaterialDropdown(node);
    ensureMaterialMenuStyles();
    const entries = materialEntries();
    if (!entries.length) return false;

    const popup = document.createElement("div");
    popup.className = "daelab-badge-material-menu";
    popup.id = `daelab-badge-material-menu-${node.id}-${group.id}`;
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", "区域材质选项（悬浮可预览）");
    const buttons = entries.map((entry, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "daelab-badge-material-option";
        option.dataset.materialId = entry.id;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(entry.id === group.material_id));
        option.textContent = entry.label || entry.id;
        option.addEventListener("mouseenter", () => showMaterialHoverPreview({
            owner: node,
            entry,
            anchorElement: option,
            imageUrl: makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION),
            active: Number(node?.mode ?? 0) === 0,
        }));
        option.addEventListener("mouseleave", () => hideMaterialHoverPreview(node));
        option.addEventListener("focus", () => showMaterialHoverPreview({
            owner: node,
            entry,
            anchorElement: option,
            imageUrl: makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION),
            active: Number(node?.mode ?? 0) === 0,
        }));
        option.addEventListener("blur", () => hideMaterialHoverPreview(node));
        option.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectMaterialForGroup(node, group.id, entry.id);
        });
        option.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                hideMaterialDropdown(node, { restoreFocus: true });
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                selectMaterialForGroup(node, group.id, entry.id);
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            buttons[getMaterialDropdownTargetIndex(index, event.key, buttons.length)]?.focus?.();
        });
        popup.appendChild(option);
        return option;
    });
    for (const eventName of ["pointerdown", "pointerup", "click", "wheel", "keydown"]) {
        popup.addEventListener(eventName, stopCanvasPropagation);
    }
    document.body.appendChild(popup);
    const anchor = trigger.getBoundingClientRect();
    const width = Math.max(220, anchor.width || 0);
    popup.style.width = `${Math.round(width)}px`;
    const position = getMaterialDropdownPosition({
        anchor,
        viewportWidth: globalThis.innerWidth || document.documentElement.clientWidth,
        viewportHeight: globalThis.innerHeight || document.documentElement.clientHeight,
        menuWidth: width,
        menuHeight: popup.offsetHeight,
    });
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", popup.id);

    const dismiss = () => hideMaterialDropdown(node);
    const onDocumentPointerDown = (event) => {
        if (popup.contains(event.target) || trigger.contains(event.target)) return;
        dismiss();
    };
    const onDocumentScroll = (event) => {
        if (popup.contains(event.target)) return;
        dismiss();
    };
    node._badgeMaterialRegionV1Dropdown = {
        popup,
        trigger,
        dismiss,
        onDocumentPointerDown,
        onDocumentScroll,
    };
    document.addEventListener?.("pointerdown", onDocumentPointerDown, true);
    document.addEventListener?.("scroll", onDocumentScroll, true);
    globalThis.addEventListener?.("resize", dismiss);
    globalThis.addEventListener?.("blur", dismiss);
    const selectedIndex = Math.max(0, entries.findIndex(({ id }) => id === group.material_id));
    const targetIndex = focusIndex == null
        ? selectedIndex
        : Math.max(0, Math.min(buttons.length - 1, focusIndex));
    requestAnimationFrame(() => buttons[targetIndex]?.focus?.());
    return true;
}

function updateSyncStatus(node) {
    const element = node._badgeMaterialRegionV1Panel?.element?.querySelector?.("[data-role='config-status']");
    if (!element) return;
    const invalid = invalidHexValues(node);
    if (invalid.length || node._badgeMaterialRegionV1LastError) {
        element.textContent = invalid.length ? "颜色格式错误｜禁止排队" : "配置不同步｜禁止排队";
        element.title = node._badgeMaterialRegionV1LastError || invalid.join(", ");
        element.style.color = "#ff8585";
        return;
    }
    const config = getConfig(node);
    const digest = materialRegionConfigDigest(config).slice(0, 8);
    element.textContent = `r${config.revision} · ${digest}`;
    element.title = `后端配置 revision ${config.revision}，SHA-256 ${materialRegionConfigDigest(config)}`;
    element.style.color = "#85c99a";
}

function chainCallback(object, property, callback) {
    const original = object[property];
    object[property] = function () {
        const result = original?.apply(this, arguments);
        callback?.apply(this, arguments);
        return result;
    };
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

function getConfig(node) {
    if (node._badgeMaterialRegionV1Draft) {
        return normalizeConfigForNode(node, node._badgeMaterialRegionV1Draft);
    }
    node.properties ||= {};
    const promptWidget = getPromptConfigWidget(node);
    const source = node.properties[CONFIG_PROPERTY] || promptWidget?.value;
    const config = normalizeConfigForNode(node, source);
    node._badgeMaterialRegionV1Draft = config;
    return config;
}

function getPromptConfigWidget(node) {
    return node.widgets?.find?.(
        ({ name }) => name === MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME,
    ) ?? null;
}

function showConfigError(node, message) {
    node._badgeMaterialRegionV1LastError = String(message || "材质配置同步失败");
    const detail = node._badgeMaterialRegionV1LastError;
    try {
        app.extensionManager?.toast?.add?.({
            severity: "error",
            summary: "Badge Material Region V1",
            detail,
            life: 6000,
        });
    } catch {
        console.error("[BadgeMaterialRegionV1]", detail);
    }
    updateSyncStatus(node);
}

function invalidHexValues(node) {
    return [...(node._badgeMaterialRegionV1InvalidHex?.values?.() || [])];
}

function verifyConfigSnapshot(node, queueValue) {
    const promptWidget = getPromptConfigWidget(node);
    return validateMaterialRegionConfigSnapshot({
        draft: getConfig(node),
        propertyValue: node.properties?.[CONFIG_PROPERTY],
        widgetValue: promptWidget?.value,
        queueValue,
        invalidHex: invalidHexValues(node),
    });
}

function flushMaterialRegionConfig(node, { notify = true, throwOnError = false } = {}) {
    const invalid = invalidHexValues(node);
    if (invalid.length) {
        const message = `无效颜色输入：${invalid.join(", ")}。请输入完整 #RRGGBB，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    const config = normalizeMaterialRegionConfig(getConfig(node));
    const encoded = encodeMaterialRegionConfig(config);
    node._badgeMaterialRegionV1Draft = config;
    node.properties ||= {};
    const previous = node.properties[CONFIG_PROPERTY];
    node.properties[CONFIG_PROPERTY] = encoded;
    node.properties[DIGEST_PROPERTY] = materialRegionConfigDigest(config);
    const promptWidget = getPromptConfigWidget(node);
    if (!promptWidget) {
        const message = `缺少隐藏输入 ${MATERIAL_REGION_PROMPT_CONFIG_WIDGET_NAME}，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    syncMaterialRegionPromptConfigWidget(node, promptWidget, encoded, {
        notify: notify && previous !== encoded,
    });
    const snapshot = verifyConfigSnapshot(node, encoded);
    if (!snapshot.ok) {
        const message = `配置不一致：${snapshot.mismatches.join(", ")}，排队已阻止。`;
        showConfigError(node, message);
        if (throwOnError) throw new Error(message);
        return null;
    }
    node._badgeMaterialRegionV1LastError = "";
    updateSyncStatus(node);
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    return snapshot;
}

function scheduleConfigFlush(node) {
    if (node._badgeMaterialRegionV1ConfigFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeMaterialRegionV1ConfigFrame = schedule(() => {
        node._badgeMaterialRegionV1ConfigFrame = null;
        flushMaterialRegionConfig(node);
    });
}

function stageMaterialRegionConfig(node, value, { flush = false } = {}) {
    const current = getConfig(node);
    const candidate = normalizeConfigForNode(node, value);
    candidate.revision = current.revision;
    const currentEncoded = encodeMaterialRegionConfig(current);
    const candidateEncoded = encodeMaterialRegionConfig(candidate);
    node._badgeMaterialRegionV1Draft = candidateEncoded === currentEncoded
        ? current
        : advanceMaterialRegionConfig(candidate);
    if (flush) flushMaterialRegionConfig(node, { throwOnError: true });
    else scheduleConfigFlush(node);
    return node._badgeMaterialRegionV1Draft;
}

function configurePromptConfigWidget(node) {
    const widget = getPromptConfigWidget(node);
    if (!widget) return null;
    widget.options ||= {};
    widget.options.advanced = true;
    widget.options.serialize = true;
    widget.serialize = true;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    if (!widget._badgeMaterialRegionV1StrictQueueSyncBound) {
        const originalBeforeQueued = widget.beforeQueued;
        widget.beforeQueued = function () {
            originalBeforeQueued?.apply(this, arguments);
            flushMaterialRegionConfig(node, { throwOnError: true });
        };
        widget.serializeValue = function () {
            const snapshot = flushMaterialRegionConfig(node, { throwOnError: true });
            return snapshot.encoded;
        };
        widget._badgeMaterialRegionV1StrictQueueSyncBound = true;
    }
    flushMaterialRegionConfig(node, { notify: false });
    return widget;
}

function normalizeAppModeInputs(node) {
    const graph = app.rootGraph;
    const data = graph?.extra?.linearData;
    if (!Array.isArray(data?.inputs) || graph.getNodeById?.(node.id) !== node) return false;
    const result = collapseBadgeMaterialRegionV1Inputs(data.inputs, node.id);
    if (!result.changed) return false;
    graph.extra.linearData = { ...data, inputs: result.inputs };
    return true;
}

function applyNodeSize(node, size) {
    if (typeof node.setSize === "function") node.setSize(size);
    else node.size = size;
}

function fitNodeToMinimum(node) {
    if (!node?._badgeMaterialRegionV1Panel?.widget) return;
    const savedWidth = Number(node.properties?.[WIDTH_PROPERTY]);
    const currentWidth = Number(node.size?.[0]);
    const width = Number.isFinite(savedWidth) && savedWidth >= MIN_WIDTH
        ? savedWidth
        : Math.max(DEFAULT_WIDTH, Number.isFinite(currentWidth) ? currentWidth : 0);
    const fallbackHeight = getBadgeMaterialRegionV1PanelHeight(getConfig(node).groups.length) + 100;

    node._badgeMaterialRegionV1AutoSizing = true;
    try {
        applyNodeSize(node, [width, 1]);
        node.arrange?.();
        const measured = Number(node.computeSize?.()?.[1]);
        applyNodeSize(node, [
            width,
            Number.isFinite(measured) && measured > 1 ? measured : fallbackHeight,
        ]);
    } finally {
        node._badgeMaterialRegionV1AutoSizing = false;
    }
}

function scheduleFit(node) {
    if (node._badgeMaterialRegionV1FitFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeMaterialRegionV1FitFrame = schedule(() => {
        node._badgeMaterialRegionV1FitFrame = null;
        fitNodeToMinimum(node);
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    });
}

function commitConfig(node, config, { selectedId = null, render = false, fit = false } = {}) {
    graphTransaction(node, () => {
        const stored = stageMaterialRegionConfig(node, config, { flush: true }) || getConfig(node);
        node._badgeMaterialRegionV1SelectedId = resolveSelectedMaterialRegionId(
            stored,
            selectedId ?? node._badgeMaterialRegionV1SelectedId,
        );
        if (render) renderPanel(node);
        if (fit) scheduleFit(node);
    });
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
}

function setSelectedGroup(node, groupId) {
    if (!flushMaterialRegionConfig(node)) return false;
    const config = getConfig(node);
    node._badgeMaterialRegionV1SelectedId = resolveSelectedMaterialRegionId(config, groupId);
    applyCompactGroupSelection(
        node._badgeMaterialRegionV1Panel?.element,
        node._badgeMaterialRegionV1SelectedId,
    );
    return true;
}

function createColorControl(node, group) {
    return createCompactColorControl({
        color: group.color,
        label: "平面图源区域颜色",
        onDraft: (value) => {
            const config = updateMaterialRegion(getConfig(node), group.id, { color: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            if (!updated) return null;
            node._badgeMaterialRegionV1InvalidHex?.delete?.(group.id);
            stageMaterialRegionConfig(node, config);
            updateSyncStatus(node);
            return updated.color;
        },
        onCommit: (value) => {
            const config = updateMaterialRegion(getConfig(node), group.id, { color: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            if (!updated) return null;
            node._badgeMaterialRegionV1InvalidHex?.delete?.(group.id);
            stageMaterialRegionConfig(node, config, { flush: true });
            return updated.color;
        },
        onInvalid: (value) => {
            node._badgeMaterialRegionV1InvalidHex ||= new Map();
            if (value) node._badgeMaterialRegionV1InvalidHex.set(group.id, value);
            else node._badgeMaterialRegionV1InvalidHex.delete(group.id);
            updateSyncStatus(node);
        },
        onFlush: (valid) => {
            if (valid) flushMaterialRegionConfig(node);
        },
        getCurrentColor: () => getConfig(node).groups.find(({ id }) => id === group.id)?.color,
    });
}

function createThresholdControl(node, group) {
    return createCompactThresholdControl({
        threshold: group.threshold,
        onCommit: (value) => {
            const config = updateMaterialRegion(getConfig(node), group.id, { threshold: value });
            const updated = config.groups.find(({ id }) => id === group.id);
            commitConfig(node, config, { selectedId: group.id });
            return updated?.threshold;
        },
    });
}

function createMaterialControl(node, group) {
    const label = document.createElement("span");
    label.textContent = "材质";
    label.style.cssText = "font:11px sans-serif;color:#aeb4bc;white-space:nowrap";

    const entry = materialEntry(group.material_id);
    const preview = document.createElement("img");
    preview.alt = `${entry?.label || group.material_id} 材质样片`;
    preview.src = entry ? makeCatalogThumbnailUrl(entry, THUMB_BASE_URL, UI_VERSION) : "";
    preview.style.cssText = "width:26px;height:26px;display:block;object-fit:cover;border:1px solid #4b4f56;border-radius:5px;background:#2d3137;box-sizing:border-box";

    ensureMaterialMenuStyles();
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "daelab-badge-material-trigger";
    trigger.setAttribute("aria-label", "区域材质；打开后悬浮选项可查看大图");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.title = "材质只改变命中区域的表面物理特性；打开后悬浮或聚焦选项可查看材质大图。";
    const name = document.createElement("span");
    name.textContent = entry?.label || group.material_id;
    const arrow = document.createElement("span");
    arrow.textContent = "⌄";
    arrow.setAttribute("aria-hidden", "true");
    trigger.append(name, arrow);
    trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = node._badgeMaterialRegionV1Dropdown;
        if (current?.trigger === trigger) hideMaterialDropdown(node);
        else showMaterialDropdown(node, group, trigger);
    });
    trigger.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (node._badgeMaterialRegionV1Dropdown?.trigger === trigger) return;
        const entries = materialEntries();
        const selectedIndex = Math.max(0, entries.findIndex(({ id }) => id === group.material_id));
        const focusIndex = ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ? getMaterialDropdownTargetIndex(selectedIndex, event.key, entries.length)
            : selectedIndex;
        showMaterialDropdown(node, group, trigger, focusIndex);
    });
    return { label, preview, trigger };
}

function createColorPolicyControl(node, group) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "区域色彩策略");
    select.title = "默认保留平面图原色；只有目录声明固有色的材质可启用固有色。";
    select.style.cssText = compactInputStyle("width:100%;padding:2px 5px;cursor:pointer");
    const preserve = document.createElement("option");
    preserve.value = DEFAULT_COLOR_POLICY;
    preserve.textContent = "保留原色";
    const intrinsic = document.createElement("option");
    intrinsic.value = MATERIAL_INTRINSIC_COLOR_POLICY;
    intrinsic.textContent = "材质固有色";
    intrinsic.disabled = !materialEntry(group.material_id)?.intrinsic_color_hex;
    select.append(preserve, intrinsic);
    select.value = intrinsic.disabled ? DEFAULT_COLOR_POLICY : group.color_policy;
    select.addEventListener("change", () => {
        const config = updateMaterialRegion(getConfig(node), group.id, {
            color_policy: select.value,
        });
        commitConfig(node, config, { selectedId: group.id });
    });
    return select;
}

function createMaterialStrengthControl(node, group) {
    const label = document.createElement("span");
    label.textContent = "强度";
    label.style.cssText = "font:11px sans-serif;color:#aeb4bc;white-space:nowrap";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(Math.round(MIN_MATERIAL_STRENGTH * 100));
    slider.max = String(Math.round(MAX_MATERIAL_STRENGTH * 100));
    slider.step = "5";
    slider.value = String(Math.round((group.material_strength ?? DEFAULT_MATERIAL_STRENGTH) * 100));
    slider.setAttribute("aria-label", "区域材质强度");
    slider.title = "100% 为该材质的推荐强度；调整只影响选中区域，并会同步进入后端配置。";
    slider.style.cssText = "width:100%;min-width:0;accent-color:#62a7d7;cursor:pointer";

    const value = document.createElement("span");
    value.style.cssText = "font:10px monospace;color:#c5c9cf;text-align:right;white-space:nowrap";
    const updateValue = () => {
        value.textContent = `${Math.round(Number(slider.value))}%`;
    };
    const stage = ({ flush = false } = {}) => {
        const config = updateMaterialRegion(getConfig(node), group.id, {
            material_strength: Number(slider.value) / 100,
        });
        if (flush) commitConfig(node, config, { selectedId: group.id });
        else {
            stageMaterialRegionConfig(node, config);
            updateSyncStatus(node);
        }
    };
    slider.addEventListener("input", () => {
        updateValue();
        stage();
    });
    slider.addEventListener("change", () => stage({ flush: true }));
    slider.addEventListener("blur", () => stage({ flush: true }));
    updateValue();
    return { label, slider, value };
}

function createGroupCard(node, group, index) {
    const card = document.createElement("div");
    card.dataset.materialRegionId = group.id;
    card.dataset.colorGroupId = group.id;
    card.setAttribute("role", "option");
    card.tabIndex = 0;
    card.style.cssText = [
        "height:90px",
        "min-height:90px",
        "max-height:90px",
        "display:grid",
        "grid-template-rows:26px 26px 22px",
        "gap:3px",
        "box-sizing:border-box",
        "padding:3px 6px",
        "border:1px solid #3f4248",
        "border-radius:6px",
        "background:#23262a",
        "cursor:default",
        "transition:border-color 80ms linear,background 80ms linear",
    ].join(";");

    const firstRow = document.createElement("div");
    firstRow.style.cssText = "min-width:0;display:grid;grid-template-columns:52px minmax(110px,1fr) 96px;align-items:center;gap:6px";
    const groupLabel = document.createElement("span");
    groupLabel.textContent = `区域 ${index + 1}`;
    groupLabel.title = "此颜色仅用于定位徽章平面图中的源色块";
    groupLabel.style.cssText = "font:11px sans-serif;color:#c5c9cf;white-space:nowrap";
    firstRow.append(groupLabel, createColorControl(node, group), createThresholdControl(node, group));

    const secondRow = document.createElement("div");
    secondRow.style.cssText = "min-width:0;display:grid;grid-template-columns:52px 26px minmax(0,1fr) 94px;align-items:center;gap:6px";
    const materialControl = createMaterialControl(node, group);
    secondRow.append(
        materialControl.label,
        materialControl.preview,
        materialControl.trigger,
        createColorPolicyControl(node, group),
    );
    const thirdRow = document.createElement("div");
    thirdRow.style.cssText = "min-width:0;display:grid;grid-template-columns:52px minmax(0,1fr) 42px;align-items:center;gap:6px";
    const strengthControl = createMaterialStrengthControl(node, group);
    thirdRow.append(strengthControl.label, strengthControl.slider, strengthControl.value);
    card.append(firstRow, secondRow, thirdRow);
    bindCompactGroupSelection(card, () => setSelectedGroup(node, group.id));
    return card;
}

async function rerollSelectedRegion(node) {
    if (executionActive) return;
    const initialSnapshot = flushMaterialRegionConfig(node);
    if (!initialSnapshot) return;
    const config = getConfig(node);
    const selectedId = resolveSelectedMaterialRegionId(
        config,
        node._badgeMaterialRegionV1SelectedId,
    );
    const group = config.groups.find(({ id }) => id === selectedId);
    if (!group || group.material_id === DEFAULT_REGION_MATERIAL_ID) return;
    const entry = materialEntry(group.material_id);
    const message = `区域 ${config.groups.indexOf(group) + 1}｜${entry?.label || group.material_id}\n预计调用 GPT-Image-2：1 次`;
    let confirmed = false;
    try {
        confirmed = Boolean(await app.extensionManager?.dialog?.confirm?.({
            title: "重抽选中材质区域",
            message,
        }));
    } catch {
        confirmed = globalThis.confirm?.(message) ?? false;
    }
    if (!confirmed || !flushMaterialRegionConfig(node)) return;
    node._badgeMaterialRegionV1Draft = rerollSelectedMaterialRegion(getConfig(node), selectedId);
    flushMaterialRegionConfig(node, { throwOnError: true });
    renderPanel(node);
    await app.queuePrompt?.(0, 1);
}

function createToolbar(node, config, selectedId) {
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "height:34px;min-height:34px;display:flex;align-items:center;gap:6px;padding:4px 6px;box-sizing:border-box;background:#202226";
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.addRoot,
        "在选中区域后新增",
        () => {
            const result = addMaterialRegionAfter(
                getConfig(node),
                node._badgeMaterialRegionV1SelectedId,
                undefined,
                maximumMaterialGroups(node),
            );
            commitConfig(node, result.config, {
                selectedId: result.selectedId,
                render: true,
                fit: true,
            });
        },
        config.groups.length >= maximumMaterialGroups(node),
    ));
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.remove,
        "删除选中区域",
        () => {
            const result = removeSelectedMaterialRegion(
                getConfig(node),
                node._badgeMaterialRegionV1SelectedId,
            );
            commitConfig(node, result.config, {
                selectedId: result.selectedId,
                render: true,
                fit: true,
            });
        },
        config.groups.length <= 1 || !selectedId,
    ));
    const selectedGroup = config.groups.find(({ id }) => id === selectedId);
    toolbar.appendChild(createIconButton(
        LIST_EDITOR_ICONS.edit,
        "重抽选中区域（预计 1 次 GPT-Image-2 调用）",
        () => rerollSelectedRegion(node),
        executionActive
            || !selectedGroup
            || selectedGroup.material_id === DEFAULT_REGION_MATERIAL_ID,
    ));
    const syncStatus = document.createElement("span");
    syncStatus.dataset.role = "config-status";
    syncStatus.style.cssText = "font:10px monospace;color:#85c99a;white-space:nowrap";
    toolbar.appendChild(syncStatus);
    const defaultEntry = materialEntry(config.default_material_id);
    const status = document.createElement("span");
    status.textContent = `未配置：${defaultEntry?.label || "透明漆"}`;
    status.title = "未被任何源颜色规则命中的徽章前景区域统一使用透明清漆";
    status.style.cssText = "font:10px sans-serif;color:#aeb4bc;margin-left:auto;white-space:nowrap";
    const count = document.createElement("span");
    count.textContent = `${config.groups.length}/${maximumMaterialGroups(node)}`;
    count.style.cssText = "font:10px sans-serif;color:#8e949c";
    toolbar.append(status, count);
    queueMicrotask(() => updateSyncStatus(node));
    return toolbar;
}

function renderPanel(node) {
    const panel = node._badgeMaterialRegionV1Panel;
    if (!panel?.element) return;
    hideMaterialDropdown(node);
    const config = getConfig(node);
    const selectedId = resolveSelectedMaterialRegionId(
        config,
        node._badgeMaterialRegionV1SelectedId,
    );
    node._badgeMaterialRegionV1SelectedId = selectedId;
    const panelHeight = getBadgeMaterialRegionV1PanelHeight(config.groups.length);
    panel.element.style.height = `${panelHeight}px`;
    panel.element.style.minHeight = `${panelHeight}px`;
    panel.element.style.maxHeight = `${panelHeight}px`;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createToolbar(node, config, selectedId));
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "徽章源颜色与材质区域映射");
    list.style.cssText = "min-height:0;display:flex;flex-direction:column;gap:2px;padding:4px 6px;box-sizing:border-box";
    config.groups.forEach((group, index) => list.appendChild(createGroupCard(node, group, index)));
    fragment.appendChild(list);
    panel.element.replaceChildren(fragment);

    panel.widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    panel.widget.computeLayoutSize = () => ({
        minHeight: panelHeight,
        maxHeight: panelHeight,
        minWidth: MIN_WIDTH,
    });
    panel.widget.options ||= {};
    panel.widget.options.getMinHeight = () => panelHeight;
    panel.widget.options.getHeight = () => panelHeight;
    setSelectedGroup(node, selectedId);
    normalizeAppModeInputs(node);
}

function createPanelElement() {
    const element = document.createElement("div");
    element.className = "daelab-badge-material-region-v1-panel";
    element.style.cssText = "width:100%;overflow:hidden;box-sizing:border-box;border:1px solid #36393f;border-radius:6px;background:#202226";
    for (const eventName of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
        "dblclick",
        "contextmenu",
        "wheel",
        "keydown",
    ]) {
        element.addEventListener(eventName, stopCanvasPropagation);
    }
    return element;
}

function removeOwnedPanel(node) {
    hideMaterialDropdown(node);
    const widgets = Array.isArray(node.widgets) ? [...node.widgets] : [];
    for (const widget of widgets) {
        if (!widget?.[OWNED_WIDGET_PROPERTY]) continue;
        try {
            node.removeWidget?.(widget);
        } catch {
            widget.onRemove?.();
            const index = node.widgets?.indexOf(widget) ?? -1;
            if (index >= 0) node.widgets.splice(index, 1);
        }
    }
    node._badgeMaterialRegionV1Panel?.element?.remove?.();
    node._badgeMaterialRegionV1Panel = null;
}

function installPanel(node) {
    if (
        node._badgeMaterialRegionV1InstalledVersion === UI_VERSION
        && node._badgeMaterialRegionV1Panel?.widget
    ) {
        node._badgeMaterialRegionV1Panel.widget.label = String(
            node.properties?.[APP_HEADING_PROPERTY] || "特殊材质区域（按平面图取色）"
        );
        configurePromptConfigWidget(node);
        renderPanel(node);
        scheduleFit(node);
        return;
    }
    if (typeof node.addDOMWidget !== "function") return;

    configurePromptConfigWidget(node);
    removeOwnedPanel(node);
    const element = createPanelElement();
    const config = getConfig(node);
    const panelHeight = getBadgeMaterialRegionV1PanelHeight(config.groups.length);
    const widget = node.addDOMWidget(
        BADGE_MATERIAL_REGION_V1_PANEL_WIDGET_NAME,
        "custom",
        element,
        {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => panelHeight,
            getHeight: () => panelHeight,
            getValue: () => (
                node.properties?.[CONFIG_PROPERTY]
                || encodeMaterialRegionConfig(getConfig(node))
            ),
            setValue: (value) => {
                node._badgeMaterialRegionV1Draft = normalizeConfigForNode(node, value);
                flushMaterialRegionConfig(node);
                renderPanel(node);
                scheduleFit(node);
            },
        },
    );
    widget.serialize = false;
    widget.label = String(
        node.properties?.[APP_HEADING_PROPERTY] || "特殊材质区域（按平面图取色）"
    );
    widget.inputEl = element;
    widget[OWNED_WIDGET_PROPERTY] = true;
    widget.computeSize = (width) => [width || DEFAULT_WIDTH, panelHeight];
    widget.computeLayoutSize = () => ({
        minHeight: panelHeight,
        maxHeight: panelHeight,
        minWidth: MIN_WIDTH,
    });
    const originalOnRemove = widget.onRemove?.bind(widget);
    widget.onRemove = () => {
        hideMaterialDropdown(node);
        originalOnRemove?.();
        element.remove();
    };

    node._badgeMaterialRegionV1Panel = { element, widget };
    node._badgeMaterialRegionV1InstalledVersion = UI_VERSION;
    renderPanel(node);
    scheduleFit(node);
    requestMaterials().then(() => {
        if (!node._badgeMaterialRegionV1Panel?.widget) return;
        renderPanel(node);
        scheduleFit(node);
    });
}

function scheduleInstall(node) {
    if (node._badgeMaterialRegionV1InstallFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    node._badgeMaterialRegionV1InstallFrame = schedule(() => {
        node._badgeMaterialRegionV1InstallFrame = null;
        installPanel(node);
        app.rootGraph?.events?.dispatchEvent?.(new Event("configured"));
    });
}

if (globalThis.__DAELAB_BADGE_MATERIAL_REGION_V1_VERSION !== UI_VERSION) {
    globalThis.__DAELAB_BADGE_MATERIAL_REGION_V1_VERSION = UI_VERSION;
    app.registerExtension({
        name: "DAELab.BadgeMaterialRegionV1",
        setup() {
            const previousAppModeHandler = globalThis.__daelabBadgeMaterialRegionV1AppModeHandler;
            if (previousAppModeHandler) {
                globalThis.removeEventListener?.("daelab:app-mode-synced", previousAppModeHandler);
            }
            const appModeHandler = () => {
                const graph = app.rootGraph || app.graph;
                for (const node of graph?.nodes || graph?._nodes || []) {
                    if (
                        (node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE)
                        && Number(node.mode ?? 0) !== 0
                    ) {
                        hideMaterialDropdown(node);
                    }
                }
            };
            globalThis.__daelabBadgeMaterialRegionV1AppModeHandler = appModeHandler;
            globalThis.addEventListener?.("daelab:app-mode-synced", appModeHandler);
            const setExecutionState = (active) => {
                executionActive = active;
                for (const node of app.rootGraph?._nodes || []) {
                    if (node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE) renderPanel(node);
                }
            };
            app.api?.addEventListener?.("execution_start", () => setExecutionState(true));
            app.api?.addEventListener?.("execution_success", () => setExecutionState(false));
            app.api?.addEventListener?.("execution_error", () => setExecutionState(false));
        },
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== NODE_TYPE) return;
            chainCallback(nodeType.prototype, "onNodeCreated", function () {
                this.properties ||= {};
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onConfigure", function () {
                this._badgeMaterialRegionV1Draft = null;
                this._badgeMaterialRegionV1InvalidHex = new Map();
                this._badgeMaterialRegionV1ConfigError = "";
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onAdded", function () {
                scheduleInstall(this);
            });
            chainCallback(nodeType.prototype, "onSerialize", function (serialized) {
                configurePromptConfigWidget(this);
                const snapshot = flushMaterialRegionConfig(this, { throwOnError: true });
                serialized.properties ||= {};
                serialized.properties[CONFIG_PROPERTY] = snapshot.encoded;
                serialized.properties[DIGEST_PROPERTY] = snapshot.digest;
            });
            chainCallback(nodeType.prototype, "onResize", function (size) {
                const width = Number(size?.[0]);
                if (
                    !this._badgeMaterialRegionV1AutoSizing
                    && Number.isFinite(width)
                    && width >= MIN_WIDTH
                ) {
                    this.properties ||= {};
                    this.properties[WIDTH_PROPERTY] = width;
                }
            });
            chainCallback(nodeType.prototype, "onRemoved", function () {
                const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
                if (this._badgeMaterialRegionV1InstallFrame != null) {
                    cancel(this._badgeMaterialRegionV1InstallFrame);
                }
                if (this._badgeMaterialRegionV1FitFrame != null) {
                    cancel(this._badgeMaterialRegionV1FitFrame);
                }
                if (this._badgeMaterialRegionV1ConfigFrame != null) {
                    cancel(this._badgeMaterialRegionV1ConfigFrame);
                }
                this._badgeMaterialRegionV1InstallFrame = null;
                this._badgeMaterialRegionV1FitFrame = null;
                this._badgeMaterialRegionV1ConfigFrame = null;
                hideMaterialDropdown(this);
                removeOwnedPanel(this);
            });
        },
    });
}
