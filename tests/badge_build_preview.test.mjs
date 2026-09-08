import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePoint, previewPixels } from '../web/badge_build_preview_model.mjs';

test('contain coordinates reject letterbox and map scaled image pixels', () => {
    assert.equal(imagePoint(20, 10, 200, 100, 100, 100), null);
    assert.deepEqual(imagePoint(75, 25, 200, 100, 100, 100), [25, 25]);
    assert.equal(imagePoint(150, 50, 200, 100, 100, 100), null);
});
test('threshold is inclusive RGB distance and preserves original pixels', () => {
    const source = new Uint8ClampedArray([3, 4, 0, 255, 6, 0, 0, 128]);
    const saved = [...source];
    const config = {groups: [{color: '#000000', threshold: 5}]};
    assert.deepEqual([...previewPixels(source, config, 'background', 'mask')], [255,255,255,255,0,0,0,255]);
    assert.deepEqual([...previewPixels(source, config, 'background', 'cutout')], [3,4,0,0,6,0,0,128]);
    assert.deepEqual([...source], saved);
});
test('inverted and individual masks respect output selection', () => {
    const source = new Uint8ClampedArray([255,0,0,255,0,0,255,255]);
    const config = {output: 'mask_2', groups: [{color:'#0000FF', threshold:0}, {color:'#FF0000', threshold:0, invert:true}]};
    assert.deepEqual([...previewPixels(source, config, 'background', 'mask')], [0,0,0,255,255,255,255,255]);
});
test('height preview uses discrete levels including zero', () => {
    const source = new Uint8ClampedArray([255,0,0,255,0,0,255,255]);
    const config = {groups: [{color:'#FF0000', threshold:0, layer:3}, {color:'#0000FF', threshold:0, layer:0}]};
    assert.deepEqual([...previewPixels(source, config, 'height', 'mask')], [153,153,153,255,0,0,0,255]);
});
