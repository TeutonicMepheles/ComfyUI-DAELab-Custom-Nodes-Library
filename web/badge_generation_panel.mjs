import { badgeText } from './badge_ui_text.mjs?v=20260917-dimensions-2';
import { refinedBadge87 } from './badge_refinement_87.mjs?v=20261119-model-matching';
import { RATIOS, badgeBuildPriceParameters, badgeExecutionSize, classifyPresets, generationPresets87, isPromptOnlyBuild, readGenerationConfig, editDimension, validateDimensions } from './badge_generation_model.mjs?v=20261119-build-menu';
import { createGenerationConfigPanel } from './generation_config_panel.mjs?v=20261119-badge-build-sections';
import { requestForStage } from './badge_execution_87_model.mjs?v=20261119-model-matching';
import { executionPriceInput, generationPriceEstimator } from './generation_price.mjs';
import { accessModelReason, changedConfiguration, findAccessModel, integerInRange } from './model_access.mjs?v=20261119-model-matching';
import {
    DEFAULT_COUNT, INITIAL_COUNT_MAX, LEGACY_COUNT_MAX, changeGenerationGraph,
    generationFold, generationLoadIdentity, normalizeCountDraft, validGenerationCount,
} from './generation_ui_model.mjs';

const text = number => badgeText('generation_panel.text_' + String(number).padStart(3, '0'));

