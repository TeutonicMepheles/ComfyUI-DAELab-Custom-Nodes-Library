import jsonata from './vendor/jsonata/jsonata.mjs';

// ComfyUI Partner Node billing units:
// https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy
const CREDITS_PER_USD = 211;
const creditsFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const estimators = new WeakMap();

export function executionPriceInput(model, parameters, references) {
    const execution = model?.execution;
    if (!execution?.nodeType || !execution.inputs.references || !Number.isInteger(references) || references < 0) return null;
    const widgets = { [execution.modelField]: model.provider };
    for (const [key, value] of Object.entries(parameters)) {
        const name = execution.inputs[key];
        if (name && value != null) widgets[name] = value;
    }
    return { nodeType: execution.nodeType, widgets, inputs: {}, inputGroups: { [execution.inputs.references]: references } };
}

function normalizeWidget(value, type) {
    if (type === 'INT' || type === 'FLOAT') return Number(value);
    if (type === 'BOOLEAN') return value === true || value === 'on' || value === 1;
    return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function compilePriceBadge(badge) {
    if (badge?.engine !== 'jsonata' || !badge.depends_on || !badge.expr) return null;
    const expression = jsonata(badge.expr);
    const { widgets = [], inputs = [], input_groups: groups = [] } = badge.depends_on;
    return async snapshot => {
        if (widgets.some(({ name }) => !Object.hasOwn(snapshot.widgets, name)) ||
            inputs.some(name => !Object.hasOwn(snapshot.inputs, name)) ||
            groups.some(name => !Object.hasOwn(snapshot.inputGroups, name))) return null;
        const result = await expression.evaluate({
            widgets: Object.fromEntries(widgets.map(({ name, type }) => [name, normalizeWidget(snapshot.widgets[name], type)])),
            inputs: Object.fromEntries(inputs.map(name => [name, { connected: snapshot.inputs[name] }])),
            inputGroups: Object.fromEntries(groups.map(name => [name, snapshot.inputGroups[name]])),
        });
        const values = result?.type === 'usd' ? [result.usd, result.usd] :
            result?.type === 'range_usd' ? [result.min_usd, result.max_usd] : [];
        if (!values.length || values.some(value => !Number.isFinite(value) || value < 0) || values[0] > values[1]) return null;
        return { min: values[0] * CREDITS_PER_USD, max: values[1] * CREDITS_PER_USD };
    };
}

export function generationPriceEstimator(api) {
    if (!estimators.has(api)) {
        const rules = new Map();
        estimators.set(api, async snapshot => {
            const { nodeType } = snapshot;
            if (!rules.has(nodeType)) {
                const definition = async () => {
                    const response = await api.fetchApi('/object_info/' + encodeURIComponent(nodeType));
                    if (!response.ok) return null;
                    const data = await response.json();
                    return compilePriceBadge(data[nodeType]?.price_badge);
                };
                rules.set(nodeType, definition().catch(() => null));
            }
            const evaluate = await rules.get(nodeType);
            return evaluate ? evaluate(snapshot) : null;
        });
    }
    return estimators.get(api);
}

export function generationPriceQuote(evaluate, show) {
    let key, revision = 0;
    return {
        update(snapshot) {
            const signature = snapshot ? JSON.stringify(snapshot) : '';
            if (signature === key) return;
            key = signature;
            const current = ++revision;
            show(null, snapshot ? '估算中…' : '暂无法估算');
            if (!snapshot) return;
            Promise.resolve().then(() => evaluate(snapshot)).catch(() => null).then(value => {
                if (current !== revision) return;
                if (!value) { show(null, '暂无法估算'); return; }
                const min = creditsFormat.format(value.min);
                const max = creditsFormat.format(value.max);
                show(min === max ? min : min + '–' + max);
            });
        },
        dispose() { revision++; },
    };
}
