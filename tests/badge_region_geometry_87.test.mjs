import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRegionGeometry87,fetchRegionGeometry87} from '../web/badge_region_geometry_87.mjs';

test('preview follows authoritative ownership, including added pixels and per-layer scope',()=>{
    const source=new Uint8ClampedArray([10,20,30,255,10,20,30,255,10,20,30,255]);
    const geometry={ids:['a','b'],pixels:[1,1,1,255,2,2,2,255,0,0,0,255]};
    const result=renderRegionGeometry87(source,geometry,'mask','b');
    assert.deepEqual([...result],[0,0,0,255,255,255,255,255,0,0,0,255]);
    assert.equal(renderRegionGeometry87(source,geometry,'mask','missing')[0],0);
    assert.throws(()=>renderRegionGeometry87(source,{...geometry,pixels:[]},'mask'),/mismatch/);
});

test('backend error never silently falls back to a threshold preview',async()=>{
    await assert.rejects(fetchRegionGeometry87({fetchApi:async()=>({ok:false,json:async()=>({error:'selection changed'})})},{}),/selection changed/);
});
