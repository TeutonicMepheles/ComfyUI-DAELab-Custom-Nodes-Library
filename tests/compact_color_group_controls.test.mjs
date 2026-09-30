import assert from "node:assert/strict";
import test from "node:test";

import {
    COMPACT_COLOR_CONTEXT_ATTRIBUTE,
    COMPACT_COLOR_CONTEXT_EVENT,
    COMPACT_THRESHOLD_DRAG_MIN_DISTANCE,
    compactThresholdValueFromDrag,
    createCompactColorControl,
    createCompactThresholdControl,
    bindCompactNumberDrag,
} from "../web/compact_color_group_controls.mjs";

function createFakeElement(tagName) {
    const listeners = new Map();
    return {
        tagName,
        style: {},
        dataset: {},
        children: [],
        attributes: new Map(),
        addEventListener(type, callback) {
            listeners.set(type, callback);
        },
        append(...children) {
            this.children.push(...children);
        },
        setAttribute(name, value) {
            this.attributes.set(name, value);
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        },
        setPointerCapture() {},
        dispatch(type, event = {}) {
            listeners.get(type)?.({ type, ...event });
        },
    };
}

test('quantity dragging clamps to 1–8 and cancellation or disabled inputs do not commit',()=>{
    const input=createFakeElement('input'); Object.assign(input,{min:'1',max:'8',step:'1',value:'2'});
    const commits=[]; bindCompactNumberDrag(input,{onCommit:v=>commits.push(Number(v))});
    const drag=(end,cancel=false)=>{
        input.dispatch('pointerdown',{pointerId:1,button:0,clientX:100});
        input.dispatch('pointermove',{pointerId:1,clientX:end});
        input.dispatch(cancel?'pointercancel':'pointerup',{pointerId:1});
    };
    drag(136); assert.deepEqual(commits,[5]);
    drag(1000); assert.deepEqual(commits,[5,8]);
    drag(-1000,true); assert.equal(input.value,'8');assert.equal(commits.length,2);
    input.disabled=true;drag(-1000);assert.equal(commits.length,2);
    input.disabled=false;drag(-1000);assert.equal(commits.at(-1),1);
});

test("maps horizontal drag distance to a clamped integer threshold", () => {
    assert.equal(compactThresholdValueFromDrag(30, 12.4), 42);
    assert.equal(compactThresholdValueFromDrag(3, -20), 0);
    assert.equal(compactThresholdValueFromDrag(250, 20), 255);
});

test("strict color draft updates immediately and invalid hex survives blur as a queue blocker", () => {
    const previousDocument = globalThis.document;
    const previousCustomEvent = globalThis.CustomEvent;
    const previousDispatchEvent = globalThis.dispatchEvent;
    globalThis.document = { createElement: createFakeElement };
    let contextEvent = null;
    globalThis.CustomEvent = class {
        constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    };
    globalThis.dispatchEvent = (event) => {
        contextEvent = event;
        return true;
    };
    try {
        const drafts = [];
        const commits = [];
        const invalid = [];
        let flushValid = null;
        const control = createCompactColorControl({
            color: "#112233",
            onDraft(value) {
                drafts.push(value);
                return value.toLowerCase();
            },
            onCommit(value) {
                commits.push(value);
                return value.toLowerCase();
            },
            onInvalid(value) {
                invalid.push(value);
            },
            onFlush(value) {
                flushValid = value;
            },
        });
        const picker = control.children[0];
        const text = control.children[1];
        assert.equal(control.attributes.get(COMPACT_COLOR_CONTEXT_ATTRIBUTE), "1");
        assert.equal(picker.dataset.daelabColorControlTrigger, "picker");
        assert.equal(text.dataset.daelabColorControlTrigger, "hex");
        picker.dispatch("click");
        assert.equal(contextEvent.type, COMPACT_COLOR_CONTEXT_EVENT);
        assert.equal(contextEvent.detail.element, control);
        assert.equal(contextEvent.detail.trigger, "picker");
        picker.value = "#abcdef";
        picker.dispatch("input");
        assert.deepEqual(drafts, ["#abcdef"]);

        text.value = "#12";
        text.dispatch("input");
        text.dispatch("blur");
        assert.equal(text.value, "#12");
        assert.equal(text.attributes.get("aria-invalid"), "true");
        assert.equal(flushValid, false);
        assert.deepEqual(commits, []);
        assert.ok(invalid.includes("#12"));

        text.value = "#A1B2C3";
        text.dispatch("input");
        text.dispatch("keydown", { key: "Enter", preventDefault() {} });
        assert.equal(text.attributes.get("aria-invalid"), "false");
        assert.equal(flushValid, true);
        assert.deepEqual(commits, ["#A1B2C3"]);
    } finally {
        globalThis.document = previousDocument;
        if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = previousCustomEvent;
        if (previousDispatchEvent === undefined) delete globalThis.dispatchEvent;
        else globalThis.dispatchEvent = previousDispatchEvent;
    }
});

test("threshold input previews while dragging and commits once on release", () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: createFakeElement };

    try {
        const commits = [];
        const control = createCompactThresholdControl({
            threshold: 30,
            onCommit(value) {
                commits.push(Number(value));
                return Number(value);
            },
        });
        const input = control.children[1];
        let prevented = 0;
        const event = {
            button: 0,
            pointerId: 7,
            preventDefault() {
                prevented += 1;
            },
        };

        input.dispatch("pointerdown", { ...event, clientX: 100 });
        input.dispatch("pointermove", {
            ...event,
            clientX: 100 + COMPACT_THRESHOLD_DRAG_MIN_DISTANCE - 1,
        });
        assert.equal(input.value, "30");
        assert.deepEqual(commits, []);

        input.dispatch("pointermove", { ...event, clientX: 118 });
        assert.equal(input.value, "48");
        assert.deepEqual(commits, []);
        assert.equal(input.dataset.dragging, "true");

        input.dispatch("pointerup", { ...event, clientX: 118 });
        assert.equal(input.value, "48");
        assert.deepEqual(commits, [48]);
        assert.equal(input.dataset.dragging, undefined);
        assert.ok(prevented >= 2);
        assert.match(input.title, /左右拖动调整/);
        assert.match(input.style.cssText, /cursor:ew-resize/);
    } finally {
        globalThis.document = previousDocument;
    }
});

test("a click-sized pointer movement leaves direct input behavior unchanged", () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: createFakeElement };

    try {
        const commits = [];
        const control = createCompactThresholdControl({
            threshold: 30,
            onCommit(value) {
                commits.push(Number(value));
                return Number(value);
            },
        });
        const input = control.children[1];
        input.dispatch("pointerdown", { button: 0, pointerId: 2, clientX: 50 });
        input.dispatch("pointermove", { pointerId: 2, clientX: 51 });
        input.dispatch("pointerup", { pointerId: 2, clientX: 51 });
        assert.equal(input.value, "30");
        assert.deepEqual(commits, []);

        input.value = "61";
        input.dispatch("change");
        assert.deepEqual(commits, [61]);
    } finally {
        globalThis.document = previousDocument;
    }
});
