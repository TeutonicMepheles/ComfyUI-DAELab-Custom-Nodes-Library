import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function load(file, yielded, ready) {
    const registrations = [], events = new Map(), extensions = [];
    const context = vm.createContext({
        YIELDED_EXTENSIONS: yielded,
        app: {registerExtension: extension => extensions.push(extension)},
        addEventListener: (name, listener) => events.set(name, listener),
    });
    const api = {version: 1, registerAdapter: (id, adapter) => registrations.push({id, adapter})};
    const key = Symbol.for('DAELAB.CreativeCanvas.API.v1');
    if (ready) context[key] = api;
    const source = readFileSync(new URL('../web/' + file, import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '');
    vm.runInContext(source, context, {filename: file});
    return {registrations, extensions, publish() {
        context[key] = api;
        events.get('daelab:creative-canvas-ready')?.();
    }};
}

for (const [file, owner, adapterId] of [
    ['creative_canvas_adapter.js', 'DAELab.DataTable', 'daelab.business'],
    ['script_parser.js', 'DAELab.ScriptParser', 'daelab.script-parser'],
    ['llm_style_preview.js', 'DAELab.LLMStylePreview', 'daelab.llm-style-preview'],
]) {
    for (const ready of [false, true]) {
        test(`${file}: standalone registers once with canvas ready=${ready}`, () => {
            const fixture = load(file, [], ready);
            if (!ready) assert.equal(fixture.registrations.length, 0);
            fixture.publish(); fixture.publish();
            assert.deepEqual(fixture.registrations.map(item => item.id), [adapterId]);
        });
        test(`${file}: Studio owner prevents adapter overwrite with canvas ready=${ready}`, () => {
            const fixture = load(file, [owner], ready);
            fixture.publish(); fixture.publish();
            assert.equal(fixture.registrations.length, 0);
        });
    }
    test(`${file}: unrelated yielded extensions do not disable its adapter`, () => {
        const fixture = load(file, ['DAELab.PromptOptimization.Identity.v1'], true);
        assert.equal(fixture.registrations.length, 1);
    });
}
