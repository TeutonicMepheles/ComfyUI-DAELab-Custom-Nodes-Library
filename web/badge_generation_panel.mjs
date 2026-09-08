import { RATIOS, classifyPresets, readGenerationConfig, editDimension, validateDimensions } from './badge_generation_model.mjs';

// Both stages use the same view; only their workflow-scoped saved configuration differs.
export function createGenerationPanel(graph, stage, { onGenerate, onChange, live }) {
    const element = document.createElement('section');
    element.className = 'badge-generation'; element.dataset.generationStage = stage;
    const make = (tag, text, parent = element) => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
    const heading = make('strong', '模型输出配置');
    heading.id = `badge-generation-${stage}`; element.setAttribute('aria-labelledby', heading.id);
    let presets = classifyPresets();
    const ratios = new Map(), tiers = new Map();
    make('p', '选择比例'); const ratioRow = make('div', ''); ratioRow.className = 'badge-generation-options';
    const commit = config => {
        if (!live()) return;
        graph.beforeChange?.();
        const meta = graph.extra.daelabBadgePrototypeV1;
        meta.generation ??= {}; meta.generation[stage] = config;
        graph.afterChange?.(); graph.setDirtyCanvas?.(true, true);
        onChange?.(); render();
    };
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
    const customIcon = make('span', '↔', custom); customIcon.setAttribute('aria-hidden', 'true');
    customIcon.style.height = '20px'; make('span', '自定义', custom);
    custom.onclick = () => {
        const c = readGenerationConfig(graph, stage);
        commit({ ...c, custom: true, locked: false });
    };
    make('p', '选择分辨率'); const tierRow = make('div', ''); tierRow.className = 'badge-generation-options';
    for (const tier of ['1K', '2K']) {
        const b = make('button', tier, tierRow); b.type = 'button'; tiers.set(tier, b);
        b.onclick = () => select(presets.find(p => p.ratio === readGenerationConfig(graph, stage).ratio && p.tier === tier));
    }
    make('p', '尺寸'); const dimensions = make('div', ''); dimensions.className = 'badge-generation-dimensions';
    const inputs = {};
    for (const [axis, label] of [['width', 'W'], ['height', 'H']]) {
        const wrap = make('label', label, dimensions), input = make('input', '', wrap);
        input.type = 'number'; input.min = '1024'; input.max = '3840'; input.step = '16';
        input.setAttribute('aria-label', axis === 'width' ? '输出宽度（像素）' : '输出高度（像素）');
        input.oninput = () => {
            const c = readGenerationConfig(graph, stage);
            if (c.custom && !running) commit(editDimension({ ...c, locked: false }, axis, input.value === '' ? null : Number(input.value)));
        };
        inputs[axis] = input;
    }
    make('span', 'PX', dimensions);
    const hint = make('p', ''); hint.className = 'badge-generation-hint'; hint.setAttribute('role', 'status'); hint.id = `badge-generation-hint-${stage}`;
    for (const input of Object.values(inputs)) input.setAttribute('aria-describedby', hint.id);
    const button = make('button', '生成'); button.type = 'button'; button.className = 'badge-generation-submit'; button.setAttribute('aria-describedby', hint.id);
    button.onclick = () => { if (live() && !button.disabled) void onGenerate(); };
    const status = make('p', '仅模拟当前阶段，不生成图片。'); status.setAttribute('role', 'status');
    let running = false, problem = '';
    function render() {
        const c = readGenerationConfig(graph, stage), error = validateDimensions(c);
        for (const [ratio, b] of ratios) {
            b.hidden = !presets.some(p => p.ratio === ratio);
            b.setAttribute('aria-pressed', String(!c.custom && c.ratio === ratio)); b.disabled = running;
        }
        custom.setAttribute('aria-pressed', String(c.custom)); custom.disabled = running;
        for (const [tier, b] of tiers) {
            const supported = presets.some(p => p.ratio === c.ratio && p.tier === tier);
            b.disabled = running || c.custom || !supported; b.title = c.custom ? '自定义模式直接设置宽高；选择固定比例后可切换分辨率' : supported ? '' : '当前比例没有此分辨率预设';
            b.setAttribute('aria-pressed', String(!c.custom && c.tier === tier));
        }
        for (const [axis, input] of Object.entries(inputs)) {
            if (document.activeElement !== input) input.value = c[axis] ?? '';
            input.disabled = running || !c.custom;
            input.parentElement.dataset.disabled = String(input.disabled); input.setAttribute('aria-invalid', String(Boolean(error)));
        }
        hint.dataset.error = String(Boolean(error));
        hint.textContent = (error ? `无法生成：${error}` : '') || (c.custom ? `自定义 · ${c.width} × ${c.height} PX · 宽高按 16 像素步长调整` : `${c.tier} · ${c.ratio} · ${c.width} × ${c.height} PX · 选择“自定义”可编辑尺寸`);
        button.disabled = running || Boolean(error || problem); button.textContent = running ? '生成中…' : '生成';
    }
    render();
    return { element, button, status,
        setPresets(sizes) { presets = classifyPresets(sizes); render(); },
        update({ busy = false, error = '', message = '' } = {}) {
            running = busy; problem = error; render();
            status.textContent = busy ? '正在模拟当前阶段…' : error || message || '仅模拟当前阶段，不生成图片。';
        }, dispose() { element.remove(); } };
}

export const GENERATION_CSS = `
.badge-generation{box-sizing:border-box;flex:0 0 auto;min-width:0;margin:16px 8px 8px;padding:16px;border:1px solid #46535d;border-radius:12px;background:#20252b;color:#e4eaee}
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
.badge-generation-dimensions label{flex:1;min-width:85px;display:flex;align-items:center;gap:8px;background:#292e35;padding:8px;border-radius:6px}
.badge-generation input{width:100%;min-width:0;box-sizing:border-box;background:transparent;color:inherit;border:0;text-align:right;font-size:14px}
.badge-generation-dimensions label[data-disabled=true]{opacity:.4}
.badge-generation input:disabled{cursor:not-allowed}
.badge-generation .badge-generation-hint[data-error=true]{color:#ffaaa0;border-left:3px solid #ef8d80;background:#482d2b;padding:8px 10px;border-radius:4px}
.badge-generation input[aria-invalid=true]{outline:1px solid #ef8d80}
.badge-generation .badge-generation-submit,.badge-local-options .badge-generation .badge-generation-submit{display:block;width:100%;max-width:none;min-height:44px;margin-top:16px;background:#087fc7;border-color:#249fea;color:#fff;font-weight:600}
`;
