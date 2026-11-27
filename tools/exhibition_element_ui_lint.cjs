// UI-LINT-01 through UI-LINT-04: Exercise real App Mode with disposable browser state.
// Requires Playwright and local ComfyUI. COMFY_URL defaults to http://127.0.0.1:8000.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const base = new URL(process.env.COMFY_URL || 'http://127.0.0.1:8000');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a local ComfyUI instance.');
const readWorkflow = (file, name) => JSON.parse(readFileSync(
    file || path.join(__dirname, '..', 'user', 'default', 'workflows', name), 'utf8').replace(/^\uFEFF/, ''));
const workflow = readWorkflow(process.env.CNL_EXHIBITION_WORKFLOW, 'CNL-展厅设计-分割独立描述版.json');
const badgeWorkflow = readWorkflow(process.env.CNL_BADGE_WORKFLOW, 'CNL-徽章设计-v8.8.json');
// Provide deterministic image bytes without uploading anything or needing local assets.
const imageNames = new Set([
    ...workflow.nodes.filter(node => [674, 735].includes(node.id)),
    ...badgeWorkflow.nodes.filter(node => [1, 2].includes(node.id)),
].map(node => node.widgets_values[0]));
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><path fill="#17678b" d="M0 0h320v200H0z"/><circle cx="160" cy="100" r="48" fill="#fff"/></svg>';
const uploadedName = 'ui-lint-reference.png';
imageNames.add(uploadedName);
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const visible = (locator) => locator.waitFor({ state: 'visible' });
const hidden = (locator) => locator.waitFor({ state: 'hidden' });
const stage = (page, name) => page.getByRole('tab', { name, exact: true });

async function openAppMode(page, data) {
    const enter = page.getByRole('button', { name: /^(进入应用模式|Enter App Mode)$/ });
    await page.evaluate(data => globalThis.comfyAPI.app.app.loadGraphData(data, true, true), data);
    await page.waitForFunction(id => globalThis.comfyAPI.app.app.rootGraph.id === id, data.id);
    if (!(await page.getByTestId('linear-widgets').isVisible())) {
        if (await enter.isVisible()) await enter.click();
        else await page.evaluate(() => globalThis.comfyAPI.app.app.extensionManager.command.execute('Comfy.ToggleLinear'));
    }
    const skip = page.getByRole('button', { name: /^(跳过|Skip)$/ });
    await visible(stage(page, '效果图生成'));
    // The host guide can mount after the App Mode tab is already visible.
    await skip.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
    if (await skip.isVisible()) await skip.click();
    const templates = page.getByRole('dialog').filter({ hasText: /从模板开始|Start from a template/i });
    if (await templates.isVisible()) {
        await page.keyboard.press('Escape');
        await hidden(templates);
    }
}

async function resizeSidebar(page, width) {
    const sidebar = page.getByTestId('linear-right-panel');
    const handle = sidebar.locator('..').locator(':scope > [role="separator"][data-orientation="horizontal"]').last();
    await visible(handle);
    const [panel, grip] = await Promise.all([sidebar.boundingBox(), handle.boundingBox()]);
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + panel.width - width, y, { steps: 10 });
    await page.mouse.up();
}

async function checkPreview(preview, methods, minWidth, maxWidth) {
    await visible(preview);
    const result = await preview.evaluate(img => {
        const box = img.getBoundingClientRect();
        const frame = img.closest('[data-testid="drop-zone-indicator"]').getBoundingClientRect();
        const insideFrame = box.left >= frame.left - 1 && box.right <= frame.right + 1 &&
            box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
        return { width: box.width, height: box.height, naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight, frameWidth: frame.width, frameX: frame.x, insideFrame };
    });
    const { width, height, naturalWidth, naturalHeight, frameWidth, frameX, insideFrame } = result;
    const { width: available, x } = await methods.boundingBox();
    assert.ok(available >= minWidth && available <= maxWidth, 'Sidebar width did not reach the test range: ' + available);
    assert.ok(Math.abs(frameX - x) <= 2 && Math.abs(frameWidth - available) <= 2,
        `The preview frame must span the same content width as the method selector (frame ${frameWidth}px, available ${available}px).`);
    assert.ok(naturalWidth && naturalHeight, 'The Element Reference image must load.');
    assert.ok(Math.abs(height - width * naturalHeight / naturalWidth) <= 1, 'The preview must retain its aspect ratio.');
    assert.ok(insideFrame && width >= frameWidth - 16, 'The preview must fill its frame without clipping.');
}

