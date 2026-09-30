import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('App Mode entry links with a cached pre-toggle generation module', () => {
    const entry = new URL('../web/badge_build_prototype.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
        import vm from 'node:vm';
        import { readFileSync } from 'node:fs';
        const cache = new Map();
        function moduleFor(url) {
            if (cache.has(url)) return cache.get(url);
            let module;
            if (!url.startsWith('file:')) {
                module = new vm.SyntheticModule(['app', 'api', 'ComfyWidgets', 'ComfyDialog', 'LiteGraph', 'LGraphCanvas'], function() {});
            } else {
                let source = readFileSync(new URL(url), 'utf8');
                // An existing browser cache predates the newly added export.
                if (url.endsWith('/badge_generation_model.mjs')) {
                    source = source.replace('export function initializePromptOnlyBuild', 'function initializePromptOnlyBuild');
                }
                module = new vm.SourceTextModule(source, { identifier: url });
            }
            cache.set(url, module);
            return module;
        }
        await moduleFor(${JSON.stringify(entry)}).link((specifier, parent) =>
            moduleFor(specifier.startsWith('.') ? new URL(specifier, parent.identifier).href : specifier));
        if ([...cache.keys()].some(url => url.endsWith('/badge_generation_model.mjs'))) {
            throw new Error('Stage consumers still load the cached pre-toggle generation logic');
        }
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
