import { app } from "/scripts/app.js";
import {
    appendShot,
    durationFromTimeRange,
    moveShot,
    normalizeStoryboard,
    removeShot,
    replaceImportedShots,
    serializeStoryboard,
    storyboardPanelLayout,
    STORYBOARD_MIN_WIDTH,
    STORYBOARD_PANEL_HEIGHT,
} from "./daelab_storyboard_model.mjs?v=20260902-3";
import {
    createIconButton,
    LIST_EDITOR_ICONS,
    stopCanvasPropagation,
} from "./list_editor_controls.mjs";
import {
    findLiveOwnedWidget,
    removeOwnedWidgets,
} from "./dynamic_widget_lifecycle.mjs";

const NODE_TYPE = "DAELAB.ComfyTV.GPTImageStoryboardStage";
const EXTENSION_VERSION = "20260902-4";
const PANEL_WIDGET_NAME = "daelab_storyboard_editor";
const OWNER_PROPERTY = "__daelabStoryboardOwned";
const PANEL_HEIGHT = STORYBOARD_PANEL_HEIGHT;
const MIN_WIDTH = STORYBOARD_MIN_WIDTH;
const DEFAULT_WIDTH = 1080;
const DOCUMENT_ACCEPT = ".docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.pdf";

function widget(node, name) {
    return node.widgets?.find((candidate) => candidate.name === name) || null;
}

function isStoryboardPayload(value) {
    if (typeof value !== "string" || !value.trim().startsWith("{")) return false;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed?.shots);
    } catch {
        return false;
    }
}

function recoverShiftedWorkflowValues(node) {
    const mainPrompt = widget(node, "main_prompt");
    const storyboard = widget(node, "storyboard_data");
    if (!mainPrompt || !storyboard || !isStoryboardPayload(mainPrompt.value) || isStoryboardPayload(storyboard.value)) {
        return;
    }

    // ComfyUI serializes a seed control value immediately after `seed`. Early
    // DAELab workflow exports omitted that `fixed` entry, shifting the four
    // values below by one position. Repair those exports in memory before the
    // native widgets are hidden so copied workflows remain recoverable.
    const seedControl = widget(node, "control_after_generate");
    const selectedIndex = widget(node, "selected_index");
    const customParams = widget(node, "custom_params");
    const recoveredStyle = typeof seedControl?.value === "string" ? seedControl.value : "";
    const shiftedSelectedIndex = Number(storyboard.value);
    const shiftedCustomParams = selectedIndex?.value;

    storyboard.value = mainPrompt.value;
    mainPrompt.value = ["fixed", "increment", "decrement", "randomize"].includes(recoveredStyle)
        ? ""
        : recoveredStyle;
    if (Number.isFinite(shiftedSelectedIndex) && shiftedSelectedIndex >= 1 && selectedIndex) {
        selectedIndex.value = shiftedSelectedIndex;
    }
    if (customParams && typeof shiftedCustomParams === "string" && shiftedCustomParams.trim().startsWith("{")) {
        customParams.value = shiftedCustomParams;
    }
    if (seedControl) seedControl.value = "fixed";
}

function setWidgetValue(node, name, value, event = null) {
    const target = widget(node, name);
    if (!target || target.value === value) return;
    target.value = value;
    target.callback?.(value, app.canvas, node, null, event);
    (node.graph || app.graph)?.setDirtyCanvas?.(true, true);
}

function hideNativeWidget(node, name) {
    const target = widget(node, name);
    if (!target || target.__daelabStoryboardHidden) return;
    target.hidden = true;
    target.options = { ...(target.options || {}), hidden: true, canvasOnly: true };
    target.computeSize = () => [0, -4];
    target.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    target.draw = () => {};
    for (const element of [target.element, target.inputEl]) {
        if (element?.style) {
            element.style.display = "none";
            element.style.visibility = "hidden";
        }
    }
    target.__daelabStoryboardHidden = true;
}

function showToast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 6000 });
}

