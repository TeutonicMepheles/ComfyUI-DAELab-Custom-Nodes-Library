import test from "node:test";
import assert from "node:assert/strict";
import {draftTable, applyImportedShots, normalizeStoryboard, serializeStoryboard, moveShot} from "../web/daelab_storyboard_model.mjs";

test("draft preserves missing prompts, original fields and ambiguous images", () => {
    const table={id:0,header_index:0,mapping:{image_prompt:1},rows:[["id","visual","voice"],["1","","keep narration"]],images:{"1:1":["a","b"]}};
    const draft=draftTable({filename:"test.docx"},table);
    assert.equal(draft.length,1); assert.equal(draft[0].asset_id,"");
    assert.deepEqual(draft[0].candidate_assets,["a","b"]);
    assert.equal(draft[0].original_fields[2].value,"keep narration");
    assert.equal(draft[0].source.row,2);
    assert.equal(draft[0].image_prompt,"");
});
test("append replace and save restore preserve stable identity and source", () => {
    const state=normalizeStoryboard({shots:[{id:"old",image_prompt:"old"}]});
    const result={filename:"test.docx",shots:[{id:"new",image_prompt:"new",source:{row:2},original_fields:[{value:"voice"}]}]};
    applyImportedShots(state,result,"append"); moveShot(state,1,-1);
    const restored=normalizeStoryboard(serializeStoryboard(state));
    assert.deepEqual(restored.shots.map(s=>s.id),["new","old"]);
    assert.equal(restored.shots[0].source.row,2);
    assert.equal(restored.shots[0].original_fields[0].value,"voice");
    applyImportedShots(state,result,"replace"); assert.equal(state.shots.length,1);
});
test("clearing a prompt does not restore its previous value",()=>{
    const state=normalizeStoryboard({shots:[{image_prompt:"",prompt:"stale"}]});
    assert.equal(JSON.parse(serializeStoryboard(state)).shots[0].image_prompt,"");
});