async function checkExhibitionLayoutRecovery(page) {
    const root = page.getByTestId('linear-widgets');
    const reference = root.locator('.cnl-expo-original');
    const features = root.getByRole('group', { name: '展厅附加功能' });
    const generation = root.locator('.cnl-generation-panel');
    const nativeUpload = root.locator('[data-widget-key$=":674:image"]');
    const hierarchyKey = ':928:boolean_hierarchy_editor';
    const modes = page.getByRole('button', { name: /^(进入节点图|Enter Node Graph|Graph Mode)$/ });
    await stage(page, '效果图生成').click();
    await visible(features);
    const useRegion = button(features, '指定编辑区域');
    if (await useRegion.getAttribute('aria-expanded') === 'false') await useRegion.press('Enter');
    await visible(useRegion.and(page.locator('[aria-expanded="true"]')));
    const settings = button(generation, '生成配置');
    const popup = generation.locator('.cnl-generation-settings');
    const featureHeading = button(root, '展厅功能配置');
    const prompt = generation.getByRole('textbox', { name: '基础提示词' });
    const region = root.locator('[data-widget-key$=":673:polygon_canvas"]');
    const promptText = await prompt.inputValue();
    await settings.press('Enter');
    await visible(popup);
    await visible(prompt);
    await visible(features);
    await featureHeading.press('Enter');
    await hidden(features);
    await hidden(region);
    const collapsed = await page.evaluate(() => globalThis.comfyAPI.app.app.rootGraph.serialize());
    await openAppMode(page, collapsed);
    await visible(prompt);
    await hidden(popup);
    await hidden(features);
    assert.equal(await prompt.inputValue(), promptText);
    await featureHeading.press('Enter');
    await visible(features);
    await visible(region);
    assert.equal(await useRegion.getAttribute('aria-expanded'), 'true');
    const saved = await page.evaluate(() => globalThis.comfyAPI.app.app.rootGraph.serialize());

    // The host can remove extension-owned children without replacing its scroll container.
    await root.evaluate(element => {
        element.querySelectorAll(':scope > [data-cnl-expo-row]:not([data-widget-key]), :scope > .cnl-generation-panel')
            .forEach(row => row.remove());
    });
    await features.waitFor({ state: 'visible', timeout: 4000 });
    await visible(reference);
    await visible(generation);
    await hidden(nativeUpload);
    assert.equal(await useRegion.getAttribute('aria-expanded'), 'true');

    const setHierarchyMode = mode => page.evaluate(value => {
        globalThis.comfyAPI.app.app.rootGraph.getNodeById(928).mode = value;
    }, mode);
    await setHierarchyMode(4);
    await hidden(features);
    await visible(nativeUpload);
    await setHierarchyMode(0);
    await visible(features);
    await hidden(nativeUpload);
    assert.equal(await useRegion.getAttribute('aria-expanded'), 'true');

    // Omitting the native editor from the App Mode inputs must not prevent a fresh mount.
    const withoutHierarchyRow = structuredClone(saved);
    withoutHierarchyRow.extra.linearData.inputs =
        withoutHierarchyRow.extra.linearData.inputs.filter(([key]) => !key.endsWith(hierarchyKey));
    await modes.click();
    await openAppMode(page, withoutHierarchyRow);
    assert.equal(await root.locator('[data-widget-key$="' + hierarchyKey + '"]').count(), 0);
    await visible(features);
    await visible(reference);
    await hidden(nativeUpload);
    assert.equal(await useRegion.getAttribute('aria-expanded'), 'true');

    await modes.click();
    await openAppMode(page, saved);
    await visible(features);
    await hidden(root.locator('[data-widget-key$="' + hierarchyKey + '"]'));
    assert.equal(await useRegion.getAttribute('aria-expanded'), 'true');
    console.log('PASS 展厅布局恢复：同容器控件脱离、无原生选项挂载点、旁路、模式往返和保存后重开。');
}

async function checkNativeChrome(page, section) {
    const root = page.getByTestId('linear-widgets');
    const rows = root.getByTestId('app-mode-widget-item').filter({ visible: true });
    const keys = await rows.evaluateAll(items => items.map(item => item.dataset.widgetKey));
    for (const key of keys) {
        const row = root.locator('[data-widget-key=' + JSON.stringify(key) + ']');
        const box = await row.evaluate(element => {
            if (!element.getClientRects().length) return null;
            element.scrollIntoView({ block: 'nearest' });
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
        });
        if (!box) continue;
        for (const x of [box.x + 3, box.x + box.width - 14]) {
            await page.mouse.move(x, box.y + Math.min(16, box.height / 2));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
            const exposed = row.locator(
                ':is(.lg-slot, [data-testid="widget-actions-menu"], button:has(.icon-\\[comfy--mask\\])):visible',
            );
            assert.equal(await exposed.count(), 0, section + ' exposes host controls at ' +
                await row.getAttribute('data-widget-key'));
        }
    }
}