export function createGenerationPanel(graph, stage, { onGenerate, onChange, live, captureHistory, prompt, settingsExtra, api }) {
    const refined = refinedBadge87(graph);
    const inherit = refined && stage === 'local';
    const countMax = stage === 'build' ? INITIAL_COUNT_MAX : LEGACY_COUNT_MAX;
    const visibleMessage = message => prompt && message === badgeText('generation_model.text_009') ? '' : message;
    const executable = graph.extra?.daelabBadgeExecutionV1?.version === 1;
    const getPresets = refined ? generationPresets87 : classifyPresets;
    let access, adjustment = '';
    const storedQuality = config => config.quality ?? (graph.extra?.daelabBadgeExecutionV1?.quality || 'low');
    const read = () => {
        const config = readGenerationConfig(graph, stage);
        return { count: DEFAULT_COUNT, ...config, model: config.model ?? access?.defaultModel,
            ...(prompt && { quality: storedQuality(config) }) };
    };
    const effective = config => findAccessModel(access, config.model);
    const limits = config => effective(config)?.parameters;
    const capabilityError = (config, model) => {
        if (!model) return '';
        const params = model.parameters;
        const size = badgeExecutionSize(config.width, config.height, params.size.values);
        if (!params.size.values.includes(size)) return '当前模型不支持保存的尺寸。';
        if (size === 'Custom' && (!integerInRange(config.width, params.width) || !integerInRange(config.height, params.height))) {
            return '自定义宽高超出当前模型范围或步长。';
        }
        if (size === 'Custom' && model.constraints?.customDimensions) {
            const { width, height } = config;
            const { maxAspect, minPixels, maxPixels } = model.constraints.customDimensions;
            if (Math.max(width, height) > maxAspect * Math.min(width, height) ||
                width * height < minPixels || width * height > maxPixels) return '自定义尺寸超出当前模型范围。';
        }
        return '';
    };
    const presets = config => {
        const params = limits(config);
        return getPresets(params?.size.values).filter(preset => !params || preset.size !== 'Custom' ||
            params.size.values.includes('Custom') && integerInRange(preset.width, params.width) && integerInRange(preset.height, params.height));
    };
    const choose = (config, ratio, tier, fallback = false) =>
        presets(config).find(p => p.ratio === ratio && p.tier === tier) ||
        (fallback ? presets(config).find(p => p.ratio === ratio) : null);
    const capabilities = [];
    if (refined) capabilities.push({
        key: 'model', label: text(2), external: inherit,
        options: config => (access?.models ?? []).map(model => [model === effective(config) ? config.model : model.id, model.label]),
        source: prompt ? key => findAccessModel(access, key)?.execution.route : undefined,
        patch(config, model) {
            const selected = findAccessModel(access, model);
            if (!selected) return {};
            const params = selected.parameters;
            const next = { ...config, model };
            if (!integerInRange(next.count, params.count)) next.count = params.count.default;
            if (!params.quality.values.includes(storedQuality(config))) next.quality = params.quality.default;
            const size = next.custom || next.size === 'Custom' ? 'Custom' : next.width + 'x' + next.height;
            if (!inherit && (prompt ? capabilityError(next, selected) : !params.size.values.includes(size) ||
                size === 'Custom' && (!integerInRange(next.width, params.width) || !integerInRange(next.height, params.height)))) {
                const preset = presets(next).find(p => p.size === params.size.default) ?? presets(next)[0];
                if (preset) Object.assign(next, preset, { custom: false });
                else Object.assign(next, { size: 'Custom', custom: true, width: params.width.default, height: params.height.default });
            }
            const fields = changedConfiguration(config, next, { width: '宽度', height: '高度', custom: '尺寸', count: '张数', quality: '质量' });
            adjustment = fields.length ? '已调整' + fields.join('、') + '。' : '';
            return next;
        },
    });
    if (!inherit) {
        capabilities.push(
            { type: 'choices', kind: 'ratio', label: text(3), options: [
                ...RATIOS.map(ratio => ({
                    label: ratio, aspect: ratio,
                    hidden: c => !presets(c).some(p => p.ratio === ratio),
                    selected: c => !c.custom && c.ratio === ratio,
                    patch: c => ({ ...choose(c, ratio, c.tier, true), custom: false }),
                })),
                { label: text(5), hidden: c => !!limits(c) && !limits(c).size.values.includes('Custom'),
                    selected: c => c.custom, patch: () => ({ custom: true, locked: false }) },
            ] },
            { type: 'choices', kind: 'tier', label: text(6), options: ['1K', '2K'].map(tier => ({
                label: tier, disabled: c => c.custom || !choose(c, c.ratio, tier),
                selected: c => !c.custom && c.tier === tier,
                patch: c => ({ ...choose(c, c.ratio, tier), custom: false }),
            })) },
            ...[['width', '宽', 7], ['height', '高', 8]].map(([key, label, name]) => ({
                key, label, name: text(name), unit: 'px', type: 'number', min: 16, max: 3840, step: 16,
                limits: c => limits(c)?.[key],
                tooltip: text(9), disabled: c => !c.custom,
                group: 'dimensions', validate: validateDimensions,
                patch: (c, value) => editDimension({ ...c, locked: false }, key, value),
            })),
        );
        if (executable) capabilities.push({
            key: 'count', label: text(11), unit: '张', type: 'number', action: true,
            min: 1, max: countMax, step: 1, tooltip: '每批 1–' + countMax + ' 张',
            limits: c => limits(c)?.count,
            normalize: (value, config) => normalizeCountDraft(value, limits(config)?.count.max ?? countMax),
        });
    }
    if (prompt) {
        const qualityLabels = { low: '低', medium: '中', high: '高' };
        capabilities.push({ key: 'quality', label: '质量', options: config =>
            (limits(config)?.quality.values ?? []).map(value => [value, qualityLabels[value] ?? value]) });
    }
    const panel = createGenerationConfigPanel({
        instanceId: generationLoadIdentity(graph),
        stage, labels: { heading: text(1), generate: text(24), busy: text(23) },
        capabilities, config: read(),
        fold: !prompt && !inherit && generationFold(graph, 'badge.' + stage, captureHistory),
        prompt, settingsExtra,
        sizeSummary: c => c.custom ? c.width + ' × ' + c.height + ' px' : [c.ratio, c.tier].filter(Boolean).join(' · '),
        modeSummary: () => isPromptOnlyBuild(graph) ? '纯提示词' : '参考图',
        pricing: prompt && {
            evaluate: generationPriceEstimator(api),
            snapshot(config) {
                const model = effective(config);
                if (!live() || !model || capabilityError(config, model) ||
                    !model.parameters.quality.values.includes(storedQuality(config)) ||
                    !integerInRange(config.count, model.parameters.count)) return null;
                try {
                    const { request } = requestForStage(graph, 'build');
                    const { parameters, references } = badgeBuildPriceParameters(request, model.parameters.size.values);
                    return executionPriceInput(model, parameters, references);
                } catch {
                    return null;
                }
            },
        },
        onChange(next) {
            if (!live()) throw new Error('当前工作流已切换。');
            if (next.model === read().model) adjustment = '';
            changeGenerationGraph(graph, () => {
                const meta = graph.extra.daelabBadgePrototypeV1;
                const stored = { ...next };
                const previous = readGenerationConfig(graph, stage);
                if (previous.model == null && stored.model === access?.defaultModel) {
                    delete stored.model;
                }
                if (prompt && previous.quality == null && stored.quality === storedQuality(previous)) delete stored.quality;
                (meta.generation ??= {})[stage] = stored;
            }, captureHistory);
            onChange?.();
            return read();
        },
        onGenerate() { if (live()) return onGenerate(); },
    });
    if (inherit) {
        panel.element.querySelector('.cnl-generation-heading').hidden = true;
        panel.element.removeAttribute('aria-labelledby');
        panel.element.setAttribute('aria-label', text(24));
    }
    return {
        ...panel,
        setAccess(value) { access = value; panel.update(read()); },
        update({ busy = false, error = '', message = '', failure = '', disabled = false, settingsHidden = false } = {}) {
            const config = read();
            const display = {
                busy, error: visibleMessage(error), failure: visibleMessage(failure), disabled, settingsHidden,
                promptRequired: Boolean(prompt && isPromptOnlyBuild(graph)),
                message: busy ? (executable ? text(25) : text(26)) : (prompt ? visibleMessage(message) : adjustment || message),
                settingsMessage: prompt && !busy ? adjustment : '',
                validate: value => validateDimensions(value) || (
                    executable && !validGenerationCount(value.count, countMax)
                        ? stage === 'build' ? badgeText('generation_ui.build_count') : badgeText('execution_87_model.text_003')
                        : ''
                ) || (executable ? accessModelReason(access, value.model) : '') ||
                    (limits(value) && !integerInRange(value.count, limits(value).count) ? '张数超出当前模型范围。' : '') ||
                    (limits(value) && !limits(value).quality.values.includes(storedQuality(value)) ? '当前模型不支持保存的质量。' : '') ||
                    (prompt ? capabilityError(value, effective(value)) : ''),
            };
            panel.update(config, display);
        },
    };
}
