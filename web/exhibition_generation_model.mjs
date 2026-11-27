import { getSelectedInputEntries } from './app_mode_bypass_model.mjs';
import { DEFAULT_COUNT, validGenerationCount } from './generation_ui_model.mjs';
import { integerInRange } from './model_access.mjs';

const NODE_TYPE = 'OpenAIGPTImageNodeV2';
export const EXHIBITION_PRESETS = [
    ['1024x1024', '1:1', '1K'], ['1024x1536', '2:3', '1K'], ['1536x1024', '3:2', '1K'],
    ['2048x2048', '1:1', '2K'], ['2048x1152', '16:9', '2K'], ['1152x2048', '9:16', '2K'],
    ['3840x2160', '16:9', '4K'], ['2160x3840', '9:16', '4K'],
].map(([size, ratio, tier]) => ({ size, ratio, tier }));
export const EXHIBITION_BUILD_WIDGETS = Object.freeze({
    model: 'model', size: 'model.size', width: 'model.custom_width',
    height: 'model.custom_height', quality: 'model.quality', count: 'n',
});
const DUPLICATED_FIELDS = ['size', 'quality', 'count'];

export function exhibitionMarker(graph) {
    return graph?.extra?.daelabExhibitionUiV1;
}

export function resolveExhibitionBuild(graph) {
    const marker = exhibitionMarker(graph);
    const binding = marker?.build;
    if (marker?.version !== 1 || !Number.isInteger(binding?.nodeId) || binding.type !== NODE_TYPE) {
        throw new Error('展厅生成绑定版本或节点类型不受支持。');
    }
    const node = graph.getNodeById(binding.nodeId);
    if (node?.type !== binding.type) throw new Error('找不到展厅初次生成节点 ' + binding.nodeId + '。');
    const entries = getSelectedInputEntries(graph);
    const widgets = {};
    for (const [key, name] of Object.entries(EXHIBITION_BUILD_WIDGETS)) {
        if (binding.widgets?.[key] !== name) throw new Error('展厅生成字段绑定无效：' + name);
        const matches = node.widgets?.filter(widget => widget.name === name) ?? [];
        if (matches.length !== 1) throw new Error('展厅生成字段缺失或重复：' + name);
        widgets[key] = matches[0];
    }
    const inputKeys = DUPLICATED_FIELDS.map(key => {
        const entry = entries.find(item => item.key === binding.inputKeys?.[key]);
        if (entry?.node !== node || entry.widgetName !== binding.widgets[key]) {
            throw new Error('展厅 App Mode 字段绑定无效：' + key);
        }
        return entry.key;
    });
    return { node, widgets, inputKeys };
}

export function storedExhibitionCount(workflow, { node, widgets }) {
    const saved = workflow?.nodes?.find(entry => String(entry.id) === String(node.id) && entry.type === node.type);
    if (!saved) return undefined;
    const name = widgets.count.name;
    const slot = saved.inputs?.filter(input => input.widget).findIndex(input => input.widget.name === name) ?? -1;
    if (slot >= 0 && Object.hasOwn(saved.widgets_values ?? [], slot)) return saved.widgets_values[slot];
    if (Object.hasOwn(saved.widgets_values_named ?? {}, name)) return saved.widgets_values_named[name];
    if (slot < 0) return saved.widgets_values?.[node.widgets.indexOf(widgets.count)];
}

export function readExhibitionBuild(widgets) {
    const config = Object.fromEntries(Object.entries(widgets).map(([key, widget]) => [key, widget.value]));
    if (config.count === undefined) config.count = DEFAULT_COUNT;
    return config;
}

export function exhibitionCapability(model) {
    if (!model) return undefined;
    const { size, quality, width, height, count, background } = model.parameters;
    return {
        model: model.provider, aliases: model.aliases, label: model.label,
        sizes: size.values, qualities: quality.values, width, height, count, background,
        defaultSize: size.default, defaultQuality: quality.default,
        dimensions: model.constraints.customDimensions,
    };
}

