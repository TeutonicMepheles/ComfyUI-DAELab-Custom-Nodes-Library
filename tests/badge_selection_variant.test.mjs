import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installBadgeSelectionVariant} from '../web/badge_selection_variant.mjs';

test('variant state survives queue serialization, restore and undo snapshots',()=>{
    const oldDocument=globalThis.document;
    globalThis.document={getElementById:()=>true};
    try {
        class Node {
            constructor(){this.properties={};this.polygonWidget={polygons:[],brushStrokes:[]};this.data={value:''};}
            getPolygonWidget(){return this.data;}
            serializePolygonInfo(){return JSON.stringify({polygons:this.polygonWidget.polygons,cleared:true});}
            restorePolygonInfo(){this.serializePolygonInfo();}
            getPolygonState(){return {polygons:this.polygonWidget.polygons};}
            restorePolygonState(s){this.polygonWidget.polygons=s.polygons;this.serializePolygonInfo();}
            redrawPolygonCanvas(){} updatePolygonButtons(){} clearPolygon(){} onNodeCreated(){}
        }
        installBadgeSelectionVariant(Node);
        const n=new Node(),stroke={diameter:.1,points:[{x:.4,y:.6}]};
        const before=n.getPolygonState();n.polygonWidget.brushStrokes=[stroke];
        const after=n.getPolygonState();const saved=n.serializePolygonInfo();
        assert.deepEqual(JSON.parse(saved).brush_strokes,[stroke]);assert.equal(JSON.parse(saved).cleared,false);
        n.restorePolygonState(before);assert.deepEqual(n.polygonWidget.brushStrokes,[]);
        n.restorePolygonState(after);assert.deepEqual(n.polygonWidget.brushStrokes,[stroke]);
        const restored=new Node();restored.properties.polygon_info=saved;restored.restorePolygonInfo();
        assert.deepEqual(restored.polygonWidget.brushStrokes,[stroke]);
        n.polygonWidget.brushStrokes[0].points[0].x=.9;assert.equal(after.brushStrokes[0].points[0].x,.4);
    } finally {globalThis.document=oldDocument;}
});

test('prototype mask display renders into drawing canvas and restores normal rendering without changing selection',()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById:()=>true};
 try {
  const calls=[];const ctx=new Proxy({}, {get(o,k){return o[k]??((...args)=>calls.push([k,...args]));},set(o,k,v){o[k]=v;return true;}});
  class Node {constructor(){this.properties={};this.polygonWidget={canvas:{width:500,height:250},ctx,brushStrokes:[]};this.originals=0;}redrawPolygonCanvas(){this.originals++;}}
  installBadgeSelectionVariant(Node);const n=new Node();const info={polygons:[{points:[{x:0,y:0},{x:1000,y:0},{x:0,y:500}]}]};
  n.polygonWidget.badgePrototypeMaskPreview={info,width:1000,height:500};
  const before=JSON.stringify(info);n.redrawPolygonCanvas();
  assert.equal(n.originals,0);assert.ok(calls.some(c=>c[0]==='scale'&&c[1]===.5&&c[2]===.5));assert.ok(calls.some(c=>c[0]==='fillRect'));assert.equal(JSON.stringify(info),before);
  delete n.polygonWidget.badgePrototypeMaskPreview;n.redrawPolygonCanvas();assert.equal(n.originals,1);
 } finally {globalThis.document=oldDocument;}
});

test('Clear appearance follows final brush availability and Reset can create an initial polygon',()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById:()=>true};
 try {
  class Node {
   constructor(){this.properties={badge_selection_tool:'brush'};this.polygonWidget={image:{},selectedIndex:-1,brushStrokes:[],buttons:{clear:{style:{}},reset:{style:{}}}};}
   updatePolygonButtons(){for(const b of Object.values(this.polygonWidget.buttons)){b.disabled=true;b.style.opacity='0.45';}}
  }
  installBadgeSelectionVariant(Node);const n=new Node(),w=n.polygonWidget;
  n.updatePolygonButtons();assert.equal(w.buttons.clear.disabled,true);assert.equal(w.buttons.clear.style.opacity,'0.4');
  w.brushStrokes=[{points:[{x:.2,y:.3}]}];n.updatePolygonButtons();assert.equal(w.buttons.clear.disabled,false);assert.equal(w.buttons.clear.style.opacity,'1');assert.equal(w.buttons.clear.style.cursor,'pointer');
  w.pendingSourceImageData={};n.updatePolygonButtons();assert.equal(w.buttons.clear.disabled,true);assert.equal(w.buttons.reset.disabled,true);
  w.pendingSourceImageData=null;n.properties.badge_selection_tool='polygon';n.updatePolygonButtons();assert.equal(w.buttons.reset.disabled,false);assert.equal(w.buttons.reset.style.opacity,'1');
  w.image=null;n.updatePolygonButtons();assert.equal(w.buttons.reset.disabled,true);assert.match(w.buttons.reset.title,/加载/);
 } finally {globalThis.document=oldDocument;}
});
