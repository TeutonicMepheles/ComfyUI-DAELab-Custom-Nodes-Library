import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { createExhibitionReferenceCard } from './exhibition_reference_card.mjs';
import { changeGenerationGraph, generationFold, generationUiState } from './generation_ui_model.mjs';
import { bindCreativeButton } from './vendor/generation-ui-shared/creative_button.mjs';
import { bindCreativeField } from './vendor/generation-ui-shared/creative_field.mjs';

// These IDs belong to BooleanListHierarchy in the distributed exhibition workflow.
// Labels, order, and rule edits on that node are never used as lookup keys.
const IDS = {
    template: 'b3b29d1b-ed49-4742-8d95-2a65b8984f24',
    people: 'd49b9da7-d3a8-4def-85dd-e56adfbe0c70',
    space: '48d30b91-fe23-4a5c-b766-904f29b2dd5d',
    region: '5ce3dc89-c3d0-42fc-a4f1-28125899e1e2',
    describe: '4a01cdeb-c462-4188-b090-62752b8517ec',
    replace: '37fa1799-6867-4c1f-8a37-acfd2632193e',
    element: '29524db6-4079-4408-b648-9e0642ddd941',
    sam: 'b595341b-1da5-44f8-9e51-3ffd9553de7b',
    rmbg: 'a6437e0a-baf5-4a61-9f7a-fef7534a97d9',
    camera: '3b04f4b4-ee73-4a87-981e-a535d0b1c462',
};
const GROUPS = [
    ['template', '提示词模板', [['people', '生成示意人物']]],
    ['region', '指定编辑区域', [['describe', '按描述生成'], ['replace', '用参考元素替换']]],
    ['element', '元素参考', []],
    ['camera', '视角转换', []],
    ['space', '使用空间原图', null],
];
const ROW = 'data-cnl-expo-row';
const HIDDEN = 'data-cnl-expo-hidden';
const WORKSPACE = 'data-cnl-expo-build';
const ELEMENT_METHODS = [['original', '不分割'], ['sam', 'SAM3'], ['rmbg', 'RMBG']];
const ADVANCED_LABELS = {
    '737:precision': '计算精度',
    '737:compile': '启用编译',
    '749:erode_dilate': '遮罩扩张／收缩',
    '749:fill_holes': '填补孔洞',
    '749:remove_isolated_pixels': '移除孤立像素',
    '749:smooth': '平滑边缘',
    '749:blur': '模糊边缘',
    '748:mode': '提取模式',
    '748:background': '输出背景',
    '748:background_color': '输出背景颜色',
    '851:sensitivity': '灵敏度',
    '851:process_res': '处理分辨率',
    '851:mask_blur': '遮罩模糊',
    '851:mask_offset': '遮罩偏移',
    '851:invert_output': '反转输出',
    '851:refine_foreground': '精细前景优化',
    '851:background': '背景类型',
    '977:color': '背景颜色',
};

function element(tag, className, label) {
    const node = document.createElement(tag);
    node.className = className;
    if (label) node.textContent = label;
    return node;
}

export function createExhibitionBuildPrompt(write) {
    const field = element('div', 'cnl-generation-prompt');
    const input = element('textarea', '');
    input.rows = 3;
    input.setAttribute('aria-label', '基础提示词');
    input.oninput = () => write(input.value);
    field.append(input);
    const release = bindCreativeField(input);
    return {
        element: field,
        update(widget, visible) {
            field.hidden = !visible;
            const value = widget?.value ?? '';
            if (input.value !== value) input.value = value;
        },
        dispose() { input.oninput = null; release(); },
    };
}

// Reuse the actual host controls, keeping each under its Vue-owned parent.
function detailGroup(key) {
    const [id, widget] = key.split(':').slice(-2);
    if (id === '790' && widget === 'style_thumbnail_dom_selector') return ['template'];
    if (id === '673' && widget === 'polygon_canvas') return ['region'];
    if (id === '784' && widget === 'value') return ['region', 'describe'];
    if (id === '1058' && widget === 'prompt') return ['region', 'replace'];
    if (['699', '697'].includes(id)) return ['camera'];
}

