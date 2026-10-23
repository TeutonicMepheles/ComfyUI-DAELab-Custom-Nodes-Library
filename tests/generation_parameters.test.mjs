import test from 'node:test';
import assert from 'node:assert/strict';
import {generationDurationOptions,generationParameterSpecs,generationParameterModes,promptSettingsItems,generationParametersSummary} from '../web/table_prompt_settings.mjs';
import {generationModelIconURL} from '../web/generation_model_icons.mjs';

test('combined video summary preserves saved values without mutating config or adding defaults',()=>{
 const config={kind:'video',model:'Seedance 2.5',mode:'frames2video',settings:{resolution:'720p',duration:9,enableSound:'off'}};
 const before=structuredClone(config),items=promptSettingsItems(config,{combined:true});
 assert.deepEqual(items.map(x=>x.key),['kind','model','parameters']);
 assert.match(items[2].text,/首尾帧 · 720p · 9s · 音频关闭/);
 assert.deepEqual(config,before);
 assert.equal(promptSettingsItems(config).length,5,'existing table settings keep their individual entry points');
});
test('image summary omits stale video duration; local dimensions remain visible',()=>{
 assert.equal(generationParametersSummary({kind:'image',mode:'text2image',settings:{width:1024,height:1024,duration:9}}),'文生图 · 1:1 · 1024×1024');
});
test('combined options use mode-specific capabilities and include audio but omit advanced controls',()=>{
 const schema={properties:{ratio:{enum:['16:9']},resolution:{enum:['480p']},enableSound:{enum:['off','on']},seed:{type:'integer'}},config:{settings:{text2video:['ratio','resolution','enableSound'],frames2video:['resolution','enableSound']},advancedSettings:['seed','enableSound']}};
 assert.deepEqual(generationParameterSpecs(schema,'frames2video').map(x=>x.name),['resolution','enableSound']);
 assert.deepEqual(generationParameterSpecs(schema,'text2video').map(x=>x.name),['ratio','resolution','enableSound']);
});
test('local and cloud model versions share their brand; unknown models keep a safe generic fallback',()=>{
 assert.equal(generationModelIconURL('Minimax H3'),generationModelIconURL('MiniMax H3 FL（本地）'));
 assert.equal(generationModelIconURL('Seedance 2.0'),generationModelIconURL('Seedance 2.5'));
 assert.match(generationModelIconURL('Qwen-Image-2.1 Turbo（本地）'),/qwen\.svg$/);
 assert.match(generationModelIconURL('Lib Image 2.5 Pro'),/libtv\.svg$/);
 assert.match(generationModelIconURL('unrecognized'),/remixicon\/box-3-line\.svg$/);
});
test('unified mode choices follow capabilities while retaining an unsupported saved selection',()=>{
 const schema={properties:{modeType:{items:{text2video:[],singleImage2video:[],frames2video:[]}}}};
 assert.deepEqual(generationParameterModes({kind:'video',mode:'text2video'},schema),['text2video','frames2video']);
 const config={kind:'video',mode:'mixed2video'};
 assert.deepEqual(generationParameterModes(config,schema),['text2video','frames2video','mixed2video']);
 assert.equal(config.mode,'mixed2video');
});

test('duration segments follow model bounds and preserve saved fractional values',()=>{
 assert.deepEqual(generationDurationOptions({type:'integer',min:4,max:6,step:1},4.5),[4,4.5,5,6]);
 assert.deepEqual(generationDurationOptions({enum:[{value:5},{value:10}]},10),[5,10]);
 assert.deepEqual(generationDurationOptions({type:'number',min:.2,max:2},.2),[.2,.5,1,1.5,2]);
});
