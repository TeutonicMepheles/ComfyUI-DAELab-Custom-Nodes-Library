import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedImageFromDrop87} from '../web/badge_image_drop_87.mjs';
const base = 'http://127.0.0.1:8000/';
const drop = values => ({getData: type => values[type] || ''});
test('native image URL preserves output folder and decoded filename', () => {
    assert.deepEqual(generatedImageFromDrop87(drop({'text/uri-list': '# image\nhttp://127.0.0.1:8000/api/view?filename=a%20b.png&type=output&subfolder=Badge87%2Fbuild&preview=webp'}), base),
        {filename:'a b.png', type:'output', subfolder:'Badge87/build'});
});
test('plain URL supports temporary results but rejects external URLs and unrelated payloads', () => {
    assert.equal(generatedImageFromDrop87(drop({'text/plain':'https://example.com/view?filename=a.png&type=output'}), base), null);
    for (const value of ['/view?filename=a.png&type=input', '/other?filename=a.png', '{"workflow":true}', '/view?type=output']) {
        assert.equal(generatedImageFromDrop87(drop({'text/plain':value}), base), null);
    }
    assert.equal(generatedImageFromDrop87(drop({'text/plain':'/view?filename=a.png&type=temp'}), base).type, 'temp');
});
