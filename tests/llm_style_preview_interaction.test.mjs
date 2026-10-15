import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSignature,applyPreview,undoPreview} from '../web/llm_style_preview_interaction.mjs';
const sample=()=>{const s={source:'原文',instruction:'保留原意',mode:'polish',model:'deepseek'};s.demo={result:'示例结果',signature:previewSignature(s)};return s;};
test('apply is explicit, idempotent, reversible after workflow serialization',()=>{
    const s=sample();assert.equal(s.source,'原文');assert.equal(applyPreview(s),true);assert.equal(applyPreview(s),false);
    const restored=JSON.parse(JSON.stringify(s));assert.equal(undoPreview(restored),true);assert.equal(restored.source,'原文');assert.equal(undoPreview(restored),false);
});
test('changed inputs prevent applying an obsolete result',()=>{
    for(const key of ['source','instruction','mode','model']){const s=sample();s[key]='changed';assert.equal(applyPreview(s),false);}
});
test('undo cannot overwrite a subsequent manual edit; instances are independent',()=>{
    const a=sample(),b=sample();applyPreview(a);a.source='手工修改';assert.equal(undoPreview(a),false);assert.equal(a.source,'手工修改');assert.equal(b.source,'原文');
});
