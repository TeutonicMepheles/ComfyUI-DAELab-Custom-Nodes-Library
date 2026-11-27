const requests = new WeakMap();
const lookup = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;

export function loadModelAccess(api, consumer, stage) {
    if (!requests.has(api)) requests.set(api, new Map());
    const cache = requests.get(api);
    const query = new URLSearchParams({ consumer, stage });
    if (!cache.has(query.toString())) {
        cache.set(query.toString(), (async () => {
            try {
                const response = await api.fetchApi('/daelab/cnl/model-access?' + query, { cache: 'no-store' });
                if (!response.ok) throw new Error();
                const data = await response.json();
                if (data.version !== 1 || data.consumer !== consumer || data.stage !== stage || !Array.isArray(data.models)) {
                    throw new Error();
                }
                return data;
            } catch {
                return { models: [], error: '无法读取工作流的模型接入配置，请检查 ComfyUI 并重新载入。' };
            }
        })());
    }
    return cache.get(query.toString());
}

export function findAccessModel(access, value) {
    value ??= access?.defaultModel;
    return access?.models.find(model => model.id === (lookup(access.aliases, value) ?? value));
}

export function accessModelReason(access, value) {
    if (!access) return '正在读取模型接入配置…';
    if (findAccessModel(access, value)) return '';
    if (value == null) return access.error || '此阶段没有可用模型。';
    const id = lookup(access.aliases, value) ?? value;
    return lookup(access.unavailable, id) || access.error || ('模型未登记：' + String(value));
}

export function integerInRange(value, { min, max, step = 1 }) {
    return Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0;
}

export function changedConfiguration(before, after, labels) {
    return Object.keys(labels).filter(key => !Object.is(before[key], after[key])).map(key => labels[key]);
}
