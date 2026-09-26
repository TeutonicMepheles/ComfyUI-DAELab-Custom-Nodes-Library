import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleValues} from '../web/libtv_connection.mjs';

test('model switch normalizes unsupported H3 options without changing identity',()=>{
    const input={model:'Minimax H3',project_uuid:'canvas',request_id:'recovery',resolution:'480p',ratio:'16:9',mode:'image2video',duration:4,sound:true};
    const next=compatibleValues(input,{resolution:['768P','2K'],ratio:['16:9'],modes:['text2video','frames2video'],duration:{min:5,max:15},sound:false});
    assert.equal(next.resolution,'768P');assert.equal(next.duration,5);assert.equal(next.mode,'text2video');assert.equal(next.sound,false);
    assert.equal(next.request_id,'recovery');assert.equal(next.project_uuid,'canvas');assert.equal(input.resolution,'480p');
});
test('supported values survive schema refresh and enum duration is honored',()=>{
    const caps={resolution:['720p'],ratio:['9:16'],modes:['frames2video'],duration:{enum:[5,10]},sound:true};
    const next=compatibleValues({resolution:'720p',ratio:'9:16',mode:'frames2video',duration:7,sound:true},caps);
    assert.deepEqual(next,{resolution:'720p',ratio:'9:16',mode:'frames2video',duration:5,sound:true});
});