function makeButton(label, onClick, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
        "height:30px",
        "padding:0 14px",
        "border-radius:6px",
        `border:1px solid ${primary ? "#a9bce8" : "#4b5262"}`,
        `background:${primary ? "#dce5fa" : "#2a2f39"}`,
        `color:${primary ? "#111827" : "#d7dce7"}`,
        "font:600 12px sans-serif",
        "cursor:pointer",
    ].join(";");
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
    });
    button.addEventListener("pointerdown", stopCanvasPropagation);
    button.addEventListener("pointerup", stopCanvasPropagation);
    return button;
}

function makeInput(multiline = false) {
    const input = document.createElement(multiline ? "textarea" : "input");
    input.style.cssText = [
        "width:100%",
        `height:${multiline ? "62px" : "30px"}`,
        "min-width:0",
        "box-sizing:border-box",
        "border:1px solid #444c5e",
        "border-radius:5px",
        "background:#171c27",
        "color:#eef2fa",
        "padding:6px 8px",
        "font:12px/1.35 sans-serif",
        multiline ? "resize:none" : "",
    ].filter(Boolean).join(";");
    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "keydown"] ) {
        input.addEventListener(eventName, stopCanvasPropagation);
    }
    return input;
}

function syncState(node) {
    setWidgetValue(node, "storyboard_data", serializeStoryboard(node.__daelabStoryboardState));
}

function rerender(node, tbody, emptyState) {
    if (typeof node.__daelabStoryboardRender === "function") {
        node.__daelabStoryboardRender();
    } else {
        renderRows(node, tbody, emptyState);
    }
}

async function uploadReference(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");
    body.append("subfolder", "DAELAB/storyboard");
    body.append("overwrite", "true");
    const response = await app.api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
    const result = await response.json();
    const query = new URLSearchParams({
        filename: result.name,
        subfolder: result.subfolder || "",
        type: result.type || "input",
    });
    return `/view?${query}`;
}

async function importDocument(file) {
    const body = new FormData();
    body.append("file", file, file.name);
    const response = await app.api.fetchApi("/daelab/storyboard/import_document", { method: "POST", body });
    if (!response.ok) {
        let detail = "";
        try { detail = String((await response.json())?.error || ""); }
        catch { detail = await response.text(); }
        throw new Error(detail || `${response.status} ${response.statusText}`);
    }
    return response.json();
}

