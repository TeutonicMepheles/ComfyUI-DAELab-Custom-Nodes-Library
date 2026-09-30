import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSelectionMask, drawBrushStrokes } from '../web/badge_selection_render.mjs';
function recorder(){const calls=[];const ctx=new Proxy({}, {set(o,k,v){o[k]=v;calls.push([k,v]);return true},get(o,k){return o[k]??((...args)=>calls.push([k,...args]))}});return {ctx,calls};}
test('selection preview paints a black background and unions polygon and brush in white',()=>{
 const {ctx,calls}=recorder();drawSelectionMask(ctx,{polygons:[{points:[{x:10,y:20},{x:40,y:20},{x:20,y:60}]}],brush_strokes:[{diameter:.1,points:[{x:.5,y:.25}]}]},200,100);
 assert.deepEqual(calls.slice(0,4),[['fillStyle','#000'],['fillRect',0,0,200,100],['strokeStyle','#fff'],['fillStyle','#fff']]);
 assert.ok(calls.some(c=>c[0]==='moveTo'&&c[1]===10&&c[2]===20));
 assert.ok(calls.some(c=>c[0]==='arc'&&c[1]===100&&c[2]===25&&c[3]===5));
 assert.ok(calls.some(c=>c[0]==='closePath'));
});
test('empty selection stays black and incomplete polygons are ignored',()=>{
 const {ctx,calls}=recorder();drawSelectionMask(ctx,{cleared:true,polygons:[{points:[{x:1,y:2}]}],brush_strokes:[]},100,100);
 assert.ok(!calls.some(c=>c[0]==='fill'||c[0]==='stroke'));
});
test('shared brush rendering covers every point with normalized round caps',()=>{
 const {ctx,calls}=recorder();drawBrushStrokes(ctx,[{diameter:.2,points:[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}]}],100,200);
 assert.equal(calls.filter(c=>c[0]==='arc').length,3);assert.ok(calls.some(c=>c[0]==='lineWidth'&&c[1]===20));
});