async function checkExhibitionStages(page) {
    const root = page.getByTestId('linear-widgets');
    const features = button(root, '展厅功能配置');
    const selectFeature = async (name, row) => {
        const heading = button(root, name);
        if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
        await visible(root.locator('[data-widget-key$="' + row + '"]'));
        await checkNativeChrome(page, name);
    };
    await stage(page, '效果图生成').click();
    if (await features.getAttribute('aria-expanded') !== 'true') await features.click();
    await selectFeature('提示词模板', ':790:style_thumbnail_dom_selector');
    await selectFeature('指定编辑区域', ':673:polygon_canvas');
    for (const [choice, row] of [['按描述生成', ':784:value'], ['用参考元素替换', ':1058:prompt']]) {
        const control = root.getByRole('switch', { name: choice, exact: true });
        if (!(await control.isChecked())) await control.click();
        await visible(root.locator('[data-widget-key$="' + row + '"]'));
        await checkNativeChrome(page, choice);
    }
    const camera = root.getByRole('switch', { name: '视角转换启用', exact: true });
    if (!(await camera.isChecked())) {
        await camera.click();
        await visible(button(root, '视角转换').and(page.locator('[aria-expanded="true"]')));
    }
    await selectFeature('视角转换', ':699:horizontal_angle');
    for (const [name, options] of [
        ['局部修改', ['图片替换', '材质替换', '语义描述'].map(option => button(root, option))],
        ['抠图', [stage(page, '识别物体抠图'), stage(page, '主体物抠图')]],
    ]) {
        await stage(page, name).click();
        await visible(root.locator('.cnl-image-editing'));
        assert.equal(await root.getByTestId('app-mode-widget-item').filter({ visible: true }).count(), 0,
            name + ' must render its own controls.');
        for (const option of options) {
            await option.click();
            assert.equal(await root.getByTestId('app-mode-widget-item').filter({ visible: true }).count(), 0,
                name + ' options must not reveal native widget rows.');
        }
    }
    console.log('PASS UI-LINT-04 展厅：模板、区域两种方式、视角转换、局部修改和抠图无原生节点控件外露。');
}

async function checkBadgeNativeChrome(page) {
    const root = page.getByTestId('linear-widgets');
    const reference = button(root, '参考图配置');
    const assertNoNativeRows = async name => {
        const panel = root.locator('.cnl-image-editing');
        await visible(panel);
        await panel.hover();
        assert.equal(await root.getByTestId('app-mode-widget-item').filter({ visible: true }).count(), 0,
            '徽章局部修改 exposes native inputs in ' + name);
    };

    for (const [width, height, sidebar] of [[1440, 940, 680], [960, 720, 340]]) {
        await stage(page, '效果图生成').click();
        await page.setViewportSize({ width, height });
        await resizeSidebar(page, sidebar);
        if (await reference.getAttribute('aria-expanded') !== 'true') await reference.press('Enter');
        await visible(reference.and(page.locator('[aria-expanded="true"]')));
        await reference.hover();
        await checkBuildCardOrder(root);
        for (const name of ['背景 / 镂空剔除', '高度建立']) {
            const enabled = root.getByRole('switch', { name: name + '启用', exact: true });
            if (!(await enabled.isChecked())) await enabled.click();
            const section = button(root, name);
            if (await section.getAttribute('aria-expanded') !== 'true') await section.press('Enter');
            await visible(section.and(page.locator('[aria-expanded="true"]')));
            if (name.startsWith('背景')) {
                await visible(root.locator('[data-widget-key$=":47:multi_color_mask_v1_panel"]'));
            }
            await section.hover();
            await checkNativeChrome(page, '徽章 ' + name);
        }
        await hidden(root.locator('.cnl-generation-settings'));
        await reference.press('Enter');
        await visible(reference.and(page.locator('[aria-expanded="false"]')));
        await checkNativeChrome(page, '徽章收折配置');

        await stage(page, '局部修改').click();
        await visible(root.locator('.cnl-image-editing'));
        await button(root, '遮罩').click();
        for (const name of ['颜色', '多边形', '标注']) {
            await button(root, name).click();
            await assertNoNativeRows(name);
        }
        await button(root, '遮罩').click();
        for (const name of ['图片替换', '材质替换', '语义描述']) {
            await button(root, name).click();
            await assertNoNativeRows(name);
        }
    }
    console.log('PASS UI-LINT-04 徽章：宽窄侧栏的生成卡片、选区和修改方式均无原生节点控件外露。');
}

