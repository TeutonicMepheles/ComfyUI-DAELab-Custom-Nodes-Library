import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaletteReferencePanel, paletteReference } from '../web/badge_palette_reference.mjs';

function fixture() {
    const elements = [];
    globalThis.document = { createElement(tag) {
        const element = { tag, style: {}, isConnected: true, children: [],
            setAttribute() {}, removeAttribute() {}, append(...children) { this.children.push(...children); },
            remove() { this.isConnected = false; } };
        elements.push(element); return element;
    } };
    const requests = [], graph = { extra: { daelabBadgePrototypeV1: {} } };
    let live = true;
    const panel = createPaletteReferencePanel(graph, {
        apiURL: path => path,
        fetchApi: () => new Promise(resolve => requests.push(name => resolve({ok:true,json:async()=>({name})}))),
    }, () => live);
    const file = elements.find(e => e.tag === 'input');
    return { graph, panel, requests, clear: elements.find(e => e.textContent === '清除配色参考图'),
        start() { file.files = [new Blob(['test'], {type:'image/png'})]; file.onchange(); },
        leave() { live = false; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('latest palette upload wins reverse completion', async () => {
    const f = fixture(); f.start(); f.start();
    f.requests[1]('new.png'); await flush(); f.requests[0]('old.png'); await flush();
    assert.equal(paletteReference(f.graph).filename, 'new.png');
});
test('clear, disposal, tab exit and external changes invalidate pending palette upload', async () => {
    for (const invalidate of [f=>f.clear.onclick(), f=>f.panel.dispose(), f=>f.leave(), f=>{f.graph.extra.daelabBadgePrototypeV1.paletteReference='external.png';}]) {
        const f = fixture(); f.start(); invalidate(f);
        const expected = paletteReference(f.graph);
        f.requests[0]('stale.png'); await flush();
        assert.deepEqual(paletteReference(f.graph), expected);
    }
});