export function exhibitionModelPatch(config, capability) {
    const { model, sizes, qualities, width, height, defaultSize, defaultQuality } = capability;
    const next = {
        model,
        size: sizes.includes(config.size) ? config.size : defaultSize,
        quality: qualities.includes(config.quality) ? config.quality : defaultQuality,
        width: config.width,
        height: config.height,
    };
    if (next.size === 'Custom' && validateExhibitionDimensions(next, capability)) {
        next.width = width.default;
        next.height = height.default;
    }
    if (capability.count && !integerInRange(config.count, capability.count)) next.count = capability.count.default;
    return next;
}

export function exhibitionPreset(config, capability) {
    return EXHIBITION_PRESETS.find(preset => preset.size === config.size && capability?.sizes.includes(preset.size));
}

export function exhibitionDimension(config, key) {
    if (config.size === 'auto') return undefined;
    if (config.size === 'Custom') return config[key];
    return Number(config.size?.split('x')[key === 'width' ? 0 : 1]) || undefined;
}

export const EXHIBITION_COUNT_ERROR = '初次生成每批张数必须为 1–4 的整数。';

export function validateExhibitionBuild(config, capability) {
    if (!capability || config.model !== capability.model && !capability.aliases?.includes(config.model)) {
        return '展厅生成使用的模型未接线：' + String(config.model);
    }
    if (!capability.sizes.includes(config.size)) return '当前模型不支持尺寸：' + String(config.size);
    if (!capability.qualities.includes(config.quality)) return '当前模型不支持质量：' + String(config.quality);
    const dimensionError = validateExhibitionDimensions(config, capability);
    if (dimensionError) return dimensionError;
    if (!validGenerationCount(config.count)) return EXHIBITION_COUNT_ERROR;
    if (capability.count && !integerInRange(config.count, capability.count)) return '张数超出当前模型范围。';
    return '';
}

export function validateExhibitionDimensions(config, capability) {
    if (config.size === 'Custom') {
        if (!capability || !integerInRange(config.width, capability.width) || !integerInRange(config.height, capability.height)) {
            return '自定义宽高超出当前模型范围或步长。';
        }
        const { width, height } = config;
        const { maxAspect, minPixels, maxPixels } = capability.dimensions;
        if (Math.max(width, height) / Math.min(width, height) > maxAspect || width * height < minPixels || width * height > maxPixels) {
            return '自定义尺寸的长宽比或总像素超出模型范围。';
        }
    }
    return '';
}

export function verifyExhibitionPrompt(prompt, node, config, connections = [], independentLocalEdit = false) {
    const submitted = prompt?.output?.[String(node.id)];
    // Muted and bypassed nodes are removed by the host compiler.
    if (!submitted) return;
    if (submitted.class_type !== NODE_TYPE) throw new Error('展厅初次生成请求的节点类型已变更。');
    if (!validGenerationCount(submitted.inputs?.n)) throw new Error(EXHIBITION_COUNT_ERROR);
    if (independentLocalEdit) {
        if (prompt.output['1035'] || prompt.output['1058']) {
            throw new Error('展厅首轮生成包含旧版局部修改节点。');
        }
        const expectedInputs = new Set(connections.map(({ input }) => input.name));
        for (const name of Object.keys(submitted.inputs)) {
            if ((name.startsWith('model.images.') || name === 'model.mask') && !expectedInputs.has(name)) {
                throw new Error('展厅生成请求包含未启用的参考图或遮罩：' + name);
            }
        }
    }
    if (!config) return;
    const expected = { model: config.model, 'model.size': config.size, 'model.quality': config.quality, n: config.count };
    if (config.size === 'Custom') {
        expected['model.custom_width'] = config.width;
        expected['model.custom_height'] = config.height;
    }
    if (Object.entries(expected).some(([key, value]) => !Object.is(submitted.inputs[key], value))) {
        throw new Error('展厅生成请求与当前的模型输出配置不一致。');
    }
    for (const { input, link } of connections) {
        const source = submitted.inputs[input.name];
        if (!Array.isArray(source) || String(source[0]) !== String(link.origin_id) || source[1] !== link.origin_slot) {
            throw new Error('展厅生成请求的参考图连接发生变化：' + input.name);
        }
    }
}
