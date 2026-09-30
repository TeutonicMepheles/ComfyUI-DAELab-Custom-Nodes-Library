import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('browser JavaScript entries parse as ES modules', () => {
    const web = new URL('../web/', import.meta.url);
    const files = readdirSync(web).filter(name => /\.(?:js|mjs)$/.test(name));
    const script = `const vm = require('node:vm'); const files = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); for (const [name, source] of files) new vm.SourceTextModule(source, {identifier:name});`;
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', '-e', script], {
        input: JSON.stringify(files.map(name => [name, readFileSync(new URL(name, web), 'utf8')])),
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
});