async function checkExhibitionCards(page) {
    const root = page.getByTestId('linear-widgets');
    const reference = button(root, '参考图配置');
    const features = button(root, '展厅功能配置');
    const nativePrompt = root.locator('[data-widget-key$=":790:base_prompt"]');
    const text = root.locator('.cnl-generation-prompt textarea');
    const cards = [
        root.locator('.cnl-expo-original'),
        root.locator('[data-cnl-expo-row="features-heading"]'),
        root.locator('.cnl-generation-panel'),
    ];
    async function fold(heading, open) {
        if (await heading.getAttribute('aria-expanded') !== String(open)) await heading.press('Enter');
        await visible(heading.and(page.locator('[aria-expanded="' + open + '"]')));
    }

    await stage(page, '效果图生成').click();
    await fold(reference, false);
    await fold(features, false);
    for (const [width, height, sidebar] of [[1440, 940, 680], [960, 720, 340]]) {
        await page.setViewportSize({ width, height });
        await resizeSidebar(page, sidebar);
        const boxes = await Promise.all(cards.map(card => card.boundingBox()));
        for (const [index, box] of boxes.entries()) {
            const name = ['参考图配置', '展厅功能配置', '合并生成卡片'][index];
            if (index < 2) {
                const title = index === 0 ? reference : features;
                const type = await title.evaluate(node => {
                    const style = getComputedStyle(node);
                    return [style.fontSize, style.lineHeight, style.fontWeight];
                });
                assert.deepEqual(type, ['16px', '24px', '600'], name + ' must use the card title typography.');
            }
            assert.ok(box && Math.abs(box.x - boxes[0].x) <= 1 &&
                Math.abs(box.width - boxes[0].width) <= 1, name + ' must align with the reference card.');
            if (index > 0) {
                const previous = boxes[index - 1];
                const gap = box.y - previous.y - previous.height;
                assert.ok(Math.abs(gap - 12) <= 1, name + ' must have a 12px gap above it, got ' + gap);
            }
        }
        await visible(text);
        await hidden(nativePrompt);
        await checkBuildCardOrder(root);
    }
    console.log('PASS UI-LINT-04 展厅：宽窄侧栏的标题、卡片对齐与间距、合并卡片控件顺序与折叠。');
}

