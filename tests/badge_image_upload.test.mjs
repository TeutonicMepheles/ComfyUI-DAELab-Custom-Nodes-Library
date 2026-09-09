import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localTargets87, setExistingTarget87, selectLocalSource87 } from '../web/badge_result_target_87.mjs';

// Exercise the adapter's actual handlers with controlled network completion order.
const source = readFileSync(new URL('../web/badge_build_prototype.js', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('    const imageSelections ='), source.indexOf('    file.onchange'));
function fixture(badge87 = false) {
    const widget = { name: 'image', value: 'initial.png', options: { values: [] } };
    const target = { id: 1, widgets: [widget] };
    const requests = [], uploadButton = {}, status = {}, file = { value: 'pending' };
    let live = true, currentNode = target, changes = 0;
    const create = new Function('imageWidget', 'sourceNode', 'node', 'live', 'selectionKey',
        'uploadButton', 'status', 'file', 'state', 'update', 'graph', 'api', 'local', 'segmented', 'localTargets87', 'setExistingTarget87', 'getPrototypeSession',
        `${handlers}; return { upload, setImage };`);
    const api = { fetchApi: () => new Promise((resolve, reject) => requests.push({
        complete: name => resolve({ ok: true, json: async () => ({ name }) }), reject,
    })) };
    const graph = {beforeChange() { changes++; }, afterChange() {}, getNodeById: id => id===1 ? target : null,
        extra:{daelabBadgeExecutionV1:{version:1},daelabBadgePrototypeV1:{localReferenceNodeId:1,stateNodeId:95}}};
    const session = {};
    if (badge87) localTargets87(graph).source='existing';
    const actions = create(() => widget, () => target, () => currentNode, () => live, JSON.stringify,
        uploadButton, status, file, {}, () => {}, graph, api, badge87, badge87, localTargets87, setExistingTarget87, () => session);
    return { ...actions, widget, target, requests, uploadButton, status, file, graph, session,
        changes: () => changes, dispose: () => { live = false; },
        replaceNode: () => { currentNode = { id: 1 }; },
        start: () => actions.upload(new Blob(['image'], { type: 'image/png' })),
    };
}

test('newer upload wins when responses complete in reverse order', async () => {
    const f = fixture(), a = f.start(), b = f.start();
    f.requests[1].complete('B.png'); await b;
    f.requests[0].complete('A.png'); await a;
    assert.equal(f.widget.value, 'B.png');
    assert.deepEqual(f.widget.options.values, ['B.png']);
    assert.equal(f.changes(), 1);
});

test('8.7 uploads update the existing source and switching away rejects a pending result', async () => {
    const f=fixture(true), upload=f.start();
    f.requests[0].complete('existing.png'); await upload;
    assert.equal(localTargets87(f.graph).existing.filename,'existing.png');
    const pending=f.start();
    selectLocalSource87(f.graph,'generated',f.session);
    f.requests[1].complete('stale.png'); await pending;
    assert.equal(f.widget.value,'');
    assert.equal(localTargets87(f.graph).existing.filename,'existing.png');
    await f.start();
    assert.equal(f.requests.length,2);
});

test('old completion cannot unlock or clear the newer pending upload', async () => {
    const f = fixture(), a = f.start(), b = f.start();
    f.requests[0].complete('A.png'); await a;
    assert.equal(f.widget.value, 'initial.png');
    assert.equal(f.uploadButton.disabled, true);
    assert.equal(f.file.value, 'pending');
    f.requests[1].complete('B.png'); await b;
    assert.equal(f.widget.value, 'B.png');
    assert.equal(f.uploadButton.disabled, false);
});

test('gallery selection invalidates upload even when reselecting the same filename', async () => {
    for (const selected of ['gallery.png', 'initial.png']) {
        const f = fixture(), a = f.start();
        f.setImage(selected);
        f.requests[0].complete('A.png'); await a;
        assert.equal(f.widget.value, selected);
        assert.equal(f.uploadButton.disabled, false);
        assert.equal(f.changes(), 1);
    }
});

test('stale upload errors cannot overwrite the latest status', async () => {
    const f = fixture(), a = f.start(), b = f.start();
    f.requests[0].reject(new Error('old error')); await a;
    assert.equal(f.status.textContent, '正在上传…');
    assert.equal(f.uploadButton.disabled, true);
    f.requests[1].reject(new Error('new error')); await b;
    assert.equal(f.status.textContent, 'new error');
    assert.equal(f.uploadButton.disabled, false);
});

test('disposed panels, replaced nodes and external selection changes reject stale writes', async () => {
    for (const invalidate of [f => f.dispose(), f => f.replaceNode(), f => { f.widget.value = 'external.png'; }]) {
        const f = fixture(), a = f.start();
        invalidate(f);
        const before = f.widget.value;
        f.requests[0].complete('A.png'); await a;
        assert.equal(f.widget.value, before);
        assert.equal(f.changes(), 0);
    }
});

test('latest failed selection does not revive an older successful upload', async () => {
    const f = fixture(), a = f.start(), b = f.start();
    f.requests[1].reject(new Error('B failed')); await b;
    f.requests[0].complete('A.png'); await a;
    assert.equal(f.widget.value, 'initial.png');
    assert.equal(f.status.textContent, 'B failed');
});
