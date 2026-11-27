import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
    INITIAL_COUNT_MAX, generationFold, generationLoadIdentity, markGenerationGraphLoaded,
    migrateInitialCount, normalizeCountDraft, validGenerationCount,
} from '../web/generation_ui_model.mjs';
import {
    EXHIBITION_BUILD_WIDGETS, exhibitionCapability, exhibitionDimension, exhibitionModelPatch, exhibitionPreset, readExhibitionBuild,
    resolveExhibitionBuild, storedExhibitionCount, validateExhibitionBuild, verifyExhibitionPrompt,
} from '../web/exhibition_generation_model.mjs';
import { REGION_KEY } from '../web/image_editing_model.mjs';

const workflows = new URL('../user/default/workflows/', import.meta.url);
const readWorkflow = label => JSON.parse(readFileSync(new URL(encodeURIComponent(
    readdirSync(workflows).find(name => name.startsWith('CNL-' + label)),
), workflows), 'utf8'));

test('initial count rejects malformed persisted values, while drafts normalize on commit', () => {
    for (const value of [null, false, true, '2', 0, -4, 5, 8, 9, NaN, Infinity, 2.5, undefined]) {
        assert.equal(validGenerationCount(value), false, String(value));
    }
    for (const [draft, value] of [['',1],['bad',1],['0',1],['-1',1],['2.5',3],['8',4],['9',4]]) {
        assert.equal(normalizeCountDraft(draft), value);
    }
    assert.ok(validGenerationCount(1) && validGenerationCount(INITIAL_COUNT_MAX));
});

test('only old integer counts migrate, once per load and with independent copies and folds', () => {
    const first = { id: 'same', extra: {} }, copy = { id: 'same', extra: {} };
    let output, notifications = 0;
    const migrate = (g, value) => migrateInitialCount(g, value, number => { output = number; }, () => notifications++);
    assert.equal(migrate(first, 2), false);
    assert.equal(migrate(first, 8), false, 'node edits after load are not migrated');
    assert.equal(migrate(copy, 8), true);
    assert.equal(output, 4);
    assert.equal(migrate(copy, 8), false);
    copy.extra = {};
    markGenerationGraphLoaded(copy, true);
    assert.equal(migrate(copy, 8), false, 'undo does not re-run migration');
    markGenerationGraphLoaded(copy);
    assert.equal(generationLoadIdentity(copy), 2);
    assert.equal(migrate(copy, 5), true);
    assert.equal(notifications, 2);
    assert.equal(migrate({ extra: {} }, '8'), false);
    generationFold(first, 'badge.build').setCollapsed(true);
    assert.equal(generationFold(first, 'badge.build').collapsed(), true);
    assert.equal(generationFold(copy, 'badge.build').collapsed(), false);
    assert.equal(generationFold(first, 'badge.local').collapsed(), false);
});

function exhibitionFixture() {
    const workflow = readWorkflow('展厅');
    const first = workflow.nodes.find(n => n.id === 1040);
    const keys = ['prompt', 'model', 'model.size', 'model.custom_width', 'model.custom_height', 'model.background',
        'model.quality', 'n', 'seed', 'control_after_generate'];
    first.widgets = keys.map((name, index) => ({ name, value: first.widgets_values[index] }));
    workflow.getNodeById = id => workflow.nodes.find(node => String(node.id) === String(id));
    return workflow;
}

test('distributed exhibition workflow binds only node 1040 and its stable input keys', () => {
    const workflow = exhibitionFixture();
    const { node, widgets, inputKeys } = resolveExhibitionBuild(workflow);
    assert.equal(node.id, 1040);
    assert.deepEqual(Object.fromEntries(Object.entries(widgets).map(([key, widget]) => [key, widget.name])), EXHIBITION_BUILD_WIDGETS);
    assert.deepEqual(readExhibitionBuild(widgets), { model: 'gpt-image-2', size: 'auto', width: 1024, height: 1024, quality: 'medium', count: 1 });
    assert.equal(inputKeys.length, 3);
    for (const key of inputKeys) assert.ok(key.includes(':1040:'));
    assert.ok(workflow.nodes.find(n => n.id === 1058).inputs.some(input => input.link != null && /width|height/.test(input.name)));
});

test('distributed badge workflow retains its generation defaults and an isolated local editing anchor', () => {
    const badge = readWorkflow('徽章');
    const marker = badge.extra[REGION_KEY];
    assert.equal(marker.version, 1);
    assert.equal(marker.kind, 'badge');
    const anchor = badge.nodes.find(node => node.id === marker.local);
    const source = badge.nodes.find(node => node.id === marker.sources.local);
    assert.equal(anchor?.type, 'LoadImage');
    assert.equal(source?.type, 'AppModeLoadImage');
    assert.notEqual(anchor.id, source.id);
    assert.equal(anchor.mode, 0);
    assert.deepEqual(anchor.inputs, []);
    assert.ok(anchor.outputs.every(output => !output.links?.length));
    assert.ok(badge.links.every(([, from, , to]) => from !== anchor.id && to !== anchor.id));
    assert.equal(badge.nodes.filter(node => node.id !== anchor.id).length, 29);
    assert.equal(badge.extra.daelabBadgePrototypeV1.generation.build.count, 4);
    assert.equal(badge.extra.daelabBadgePrototypeV1.generation.local.count, 2);
});

