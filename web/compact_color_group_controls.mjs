export function compactInputStyle(extra = "") {
    return [
        "height:26px",
        "min-width:0",
        "box-sizing:border-box",
        "border:1px solid #45484e",
        "border-radius:5px",
        "background:#292c31",
        "color:#eeeeee",
        "font:12px sans-serif",
        "outline:none",
        extra,
    ].filter(Boolean).join(";");
}

export const COMPACT_THRESHOLD_DRAG_MIN_DISTANCE = 3;

export function compactThresholdValueFromDrag(startValue, deltaX) {
    const start = Number(startValue);
    const delta = Number(deltaX);
    const next = (Number.isFinite(start) ? Math.round(start) : 0)
        + (Number.isFinite(delta) ? Math.round(delta) : 0);
    return Math.min(255, Math.max(0, next));
}

export function createCompactColorControl({
    color,
    onCommit,
    onDraft = null,
    onInvalid = null,
    onFlush = null,
    getCurrentColor = null,
    label = "颜色",
}) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "height:26px;min-width:0;display:grid;grid-template-columns:28px minmax(0,1fr);gap:4px";

    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = color;
    picker.title = `选择${label} ${color}`;
    picker.setAttribute("aria-label", `${label} ${color}`);
    picker.style.cssText = compactInputStyle("width:28px;padding:1px;cursor:pointer");

    const text = document.createElement("input");
    text.type = "text";
    text.value = color.toUpperCase();
    text.spellcheck = false;
    text.setAttribute("aria-label", `${label}十六进制值`);
    text.style.cssText = compactInputStyle("width:100%;padding:2px 6px;text-transform:uppercase");

    const isStrictHex = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value ?? ""));
    const setInvalid = (invalid, value = "") => {
        text.setAttribute("aria-invalid", String(invalid));
        text.style.borderColor = invalid ? "#d65a5a" : "#45484e";
        if (invalid) text.title = `请输入完整的 #RRGGBB 颜色值；当前值：${value}`;
        else text.removeAttribute("title");
        onInvalid?.(invalid ? String(value) : null);
    };
    const applyNormalized = (normalized, { updateText = true } = {}) => {
        if (typeof normalized !== "string") return;
        picker.value = normalized;
        picker.setAttribute("aria-label", `${label} ${normalized}`);
        if (updateText) text.value = normalized.toUpperCase();
        setInvalid(false);
        return normalized;
    };
    const draft = (value, { updateText = true } = {}) => {
        if (!isStrictHex(value)) {
            setInvalid(true, value);
            return null;
        }
        const normalized = (onDraft ?? onCommit)?.(value);
        return applyNormalized(normalized, { updateText });
    };
    const flush = (value) => {
        if (!isStrictHex(value)) {
            setInvalid(true, value);
            onFlush?.(false);
            return null;
        }
        const normalized = onDraft ? onCommit?.(value) : draft(value);
        const applied = applyNormalized(normalized ?? getCurrentColor?.() ?? value);
        onFlush?.(true);
        return applied;
    };
    picker.addEventListener("input", () => draft(picker.value));
    picker.addEventListener("change", () => flush(picker.value));
    text.addEventListener("input", () => draft(text.value, { updateText: false }));
    text.addEventListener("change", () => flush(text.value));
    text.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault?.();
        flush(text.value);
    });
    text.addEventListener("blur", () => flush(text.value));

    wrapper.append(picker, text);
    return wrapper;
}

export function createCompactThresholdControl({ threshold, onCommit }) {
    const wrapper = document.createElement("label");
    wrapper.style.cssText = "height:26px;min-width:0;display:grid;grid-template-columns:auto minmax(42px,1fr);align-items:center;gap:4px";
    const label = document.createElement("span");
    label.textContent = "阈值";
    label.title = "悬浮数值后左右拖动调整。0 为严格颜色匹配；数值越大，允许的色差越大。";
    label.style.cssText = "font:11px sans-serif;color:#aeb4bc;white-space:nowrap";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "255";
    input.step = "1";
    input.value = String(threshold);
    input.setAttribute("aria-label", "颜色匹配阈值");
    input.setAttribute("aria-description", "悬浮后左右拖动调整，也可以单击输入数值");
    input.title = "左右拖动调整；单击后可直接输入（0–255）";
    input.style.cssText = compactInputStyle("width:100%;padding:2px 4px;text-align:center;cursor:ew-resize;user-select:none");

    const commit = (value) => {
        const normalized = onCommit?.(value);
        if (normalized != null) input.value = String(normalized);
        return normalized;
    };
    input.addEventListener("change", () => commit(input.value));

    let dragState = null;
    let suppressClick = false;

    input.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        const clientX = Number(event.clientX);
        if (!Number.isFinite(clientX)) return;
        dragState = {
            pointerId: event.pointerId,
            startX: clientX,
            startValue: Number(input.value),
            dragged: false,
        };
        try {
            input.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture is optional in lightweight DOM hosts.
        }
    });

    input.addEventListener("pointermove", (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const deltaX = Number(event.clientX) - dragState.startX;
        if (!Number.isFinite(deltaX)) return;
        if (!dragState.dragged && Math.abs(deltaX) < COMPACT_THRESHOLD_DRAG_MIN_DISTANCE) return;
        dragState.dragged = true;
        input.dataset.dragging = "true";
        input.value = String(compactThresholdValueFromDrag(dragState.startValue, deltaX));
        event.preventDefault?.();
    });

    const finishDrag = (event, { cancelled = false } = {}) => {
        if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
        const { dragged, startValue } = dragState;
        dragState = null;
        delete input.dataset.dragging;
        if (!dragged) return;
        event.preventDefault?.();
        suppressClick = true;
        setTimeout(() => {
            suppressClick = false;
        }, 0);
        if (cancelled) input.value = String(compactThresholdValueFromDrag(startValue, 0));
        else commit(input.value);
    };

    input.addEventListener("pointerup", (event) => finishDrag(event));
    input.addEventListener("pointercancel", (event) => finishDrag(event, { cancelled: true }));
    input.addEventListener("lostpointercapture", (event) => finishDrag(event));
    input.addEventListener("click", (event) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault?.();
    });

    wrapper.append(label, input);
    return wrapper;
}

export function bindCompactGroupSelection(card, onSelect) {
    card.addEventListener("pointerdown", onSelect);
    card.addEventListener("focusin", onSelect);
}

export function applyCompactGroupSelection(root, selectedId) {
    for (const card of root?.querySelectorAll?.("[data-color-group-id]") || []) {
        const selected = card.dataset.colorGroupId === selectedId;
        card.dataset.selected = String(selected);
        card.setAttribute("aria-selected", String(selected));
        card.style.borderColor = selected ? "#4ca2d9" : "#3f4248";
        card.style.background = selected ? "#26343e" : "#23262a";
        card.style.boxShadow = selected ? "inset 3px 0 0 #4ca2d9" : "none";
    }
}
