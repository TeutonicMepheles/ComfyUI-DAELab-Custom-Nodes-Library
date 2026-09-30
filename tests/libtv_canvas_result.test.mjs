import test from 'node:test';
import assert from 'node:assert/strict';
import {resultUrl,validateResultUrl,addVideoToCanvas} from '../web/libtv_canvas_result.mjs';
const file={filename:'result.mp4',subfolder:'DAELab/libtv/0123456789abcdef01234567',type:'output'};
test('video output maps to local preview, rejects external and traversal paths',()=>{
 const url=resultUrl({images:[file]});assert.equal(validateResultUrl(url),url);
 assert.equal(resultUrl({images:[{filename:'picture.png'}]}),null);
 for(const value of ['https://example.com/view','/view?type=output&subfolder=../../private&filename=a.mp4'])assert.throws(()=>validateResultUrl(value));
});
test('existing canvas result is reused without creating assets or stages',async()=>{
 const url=resultUrl({images:[file]});const node={type:'ComfyTV.AssetVideoLoaderStage',widgets:[{name:'asset_url',value:url}]};
 assert.equal(await addVideoToCanvas({graph:{_nodes:[node]}},url,'video'),node);
});
