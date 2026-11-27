import assert from 'node:assert/strict';
import test from 'node:test';
import { badgeBuildPriceParameters } from '../web/badge_generation_model.mjs';
import {
    compilePriceBadge, executionPriceInput, generationPriceEstimator, generationPriceQuote,
} from '../web/generation_price.mjs';

const model = {
    provider: 'native-model',
    execution: { nodeType: 'NativeImageNode', modelField: 'model', inputs: {
        count: 'n', size: 'model.size', quality: 'model.quality', references: 'model.images',
    } },
};
const badge = {
    engine: 'jsonata',
    depends_on: {
        widgets: [{ name: 'model', type: 'COMBO' }, { name: 'n', type: 'INT' }],
        input_groups: ['model.images'],
    },
    expr: `($count := $lookup(inputGroups, "model.images");
        $amount := widgets.n * 0.01;
        $count > 0 ? {"type":"range_usd", "min_usd":$amount, "max_usd":$amount + $count * 0.01}
        : {"type":"usd", "usd":$amount})`,
};

test('pricing consumes native ports and the expression accounts for the batch count once', async () => {
    const evaluate = compilePriceBadge(badge);
    const parameters = { count: 4, quality: 'low', size: '1024x1024' };
    const snapshot = executionPriceInput(model, parameters, 0);
    assert.deepEqual(snapshot, {
        nodeType: 'NativeImageNode', widgets: { model: 'native-model', n: 4, 'model.quality': 'low', 'model.size': '1024x1024' },
        inputs: {}, inputGroups: { 'model.images': 0 },
    });
    assert.deepEqual(await evaluate(snapshot), { min: 0.04 * 211, max: 0.04 * 211 });
    assert.deepEqual(await evaluate(executionPriceInput(model, parameters, 2)), { min: 0.04 * 211, max: 0.06 * 211 });
    assert.equal(await evaluate(executionPriceInput(model, { size: 'auto' }, 1)), null);
});

test('badge pricing follows preset normalization and design and height execution inputs', () => {
    const sizes = ['1024x1024', 'Custom'];
    const request = { width: 1024, height: 1024, quality: 'low', count: 4, prompt_only: true };
    const textOnly = badgeBuildPriceParameters(request, sizes);
    assert.equal(textOnly.parameters.size, '1024x1024');
    assert.equal(textOnly.references, 0);
    assert.equal(badgeBuildPriceParameters({ ...request, prompt_only: false, image: {} }, sizes).references, 1);
    const height = badgeBuildPriceParameters({ ...request, prompt_only: false, image: {}, height_board: {} }, ['Custom']);
    assert.equal(height.parameters.size, 'Custom');
    assert.equal(height.references, 2);
});

test('a shared estimator reads only the mapped host node and handles missing or invalid rules', async () => {
    const requests = [];
    const estimator = generationPriceEstimator({ async fetchApi(route) {
        requests.push(route);
        return { ok: true, async json() { return { NativeImageNode: { price_badge: badge } }; } };
    } });
    const snapshot = executionPriceInput(model, { count: 1 }, 0);
    await Promise.all([estimator(snapshot), estimator(snapshot)]);
    assert.deepEqual(requests, ['/object_info/NativeImageNode']);
    assert.equal(await estimator({ ...snapshot, nodeType: 'NoPriceBadge' }), null);
    assert.equal(await compilePriceBadge({ ...badge, expr: '{"type":"range_usd", "min_usd":2,"max_usd":1}' })(snapshot), null);
});

test('quote invalidates stale, failed, and disposed requests independently of submission', async () => {
    const labels = [], pending = new Map();
    const quote = generationPriceQuote(key => new Promise((resolve, reject) => pending.set(key, { resolve, reject })),
        value => labels.push(value));
    const tick = () => new Promise(resolve => setImmediate(resolve));
    quote.update('old');
    quote.update('current');
    await tick();
    pending.get('current').resolve({ min: 1.5, max: 2 });
    await tick();
    pending.get('old').resolve({ min: 99, max: 99 });
    await tick();
    assert.equal(labels.at(-1), '本批预计 1.5–2 积分');
    quote.update('failure');
    await tick();
    pending.get('failure').reject(new Error('missing price'));
    await tick();
    assert.equal(labels.at(-1), '暂无法估算');
    quote.update('dispose');
    await tick();
    quote.dispose();
    pending.get('dispose').resolve({ min: 4, max: 4 });
    await tick();
    assert.equal(labels.at(-1), '估算中…');
});
