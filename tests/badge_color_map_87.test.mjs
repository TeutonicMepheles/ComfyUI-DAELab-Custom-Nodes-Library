import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeImageSelection,buildImageViewPath} from '../web/app_mode_load_image_preview_model.mjs';

// Execute the production runner with browser/queue boundaries replaced, so an
// accidental submission from the read-only restoration path fails this test.
const source=readFileSync(new URL('../web/badge_color_map_87.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('    const {app}'),source.lastIndexOf('}'))
    .replace(/^    const \{(?:app|api|getBadgeNativeQueue)\} = await import\([^\n]+\);\r?\n/gm,'');
const run=new (Object.getPrototypeOf(async function(){}).constructor)(
    'graph','pixels','cancelled','regenerate','allowGenerate','app','api','getBadgeNativeQueue',
    'queueBadge87','promptForRequest','normalizeImageSelection','buildImageViewPath','Image','document',body);
async function fixture(allowGenerate, cached=false) {
    let submissions=0;
    const image={filename:'target.png',subfolder:'',type:'input'};
    const meta={localReferenceNodeId:146};
    if(cached) meta.gptColorMap={sourceKey:JSON.stringify(image),source:image,quality:'low',image:{...image,filename:'map.png'}};
    const graph={extra:{daelabBadgePrototypeV1:meta,daelabBadgeExecutionV1:{executorNodeId:200}},getNodeById:()=>({widgets:[{name:'image',value:'target.png'}]}),serialize:()=>({})};
    const result=await run(graph,{width:32,height:32},()=>false,false,allowGenerate,{},
        {apiURL:x=>x,fetchApi:async()=>({ok:true,json:async()=>({job:{outputs:{113:{images:[{...image,filename:'map.png'}]}}}})})},
        ()=>()=>{},async()=>{submissions++;return {prompt_id:'job'}},()=>({}),
        normalizeImageSelection,buildImageViewPath,
        class {naturalWidth=32;naturalHeight=32;async decode(){}},
        {createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({ready:true})})})});
    return {submissions,result};
}
test('entering a map source without a saved map cannot submit GPT work',async()=>{
    assert.deepEqual(await fixture(false),{submissions:0,result:null});
});
test('restoring an existing map requires no generation',async()=>{
    assert.deepEqual(await fixture(false,true),{submissions:0,result:{ready:true}});
});
test('explicit generation action may submit one task',async()=>{
    assert.deepEqual(await fixture(true),{submissions:1,result:{ready:true}});
});