function renderRows(node, tbody, emptyState) {
    const state = node.__daelabStoryboardState;
    tbody.replaceChildren();
    emptyState.style.display = state.shots.length ? "none" : "flex";

    state.shots.forEach((shot, index) => {
        const row = document.createElement("tr");
        row.style.cssText = "border-top:1px solid #343b49;vertical-align:top";

        const cell = (width) => {
            const element = document.createElement("td");
            element.style.cssText = `width:${width};padding:6px;border-right:1px solid #343b49;box-sizing:border-box`;
            return element;
        };

        const shotCell = cell("64px");
        const shotInput = makeInput();
        shotInput.value = shot.shot_no;
        shotInput.addEventListener("input", (event) => { shot.shot_no = event.currentTarget.value; syncState(node); });
        shotCell.append(shotInput);

        const timeCell = cell("94px");
        const timeInput = makeInput();
        timeInput.value = shot.time_range;
        timeInput.placeholder = "00-08s";
        const duration = document.createElement("div");
        duration.style.cssText = "margin-top:4px;color:#8f98aa;font:10px sans-serif;text-align:center";
        duration.textContent = `${shot.duration || 3}s`;
        timeInput.addEventListener("input", (event) => {
            shot.time_range = event.currentTarget.value;
            shot.duration = durationFromTimeRange(shot.time_range);
            duration.textContent = `${shot.duration}s`;
            syncState(node);
        });
        timeCell.append(timeInput, duration);

        const promptCell = cell("330px");
        const promptInput = makeInput(true);
        promptInput.value = shot.image_prompt || shot.prompt;
        promptInput.placeholder = "描述这个分镜要生成的画面（必填）";
        promptInput.addEventListener("input", (event) => {
            shot.prompt = event.currentTarget.value;
            shot.image_prompt = event.currentTarget.value;
            syncState(node);
        });
        promptCell.append(promptInput);

        const notesCell = cell("230px");
        const notesInput = makeInput(true);
        notesInput.value = shot.camera_notes;
        notesInput.placeholder = "运镜、构图等，可留空";
        notesInput.addEventListener("input", (event) => { shot.camera_notes = event.currentTarget.value; syncState(node); });
        notesCell.append(notesInput);

        const referenceCell = cell("112px");
        referenceCell.style.textAlign = "center";
        const preview = document.createElement("button");
        preview.type = "button";
        preview.title = "上传或替换参考图";
        preview.style.cssText = [
            "width:88px", "height:62px", "padding:0", "overflow:hidden",
            "border:1px solid #4b5262", "border-radius:5px", "background:#11151d",
            "color:#8f98aa", "cursor:pointer", "font:11px sans-serif",
        ].join(";");
        if (shot.image_url) {
            const image = document.createElement("img");
            image.src = shot.image_url;
            image.alt = `分镜 ${shot.shot_no} 参考图`;
            image.draggable = false;
            image.style.cssText = "width:100%;height:100%;object-fit:cover";
            preview.append(image);
        } else {
            preview.textContent = "上传参考图";
        }
        preview.addEventListener("pointerdown", stopCanvasPropagation);
        preview.addEventListener("click", (event) => {
            event.preventDefault(); event.stopPropagation();
            const picker = document.createElement("input");
            picker.type = "file"; picker.accept = "image/*";
            picker.addEventListener("change", async () => {
                const file = picker.files?.[0];
                if (!file) return;
                preview.textContent = "上传中…";
                try {
                    shot.image_url = await uploadReference(file);
                    syncState(node);
                    rerender(node, tbody, emptyState);
                } catch (error) {
                    showToast("error", "参考图上传失败", String(error?.message || error));
                    rerender(node, tbody, emptyState);
                }
            });
            picker.click();
        });
        referenceCell.append(preview);

        const actionCell = cell("78px");
        actionCell.style.borderRight = "0";
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:3px;justify-content:center;flex-wrap:wrap";
        const up = createIconButton(LIST_EDITOR_ICONS.up, "上移", () => {
            moveShot(state, index, -1); syncState(node); rerender(node, tbody, emptyState);
        }, index === 0);
        const down = createIconButton(LIST_EDITOR_ICONS.down, "下移", () => {
            moveShot(state, index, 1); syncState(node); rerender(node, tbody, emptyState);
        }, index === state.shots.length - 1);
        const remove = createIconButton(LIST_EDITOR_ICONS.remove, "删除", () => {
            removeShot(state, index); syncState(node); rerender(node, tbody, emptyState);
        });
        actions.append(up, down, remove);
        if (shot.image_url) {
            actions.append(createIconButton(LIST_EDITOR_ICONS.remove, "清除参考图", () => {
                shot.image_url = ""; syncState(node); rerender(node, tbody, emptyState);
            }));
        }
        actionCell.append(actions);
        row.append(shotCell, timeCell, promptCell, notesCell, referenceCell, actionCell);
        tbody.append(row);
    });
}

