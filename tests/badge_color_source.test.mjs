import test from 'node:test';
import assert from 'node:assert/strict';
import { colorSelectionSource } from '../web/badge_color_source.mjs';
import { previewPixels } from '../web/badge_build_preview_model.mjs';

test('map sampling and matching share simplified pixels without changing the original', () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([210, 20, 110, 255, 220, 25, 115, 128]) };
    const map = colorSelectionSource(image, true);
    assert.deepEqual([...map.data], [170, 0, 85, 255, 255, 0, 85, 128]);
    const mask = previewPixels(map.data, { groups: [{ color: '#aa0055', threshold: 0 }] }, 'color', 'mask');
    assert.deepEqual([...mask], [255,255,255,255,0,0,0,255]);
    assert.equal(colorSelectionSource(image, false), image);
    assert.equal(image.data[0], 210);
    assert.equal(colorSelectionSource(image, true), map);
});
test('missing and replaced sources cannot reuse a stale map', () => {
    assert.equal(colorSelectionSource(null, true), null);
    const first = { width: 1, height: 1, data: new Uint8ClampedArray([0,0,0,255]) };
    const second = { ...first, data: new Uint8ClampedArray([255,255,255,255]) };
    assert.notEqual(colorSelectionSource(first, true), colorSelectionSource(second, true));
    assert.equal(colorSelectionSource(second, true).data[0], 255);
});
import { generateColorSelectionSource } from '../web/badge_color_source.mjs';
test('generation reports actual chunk progress, regenerates and supports cancellation', async () => {
    const image = { width: 512, height: 512, data: new Uint8ClampedArray(512 * 512 * 4).fill(100) };
    const progress = [];
    const first = await generateColorSelectionSource(image, { onProgress: p => progress.push(p) });
    assert.deepEqual(progress, [0,25,50,75,100]);
    assert.deepEqual(first.data, colorSelectionSource(image, true).data);
    assert.notEqual(await generateColorSelectionSource(image), first);
    assert.equal(await generateColorSelectionSource(image, { cancelled: () => true }), null);
});
