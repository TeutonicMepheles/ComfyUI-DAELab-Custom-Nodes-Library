import test from 'node:test';
import assert from 'node:assert/strict';
import { accessModelReason, findAccessModel, loadModelAccess } from '../web/model_access.mjs';

test('stage capability is loaded once and resolves a saved provider alias', async () => {
    const requested = [];
    const api = {
        async fetchApi(path) {
            requested.push(path);
            return { ok: true, json: async () => ({
                version: 1, consumer: 'exhibition', stage: 'build',
                models: [{ id: 'image-id', provider: 'image-current' }],
                defaultModel: 'image-id',
                aliases: { 'image-previous': 'image-id' },
            }) };
        },
    };
    const access = await loadModelAccess(api, 'exhibition', 'build');
    assert.equal(await loadModelAccess(api, 'exhibition', 'build'), access);
    assert.equal(requested.length, 1);
    assert.equal(findAccessModel(access, 'image-previous').provider, 'image-current');
    assert.equal(findAccessModel(access).provider, 'image-current');
    assert.equal(accessModelReason(access), '');
    assert.equal(accessModelReason(access, 'image-previous'), '');
    assert.match(accessModelReason(access, 'constructor'), /未登记/);
});

test('failure and environment denial disable model access with a usable reason', async () => {
    const access = await loadModelAccess({ fetchApi: async () => { throw new Error('disconnected'); } }, 'badge', 'build');
    assert.deepEqual(access.models, []);
    assert.match(accessModelReason(access, 'model-id'), /无法读取/);
    const denied = { models: [], aliases: { 'old-id': 'model-id' }, unavailable: { 'model-id': '内网禁用' } };
    assert.equal(accessModelReason(denied, 'old-id'), '内网禁用');
});