function createPanel(node) {
    const root = document.createElement("div");
    root.className = "daelab-storyboard-panel";
    root.style.cssText = [
        `height:${PANEL_HEIGHT}px`, `min-height:${PANEL_HEIGHT}px`, `max-height:${PANEL_HEIGHT}px`,
        "width:100%", "box-sizing:border-box", "display:flex", "flex-direction:column",
        "gap:8px", "padding:9px", "overflow:hidden", "border:1px solid #3b4352",
        "border-radius:8px", "background:#202631", "color:#e7ebf3", "font:12px sans-serif",
    ].join(";");
    for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "dragover", "drop"]) {
        root.addEventListener(name, stopCanvasPropagation);
    }

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "height:32px;min-height:32px;max-height:32px;display:flex;align-items:center;gap:8px";
    const importButton = makeButton("上传 / 拖入分镜文档", () => documentPicker.click());
    const source = document.createElement("span");
    source.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9da7ba";
    const updateSource = () => {
        const state = node.__daelabStoryboardState;
        source.textContent = state.source_filename || state.document_title || "支持 DOCX、XLSX、CSV、Markdown、PDF";
        source.title = source.textContent;
    };
    const documentPicker = document.createElement("input");
    documentPicker.type = "file";
    documentPicker.accept = DOCUMENT_ACCEPT;
    documentPicker.hidden = true;
    const handleDocument = async (file) => {
        importButton.disabled = true;
        importButton.textContent = "解析中…";
        try {
            const result = await importDocument(file);
            replaceImportedShots(node.__daelabStoryboardState, result);
            syncState(node); updateSource(); rerender(node, tbody, emptyState);
            const warning = result.warnings?.length ? `；${result.warnings.length} 条提示` : "";
            showToast("success", "分镜文档已导入", `已填入 ${result.shots.length} 个分镜${warning}`);
        } catch (error) {
            showToast("error", "分镜文档解析失败", String(error?.message || error));
        } finally {
            importButton.disabled = false;
            importButton.textContent = "上传 / 拖入分镜文档";
        }
    };
    documentPicker.addEventListener("change", () => {
        const file = documentPicker.files?.[0]; documentPicker.value = "";
        if (file) void handleDocument(file);
    });
    toolbar.append(importButton, source, documentPicker);

    const styleRow = document.createElement("label");
    styleRow.style.cssText = "height:38px;min-height:38px;max-height:38px;display:flex;align-items:center;gap:8px";
    const styleLabel = document.createElement("span");
    styleLabel.textContent = "全局风格";
    styleLabel.style.cssText = "flex:0 0 64px;color:#aeb7c8";
    const styleInput = makeInput();
    styleInput.placeholder = "可选：所有分镜共同使用的画风、角色一致性或构图要求";
    styleInput.value = String(widget(node, "main_prompt")?.value || "");
    styleInput.addEventListener("input", (event) => setWidgetValue(node, "main_prompt", event.currentTarget.value, event));
    styleRow.append(styleLabel, styleInput);

    const tableShell = document.createElement("div");
    tableShell.style.cssText = "flex:1;min-height:0;overflow:auto;border:1px solid #343b49;border-radius:6px;background:#141923";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;min-width:900px;table-layout:fixed;border-collapse:collapse";
    const thead = document.createElement("thead");
    thead.style.cssText = "position:sticky;top:0;z-index:1;background:#2a303c;color:#b7c0d0";
    const header = document.createElement("tr");
    for (const [label, width] of [["镜号","64px"],["时长","94px"],["画面内容（提示词）","330px"],["镜头备注（可空）","230px"],["参考图","112px"],["操作","78px"]]) {
        const th = document.createElement("th");
        th.textContent = label;
        th.style.cssText = `width:${width};height:30px;padding:0 6px;text-align:left;border-right:1px solid #3c4452;box-sizing:border-box;font-weight:600`;
        header.append(th);
    }
    thead.append(header);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    const emptyState = document.createElement("div");
    emptyState.textContent = "请上传分镜文档，或点击下方“新增分镜”开始。配音旁白列不会导入。";
    emptyState.style.cssText = "height:210px;display:flex;align-items:center;justify-content:center;color:#7f899d;text-align:center;padding:20px";
    tableShell.append(table, emptyState);

    const footer = document.createElement("div");
    footer.style.cssText = "height:34px;min-height:34px;max-height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px";
    const add = makeButton("＋ 新增分镜", () => {
        appendShot(node.__daelabStoryboardState); syncState(node); rerender(node, tbody, emptyState);
    });
    const counter = document.createElement("span");
    counter.style.cssText = "margin-left:auto;color:#9da7ba";
    const run = makeButton("一键运行", () => {
        const state = node.__daelabStoryboardState;
        const missing = state.shots.findIndex((shot) => !String(shot.image_prompt || shot.prompt || "").trim());
        if (!state.shots.length || missing >= 0) {
            showToast("warn", "无法运行", !state.shots.length ? "请先添加分镜" : `第 ${missing + 1} 个分镜缺少画面提示词`);
            return;
        }
        const force = widget(node, "force_run_token");
        setWidgetValue(node, "force_run_token", (Number(force?.value) || 0) + 1);
        syncState(node);
        void Promise.resolve(app.queuePrompt(0, 1, [node.id])).catch((error) => {
            showToast("error", "运行失败", String(error?.message || error));
        });
    }, true);
    footer.append(add, counter, run);

    root.append(toolbar, styleRow, tableShell, footer);
    root.addEventListener("dragover", (event) => { event.preventDefault(); root.style.borderColor = "#91a8da"; });
    root.addEventListener("dragleave", () => { root.style.borderColor = "#3b4352"; });
    root.addEventListener("drop", (event) => {
        event.preventDefault(); root.style.borderColor = "#3b4352";
        const file = event.dataTransfer?.files?.[0];
        if (file) void handleDocument(file);
    });

    const render = () => {
        renderRows(node, tbody, emptyState);
        counter.textContent = `共 ${node.__daelabStoryboardState.shots.length} 个分镜`;
        updateSource();
    };
    return { root, render };
}

