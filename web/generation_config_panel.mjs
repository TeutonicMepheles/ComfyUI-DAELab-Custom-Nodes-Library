import { BADGE_APP_PALETTE } from './badge_ui_styles.mjs';
import { bindCreativeButton } from './vendor/generation-ui-shared/creative_button.mjs';
import { bindCreativeField } from './vendor/generation-ui-shared/creative_field.mjs';
import { bindCompactNumberDrag, boundedNumberDragValue } from './compact_color_group_controls.mjs';
import { generationPriceQuote } from './generation_price.mjs';

let mountSequence = 0;
function ensureStyles() {
    if (!document.getElementById('cnl-generation-palette')) {
        const palette = document.createElement('style');
        palette.id = 'cnl-generation-palette';
        palette.textContent = '.cnl-generation-ui {' + BADGE_APP_PALETTE + '}';
        document.head.append(palette);
    }
    for (const path of ['./vendor/generation-ui-shared/creative_theme.css', './generation_config_panel.css?v=20261119-build-price']) {
        const href = new URL(path, import.meta.url).href;
        if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) continue;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.append(link);
    }
}

export function createGenerationConfigPanel({
    instanceId, stage, labels, capabilities, config, fold, prompt, settingsExtra, pricing, onChange, onGenerate,
}) {
    ensureStyles();
    const id = 'cnl-generation-' + instanceId + '-' + stage + '-' + (++mountSequence);
    const releases = [], events = new AbortController(), drafts = new Set();
    const element = document.createElement('section');
    element.className = 'cnl-generation-ui cnl-generation-panel';
    element.dataset.generationStage = stage;
    const make = (tag, label, parent, className) => {
        const control = document.createElement(tag);
        control.textContent = label;
        if (className) control.className = className;
        parent.append(control);
        return control;
    };
    const listen = (control, event, callback, capture = false) =>
        control.addEventListener(event, callback, { signal: events.signal, capture });
    const heading = make('div', '', element, 'cnl-generation-heading');
    heading.id = id + '-heading';
    element.setAttribute('aria-labelledby', heading.id);
    heading.hidden = Boolean(prompt);
    if (prompt) element.dataset.compactGeneration = '';
    const title = make(fold ? 'button' : 'strong', labels.heading, heading);
    if (fold) {
        title.type = 'button';
        const arrow = document.createElement('span');
        arrow.className = 'cnl-generation-fold-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        title.prepend(arrow);
    }
    const content = fold ? make('div', '', element, 'cnl-generation-content') : element;
    content.id = id + '-content';
    if (prompt) content.append(prompt);
    const actionRow = make('div', '', content, 'cnl-generation-actions');
    const settings = prompt && make('div', '', content, 'cnl-generation-settings');
    const settingsFields = settings && make('div', '', settings, 'cnl-generation-settings-fields');
    if (settingsExtra) settings.prepend(settingsExtra);
    const countRow = settings && make('div', '', settingsFields, 'cnl-generation-settings-count');
    const body = make('div', '', settingsFields || content, 'cnl-generation-fields');
    let settingsButton;
    if (settings) {
        settings.id = id + '-settings';
        settings.popover = 'auto';
        settings.setAttribute('role', 'group');
        settings.setAttribute('aria-label', '生成配置');
        settingsButton = make('button', '生成配置', actionRow, 'cnl-generation-settings-trigger');
        settingsButton.type = 'button';
        settingsButton.setAttribute('popovertarget', settings.id);
        settingsButton.setAttribute('aria-expanded', 'false');
        settingsButton.setAttribute('aria-controls', settings.id);
        releases.push(bindCreativeButton(settingsButton));
        const position = () => {
            if (!settings.matches(':popover-open')) return;
            const anchor = settingsButton.getBoundingClientRect();
            const card = element.getBoundingClientRect();
            const toolbar = actionRow.getBoundingClientRect();
            if (!anchor.width || anchor.bottom < 0 || anchor.top > innerHeight) {
                settings.hidePopover();
                return;
            }
            const edge = 8;
            const width = Math.min(card.width, 440, innerWidth - edge * 2);
            const left = Math.max(edge, Math.min(card.right - width, anchor.left, innerWidth - width - edge));
            const above = Math.max(0, toolbar.top - edge * 2);
            const below = Math.max(0, innerHeight - toolbar.bottom - edge * 2);
            const openAbove = above > below;
            settings.style.width = width + 'px';
            settings.style.maxHeight = Math.max(0, openAbove ? above : below) + 'px';
            settings.style.left = left + 'px';
            settings.style.top = (openAbove ? toolbar.top - settings.offsetHeight - edge : toolbar.bottom + edge) + 'px';
        };
        listen(settings, 'toggle', event => {
            settingsButton.setAttribute('aria-expanded', String(event.newState === 'open'));
            position();
        });
        listen(settings, 'keydown', event => {
            if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
            event.stopPropagation();
            if (event.target.matches('select:open')) return;
            event.preventDefault();
            settings.hidePopover();
            settingsButton.focus({ preventScroll: true });
        }, true);
        const observer = new ResizeObserver(position);
        observer.observe(settings);
        observer.observe(element);
        releases.push(() => observer.disconnect());
        listen(window, 'resize', position);
        listen(document, 'scroll', position, true);
    }
    if (fold) {
        title.setAttribute('aria-controls', content.id);
        title.onclick = () => { fold.setCollapsed(!fold.collapsed()); render(); };
        releases.push(bindCreativeButton(title));
    }
    if (!settings) content.append(actionRow);
    const status = make('p', '', content, 'cnl-generation-status');
    status.id = id + '-status';
    status.setAttribute('role', 'status');
    let state = {}, pending = false, disposed = false, feedback = '', modelControl = null;

    function apply(patch) {
        if (pending || state.busy || disposed || state.disabled) return false;
        try {
            config = onChange({ ...config, ...patch }) ?? { ...config, ...patch };
            feedback = '';
            return true;
        } catch (error) {
            feedback = error.message;
            return false;
        } finally { render(); }
    }

    function select(field, parent) {
        const control = make('select', '', parent);
        control.setAttribute('aria-label', field.label);
        if (field.key !== 'model') make('label', field.label, parent).append(control);
        else if (settings) {
            control.className = 'cnl-generation-model-trigger';
            parent.insertBefore(control, settingsButton);
        }
        let previous = '';
        releases.push(bindCreativeField(control));
        listen(control, 'keydown', event => {
            // ComfyUI also handles Escape at document level. Let the native
            // picker dismiss itself before the host sees the same keystroke.
            if (event.key === 'Escape' && control.matches(':open')) event.stopPropagation();
        }, true);
        listen(control, 'change', () => apply(field.patch?.(config, control.value) ?? { [field.key]: control.value }));
        return locked => {
            let options = field.options(config);
            if (field.showUnknown !== false && config[field.key] != null && !options.some(([key]) => key === config[field.key])) {
                options = [...options, [config[field.key], String(config[field.key])]];
            }
            const signature = JSON.stringify(options);
            if (signature !== previous) {
                control.replaceChildren(...options.map(([key, label]) => new Option(label, key)));
                previous = signature;
            }
            const value = String(config[field.key] ?? '');
            if (control.value !== value) control.value = value;
            control.disabled = locked || field.disabled?.(config) || (options.length < 2 && control.value !== '');
        };
    }

    function numeric(field, parent) {
        const label = make('label', field.label, parent, 'cnl-generation-number');
        if (field.group) label.dataset.numberGroup = field.group;
        const input = make('input', '', label);
        input.type = 'number';
        input.id = id + '-' + field.key;
        input.setAttribute('aria-label', field.name ?? field.label);
        input.setAttribute('aria-describedby', status.id);
        if (field.tooltip) input.title = field.tooltip;
        if (field.unit) make('span', field.unit, label);
        const limits = () => field.limits?.(config) ?? field;
        let dirty = false;
        const draft = { field, input, dirty: () => dirty, clear: () => { dirty = false; } };
        const commit = () => {
            if (!dirty || input.disabled) return true;
            const group = [...drafts].filter(candidate => candidate === draft || (
                field.group && candidate.field.group === field.group && candidate.dirty() && !candidate.input.disabled
            ));
            let next = { ...config };
            for (const part of group) {
                const { field: spec, input: control } = part;
                if (spec.normalize) control.value = String(spec.normalize(control.value, next));
                const value = control.valueAsNumber;
                if (!control.validity.valid || !Number.isFinite(value)) {
                    control.setAttribute('aria-invalid', 'true');
                    return false;
                }
                Object.assign(next, spec.patch?.(next, value) ?? { [spec.key]: value });
            }
            const problem = field.validate?.(next);
            if (problem) {
                feedback = problem;
                for (const part of group) part.input.setAttribute('aria-invalid', 'true');
                render();
                return false;
            }
            if (Object.keys(next).some(key => !Object.is(next[key], config[key])) && !apply(next)) {
                input.setAttribute('aria-invalid', 'true');
                return false;
            }
            for (const part of group) {
                part.clear();
                part.input.removeAttribute('aria-invalid');
            }
            feedback = '';
            render();
            return true;
        };
        listen(input, 'input', () => { dirty = true; render(); }, true);
        listen(input, 'change', event => {
            dirty = true;
            if (!commit()) event.stopImmediatePropagation();
        }, true);
        listen(input, 'blur', commit);
        listen(input, 'keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                commit();
            }
        });
        releases.push(bindCreativeField(input));
        releases.push(bindCompactNumberDrag(input, {
            onCommit() { dirty = true; commit(); },
            valueFromDrag: (start, delta) => {
                const { min, max, step } = limits();
                return boundedNumberDragValue(min + Math.round((start - min) / step) * step, delta, min, max, step);
            },
        }));
        draft.commit = commit;
        drafts.add(draft);
        return locked => {
            const { min, max, step } = limits();
            for (const [key, value] of Object.entries({ min, max, step })) {
                if (value != null && input[key] !== String(value)) input[key] = String(value);
            }
            label.hidden = Boolean(field.hidden?.(config));
            input.disabled = locked || label.hidden || Boolean(field.disabled?.(config));
            label.dataset.disabled = String(input.disabled);
            if (input.disabled && dirty) {
                dirty = false;
                input.removeAttribute('aria-invalid');
            }
            const value = String((field.display ? field.display(config) : config[field.key]) ?? '');
            if (!dirty && input.dataset.dragging !== 'true' && input.value !== value) input.value = value;
        };
    }

    function choices(field, parent) {
        const group = make('div', '', parent, 'cnl-generation-choice-group');
        make('span', field.label, group);
        const row = make('div', '', group, 'cnl-generation-choices');
        row.dataset.choiceKind = field.kind ?? '';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', field.label);
        const updateOptions = field.options.map(option => {
            const control = make('button', option.label, row);
            control.type = 'button';
            if (option.aspect) {
                const icon = document.createElement('span');
                icon.className = 'cnl-generation-ratio';
                icon.setAttribute('aria-hidden', 'true');
                const [w, h] = option.aspect.split(':').map(Number);
                icon.style.width = (20 * Math.min(1, w / h)) + 'px';
                icon.style.height = (20 * Math.min(1, h / w)) + 'px';
                control.prepend(icon);
            }
            control.onclick = () => apply(option.patch(config));
            releases.push(bindCreativeButton(control));
            return locked => {
                control.hidden = Boolean(option.hidden?.(config));
                control.disabled = locked || Boolean(option.disabled?.(config));
                control.setAttribute('aria-pressed', String(option.selected(config)));
            };
        });
        return locked => {
            group.hidden = Boolean(field.hidden?.(config));
            for (const update of updateOptions) update(locked);
        };
    }

    const renderers = [];
    for (const field of capabilities) {
        const parent = field.external
            ? (modelControl ??= make('div', '', heading, 'cnl-generation-model cnl-generation-ui'))
            : field.key === 'model' ? (settings ? actionRow : heading) : field.action ? (countRow || actionRow) : body;
        if (field.type === 'choices') renderers.push(choices(field, parent));
        else renderers.push(field.type === 'number' ? numeric(field, parent) : select(field, parent));
    }
    const submitGroup = settings ? make('div', '', actionRow, 'cnl-generation-submit-group') : actionRow;
    const price = pricing && make('output', '', submitGroup, 'cnl-generation-price');
    if (price) {
        price.id = id + '-price';
        price.setAttribute('aria-label', '本批初次生成预计积分');
    }
    const settingsNote = settings && make('p', '', settingsFields, 'cnl-generation-status');
    settingsNote?.setAttribute('role', 'status');
    const quote = pricing && generationPriceQuote(pricing.evaluate, label => { price.textContent = label; });
    const button = make('button', labels.generate, submitGroup, 'cnl-generation-submit');
    button.type = 'button';
    button.setAttribute('aria-describedby', price ? price.id + ' ' + status.id : status.id);
    button.onclick = () => {
        if (pending || disposed || state.busy || state.disabled) return;
        for (const { input, commit } of drafts) {
            if (!commit()) {
                if (settings && !settings.matches(':popover-open')) settings.showPopover();
                input.focus();
                return;
            }
        }
        const problem = state.validate?.(config) || state.error;
        if (problem) { render(); return; }
        pending = true;
        feedback = '';
        return Promise.resolve().then(() => {
            if (!disposed) return onGenerate(config);
        }).catch(error => { feedback = error?.message || String(error); });
    };
    const releaseButton = bindCreativeButton(button);
    const invoke = button.onclick;
    button.onclick = function (event) {
        const submission = invoke.call(this, event);
        if (submission) {
            render();
            return submission.finally(() => {
                pending = false;
                if (!disposed) render();
            });
        }
    };
    releases.push(() => { button.onclick = invoke; releaseButton(); });

    function render() {
        const locked = pending || Boolean(state.busy || state.disabled);
        const invalid = state.validate?.(config) || state.error;
        const error = feedback || invalid || state.failure;
        if (fold) {
            const collapsed = fold.collapsed();
            content.hidden = collapsed;
            title.setAttribute('aria-expanded', String(!collapsed));
        }
        if (settings) {
            settingsFields.hidden = Boolean(state.settingsHidden);
            settingsButton.hidden = Boolean(state.settingsHidden && !settingsExtra);
            const model = actionRow.querySelector('.cnl-generation-model-trigger');
            if (model) model.hidden = Boolean(state.settingsHidden);
            submitGroup.hidden = Boolean(state.settingsHidden);
            if (settingsButton.hidden && settings.matches(':popover-open')) settings.hidePopover();
            const note = state.settingsMessage || '';
            if (settingsNote.textContent !== note) settingsNote.textContent = note;
            settingsNote.hidden = !note;
        } else body.hidden = actionRow.hidden = Boolean(state.settingsHidden);
        if (quote) quote.update(state.disabled || state.settingsHidden ? null : pricing.snapshot(config));
        for (const update of renderers) update(locked);
        button.disabled = locked || Boolean(invalid && ![...drafts].some(draft => draft.dirty()));
        const actionLabel = pending || state.busy ? labels.busy : labels.generate;
        if (button.textContent !== actionLabel) button.textContent = actionLabel;
        const message = error || state.message || '';
        if (status.textContent !== message) status.textContent = message;
        status.dataset.error = String(Boolean(error));
        status.hidden = !status.textContent;
    }
    render();
    return {
        element, modelControl, button, status,
        update(next, display = state) {
            if (disposed) return;
            config = next;
            state = display;
            render();
        },
        dispose() {
            disposed = true;
            quote?.dispose();
            events.abort();
            releases.forEach(release => release());
            button.onclick = null;
            modelControl?.remove();
            element.remove();
        },
    };
}
