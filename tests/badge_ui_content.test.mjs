import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { badgeText } from '../web/badge_ui_text.mjs';
import { messages } from '../web/badge_ui_catalog.mjs';

const read = path => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), path), 'utf8'));

test('every extracted UI message retains baseline wording and compiled source', () => {
    const source = read('../content/badge87/ui.zh-CN.json').messages;
    const baseline = read('./fixtures/badge87_ui_baseline.json').messages;
    assert.deepEqual(messages, source);
    // The extraction baseline protects existing wording; new UI may add keys.
    for (const key of Object.keys(baseline)) {
        const value = source[key];
        assert.equal(createHash('sha256').update(value).digest('hex'), baseline[key], key);
    }
});

test('UI substitution is single-pass and rejects missing keys or values', () => {
    assert.throws(() => badgeText('missing.key'), /Unknown Badge UI text/);
    const [key, text] = Object.entries(messages).find(([, text]) => text.includes('{{p0}}'));
    const names = [...text.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map(match => match[1]);
    const values = Object.fromEntries(names.map(name => [name, '{{p0}} $& 中文']));
    assert.equal(badgeText(key, values), text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, () => '{{p0}} $& 中文'));
    assert.throws(() => badgeText(key), /Missing Badge UI variable/);
});

test('workflow default copy bindings preserve the distributed workflow', () => {
    const binding = read('../content/badge87/ui.workflow-bindings.json');
    const workflow = read('../' + binding.file);
    for (const entry of binding.bindings) {
        assert.equal(entry.path.reduce((value, part) => value[part], workflow), messages[entry.key], entry.key);
    }
});
