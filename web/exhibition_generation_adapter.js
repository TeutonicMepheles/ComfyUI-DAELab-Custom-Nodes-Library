import { app } from '/scripts/app.js';
import { api } from '/scripts/api.js';
import { REGION_KEY, BUILD_RESULTS_CHANGED, sourceRef } from './image_editing_model.mjs?v=20261119-local-edit';
import { syncBooleanGroupBypass } from './boolean_group_bypass_controller.js?v=20261119-local-edit';
import { resolveBooleanSource } from './boolean_group_bypass_controller_model.mjs?v=20261119-prompt-title';
import { syncBooleanHierarchyGets } from './boolean_list_hierarchy_get.js?v=20261119-local-edit';
import { findInspectorItem, getRootGraphSafely, getSelectedInputEntries, isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { findLiveOwnedWidget } from './dynamic_widget_lifecycle.mjs';
import { createGenerationConfigPanel } from './generation_config_panel.mjs?v=20261120-build-sections';
import { createExhibitionBuildPrompt, createExhibitionBuildWorkspace } from './exhibition_build_workspace.mjs?v=20261120-feature-row';
import { executionPriceInput, generationPriceEstimator } from './generation_price.mjs';
import { uploadBadgeImage } from './badge_image_upload.mjs';
import { BADGE_APP_PALETTE } from './badge_ui_styles.mjs';
import { accessModelReason, changedConfiguration, findAccessModel, loadModelAccess } from './model_access.mjs?v=20261119-model-matching';
import {
    INITIAL_COUNT_MAX, captureGenerationHistory, changeGenerationGraph, generationFold, generationLoadIdentity, normalizeCountDraft,
} from './generation_ui_model.mjs';
import {
    EXHIBITION_PRESETS, exhibitionCapability, exhibitionDimension, exhibitionMarker, exhibitionModelPatch,
    exhibitionPreset, readExhibitionBuild, resolveExhibitionBuild, storedExhibitionCount, validateExhibitionBuild,
    validateExhibitionDimensions, verifyExhibitionPrompt,
} from './exhibition_generation_model.mjs?v=20261119-local-edit';

// ComfyUI Frontend 1.59 and 1.53 expose stable graph-scoped keys on these App Mode items.
const ROOT = '[data-testid="linear-widgets"]';
const ITEM = '[data-testid="app-mode-widget-item"][data-widget-key]';
const RUN = 'div:has(> button > [data-testid="linear-run-button-icon"])';
const LEASE = 'data-cnl-exhibition-generation-leased';
const STAGES = [[1040, 'build'], [1035, 'description'], [1058, 'replacement']];
const stageAccess = new Map();
const savedModels = new WeakMap();

function preservedModel(node) {
    const saved = savedModels.get(node);
    if (saved && findLiveOwnedWidget(node, 'model')?.value === saved.fallback) return saved;
    savedModels.delete(node);
    return undefined;
}

function readConfig({ node, widgets }) {
    const config = readExhibitionBuild(widgets);
    config.model = preservedModel(node)?.value ?? config.model ?? findAccessModel(stageAccess.get('build'))?.provider;
    return config;
}

function capabilities(access) {
    const capability = config => exhibitionCapability(findAccessModel(access, config.model));
    const hasSize = (config, size) => capability(config)?.sizes.includes(size) ?? false;
    const available = (config, filters) => EXHIBITION_PRESETS.filter(preset =>
        hasSize(config, preset.size) && Object.entries(filters).every(([key, value]) => preset[key] === value));
    const selection = config => exhibitionPreset(config, capability(config));
    const specialSize = (size, label) => ({
        label, hidden: config => !hasSize(config, size), selected: config => config.size === size, patch: () => ({ size }),
    });
    return [
        { key: 'model', label: '模型', options: config => access.models.map(model =>
            [model === findAccessModel(access, config.model) ? config.model : model.provider, model.label]),
            source: key => findAccessModel(access, key)?.execution.route,
            patch: (config, key) => exhibitionModelPatch(config, exhibitionCapability(findAccessModel(access, key))) },
        { type: 'choices', kind: 'ratio', label: '选择比例', options: [
            specialSize('auto', '自动'),
            ...[...new Set(EXHIBITION_PRESETS.map(preset => preset.ratio))].map(ratio => ({
                label: ratio, aspect: ratio,
                hidden: config => !available(config, { ratio }).length,
                selected: config => selection(config)?.ratio === ratio,
                patch: config => {
                    const presets = available(config, { ratio });
                    return { size: (presets.find(preset => preset.tier === selection(config)?.tier) ?? presets[0]).size };
                },
            })),
            specialSize('Custom', '自定义'),
        ] },
        { type: 'choices', kind: 'tier', label: '分辨率与尺寸',
            hidden: config => !selection(config),
            options: ['1K', '2K', '4K'].map(tier => ({
                label: tier,
                hidden: config => !available(config, { tier, ratio: selection(config)?.ratio }).length,
                selected: config => selection(config)?.tier === tier,
                patch: config => ({ size: available(config, { tier, ratio: selection(config)?.ratio })[0].size }),
            })),
        },
        ...['width', 'height'].map(key => ({
            key, label: key === 'width' ? '宽' : '高', name: key === 'width' ? '宽度' : '高度',
            unit: 'px', type: 'number', limits: config => capability(config)?.[key],
            hidden: config => config.size === 'auto',
            display: config => exhibitionDimension(config, key), disabled: config => config.size !== 'Custom' || !capability(config),
            group: 'dimensions', validate: config => validateExhibitionDimensions(config, capability(config)),
        })),
        { key: 'quality', label: '质量', options: config => (capability(config)?.qualities ?? []).map(key =>
            [key, { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }[key] ?? key]) },
        { key: 'count', label: '张数', unit: '张', type: 'number', action: true,
            min: 1, max: INITIAL_COUNT_MAX, step: 1, tooltip: '每批 1–4 张',
            limits: config => capability(config)?.count,
            normalize: (value, config) => normalizeCountDraft(value, capability(config)?.count.max ?? INITIAL_COUNT_MAX) },
    ];
}

function writeField(node, name, value) {
    const widget = findLiveOwnedWidget(node, name);
    if (!widget) throw new Error('展厅生成字段已失效：' + name);
    widget.value = value;
    widget.callback?.(value, app.canvas, node);
    node.graph?.change?.();
}

function restoreNativeModel(node, provider, values) {
    writeField(node, 'model', provider);
    for (const [name, value] of Object.entries(values)) {
        if (name !== 'model' && value !== undefined && findLiveOwnedWidget(node, name)) writeField(node, name, value);
    }
}

function restoreSavedModel(node, workflow, stage) {
    const saved = workflow.nodes?.find(entry => String(entry.id) === String(node.id));
    const widget = findLiveOwnedWidget(node, 'model');
    if (!saved || !widget) return;
    const names = saved.inputs?.flatMap(input => input.widget ? [input.widget.name] : []) ?? [];
    const fromSlots = Object.fromEntries(names.flatMap((name, index) => Object.hasOwn(saved.widgets_values ?? [], index)
        ? [[name, saved.widgets_values[index]]] : []));
    const values = { ...saved.widgets_values_named, ...fromSlots };
    const value = fromSlots.model ?? saved.widgets_values_named?.model ?? saved.widgets_values?.[node.widgets.indexOf(widget)];
    const options = widget.options?.values;
    if (!Array.isArray(options)) return;
    const access = stageAccess.get(stage);
    if (value == null && stage === 'build') {
        const graph = node.graph;
        const original = widget.value;
        const useDefault = data => {
            const provider = findAccessModel(data)?.provider;
            if (!options.includes(provider) || graph?.getNodeById(node.id) !== node ||
                findLiveOwnedWidget(node, 'model')?.value !== original) return false;
            restoreNativeModel(node, provider, values);
            return true;
        };
        if (access) useDefault(access);
        else void loadModelAccess(api, 'exhibition', stage).then(data => {
            if (useDefault(data)) restoreImageConnections(graph, node, savedImageConnections(workflow, node.id));
        }).catch(error => imageRestoreErrors.set(graph, error));
        return;
    }
    if (typeof value !== 'string' || options.includes(value)) return;
    const provider = (findAccessModel(access, value) ?? findAccessModel(access))?.provider;
    const fallback = options.includes(provider) ? provider : options[0];
    if (!fallback) return;

    // LiteGraph removes all dependent widgets when a saved DynamicCombo key
    // is absent. Use a known native layout for editing, keeping the saved key
    // for display, serialization and compilation until an explicit selection.
    restoreNativeModel(node, fallback, values);
    savedModels.set(node, { value, fallback });
    const callback = widget.callback;
    widget.callback = function (...args) {
        savedModels.delete(node);
        return callback?.apply(this, args);
    };
    const serialize = node.onSerialize;
    node.onSerialize = function (data) {
        serialize?.call(this, data);
        const original = preservedModel(node);
        if (!original) return;
        if (Array.isArray(data.widgets_values)) data.widgets_values[node.widgets.indexOf(widget)] = original.value;
        if (data.widgets_values_named && Object.hasOwn(data.widgets_values_named, 'model')) {
            data.widgets_values_named.model = original.value;
        }
    };
}

function dynamicImageInput(name) {
    return /^model\.images\.image_\d+$/.test(name) || name === 'model.mask';
}

function imageConnections(node, links) {
    return node.inputs.filter(input => dynamicImageInput(input.name) && input.link != null)
        .map(input => ({ input, link: links.get(input.link) }))
        .filter(({ input, link }) => link?.type === input.type);
}

function savedImageConnections(workflow, nodeId) {
    const node = workflow.nodes?.find(item => String(item.id) === String(nodeId));
    if (!node?.inputs) return [];
    const links = new Map((Array.isArray(workflow.links) ? workflow.links : []).map(entry => {
        if (!Array.isArray(entry)) return [entry.id, entry];
        const [id, origin_id, origin_slot, target_id, target_slot, type] = entry;
        return [id, { id, origin_id, origin_slot, target_id, target_slot, type }];
    }));
    return imageConnections(node, links);
}

function restoreImageConnections(graph, node, connections) {
    // The host's DynamicCombo can rebuild an AutoGrow input while loading or
    // changing the model. LiteGraph links store target indices, so restore the
    // affected edges by port name instead of trusting their former indices.
    for (const { input, link } of connections) {
        const target = node.inputs.find(item => item.name === input.name);
        const current = graph.links.get(target?.link);
        if (current?.type === input.type && String(current.origin_id) === String(link.origin_id) &&
            current.origin_slot === link.origin_slot &&
            graph.getNodeById(current.origin_id)?.outputs[current.origin_slot]?.links?.includes(current.id)) continue;
        for (const item of [...node.inputs]) {
            const misplaced = graph.links.get(item.link);
            if (dynamicImageInput(item.name) && (item.name === input.name || misplaced?.type !== item.type) &&
                misplaced && String(misplaced.origin_id) === String(link.origin_id) && misplaced.origin_slot === link.origin_slot) {
                graph.removeLink(misplaced.id);
            }
        }
        if (!node.inputs.some(item => item.name === input.name)) {
            node.addInput(input.name, input.type, { shape: input.shape, localized_name: input.localized_name });
        }
        const index = node.inputs.findIndex(item => item.name === input.name);
        const origin = graph.getNodeById(link.origin_id);
        if (!origin?.connect(link.origin_slot, node, index)) {
            throw new Error('展厅参考图端口恢复失败：' + input.name);
        }
    }
}

function writeConfig(graph, binding, next, model) {
    const { node, widgets } = binding;
    const saved = preservedModel(node);
    const before = readConfig(binding);
    const modelChanged = next.model !== before.model;
    const keys = Object.keys(before).filter(key => modelChanged || !Object.is(before[key], next[key]));
    if (!keys.length) return before;
    const imageLinks = modelChanged ? imageConnections(node, graph.links) : [];
    const background = findLiveOwnedWidget(node, 'model.background')?.value;
    const write = (config, backgroundValue) => {
        for (const key of keys) writeField(node, widgets[key].name, config[key]);
        if (modelChanged) {
            const field = findLiveOwnedWidget(node, 'model.background');
            if (field?.options?.values?.includes(backgroundValue) && field.value !== backgroundValue) {
                writeField(node, field.name, backgroundValue);
            }
            restoreImageConnections(graph, node, imageLinks);
        }
    };
    return changeGenerationGraph(graph, () => {
        try {
            const candidate = model?.parameters.background;
            write(next, candidate && !candidate.values.includes(background) ? candidate.default : background);
            const current = resolveExhibitionBuild(graph);
            const after = readConfig(current);
            if (current.node !== node || keys.some(key => !Object.is(next[key], after[key]))) {
                throw new Error('展厅生成参数在宿主更新时发生变化。');
            }
            return after;
        } catch (error) {
            write(saved ? { ...before, model: saved.fallback } : before, background);
            if (saved) savedModels.set(node, saved);
            throw error;
        }
    }, () => captureGenerationHistory(app, graph));
}

function restoreBusinessInputs(graph, byKey) {
    const keys = exhibitionMarker(graph).sections?.businessInputKeys;
    if (!Array.isArray(keys)) return;
    for (const { key, node, widgetName } of getSelectedInputEntries(graph)) {
        if (!keys.includes(key) || !isNodeAvailableInAppMode(node)) continue;
        const item = findInspectorItem(byKey, key, graph.id);
        if (!item) continue;
        if (widgetName === 'boolean_hierarchy_editor' && node.type === 'BooleanListHierarchy') {
            node.daelabRestoreHierarchyAppMode?.(item);
        }
        if (widgetName === 'style_thumbnail_dom_selector' && node.type === 'SeedreamExhibitionPromptBuilder') {
            node.daelabRestorePromptPresetAppMode?.(item);
        }
    }
}

function promptBinding(graph) {
    const key = exhibitionMarker(graph).sections?.businessInputKeys?.find(key => key.endsWith(':790:base_prompt'));
    const entry = getSelectedInputEntries(graph).find(entry => entry.key === key);
    if (entry?.node?.type === 'SeedreamExhibitionPromptBuilder') return entry;
}

function basePromptRequired(node) {
    const source = resolveBooleanSource(node, 'use_theme_template');
    if (source.ok) return isNodeAvailableInAppMode(source.sourceNode) && !source.value;
    return source.code === 'unconnected' && findLiveOwnedWidget(node, 'use_theme_template')?.value === false;
}

function lease(element, elements) {
    if (element && !elements.has(element)) {
        elements.add(element);
        element.setAttribute(LEASE, '');
    }
}

const imageRestoreErrors = new WeakMap();
let loadingWorkflow;
app.registerExtension({
    name: 'DAELab.ExhibitionGenerationUI',
    beforeConfigureGraph(workflow) {
        loadingWorkflow = exhibitionMarker(workflow) ? workflow : undefined;
    },
    afterConfigureGraph() {
        const saved = loadingWorkflow;
        loadingWorkflow = undefined;
        if (!saved) return;
        try {
            const graph = app.rootGraph;
            imageRestoreErrors.delete(graph);
            try {
                for (const [id, stage] of STAGES) {
                    const node = graph.getNodeById(id);
                    if (node?.type === 'OpenAIGPTImageNodeV2') {
                        restoreSavedModel(node, saved, stage);
                        restoreImageConnections(graph, node, savedImageConnections(saved, id));
                    }
                }
            } catch (error) {
                imageRestoreErrors.set(graph, error);
            }
            const binding = resolveExhibitionBuild(graph);
            const raw = storedExhibitionCount(saved, binding);
            // LiteGraph can coerce serialized number strings during configure.
            // Keep an invalid legacy value visible until the user edits it.
            if (raw !== undefined && !Object.is(raw, binding.widgets.count.value)) binding.widgets.count.value = raw;
        } catch {
            // The mounted panel and prompt boundary report invalid bindings.
        }
    },
    setup() {
        let access, current, workspace, scheduled, submitting;
        const compiledPrompts = new WeakMap(), sessions = new WeakMap(), queued = new Map();
        function session(graph, epoch) {
            if (sessions.get(graph)?.epoch !== epoch) sessions.set(graph, { epoch });
            return sessions.get(graph);
        }

        function finish(type, detail) {
            const id = detail?.prompt_id;
            const job = queued.get(id);
            if (!job) {
                if (id && submitting) submitting.completed.set(id, { type, detail });
                return;
            }
            queued.delete(id);
            job.state.promptId = undefined;
            job.state.error = type === 'execution_success' ? '' : detail.exception_message || '展厅生成已停止。';
            schedule();
        }
        for (const type of ['execution_success', 'execution_error', 'execution_interrupted']) {
            api.addEventListener(type, event => finish(type, event.detail));
        }

        function rememberBuildResults(job, images) {
            const { graph, epoch } = job;
            if (getRootGraphSafely(app) !== graph || generationLoadIdentity(graph) !== epoch ||
                !exhibitionMarker(graph)?.build?.independentLocalEdit) return;
            const marker = graph.extra?.[REGION_KEY];
            const results = (images ?? []).map(sourceRef).filter(Boolean);
            if (!marker || !results.length) return;
            changeGenerationGraph(graph, () => { marker.buildResults = results; },
                () => captureGenerationHistory(app, graph));
            globalThis.dispatchEvent(new CustomEvent(BUILD_RESULTS_CHANGED,{detail:graph}));
        }

        api.addEventListener('executed', ({detail}) => {
            const id = detail?.prompt_id;
            if (!id || String(detail.display_node ?? detail.node) !== '1067') return;
            const images = detail.output?.images;
            if (!Array.isArray(images) || !images.length) return;
            const job = queued.get(id);
            if (job) rememberBuildResults(job, images);
            else submitting?.outputs.set(id, images);
        });

        function assertCurrent(graph, epoch) {
            if (getRootGraphSafely(app) !== graph || generationLoadIdentity(graph) !== epoch) {
                throw new Error('当前工作流已切换，展厅生成已取消。');
            }
        }

        const style = document.createElement('style');
        style.textContent = '[' + LEASE + ']{ display:none !important; }';
        document.head.append(style);
        const workspaceStyle = document.createElement('link');
        workspaceStyle.rel = 'stylesheet';
        workspaceStyle.href = new URL('./exhibition_build_workspace.css?v=20261120-feature-row-compact', import.meta.url).href;
        document.head.append(workspaceStyle);
        for (const [, stage] of STAGES) {
            void loadModelAccess(api, 'exhibition', stage).then(data => {
                stageAccess.set(stage, data);
                if (stage === 'build') access = data;
                schedule();
            });
        }
        const validate = config => accessModelReason(access, config.model) ||
            validateExhibitionBuild(config, exhibitionCapability(findAccessModel(access, config.model)));

        const compile = app.graphToPrompt;
        app.graphToPrompt = async function (graph = this.rootGraph, ...args) {
            const job = submitting;
            if (job && graph !== job.graph) throw new Error('当前工作流已切换，展厅生成已取消。');
            if (!exhibitionMarker(graph)) return compile.apply(this, arguments);
            const epoch = generationLoadIdentity(graph);
            assertCurrent(graph, epoch);
            const { node, widgets } = resolveExhibitionBuild(graph);
            const config = readConfig({ node, widgets });
            if (job && (job.epoch !== epoch || !isNodeAvailableInAppMode(node))) {
                throw new Error('展厅初次生成节点已切换或停用。');
            }
            if (job) {
                const imageError = imageRestoreErrors.get(graph);
                if (imageError) throw imageError;
                const error = validate(config);
                if (error) throw new Error(error);
            }
            const independent = exhibitionMarker(graph).build.independentLocalEdit === true;
            if (independent) {
                // Virtual node modes normally follow the hierarchy on a timer.
                syncBooleanHierarchyGets(graph);
                syncBooleanGroupBypass(graph);
            }
            const images = imageConnections(node, graph.links).filter(({ input, link }) =>
                !independent || (input.name !== 'model.mask' && isNodeAvailableInAppMode(graph.getNodeById(link.origin_id))));
            const prompt = await compile.call(this, graph, ...args);
            assertCurrent(graph, epoch);
            for (const [id, stage] of STAGES) {
                const inputs = prompt.output?.[String(id)]?.inputs;
                if (!inputs) continue;
                const value = preservedModel(graph.getNodeById(id))?.value ?? inputs.model;
                inputs.model = findAccessModel(stageAccess.get(stage), value)?.provider ?? value;
            }
            if (job) {
                const model = findAccessModel(access, config.model);
                verifyExhibitionPrompt(prompt, node, { ...config, model: model.provider }, images, independent);
            }
            if (job && !prompt.output?.[String(node.id)]) throw new Error('初次生成节点未进入本次提示词。');
            compiledPrompts.set(prompt, { graph, epoch, job });
            return prompt;
        };

        const sendPrompt = api.queuePrompt;
        api.queuePrompt = async function (number, prompt, options) {
            const context = compiledPrompts.get(prompt);
            if (context) assertCurrent(context.graph, context.epoch);
            try {
                const result = await sendPrompt.call(this, number, prompt, options);
                const job = context?.job;
                if (job && result?.prompt_id) {
                    job.state.promptId = result.prompt_id;
                    job.receipt = result;
                    queued.set(result.prompt_id, job);
                    if (job.outputs.has(result.prompt_id)) rememberBuildResults(job, job.outputs.get(result.prompt_id));
                    const early = job.completed.get(result.prompt_id);
                    if (early) finish(early.type, early.detail);
                    schedule();
                }
                return result;
            } catch (error) {
                if (context?.job) context.job.failure = error;
                throw error;
            }
        };

        function unmount() {
            if (!current) return;
            current.prompt?.dispose();
            current.panel?.dispose();
            for (const item of current.leases) item.removeAttribute(LEASE);
            current.notice?.remove();
            current = undefined;
        }

        function mount(graph, root, epoch, binding, entry) {
            const instance = { graph, root, epoch, node: binding.node, promptNode: entry?.node, leases: new Set() };
            const mounted = () => current === instance && getRootGraphSafely(app) === graph &&
                generationLoadIdentity(graph) === epoch && instance.panel.element.isConnected &&
                !root.hasAttribute('data-cnl-image-stage');
            const active = () => mounted() && graph.getNodeById(instance.node.id) === instance.node &&
                isNodeAvailableInAppMode(instance.node);
            if (entry) {
                instance.prompt = createExhibitionBuildPrompt(value => {
                    if (!mounted() || !isNodeAvailableInAppMode(entry.node) || graph.getNodeById(entry.node.id) !== entry.node) return;
                    changeGenerationGraph(graph, () => writeField(entry.node, entry.widgetName, value),
                        () => captureGenerationHistory(app, graph));
                });
            }
            const panel = createGenerationConfigPanel({
                instanceId: epoch,
                stage: 'build',
                labels: { heading: '模型输出配置', generate: '生成', busy: '生成中…' },
                capabilities: capabilities(access),
                config: readConfig(binding),
                fold: !instance.prompt && generationFold(graph, 'exhibition.build', () => captureGenerationHistory(app, graph)),
                prompt: instance.prompt,
                sizeSummary(config) {
                    if (config.size === 'auto') return '自动比例';
                    if (config.size === 'Custom') return config.width + ' × ' + config.height + ' px';
                    const preset = exhibitionPreset(config, exhibitionCapability(findAccessModel(access, config.model)));
                    return preset ? preset.ratio + ' · ' + preset.tier : config.size;
                },
                pricing: {
                    evaluate: generationPriceEstimator(api),
                    snapshot(config) {
                        if (!active() || imageRestoreErrors.has(graph) || validate(config)) return null;
                        const model = findAccessModel(access, config.model);
                        const group = model.execution.inputs.references + '.';
                        const references = imageConnections(binding.node, graph.links).filter(({ input }) =>
                            input.name.startsWith(group)).length;
                        return executionPriceInput(model, {
                            ...config, background: findLiveOwnedWidget(binding.node, 'model.background')?.value,
                        }, references);
                    },
                },
                onChange(next) {
                    if (!active()) throw new Error('展厅初次生成节点不可用。');
                    const liveBinding = resolveExhibitionBuild(graph);
                    const before = readConfig(liveBinding);
                    const switching = next.model !== before.model;
                    const model = switching ? findAccessModel(access, next.model) : undefined;
                    const background = () => findLiveOwnedWidget(binding.node, 'model.background')?.value;
                    const oldBackground = background();
                    const result = writeConfig(graph, liveBinding, next, model);
                    const changed = switching ? changedConfiguration({ ...before, background: oldBackground },
                        { ...result, background: background() },
                        { size: '尺寸', width: '宽度', height: '高度', quality: '质量', count: '张数', background: '背景' }) : [];
                    instance.adjustment = changed.length ? '已调整' + changed.join('、') + '。' : '';
                    return result;
                },
                async onGenerate(snapshot) {
                    if (!active()) throw new Error('当前工作流已切换。');
                    const promptWidget = entry && isNodeAvailableInAppMode(entry.node) &&
                        findLiveOwnedWidget(entry.node, entry.widgetName);
                    if (promptWidget && basePromptRequired(entry.node) && !String(promptWidget.value ?? '').trim()) {
                        schedule();
                        return;
                    }
                    const config = readConfig(resolveExhibitionBuild(graph));
                    if (Object.keys(snapshot).some(key => !Object.is(snapshot[key], config[key]))) {
                        throw new Error('展厅生成参数已变化，请重新提交。');
                    }
                    const error = validate(config);
                    if (error) throw new Error(error);
                    const state = session(graph, epoch);
                    if (state.promptId || submitting || app.processingQueue) throw new Error('已有提交正在处理。');
                    const job = { graph, epoch, state, completed: new Map(), outputs: new Map() };
                    state.error = '';
                    submitting = job;
                    try {
                        await app.queuePrompt(0, 1);
                        if (!job.receipt) {
                            const reason = job.failure?.response?.error?.message ?? job.failure?.error?.message ?? job.failure?.message;
                            throw new Error(reason || '展厅生成未入队，请检查登录状态后重试。');
                        }
                        return job.receipt;
                    } finally {
                        submitting = undefined;
                        schedule();
                    }
                },
            });
            instance.panel = panel;
            return instance;
        }

        function releaseWorkspace() {
            workspace?.observer.disconnect();
            workspace?.view.dispose();
            workspace = undefined;
        }

        function syncWorkspace(graph, root, epoch, byKey) {
            const key = exhibitionMarker(graph).sections?.businessInputKeys?.find(
                key => key.endsWith(':boolean_hierarchy_editor'),
            );
            const node = key && graph.getNodeById(key.split(':').at(-2));
            const hierarchy = node?.daelabBooleanHierarchyV1;
            const hierarchyRow = key && findInspectorItem(byKey, key, graph.id);
            if (!hierarchy || !isNodeAvailableInAppMode(node) || root.hasAttribute('data-cnl-image-stage')) {
                releaseWorkspace();
                return;
            }
            if (workspace && (workspace.root !== root || workspace.graph !== graph ||
                workspace.epoch !== epoch || workspace.hierarchy !== hierarchy)) releaseWorkspace();
            if (!workspace) {
                // The graph owns the hierarchy. Its native App Mode row is optional.
                const view = createExhibitionBuildWorkspace({
                    graph, root, hierarchy, palette: BADGE_APP_PALETTE, imageURL: path => api.apiURL(path),
                    captureHistory: () => captureGenerationHistory(app, graph),
                    live: () => getRootGraphSafely(app) === graph && generationLoadIdentity(graph) === epoch &&
                        !root.hasAttribute('data-cnl-image-stage'),
                    uploadImage: blob => uploadBadgeImage(api, blob),
                    setReferenceImage(value) {
                        const node = graph.getNodeById(674);
                        const values = findLiveOwnedWidget(node, 'image')?.options?.values;
                        changeGenerationGraph(graph, () => {
                            if (Array.isArray(values) && !values.includes(value)) values.push(value);
                            writeField(node, 'image', value);
                        }, () => captureGenerationHistory(app, graph));
                    },
                });
                if (!view) return;
                const observer = new MutationObserver(schedule);
                observer.observe(root, { childList: true });
                workspace = { graph, root, epoch, hierarchy, observer, view };
            }
            if (!workspace.view.update(byKey, hierarchyRow)) releaseWorkspace();
        }

        function sync() {
            const graph = getRootGraphSafely(app);
            const root = document.querySelector(ROOT);
            if (!exhibitionMarker(graph) || app.configuringGraph) { releaseWorkspace(); unmount(); return; }
            if (!root || root.hasAttribute('data-cnl-image-stage')) {
                releaseWorkspace();
                unmount();
                return;
            }
            const epoch = generationLoadIdentity(graph);
            const byKey = new Map([...root.querySelectorAll(ITEM)].map(item => [item.dataset.widgetKey, item]));
            if (current && (current.root !== root || current.graph !== graph || current.epoch !== epoch)) unmount();
            try {
                syncWorkspace(graph, root, epoch, byKey);
                if (!access) return;
                const binding = resolveExhibitionBuild(graph);
                const { node, inputKeys } = binding;
                restoreBusinessInputs(graph, byKey);
                const items = inputKeys.map(key => findInspectorItem(byKey, key, graph.id));
                const enabled = isNodeAvailableInAppMode(node);
                const entry = promptBinding(graph);
                const promptWidget = entry && findLiveOwnedWidget(entry.node, entry.widgetName);
                const promptVisible = Boolean(promptWidget && isNodeAvailableInAppMode(entry.node));
                if (current?.panel && (current.node !== node || current.promptNode !== entry?.node)) unmount();
                if (current?.notice) unmount();
                if (!current && (enabled || promptVisible || items.some(Boolean))) current = mount(graph, root, epoch, binding, entry);
                if (!current) return;
                if (current.panel.element.parentElement !== root) {
                    const anchor = items.find(item => item?.parentElement === root);
                    if (anchor) anchor.before(current.panel.element);
                    else root.append(current.panel.element);
                }
                for (const item of current.leases) if (!item.isConnected) current.leases.delete(item);
                for (const item of items) lease(item, current.leases);
                if (current.prompt && promptWidget) lease(findInspectorItem(byKey, entry.key, graph.id), current.leases);
                lease(document.querySelector(RUN), current.leases);
                current.prompt?.update(promptWidget, promptVisible);
                current.panel.element.hidden = !enabled && !promptVisible;
                const state = session(graph, epoch);
                current.panel.update(readConfig(binding), {
                    disabled: !enabled, settingsHidden: !enabled, busy: Boolean(state.promptId),
                    promptRequired: enabled && promptVisible && basePromptRequired(entry.node),
                    message: state.promptId ? '已提交，等待结果…' : current.prompt ? '' : current.adjustment,
                    settingsMessage: current.adjustment, failure: state.error,
                    validate: config => imageRestoreErrors.get(graph)?.message || validate(config),
                });
            } catch (error) {
                if (current?.notice?.parentElement === root && current.notice.textContent === error.message) return;
                unmount();
                const notice = document.createElement('p');
                notice.className = 'cnl-generation-ui';
                notice.setAttribute('role', 'status');
                notice.textContent = error.message;
                root.prepend(notice);
                current = { graph, root, epoch, notice, leases: new Set() };
            }
        }

        function schedule() {
            if (scheduled) return;
            scheduled = requestAnimationFrame(() => { scheduled = undefined; sync(); });
        }
        globalThis.addEventListener('daelab:app-mode-synced', schedule);
        // Some native widgets mutate their values without a graph event.
        setInterval(schedule, 250);
        schedule();
    },
});
