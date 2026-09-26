import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStoryboard,serializeStoryboard} from '../web/daelab_storyboard_model.mjs';
import {reorderShot,transferCell,TableHistory} from '../web/daelab_storyboard_table_model.mjs';
import {localImageFromDrop,generatedImageFromDrop87} from '../web/badge_image_drop_87.mjs';
const state=()=>normalizeStoryboard({shots:[{id:'a',shot_no:'01',image_prompt:'A',image_url:'/view?filename=a.png',source:{row:2}},{id:'b',shot_no:'02',image_prompt:'B',image_url:'/view?filename=b.png',source:{row:3}},{id:'c',shot_no:'03',image_prompt:'C'}]});
test('whole row reorder preserves identity, metadata and content',()=>{
 const s=state();assert(reorderShot(s,'c','a'));assert.deepEqual(s.shots.map(x=>x.id),['c','a','b']);
 assert.equal(s.shots[1].source.row,2);assert.equal(s.shots[1].image_url,'/view?filename=a.png');
 assert(reorderShot(s,'c','b',true));assert.deepEqual(s.shots.map(x=>x.id),['a','b','c']);
 assert(!reorderShot(s,'missing','a'));assert(!reorderShot(s,'a','a'));
});
test('swap move replace retain row identities and synchronize prompt aliases',()=>{
 const s=state();assert(transferCell(s,'a','image_prompt','b','image_prompt','swap'));
 assert.equal(s.shots[0].prompt,'B');assert.equal(s.shots[1].image_prompt,'A');assert.equal(s.shots[0].source.row,2);
 assert(!transferCell(s,'a','image_url','b','image_prompt','replace'));
 assert(!transferCell(s,'a','image_url','b','image_url','move'));
 assert(transferCell(s,'a','image_url','c','image_url','move'));assert.equal(s.shots[0].image_url,'');assert.equal(s.shots[2].image_url,'/view?filename=a.png');
 assert(transferCell(s,'b','image_prompt','a','image_prompt','replace'));assert.equal(s.shots[1].image_prompt,'');assert.equal(s.shots[1].prompt,'');
});
test('undo redo roundtrip and edit grouping preserve full state',()=>{
 const s=state(),h=new TableHistory(),before=serializeStoryboard(s);
 reorderShot(s,'a','c',true);const after=serializeStoryboard(s);h.record(before,after);
 assert.equal(serializeStoryboard(h.restore(after)),before);assert.equal(serializeStoryboard(h.restore(before,true)),after);
 h.record(after,'edited','typing');h.record('edited','edited twice','typing');assert.equal(h.undoStack.length,2);
 h.record('edited twice','new action');assert.equal(h.redoStack.length,0);
});
test('column order, changed flag and source survive save reload',()=>{
 const s=state();s.column_order=['image_url','image_prompt','shot_no','time_range','camera_notes'];s.shots[0].input_changed=true;
 const copy=normalizeStoryboard(serializeStoryboard(s));assert.deepEqual(copy.column_order,s.column_order);assert.equal(copy.shots[0].input_changed,true);
 assert.equal(copy.shots[0].id,'a');assert.equal(copy.shots[0].source.row,2);
});
test('image drag reuses local source references without widening badge policy',()=>{
 const transfer={getData:t=>t==='text/uri-list'?'http://localhost:8199/view?filename=a.png&type=input':''};
 assert.equal(localImageFromDrop(transfer,'http://localhost:8199').type,'input');assert.equal(generatedImageFromDrop87(transfer,'http://localhost:8199'),null);
 assert.equal(localImageFromDrop(transfer,'http://another-host'),null);
});
