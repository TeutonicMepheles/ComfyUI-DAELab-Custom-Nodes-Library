import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { refinedBadge87, selectedBadgeModel, BADGE_MODELS, localTargetSize87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { RATIOS, classifyPresets, readGenerationConfig, editDimension, validateDimensions } from './badge_generation_model.mjs?v=20260917-target87-1';
import { bindCompactNumberDrag, boundedNumberDragValue } from './compact_color_group_controls.mjs?v=20260916-content-1';

// Both stages use the same view; only their workflow-scoped saved configuration differs.
export function createGenerationPanel(graph, stage, { onGenerate, onChange, live }) {
    const refined = refinedBadge87(graph), inherit = refined && stage === 'local';
    const element = document.createElement(refined && !inherit ? 'details' : 'section');
    element.className = 'badge-generation'; element.dataset.generationStage = stage;
    const make = (tag, text, parent = element) => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
    const header = make(refined && !inherit ? 'summary' : 'div', ''); header.className = 'badge-generation-heading';
    const heading = make('strong', badgeText("generation_panel.text_001"), header);
    const model = refined ? make('select', '', header) : null;
    if (model) { model.setAttribute('aria-label', badgeText("generation_panel.text_002")); for (const [id, label] of BADGE_MODELS) { const o = make('option', label, model); o.value = id; } }
    if (model) { model.onclick = event => event.stopPropagation(); model.onkeydown = event => event.stopPropagation(); }
    if (inherit) { heading.hidden = true; element.dataset.inheritedOutput = ''; }
    heading.id = `badge-generation-${stage}`; element.setAttribute('aria-labelledby', heading.id);
    if (inherit) { element.removeAttribute('aria-labelledby'); element.setAttribute('aria-label', badgeText('generation_panel.text_024')); }
    let presets = classifyPresets();
    const ratios = new Map(), tiers = new Map();
    const ratioLabel = make('p', badgeText("generation_panel.text_003")); const ratioRow = make('div', ''); ratioRow.className = 'badge-generation-options';
    const commit = config => {
        if (!live()) return;
        graph.beforeChange?.();
        const meta = graph.extra.daelabBadgePrototypeV1;
        meta.generation ??= {}; meta.generation[stage] = config;
        graph.afterChange?.(); graph.setDirtyCanvas?.(true, true);
        onChange?.(); render();
    };
    if (model) model.onchange = () => { if (!running) commit({...readGenerationConfig(graph, stage), model: model.value}); };
    const select = preset => { if (preset) commit({ ...readGenerationConfig(graph, stage), ...preset, custom: false }); };
    for (const ratio of RATIOS) {
        const b = make('button', '', ratioRow); b.type = 'button';
        const icon = make('span', '', b), [w, h] = ratio.split(':').map(Number);
        icon.className = 'badge-generation-ratio-icon'; icon.setAttribute('aria-hidden', 'true');
        icon.style.width = `${20 * Math.min(1, w / h)}px`; icon.style.height = `${20 * Math.min(1, h / w)}px`;
        make('span', ratio, b); ratios.set(ratio, b);
        b.onclick = () => { const c = readGenerationConfig(graph, stage); select(presets.find(p => p.ratio === ratio && p.tier === c.tier) || presets.find(p => p.ratio === ratio)); };
    }
    const custom = make('button', '', ratioRow); custom.type = 'button';
    const customIcon = make('span', badgeText("generation_panel.text_004"), custom); customIcon.setAttribute('aria-hidden', 'true');
    customIcon.style.height = '20px'; make('span', badgeText("generation_panel.text_005"), custom);
    custom.onclick = () => {
        const c = readGenerationConfig(graph, stage);
        commit({ ...c, custom: true, locked: false });
    };
    const resolutionLabel = make('p', badgeText("generation_panel.text_006"));
    const resolutionRow = make('div', ''); resolutionRow.className = 'badge-generation-resolution';
    const tierRow = make('div', '', resolutionRow); tierRow.className = 'badge-generation-options badge-generation-tiers';
    for (const tier of ['1K', '2K']) {
        const b = make('button', tier, tierRow); b.type = 'button'; tiers.set(tier, b);
        b.onclick = () => select(presets.find(p => p.ratio === readGenerationConfig(graph, stage).ratio && p.tier === tier));
    }
    const dimensions = make('div', '', resolutionRow); dimensions.className = 'badge-generation-dimensions';
    const inputs = {};
    for (const [axis, label] of [['width', 'W'], ['height', 'H']]) {
        const wrap = make('label', label, dimensions), input = make('input', '', wrap);
        input.type = 'number'; input.min = '1024'; input.max = '3840'; input.step = '16';
        input.setAttribute('aria-label', axis === 'width' ? badgeText("generation_panel.text_007") : badgeText("generation_panel.text_008"));
        input.title = badgeText("generation_panel.text_009");
        const setDimension = value => {
            const c = readGenerationConfig(graph, stage);
            if (live() && c.custom && !running) commit(editDimension({ ...c, locked: false }, axis, value === '' ? null : Number(value)));
        };
        input.oninput = () => setDimension(input.value);
        bindCompactNumberDrag(input, {
            onCommit: setDimension,
            valueFromDrag: (start, delta) => boundedNumberDragValue(Math.round(start / 16) * 16, delta, 1024, 3840, 16),
        });
        inputs[axis] = input;
    }
    make('span', badgeText("generation_panel.text_010"), dimensions);
    const hint = make('p', ''); hint.className = 'badge-generation-hint'; hint.setAttribute('role', 'status'); hint.id = `badge-generation-hint-${stage}`;
    for (const input of Object.values(inputs)) input.setAttribute('aria-describedby', hint.id);
    if (inherit) for (const row of [ratioLabel, ratioRow, resolutionLabel, resolutionRow]) row.hidden = true;
    const actionRow = make('div', ''); actionRow.className = 'badge-generation-actions';
    let countInput;
    if (graph.extra?.daelabBadgeExecutionV1?.version === 1 && !inherit) {
        const numberRow = make('label', badgeText("generation_panel.text_011"), actionRow); numberRow.className = 'badge-generation-count';
        countInput = make('input', '', numberRow); countInput.type = 'number'; countInput.min = '1'; countInput.max = '8'; countInput.step = '1';
        countInput.setAttribute('aria-label', badgeText("generation_panel.text_012")); countInput.title = badgeText("generation_panel.text_013");
        const setCount = value => {
            if (!live() || running) return;
            const n = Number(value);
            const count = Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : 1;
            commit({...readGenerationConfig(graph, stage), count}); countInput.value = String(count);
        };
        bindCompactNumberDrag(countInput, {onCommit: setCount});
        countInput.onchange = () => setCount(countInput.value);
    }
    const button = make('button', badgeText("generation_panel.text_014"), actionRow); button.type = 'button'; button.className = 'badge-generation-submit'; button.setAttribute('aria-describedby', hint.id);
    button.onclick = () => { if (live() && !button.disabled) void onGenerate(); };
    const status = make('p', badgeText("generation_panel.text_015")); status.setAttribute('role', 'status');
    let running = false, problem = '';
    function render() {
        const c = readGenerationConfig(graph, stage), error = validateDimensions(c);
        if (model) { model.value = c.model; model.disabled = running; }
        if (countInput) { if (countInput.dataset.dragging !== 'true' && document.activeElement !== countInput) countInput.value = c.count ?? 1; countInput.disabled = running; }
        for (const [ratio, b] of ratios) {
            b.hidden = !presets.some(p => p.ratio === ratio);
            b.setAttribute('aria-pressed', String(!c.custom && c.ratio === ratio)); b.disabled = running;
        }
        custom.setAttribute('aria-pressed', String(c.custom)); custom.disabled = running;
        for (const [tier, b] of tiers) {
            const supported = presets.some(p => p.ratio === c.ratio && p.tier === tier);
            b.disabled = running || c.custom || !supported; b.title = c.custom ? badgeText("generation_panel.text_016") : supported ? '' : badgeText("generation_panel.text_017");
            b.setAttribute('aria-pressed', String(!c.custom && c.tier === tier));
        }
        for (const [axis, input] of Object.entries(inputs)) {
            if (input.dataset.dragging !== 'true' && document.activeElement !== input) input.value = c[axis] ?? '';
            input.disabled = running || !c.custom;
            input.parentElement.dataset.disabled = String(input.disabled); input.setAttribute('aria-invalid', String(Boolean(error)));
        }
        hint.dataset.error = String(Boolean(error));
        hint.textContent = inherit ? (c.width ? badgeText("generation_panel.text_018", {p0: (c.width), p1: (c.height), p2: (error ? ' · '+error : '')}) : badgeText("generation_panel.text_019")) : (error ? badgeText("generation_panel.text_020", {p0: (error)}) : '') || (c.custom ? badgeText("generation_panel.text_021", {p0: (c.width), p1: (c.height)}) : badgeText("generation_panel.text_022", {p0: (c.tier), p1: (c.ratio), p2: (c.width), p3: (c.height)}));
        button.disabled = running || Boolean(error || problem); button.textContent = running ? badgeText("generation_panel.text_023") : badgeText("generation_panel.text_024");
    }
    render();
    return { element, button, status, modelControl: inherit ? header : null,
        setPresets(sizes) { presets = classifyPresets(sizes); render(); },
        update({ busy = false, error = '', message = '' } = {}) {
            running = busy; problem = error; render();
            status.textContent = busy ? (graph.extra?.daelabBadgeExecutionV1?.version === 1 ? badgeText("generation_panel.text_025") : badgeText("generation_panel.text_026")) : error || message || badgeText("generation_panel.text_027");
        }, dispose() { element.remove(); } };
}

export const GENERATION_CSS = `
.badge-generation{box-sizing:border-box;flex:0 0 auto;min-width:0;margin:16px 8px 8px;padding:16px;border:1px solid #46535d;border-radius:12px;background:#20252b;color:#e4eaee}
.badge-generation [hidden]{display:none!important}
.badge-generation-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.badge-generation-heading select{min-width:0;max-width:100%;padding:5px 8px;border:1px solid #4b545e;border-radius:6px;background:#2c3138;color:#e4eaee;font-size:12px}
.badge-generation[hidden]{display:none!important}
.badge-generation p{font-size:12px;margin:12px 0 7px;color:#acb7c1;overflow-wrap:anywhere}
.badge-generation-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(62px,1fr));gap:6px}
.badge-generation button,.badge-local-options .badge-generation button{cursor:pointer;border:1px solid #4b545e;border-radius:8px;background:#2c3138;color:#e4eaee;padding:9px 6px;font-size:13px}
.badge-generation-options button{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px}
.badge-generation button[aria-pressed=true]{border-color:#39c8b1;background:#254a43;color:#dcfff5}
.badge-generation button:disabled{opacity:.4;cursor:default}
.badge-generation :focus-visible{outline:2px solid #80bfff;outline-offset:2px}
.badge-generation-ratio-icon{display:block;border:2px solid currentColor;border-radius:3px;box-sizing:border-box}
.badge-generation-dimensions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.badge-generation-resolution{display:flex;align-items:center;gap:8px;min-width:0}
.badge-generation-tiers{grid-template-columns:repeat(2,minmax(0,1fr));flex:1;min-width:96px}
.badge-generation-resolution .badge-generation-dimensions{flex:2;min-width:0;flex-wrap:nowrap}
.badge-generation-resolution .badge-generation-dimensions label{min-width:0}
.badge-generation-actions{display:flex;align-items:stretch;gap:8px;margin-top:16px}
.badge-generation-actions .badge-generation-count{flex:0 0 112px;box-sizing:border-box}
.badge-generation-actions .badge-generation-submit{flex:1;min-width:0}
.badge-generation-count{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;margin:0;background:#292e35;border:1px solid #4b545e;border-radius:8px;font-size:13px;white-space:nowrap}
.badge-generation-count input{cursor:ew-resize;touch-action:none;user-select:none}
.badge-generation-dimensions input:not(:disabled){cursor:ew-resize;touch-action:none;user-select:none}
.badge-generation-dimensions label{flex:1;min-width:85px;display:flex;align-items:center;gap:8px;background:#292e35;padding:8px;border-radius:6px}
.badge-generation input{width:100%;min-width:0;box-sizing:border-box;background:transparent;color:inherit;border:0;text-align:right;font-size:14px}
.badge-generation-dimensions label[data-disabled=true]{opacity:.4}
.badge-generation input:disabled{cursor:not-allowed}
.badge-generation .badge-generation-hint[data-error=true]{color:#ffaaa0;border-left:3px solid #ef8d80;background:#482d2b;padding:8px 10px;border-radius:4px}
.badge-generation input[aria-invalid=true]{outline:1px solid #ef8d80}
.badge-generation .badge-generation-submit,.badge-local-options .badge-generation .badge-generation-submit{display:block;width:100%;max-width:none;min-height:44px;margin-top:16px;background:#087fc7;border-color:#249fea;color:#fff;font-weight:600}
.badge-generation .badge-generation-actions .badge-generation-submit{margin-top:0}
`;