function compactFit(node) {
    const { width } = storyboardPanelLayout(node.size?.[0] || DEFAULT_WIDTH);
    node.__daelabStoryboardProgrammaticResize = true;
    try {
        node.setSize?.([width, 1]);
        node.arrange?.();
        const measured = Number(node.computeSize?.()?.[1]);
        node.setSize?.([width, Number.isFinite(measured) && measured > PANEL_HEIGHT ? measured : PANEL_HEIGHT + 180]);
    } finally {
        node.__daelabStoryboardProgrammaticResize = false;
    }
}

function install(node) {
    if (!node || typeof node.addDOMWidget !== "function") return;
    recoverShiftedWorkflowValues(node);
    const storyboardWidget = widget(node, "storyboard_data");
    node.__daelabStoryboardState = normalizeStoryboard(storyboardWidget?.value || "");
    hideNativeWidget(node, "storyboard_data");
    hideNativeWidget(node, "main_prompt");

    const existing = findLiveOwnedWidget(node, PANEL_WIDGET_NAME, OWNER_PROPERTY);
    if (existing?.__daelabStoryboardVersion === EXTENSION_VERSION) {
        existing.__daelabStoryboardRender?.();
        return;
    }
    removeOwnedWidgets(node, OWNER_PROPERTY);
    const panel = createPanel(node);
    const domWidget = node.addDOMWidget(PANEL_WIDGET_NAME, "custom", panel.root, {
        serialize: false,
        hideOnZoom: false,
        getHeight: () => PANEL_HEIGHT,
        getMinHeight: () => PANEL_HEIGHT,
        getValue: () => serializeStoryboard(node.__daelabStoryboardState),
        setValue: () => panel.render(),
    });
    domWidget.serialize = false;
    domWidget[OWNER_PROPERTY] = true;
    domWidget.__daelabStoryboardVersion = EXTENSION_VERSION;
    domWidget.__daelabStoryboardRender = panel.render;
    node.__daelabStoryboardRender = panel.render;
    domWidget.computeSize = (width) => [width || DEFAULT_WIDTH, PANEL_HEIGHT];
    domWidget.computeLayoutSize = () => ({ minHeight: PANEL_HEIGHT, maxHeight: PANEL_HEIGHT, minWidth: MIN_WIDTH });
    const originalOnRemove = domWidget.onRemove?.bind(domWidget);
    domWidget.onRemove = () => { originalOnRemove?.(); panel.root.remove(); };
    panel.render();
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    schedule(() => compactFit(node));
}

function scheduleInstall(node) {
    if (node.__daelabStoryboardInstallScheduled) return;
    node.__daelabStoryboardInstallScheduled = true;
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    schedule(() => {
        node.__daelabStoryboardInstallScheduled = false;
        install(node);
    });
}

if (globalThis.__DAELAB_STORYBOARD_EXTENSION_VERSION !== EXTENSION_VERSION) {
    globalThis.__DAELAB_STORYBOARD_EXTENSION_VERSION = EXTENSION_VERSION;
    app.registerExtension({
        name: "DAELab.ComfyTV.Storyboard",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== NODE_TYPE) return;
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                scheduleInstall(this);
            };
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                onConfigure?.apply(this, arguments);
                scheduleInstall(this);
            };
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                removeOwnedWidgets(this, OWNER_PROPERTY);
                delete this.__daelabStoryboardRender;
                onRemoved?.apply(this, arguments);
            };
        },
    });
}
