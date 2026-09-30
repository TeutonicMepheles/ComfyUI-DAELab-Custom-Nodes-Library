import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueBadge87 } from '../web/badge_execution_87_queue.mjs';

test('87 submits through native auth and restores hooks on success', async () => {
    const graph = {};
    const compiled = { output: {}, workflow: {} };
    const original = async () => 'original';
    const app = { rootGraph: graph, graphToPrompt: original };
    const submit = async function(number, prompt) {
        assert.equal(this.authToken, 'native-token');
        assert.equal(prompt, compiled);
        return { prompt_id: 'test' };
    };
    const api = { queuePrompt: submit };
    const native = async function() {
        api.authToken = 'native-token';
        try { await api.queuePrompt(0, await this.graphToPrompt()); }
        finally { delete api.authToken; }
    };
    assert.equal((await queueBadge87(app, api, native, graph, compiled)).prompt_id, 'test');
    assert.equal(app.graphToPrompt, original);
    assert.equal(api.queuePrompt, submit);
    assert.equal(api.authToken, undefined);
});

test('87 restores hooks after rejected submission or workflow switch', async () => {
    for (const switched of [false, true]) {
        const graph = {};
        const app = { rootGraph: graph, graphToPrompt: async () => null };
        const api = { queuePrompt: async () => { throw new Error('server failure'); } };
        const original = app.graphToPrompt;
        const submit = api.queuePrompt;
        const native = async function() {
            if (switched) this.rootGraph = {};
            try { await api.queuePrompt(0, await this.graphToPrompt()); } catch {}
        };
        await assert.rejects(queueBadge87(app, api, native, graph, {}));
        assert.equal(app.graphToPrompt, original);
        assert.equal(api.queuePrompt, submit);
    }
});