test('count restoration reads the saved slot and preserves types across a rebuilt model layout', () => {
    const workflow = exhibitionFixture();
    const binding = resolveExhibitionBuild(workflow);
    assert.equal(storedExhibitionCount(workflow, binding), 1);
    const slot = binding.node.widgets.indexOf(binding.widgets.count);
    binding.node.widgets_values[slot] = '8';
    assert.equal(storedExhibitionCount(workflow, binding), '8');
    delete binding.node.widgets_values[slot];
    binding.node.widgets_values_named = { n: null };
    assert.equal(storedExhibitionCount(workflow, binding), null);
    binding.node.inputs = [{ widget: { name: 'model' } }, { widget: { name: 'n' } }];
    binding.node.widgets_values = ['retired-model', 6];
    assert.notEqual(slot, 1);
    assert.equal(storedExhibitionCount(workflow, binding), 6);
});

test('binding rejects unknown versions, a replacement type and missing widgets', () => {
    const workflow = exhibitionFixture();
    const marker = workflow.extra.daelabExhibitionUiV1;
    marker.version = 2;
    assert.throws(() => resolveExhibitionBuild(workflow), /版本/);
    marker.version = 1;
    const node = workflow.getNodeById(1040);
    node.type = 'Other';
    assert.throws(() => resolveExhibitionBuild(workflow), /1040/);
    node.type = marker.build.type;
    node.widgets = node.widgets.filter(w => w.name !== 'model.size');
    assert.throws(() => resolveExhibitionBuild(workflow), /model.size/);
});

test('effective capability retains auto, 4K, Custom and the registered quality values', () => {
    const size = { default: 'auto', values: ['auto','3840x2160','Custom'] };
    const quality = { default: 'medium', values: ['medium','high'] };
    const range = { min: 480, max: 3840, step: 16 };
    const schema = exhibitionCapability({
        provider: 'gpt-image-2', parameters: { size, quality, width: range, height: range },
        constraints: { customDimensions: { maxAspect: 3, minPixels: 655360, maxPixels: 8294400 } },
    });
    assert.deepEqual(schema.sizes, ['auto','3840x2160','Custom']);
    assert.deepEqual(schema.qualities, ['medium','high']);
    const base = { model: 'gpt-image-2', quality: 'medium', count: 4 };
    const validate = config => validateExhibitionBuild({ ...base, ...config }, schema);
    assert.equal(validate({ size: 'auto' }), '');
    assert.equal(validate({ size: '3840x2160' }), '');
    assert.deepEqual(exhibitionPreset({ size: '3840x2160' }, schema), { size: '3840x2160', ratio: '16:9', tier: '4K' });
    assert.equal(exhibitionDimension({ size: '3840x2160', height: 1024 }, 'height'), 2160);
    assert.equal(exhibitionDimension({ size: 'auto', height: 1024 }, 'height'), undefined);
    assert.equal(exhibitionModelPatch({ size: 'auto', quality: 'xhigh' }, schema).quality, 'medium');
    assert.equal(validate({ size: 'Custom', width: 3840, height: 2160 }), '');
    assert.match(validate({ size: 'Custom', width: 1025, height: 1024 }), /步长/);
    assert.match(validate({ size: 'Custom', width: 3840, height: 480 }), /长宽比/);
    assert.match(validate({ size: 'auto', quality: 'max' }), /质量/);
    assert.match(validate({ size: 'auto', model: 'other' }), /模型/);
    assert.equal(exhibitionCapability(undefined), undefined);
});

test('compiled exhibition prompt guards the frozen settings and references of the marked first-pass node', () => {
    const type = 'OpenAIGPTImageNodeV2';
    const node = { id: 1040 };
    const prompt = { output: { 1040: { class_type: type, inputs: { n: 4 } }, 1058: { class_type: type, inputs: { n: 8 } } } };
    assert.doesNotThrow(() => verifyExhibitionPrompt(prompt, node));
    for (const value of [5, null, 1.25, '1', ['100', 0]]) {
        prompt.output[1040].inputs.n = value;
        assert.throws(() => verifyExhibitionPrompt(prompt, node), /1–4/);
    }
    const config = { model: 'gpt-image-2', size: 'Custom', quality: 'high', width: 1024, height: 1536, count: 4 };
    const input = { name: 'model.images.image_2' };
    const connections = [{ input, link: { origin_id: 1056, origin_slot: 0 } }];
    prompt.output[1040].inputs = { n: 4, model: config.model, 'model.size': 'Custom', 'model.quality': 'high',
        'model.custom_width': 1024, 'model.custom_height': 1536, [input.name]: ['1056', 0] };
    assert.doesNotThrow(() => verifyExhibitionPrompt(prompt, node, config, connections));
    assert.throws(() => verifyExhibitionPrompt(prompt, node, { ...config, width: 1536 }, connections), /不一致/);
    delete prompt.output[1040].inputs[input.name];
    assert.throws(() => verifyExhibitionPrompt(prompt, node, config, connections), /参考图/);
    delete prompt.output[1040];
    assert.doesNotThrow(() => verifyExhibitionPrompt(prompt, node, config));
});