async function checkBuildCardOrder(root) {
    const panel = root.locator('.cnl-generation-panel[data-generation-stage="build"]');
    assert.equal(await panel.count(), 1);
    const prompt = panel.getByRole('textbox', { name: '基础提示词' });
    const trigger = button(panel, '生成配置');
    const popup = panel.locator('.cnl-generation-settings');
    const count = popup.getByRole('spinbutton', { name: '张数' });
    const price = panel.locator('.cnl-generation-submit-group > .cnl-generation-price');
    const controls = [
        prompt,
        panel.getByRole('combobox', { name: /^(生成)?模型$/ }),
        trigger,
        price,
        button(panel, '生成'),
    ];
    for (const control of controls) await visible(control);
    await visible(price.filter({ hasText: /本批预计 .+ 积分|暂无法估算/ }));
    await hidden(popup);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await hidden(button(panel, '模型输出配置'));
    assert.ok(await panel.evaluate(card => {
        const selectors = ['textarea', 'select', '.cnl-generation-settings-trigger', '.cnl-generation-price', '.cnl-generation-submit'];
        const nodes = selectors.map(selector => card.querySelector(selector));
        return nodes.every((node, index) => node && (!index ||
            nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), 'Generation controls must use the visual order in the DOM.');
    assert.equal(await panel.locator('.lg-slot,[data-testid="widget-actions-menu"]').count(), 0);
    assert.ok(await panel.evaluate(card => card.scrollWidth <= card.clientWidth + 1), 'The generation card must fit the sidebar.');
    await trigger.press('Enter');
    await visible(count);
    await visible(popup.locator('.cnl-generation-choice-group').first());
    await visible(popup.getByRole('combobox', { name: '质量' }));
    assert.equal(await popup.locator('.cnl-generation-price').count(), 0);
    await visible(price);
    assert.ok(await price.evaluate(output => {
        const button = output.nextElementSibling;
        if (!button?.matches('button.cnl-generation-submit')) return false;
        const estimate = output.getBoundingClientRect(), submit = button.getBoundingClientRect();
        return estimate.right <= submit.left && estimate.top < submit.bottom && estimate.bottom > submit.top;
    }), 'The credit estimate and generate button must stay together.');
    assert.ok(await popup.locator('[data-number-group="dimensions"] input:visible').evaluateAll(inputs =>
        inputs.every(input => {
            const style = getComputedStyle(input);
            const canvas = document.createElement('canvas').getContext('2d');
            canvas.font = style.font;
            return canvas.measureText(input.value).width <= input.clientWidth -
                parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        })), 'The full dimension values must fit inside the popover.');
    assert.ok(await popup.evaluate(node => {
        const r = node.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 &&
            node.scrollWidth <= node.clientWidth + 1;
    }), 'The open settings must fit the viewport.');
    await trigger.focus();
    await panel.page().keyboard.press('Tab');
    assert.ok(await popup.evaluate(node => node.contains(document.activeElement)));
    await count.focus();
    await count.press('Escape');
    await hidden(popup);
    assert.ok(await trigger.evaluate(node => node === document.activeElement));
    await trigger.click();
    await visible(popup);
    // The menu can cover the textarea. Click the opposite App Mode pane.
    await panel.page().mouse.click(100, 350);
    await hidden(popup);
    await visible(prompt);
}

async function checkTypography(page, name) {
    const root = page.getByTestId('linear-widgets');
    const trigger = button(root, '生成配置');
    const popup = root.locator('.cnl-generation-settings');
    const prompt = root.locator('.cnl-generation-prompt textarea');
    const support = root.locator('.cnl-generation-submit-group > .cnl-generation-price');
    // Expectations are independent of the CSS tokens so a token regression also fails.
    const samples = [
        ['提示词', prompt, [14, 21]],
        ['控件', trigger, [14, 21]],
        ['辅助信息', support, [12, 18]],
    ];

    for (const [size, viewport, target, min, max] of [
        ['宽', { width: 1440, height: 940 }, 680, 550, Infinity],
        ['窄', { width: 960, height: 720 }, 340, 240, 385],
    ]) {
        await stage(page, '效果图生成').click();
        await page.setViewportSize(viewport);
        await resizeSidebar(page, target);
        await visible(trigger);
        const { width } = await page.getByTestId('linear-right-panel').boundingBox();
        assert.ok(width >= min && width <= max, `UI-LINT-02 ${name}${size}侧栏宽度未达到测试区间：${width}px`);
        const measured = [];
        for (const [role, locator, expected] of samples) {
            await visible(locator);
            const actual = await locator.evaluate(element => {
                const { fontSize, lineHeight } = getComputedStyle(element);
                return [parseFloat(fontSize), parseFloat(lineHeight)];
            });
            assert.deepEqual(actual, expected, `UI-LINT-02 ${name}${size}侧栏 ${role} 的字号／行高`);
            measured.push(`${role} ${actual.join('/')}`);
        }
        await hidden(popup);
        console.log(`PASS UI-LINT-02 ${name}${size}侧栏 (${Math.round(width)}px): ${measured.join(' · ')} px`);
    }
}

async function checkCopy(page, name) {
    const root = page.getByTestId('linear-widgets');
    const generation = root.locator('.cnl-generation-panel');
    const trigger = button(generation, '生成配置');
    await visible(trigger);
    await visible(button(generation, '生成'));
    const assertIdleCopy = async () => {
        const copy = await generation.locator(':scope > .cnl-generation-status').evaluate(status =>
            status.dataset.error === 'true' ? '' : status.textContent.trim());
        assert.equal(copy, '', 'UI-LINT-03 ' + name + '空闲生成面板无需重复提示下一步。');
    };
    await assertIdleCopy();

    if (name === '徽章') {
        const section = generation.locator('.cnl-generation-prompt');
        const prompt = section.getByRole('textbox', { name: '基础提示词' });
        const toggle = generation.getByRole('switch', { name: '是否仅使用提示词' });
        const assertPromptCopy = async () => {
            await visible(prompt);
            assert.equal((await prompt.getAttribute('placeholder'))?.trim() ?? '', '',
                'UI-LINT-03 基础提示词有可访问名称，无需占位说明。');
            const copy = await section.evaluate(section => [...section.children]
                .filter(child => !child.matches('textarea'))
                .map(child => child.innerText?.trim()).filter(Boolean));
            assert.deepEqual(copy, [], 'UI-LINT-03 基础提示词无需常驻说明。');
        };
        await assertPromptCopy();
        await hidden(toggle);
        await trigger.click();
        const initial = await toggle.isChecked();
        await toggle.click();
        assert.equal(await toggle.isChecked(), !initial);
        await assertPromptCopy();
        await assertIdleCopy();
        await toggle.click();
        await assertIdleCopy();
        await trigger.click();
    }
    console.log('PASS UI-LINT-03 ' + name + '：空闲生成' + (name === '徽章' ? '和提示词' : '') + '没有冗余文案。');
}

async function checkReferenceControls(page, card, exhibition) {
    const title = button(card, '参考图配置');
    await visible(title);
    if (await title.getAttribute('aria-expanded') === 'false') await title.press('Enter');
    await visible(button(card, '上传 / 替换图片'));
    await visible(button(card, '下载图片'));
    const browse = button(card, '浏览已上传图片');
    await browse.click();
    const dialog = card.getByRole('dialog', { name: '选择已上传图片' });
    const search = dialog.getByRole('searchbox', { name: '搜索已上传图片' });
    await visible(search);
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await search.fill(exhibition ? 'bg.jpg' : 'BaseColor.png');
    await visible(dialog.locator('button[aria-pressed="true"]'));
    await search.press('Escape');
    await hidden(dialog);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '浏览已上传图片');
    if (!exhibition) return;

    const preview = card.getByRole('img', { name: '空间原图' });
    await visible(preview);
    const expectedWidth = await card.locator('.cnl-expo-reference-frame').evaluate(frame => frame.clientWidth);
    assert.ok(Math.abs((await preview.boundingBox()).width - expectedWidth) <= 2, 'Space reference must fill its frame.');
    await title.press('Enter');
    await hidden(preview);
    await title.press('Enter');
    await visible(preview);
    const choosing = page.waitForEvent('filechooser');
    await button(card, '上传 / 替换图片').click();
    await (await choosing).setFiles({ name: uploadedName, mimeType: 'image/png', buffer: Buffer.from(image) });
    await page.waitForFunction(name => globalThis.comfyAPI.app.app.rootGraph.getNodeById(674)
        .widgets.find(widget => widget.name === 'image').value === name, uploadedName);
    const downloading = page.waitForEvent('download');
    await button(card, '下载图片').click();
    assert.equal((await downloading).suggestedFilename(), uploadedName);
    await browse.click();
    await search.fill('bg.jpg');
    await button(dialog, 'bg.jpg').click();
    await hidden(dialog);
    await page.waitForFunction(() => globalThis.comfyAPI.app.app.rootGraph.getNodeById(674)
        .widgets.find(widget => widget.name === 'image').value === 'bg.jpg');
    console.log('PASS 展厅参考图：折叠、素材库、上传后选中与下载。');
}

async function checkFeatureSelection(root) {
    const features = root.getByRole('group', { name: '展厅附加功能' });
    const template = button(features, '提示词模板');
    const elements = button(features, '元素参考');
    const visual = control => control.evaluate(el => ({
        background: getComputedStyle(el.parentElement).backgroundColor,
        glyph: getComputedStyle(el.querySelector('.cnl-expo-chevron'), '::before').content,
    }));
    const neutral = (await visual(template)).background;
    assert.equal((await visual(template)).glyph, '"▸"');
    assert.equal((await visual(elements)).background, neutral, 'Enabled, collapsed features must stay neutral.');
    await template.press('Enter');
    await template.page().waitForFunction(() => document.querySelector('.cnl-expo-chip-title[aria-expanded="true"]')?.textContent === '提示词模板');
    assert.equal((await visual(template)).glyph, '"▾"');
    assert.notEqual((await visual(template)).background, neutral, 'The expanded feature must be highlighted.');
    assert.equal((await visual(elements)).background, neutral);
    await template.press('Enter');
    await template.page().waitForFunction(() => !document.querySelector('.cnl-expo-chip-title[aria-expanded="true"]'));
}

async function checkBadge(page) {
    const root = page.getByTestId('linear-widgets');
    await openAppMode(page, badgeWorkflow);
    await checkBadgeStageTabs(page);
    await checkCopy(page, '徽章');
    await checkReferenceControls(page, root, false);
    await checkTypography(page, '徽章');
    await checkBadgeNativeChrome(page);
}

async function checkBadgeStageTabs(page) {
    const root = page.getByTestId('linear-widgets');
    const bar = root.locator('[data-daelab-app-layout-owned="tabs"]');
    const build = stage(page, '效果图生成');
    const local = stage(page, '局部修改');
    const workspace = root.locator('.cnl-generation-panel[data-generation-stage="build"]');
    const editor = root.locator('.cnl-image-editing');
    const measure = () => bar.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return {
            height: bounds.height,
            background: getComputedStyle(el).backgroundColor,
            tabs: Array.from(el.querySelectorAll('[role="tab"]:not([hidden])'), tab => {
                const { x, y, width, height } = tab.getBoundingClientRect();
                const { fontFamily, fontSize, lineHeight, fontWeight, borderRadius } = getComputedStyle(tab);
                return { x: x - bounds.x, y: y - bounds.y, width, height,
                    fontFamily, fontSize, lineHeight, fontWeight, borderRadius };
            }),
        };
    });
    for (const [width, height, sidebar] of [[1440, 940, 680], [960, 720, 340]]) {
        await page.setViewportSize({ width, height });
        await resizeSidebar(page, sidebar);
        await build.click();
        await visible(workspace);
        const initial = await measure();
        assert.equal(initial.tabs[0].fontSize, '14px');
        assert.ok(await bar.evaluate(el => el.scrollWidth <= el.clientWidth),
            'Both Badge tabs and their focus outlines must fit the sidebar.');
        const selectedBackground = await build.evaluate(el => getComputedStyle(el).backgroundColor);
        assert.notEqual(selectedBackground, await local.evaluate(el => getComputedStyle(el).backgroundColor));

        await local.click();
        await visible(editor);
        await hidden(workspace);
        assert.equal(await local.getAttribute('aria-selected'), 'true');
        assert.equal(await local.evaluate(el => getComputedStyle(el).backgroundColor), selectedBackground);
        assert.deepEqual(await measure(), initial, 'Badge tabs must keep their geometry and typography in local editing.');
        await page.keyboard.press('ArrowLeft');
        assert.ok(await build.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'),
            'Badge tabs must show keyboard focus.');
        assert.equal(await local.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Enter');
        await visible(workspace);
        assert.equal(await build.getAttribute('aria-selected'), 'true');
        assert.deepEqual(await measure(), initial, 'Badge tab styles must survive the return to generation.');
    }
    const beforeReopening = await measure();
    const saved = await page.evaluate(() => globalThis.comfyAPI.app.app.rootGraph.serialize());
    await page.getByRole('button', { name: /^(进入节点图|Enter Node Graph|Graph Mode)$/ }).click();
    await hidden(bar);
    await openAppMode(page, saved);
    await build.click();
    await visible(workspace);
    assert.deepEqual(await measure(), beforeReopening, 'Badge tab styles must survive reopening the workflow.');
    console.log('PASS 徽章页签：宽窄侧栏切换和保存重开后，尺寸、间距和字体一致，键盘焦点可见。');
}

async function lint() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, serviceWorkers: 'block' });
        let submissions = 0;
        await page.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
                if (url.origin === base.origin && /^\/(?:api\/)?settings(?:\/|$)/.test(url.pathname)) {
                    return route.fulfill({ json: {} });
                }
                if (url.origin === base.origin && request.method() === 'POST' && url.pathname.endsWith('/upload/image')) {
                    return route.fulfill({ json: { name: uploadedName, subfolder: '', type: 'input' } });
                }
                if (url.pathname.endsWith('/prompt')) submissions++;
                return route.abort();
            }
            if (url.origin === base.origin && url.pathname.endsWith('/view') && imageNames.has(url.searchParams.get('filename'))) {
                return route.fulfill({ contentType: 'image/svg+xml', body: image });
            }
            return route.continue();
        });
        await page.goto(base.href);
        await page.waitForFunction(() => Boolean(globalThis.comfyAPI?.app?.app?.rootGraph?.getNodeById),
            undefined, { timeout: 60000 });
        if (process.argv.includes('--badge-tabs')) {
            await openAppMode(page, badgeWorkflow);
            await checkBadgeStageTabs(page);
            assert.equal(submissions, 0, 'UI lint must not attempt generation.');
            return;
        }
        if (process.argv.includes('--build-menu')) {
            for (const [name, data] of [['展厅', workflow], ['徽章', badgeWorkflow]]) {
                await openAppMode(page, data);
                await stage(page, '效果图生成').click();
                for (const [width, height, sidebar] of [[1440, 940, 680], [960, 720, 340]]) {
                    await page.setViewportSize({ width, height });
                    await resizeSidebar(page, sidebar);
                    await checkBuildCardOrder(page.getByTestId('linear-widgets'));
                }
                console.log('PASS ' + name + '：默认状态、配置选单、宽窄视口、键盘焦点和关闭。');
            }
            assert.equal(submissions, 0, 'UI lint must not attempt generation.');
            return;
        }
        if (process.argv.includes('--badge')) {
            await checkBadge(page);
            assert.equal(submissions, 0, 'UI lint must not attempt generation.');
            return;
        }
        await openAppMode(page, workflow);
        await checkCopy(page, '展厅');

        const root = page.getByTestId('linear-widgets');
        const row = suffix => root.locator('[data-widget-key$="' + suffix + '"]');
        const preview = row(':735:image').locator('img[data-testid="drop-zone-media"]');
        const methods = root.getByRole('group', { name: '元素分割方式' });
        const advanced = button(root, '高级设置');
        const sam = row(':741:sam3_complex_collector');
        const rmbg = row(':851:model');
        const samSetting = row(':737:precision');
        const rmbgSetting = row(':851:sensitivity');
        const feature = button(root, '元素参考');
        const choose = name => methods.getByText(name, { exact: true }).click();
        const settings = () => page.evaluate(() => [737, 748, 749, 851].map(id => {
            const graph = globalThis.comfyAPI.app.app.rootGraph;
            return graph.getNodeById(id).widgets.map(widget => [widget.name, widget.value]);
        }));
        const initialSettings = await settings();

        await visible(feature);
        await checkReferenceControls(page, root.locator('.cnl-expo-original'), true);
        await checkFeatureSelection(root);
        await hidden(methods);
        await hidden(sam);
        await hidden(rmbg);
        await feature.click();
        await visible(methods);
        await page.waitForFunction(() => document.querySelector('[data-cnl-expo-row="element-image"] img')?.naturalWidth > 0);
        await resizeSidebar(page, 680);
        await checkPreview(preview, methods, 550, Infinity);
        await checkNativeChrome(page, '元素参考');
        assert.ok((await preview.boundingBox()).y < (await methods.boundingBox()).y,
            'Put the reference image before the segmentation method.');

        for (const [name, main, other, setting, otherSetting] of [
            ['SAM3', sam, rmbg, samSetting, rmbgSetting],
            ['RMBG', rmbg, sam, rmbgSetting, samSetting],
        ]) {
            await choose(name);
            await visible(main);
            await hidden(other);
            await visible(advanced);
            await checkPreview(preview, methods, 550, Infinity);
            await checkNativeChrome(page, name);
            assert.ok((await methods.boundingBox()).y < (await main.boundingBox()).y &&
                (await main.boundingBox()).y < (await advanced.boundingBox()).y,
            'Place ' + name + ' controls between the method and advanced settings.');
            assert.equal(await advanced.getAttribute('aria-expanded'), 'false', name + ' advanced settings must start collapsed.');
            await hidden(setting);
            await hidden(otherSetting);
            if (name === 'SAM3') await page.waitForFunction(() =>
                [...document.querySelectorAll('[data-cnl-expo-row="element-core"] canvas')].some(canvas =>
                    canvas.getBoundingClientRect().width > 0 && canvas.width === 320 && canvas.height === 200));
            await advanced.click();
            await visible(setting);
            await hidden(otherSetting);
            await checkNativeChrome(page, name + '高级设置');
        }

        await choose('SAM3');
        await visible(samSetting);
        await hidden(rmbgSetting);
        await choose('不分割');
        for (const target of [sam, rmbg, advanced, samSetting, rmbgSetting]) await hidden(target);
        assert.deepEqual(await settings(), initialSettings, 'Switching and expanding must preserve parameter values.');
        await page.setViewportSize({ width: 960, height: 720 });
        await resizeSidebar(page, 340);
        await checkPreview(preview, methods, 1, 370);
        assert.ok(await methods.evaluate(group => group.scrollWidth <= group.clientWidth + 1),
            'Segmentation controls must fit the narrow sidebar.');
        console.log('PASS UI-LINT-01: Element Reference modes, advanced disclosure and full-width preview in wide and narrow sidebars.');
        await checkTypography(page, '展厅');
        await checkExhibitionLayoutRecovery(page);
        await checkExhibitionCards(page);
        await checkExhibitionStages(page);
        await page.getByRole('button', { name: /^(进入节点图|Enter Node Graph|Graph Mode)$/ }).click();
        await checkBadge(page);
        assert.equal(submissions, 0, 'UI lint must not attempt generation.');
    } finally {
        await browser.close();
    }
}

lint().catch(error => {
    console.error('FAIL App Mode UI lint:', error);
    process.exitCode = 1;
});
