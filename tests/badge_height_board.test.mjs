import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateHeightBoard, resizeHeightBoard, heightBoardPreview } from '../web/badge_height_board_model.mjs';
import { previewPixels } from '../web/badge_build_preview_model.mjs';
import { moveHeightColors, insertHeightTier, deleteHeightTier } from '../web/badge_height_board_model.mjs';
test('whole group drag swaps only source and target colors, preserving other layers and alpha',()=>{
    const b={count:4,fallback:1,alphas:{1:51,2:102,3:179,4:255},groups:[{id:'a',tier:4},{id:'b',tier:3},{id:'c',tier:2},{id:'d',tier:0}]};
    const r=moveHeightColors(b,4,2);
    assert.deepEqual(r.groups.map(g=>g.tier),[2,3,4,0]);assert.deepEqual(r.alphas,b.alphas);assert.equal(r.fallback,1);
    assert.deepEqual(moveHeightColors(r,2,4),b);assert.equal(moveHeightColors(b,4,0),b);
});
test('inline insert and delete retain all colors and surviving slot alpha',()=>{
    const b={count:3,fallback:1,alphas:{1:51,2:153,3:255},groups:[{id:'a',tier:3},{id:'b',tier:1},{id:'c',tier:0}]};
    const inserted=insertHeightTier(b,1);assert.equal(inserted.count,4);assert.deepEqual(inserted.groups.map(g=>g.tier),[4,1,0]);assert.equal(inserted.alphas[4],255);
    const deleted=deleteHeightTier(b,1);assert.deepEqual(deleted.groups.map(g=>g.tier),[2,1,0]);assert.equal(deleted.alphas[1],153);
    assert.equal(deleteHeightTier(deleted,1),deleted);assert.equal(insertHeightTier({...b,count:6},3).count,6);
});
test('custom layer alpha drives every color and survives serialization and resize', () => {
    const board = {count:6,fallback:3,alphas:{3:117,6:240},groups:[{tier:3},{tier:3},{tier:0}]};
    const restored = JSON.parse(JSON.stringify(board));
    assert.deepEqual(heightBoardPreview(restored).groups.map(g=>g.gray),[128,128,0]);
    assert.equal(heightBoardPreview(restored).fallbackGray,128);
    assert.equal(resizeHeightBoard(restored,2).alphas[2],230);
});
test('migration and resize preserve colors, IDs and cutout without mutating source', () => {
    const source = { groups: [{ id: 'a', color: '#ffffff', layer: 0 }, { id: 'b', color: '#000000', layer: 5 }] };
    const board = migrateHeightBoard(source), copy = structuredClone(board);
    const small = resizeHeightBoard(board, 2);
    assert.deepEqual(small.groups.map(g => [g.id,g.tier]), [['a',0],['b',2]]);
    assert.deepEqual(board, copy); assert.equal(source.groups[1].layer, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(small)), small);
});
test('all supported counts map positive tiers to positive gray and top to white', () => {
    for (let count=2;count<=6;count++) {
        const config = heightBoardPreview({count,fallback:1,groups:[{tier:0},{tier:1},{tier:count}]});
        assert.equal(config.groups[0].gray,0); assert.ok(config.groups[1].gray>0); assert.equal(config.groups[2].gray,255);
    }
});
test('composite preview respects explicit gray, fallback and nearest color', () => {
    const source = new Uint8ClampedArray([255,0,0,255,0,255,0,255]);
    const config = heightBoardPreview({count:6,fallback:1,groups:[{color:'#ff0000',threshold:10,tier:3}]});
    assert.deepEqual([...previewPixels(source,config,'height','mask')],[128,128,128,255,51,51,51,255]);
});
