import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryboard, serializeStoryboard } from '../web/daelab_storyboard_model.mjs';
import { applyGroups, rowReferences } from '../web/daelab_storyboard_groups.mjs';
import { reorderShot, TableHistory } from '../web/daelab_storyboard_table_model.mjs';
const item=url=>({id:url,url,name:url});
const fixture=()=>normalizeStoryboard({shots:[{id:'a',image_prompt:'one'},{id:'b',image_prompt:'two',selected:false}],asset_groups:[{id:'scenes',name:'场景',mode:'sequence',items:[item('scene-a'),item('scene-b')]},{id:'actor',name:'角色',mode:'shared',items:[item('actor')]}]});
test('sequential group plus shared group expands row references and preserves selection on reload',()=>{
 const s=fixture();applyGroups(s);const restored=normalizeStoryboard(serializeStoryboard(s));
 assert.deepEqual(rowReferences(restored,restored.shots[0]),['scene-a','actor']);
 assert.deepEqual(rowReferences(restored,restored.shots[1]),['scene-b','actor']);assert.equal(restored.shots[1].selected,false);
 reorderShot(restored,'b','a',false);assert.deepEqual(rowReferences(restored,restored.shots[0]),['scene-b','actor']);
});
test('mismatched assignment is atomic, empty table expands and undo restores entire group state',()=>{
 const s=fixture();s.asset_groups[0].items.pop();const before=serializeStoryboard(s);assert.throws(()=>applyGroups(s),/需要 2/);assert.equal(serializeStoryboard(s),before);
 const t=fixture();t.shots=[];const empty=serializeStoryboard(t);applyGroups(t);assert.equal(t.shots.length,2);assert.notEqual(t.shots[0].id,t.shots[1].id);
 const h=new TableHistory();h.record(empty,serializeStoryboard(t));assert.equal(h.restore(serializeStoryboard(t)).shots.length,0);
});
