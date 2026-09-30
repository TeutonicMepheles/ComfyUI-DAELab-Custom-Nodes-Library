import {
    commitColorWidgetValue,
    normalizeColor,
} from "./multi_color_mask_model.mjs?v=20260827-1";
import { findLiveOwnedWidget } from "./dynamic_widget_lifecycle.mjs?v=20260827-1";


function textColor(background) {
    const r = parseInt(background.slice(1, 3), 16);
    const g = parseInt(background.slice(3, 5), 16);
    const b = parseInt(background.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#333333" : "#eeeeee";
}


export function addColorPickerWidget(node, name, value, onChange, ownerProperty) {
    const widget = {
        name,
        type: "MULTICOLORCODE",
        value: normalizeColor(value),
        options: { default: normalizeColor(value) },
        serialize: false,
        callback(value, _canvas, currentNode) {
            const targetNode = currentNode || node;
            const liveWidget = findLiveOwnedWidget(targetNode, name, ownerProperty, this);
            commitColorWidgetValue(liveWidget, targetNode, value, onChange);
        },
        onRemove() {
            this._colorPicker?.remove();
            this._colorPicker = null;
        },
        draw(ctx, currentNode, width, y, height) {
            const margin = 15;
            const drawHeight = 22;
            const top = y + (height - drawHeight) / 2;
            ctx.beginPath();
            ctx.roundRect(margin, top, width - margin * 2, drawHeight, 10);
            ctx.fillStyle = this.value;
            ctx.fill();
            ctx.strokeStyle = "#555";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = textColor(this.value);
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`${this.label || this.name} (${this.value})`, width / 2, top + 14);
        },
        mouse(event, position, currentNode) {
            if (event.type !== "pointerdown") return false;
            if (position[0] < 15 || position[0] > currentNode.size[0] - 15) return false;

            const picker = document.createElement("input");
            picker.type = "color";
            picker.value = this.value;
            picker.style.position = "fixed";
            picker.style.left = "-10000px";
            document.body.appendChild(picker);
            this._colorPicker?.remove();
            this._colorPicker = picker;

            const cleanup = () => {
                if (this._colorPicker === picker) this._colorPicker = null;
                picker.remove();
            };
            let lastValue = this.value;
            const synchronize = (pickerEvent) => {
                const nextValue = normalizeColor(picker.value, lastValue);
                if (nextValue === lastValue) return;
                const targetNode = currentNode || node;
                const liveWidget = findLiveOwnedWidget(targetNode, name, ownerProperty, this);
                lastValue = commitColorWidgetValue(liveWidget, targetNode, nextValue, onChange);
            };
            picker.addEventListener("input", synchronize);
            picker.addEventListener("change", (pickerEvent) => {
                synchronize(pickerEvent);
                cleanup();
            }, { once: true });
            picker.addEventListener("cancel", cleanup, { once: true });
            picker.click();
            return true;
        },
        computeSize(width) {
            return [width, 22];
        },
    };
    if (ownerProperty) widget[ownerProperty] = true;
    node.addCustomWidget(widget);
    return widget;
}