export function createExhibitionBuildWorkspace({ graph, root, hierarchy, captureHistory, imageURL, uploadImage, setReferenceImage, live, palette }) {
    const itemIds = Object.values(IDS);
    const canDisplay = state => itemIds.every(id => state.some(item => item.id === id));
    if (!canDisplay(hierarchy.getState())) return null;
    const releases = [];
    const rows = new Set();
    const labels = new Map();
    const bar = element('div', 'cnl-expo-features');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '展厅附加功能');
    const options = element('div', 'cnl-expo-options');
    const methods = element('fieldset', 'cnl-expo-methods');
    methods.append(element('legend', '', '元素分割方式'));
    const methodChoices = element('div', 'cnl-expo-method-choices');
    methods.append(methodChoices);
    const methodGroup = 'cnl-expo-method-' + graph.id;
    function selectedMethod() {
        if (hierarchy.getItemValue(IDS.sam)) return 'sam';
        if (hierarchy.getItemValue(IDS.rmbg)) return 'rmbg';
        return 'original';
    }
    const methodInputs = ELEMENT_METHODS.map(([key, label]) => {
        const choice = element('label', 'cnl-expo-method-choice');
        const input = element('input', '');
        input.type = 'radio';
        input.name = methodGroup;
        input.value = key;
        input.onchange = () => {
            const active = selectedMethod();
            if (key === active) return;
            const changed = key === 'original'
                ? hierarchy.setItemValue(IDS[active], false)
                : hierarchy.setItemValue(IDS[key], true);
            if (changed) captureHistory();
        };
        releases.push(bindCreativeField(input));
        choice.append(input, element('span', '', label));
        methodChoices.append(choice);
        return input;
    });
    const folds = Object.fromEntries(['sam', 'rmbg'].map(key => [
        key, generationFold(graph, 'exhibition.element.' + key, captureHistory),
    ]));
    const advanced = element('button', 'cnl-expo-advanced', '高级设置');
    advanced.type = 'button';
    advanced.onclick = () => {
        const fold = folds[selectedMethod()];
        if (fold) fold.setCollapsed(!fold.collapsed(true));
    };
    releases.push(bindCreativeButton(advanced));
    const reference = createExhibitionReferenceCard({
        sourceNode: () => graph.getNodeById(674),
        fold: generationFold(graph, 'exhibition.reference', captureHistory),
        live, imageURL, uploadImage, setImage: setReferenceImage,
    });

    function createCardHeading(key, label) {
        const fold = generationFold(graph, 'exhibition.' + key, captureHistory);
        const header = element('div', 'cnl-expo-card-header');
        const button = element('button', 'cnl-expo-reference-heading', label);
        button.type = 'button';
        button.onclick = () => {
            fold.setCollapsed(!fold.collapsed());
            updateFold();
        };
        releases.push(bindCreativeButton(button));
        header.append(button);

        function updateFold() {
            const open = !fold.collapsed();
            if (button.getAttribute('aria-expanded') !== String(open)) {
                button.setAttribute('aria-expanded', String(open));
            }
            return open;
        }

        return { header, updateFold };
    }

    const featureCard = createCardHeading('features', '展厅功能配置');
    // The native App Mode widget rows must remain children of their Vue-owned root.
    const featureEnd = element('div', 'cnl-expo-card-end');
    featureEnd.setAttribute('aria-hidden', 'true');

    const savedSection = () => graph.extra?.daelabGenerationUiV1?.exhibitionDetails;
    function setSection(section) {
        if ((savedSection() ?? null) === section) return;
        changeGenerationGraph(graph, () => {
            generationUiState(graph).exhibitionDetails = section;
        }, captureHistory);
    }

    function makeSwitch(key, label, action) {
        const input = element('input', 'cnl-expo-switch');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-label', label);
        input.onchange = () => {
            if (hierarchy.setItemValue(IDS[key], input.checked)) captureHistory();
            action?.(input.checked);
        };
        releases.push(bindCreativeField(input));
        return input;
    }

    const groups = GROUPS.filter(([key]) => key !== 'region' || !graph.extra?.daelabExhibitionUiV1?.build?.independentLocalEdit);
    const controls = groups.map(([key, label, children]) => {
        const chip = element('div', 'cnl-expo-chip');
        const toggle = makeSwitch(key, label + '启用', checked => {
            if (children) setSection(checked ? key : savedSection() === key ? null : savedSection() ?? null);
        });
        const title = element(children ? 'button' : 'label', 'cnl-expo-chip-title', label);
        if (children) {
            title.type = 'button';
            title.onclick = () => setSection(savedSection() === key ? null : key);
            title.append(element('span', 'cnl-expo-chevron'));
            title.lastChild.setAttribute('aria-hidden', 'true');
            releases.push(bindCreativeButton(title));
            chip.append(title, toggle);
        } else {
            title.append(toggle);
            chip.append(title);
        }
        bar.append(chip);
        const choices = (children ?? []).map(([id, text]) => {
            const row = element('label', 'cnl-expo-option', text);
            const input = makeSwitch(id, text);
            row.append(input);
            options.append(row);
            return { id, row, input };
        });
        return { key, title, toggle, choices, expandable: Boolean(children) };
    });

    const methodsRow = element('div', 'cnl-expo-methods-row');
    methodsRow.append(methods);
    const advancedRow = element('div', 'cnl-expo-advanced-row');
    advancedRow.append(advanced);
    const ownedRows = [
        [reference.element, 'original'], [featureCard.header, 'features-heading'],
        [bar, 'features'], [options, 'options'], [featureEnd, 'features-end'],
        [methodsRow, 'element-methods'], [advancedRow, 'element-fold'],
    ];
    for (const [node, position] of ownedRows) {
        node.setAttribute(ROW, position);
        node.style.cssText = palette;
    }

    function clearRows(keep) {
        for (const row of rows) {
            if (keep?.has(row)) continue;
            row.removeAttribute(ROW);
            row.removeAttribute(HIDDEN);
            rows.delete(row);
        }
    }

    function restoreLabels(keep) {
        for (const [node, { original, localized }] of labels) {
            if (keep?.has(node)) continue;
            if (node.textContent === localized) node.textContent = original;
            labels.delete(node);
        }
    }

    function update(byKey, hierarchyRow) {
        const state = hierarchy.getState();
        const values = new Map(state.map(item => [item.id, item.value]));
        // Modified hierarchies can expose controls this layout does not know about.
        // Leave their native editor reachable rather than dropping saved options.
        if (!canDisplay(state)) return false;
        // App Mode may rebuild the contents of the same scroll container.
        for (const [node] of ownedRows) {
            if (node.parentElement !== root) root.append(node);
        }
        const featuresOpen = featureCard.updateFold();
        bar.hidden = featureEnd.hidden = !featuresOpen;
        const selected = savedSection();
        const enabled = key => values.get(IDS[key]) === true;
        const expanded = key => featuresOpen && selected === key && enabled(key);
        const elementOpen = expanded('element');
        const method = enabled('sam') ? 'sam' : enabled('rmbg') ? 'rmbg' : 'original';
        if (elementOpen && method === 'sam') {
            const collector = graph.getNodeById(741);
            if (isNodeAvailableInAppMode(collector)) collector.daelabSyncCollectorPreview?.();
        }
        const advancedOpen = elementOpen && !(folds[method]?.collapsed(true) ?? true);
        for (const input of methodInputs) input.checked = input.value === method;
        methodsRow.hidden = !elementOpen;
        advancedRow.hidden = !elementOpen || method === 'original';
        if (advanced.getAttribute('aria-expanded') !== String(advancedOpen)) {
            advanced.setAttribute('aria-expanded', String(advancedOpen));
        }
        root.toggleAttribute(WORKSPACE, true);
        const keep = new Set();
        function assign(row, position, hide = false) {
            if (!row || row.parentElement !== root) return;
            keep.add(row);
            rows.add(row);
            if (row.getAttribute(ROW) !== position) row.setAttribute(ROW, position);
            row.toggleAttribute(HIDDEN, hide);
        }

        const imageRow = [...byKey.entries()].find(([key]) => key.endsWith(':674:image'))?.[1];
        assign(imageRow, 'original', true);
        reference.update();
        const localizedLabels = new Set();
        function localize(row, localized) {
            const label = row.querySelector('[data-testid="builder-widget-label"]');
            if (!label) return;
            localizedLabels.add(label);
            if (label.textContent !== localized) {
                labels.set(label, { original: label.textContent, localized });
                label.textContent = localized;
            }
        }
        for (const [key, row] of byKey) {
            const group = detailGroup(key);
            if (group) assign(row, 'detail', !expanded(group[0]) || (group[1] && !enabled(group[1])));
            const [id, widget] = key.split(':').slice(-2);
            const field = id + ':' + widget;
            if (field === '735:image') assign(row, 'element-image', !elementOpen);
            if (field === '741:sam3_complex_collector' || field === '851:model') {
                const show = elementOpen && method === (id === '741' ? 'sam' : 'rmbg');
                assign(row, 'element-core', !show);
                if (show) localize(row, id === '741' ? 'SAM3 选区' : '分割模型');
            }
            const localized = ADVANCED_LABELS[field];
            if (!localized) continue;
            const show = advancedOpen && method === (['851', '977'].includes(id) ? 'rmbg' : 'sam');
            assign(row, 'element-advanced', !show);
            if (show) localize(row, localized);
        }
        if (state.length === itemIds.length) assign(hierarchyRow, 'native', true);
        clearRows(keep);
        restoreLabels(localizedLabels);

        for (const { key, title, toggle, choices, expandable } of controls) {
            const open = expanded(key);
            const checked = enabled(key);
            toggle.checked = checked;
            if (expandable) {
                title.disabled = !checked;
                if (title.getAttribute('aria-expanded') !== String(open)) title.setAttribute('aria-expanded', String(open));
            }
            for (const { id, row, input } of choices) {
                row.hidden = !open;
                input.checked = enabled(id);
            }
        }
        options.hidden = !controls.some(({ key, choices }) => expanded(key) && choices.length);
        return true;
    }

    return {
        update,
        dispose() {
            clearRows();
            restoreLabels();
            root.removeAttribute(WORKSPACE);
            releases.forEach(release => release());
            reference.dispose();
            for (const [node] of ownedRows) node.remove();
        },
    };
}
