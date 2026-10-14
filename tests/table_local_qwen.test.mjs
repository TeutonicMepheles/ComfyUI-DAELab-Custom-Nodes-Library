import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCAL_IMAGE_MODEL,isLocalGenerationModel,addGenerationColumn} from '../web/table_generation_model.mjs';
import {generationModes,normalizeLocalGenerationConfig} from '../web/table_prompt_settings.mjs';
import {modelCapabilities} from '../web/table_generation_api.mjs';

const schema={properties:{modeType:{items:{text2image:[0,0]}},width:{type:'integer',min:256,max:2048,step:32,default:1024},height:{type:'integer',min:256,max:2048,step:32,default:1024},seed:{type:'integer',min:-1,max:9007199254740991,default:-1}},config:{strictModes:true,settings:['width','height'],advancedSettings:['seed']}};

test('local Qwen advertises only its implemented mode and resets incompatible cloud settings',()=>{
 assert.deepEqual(generationModes(schema,'image'),['text2image']);
 const config={kind:'image',model:LOCAL_IMAGE_MODEL,mode:'image2image',settings:{ratio:'16:9',resolution:'4K',width:768,height:999,seed:42}};
 normalizeLocalGenerationConfig(config,schema);
 assert.equal(config.mode,'text2image');assert.deepEqual(config.settings,{width:768,height:1024,seed:42});
 assert.ok(isLocalGenerationModel(config.model));
});
test('new image columns default locally without changing existing columns',()=>{
 const old={id:'old',generation:{model:'Lib Image'}};
 const table={fields:[old],records:[],meta:{}};
 const field=addGenerationColumn(table);
 assert.equal(field.generation.model,LOCAL_IMAGE_MODEL);
 assert.equal(field.generation.mode,'text2image');assert.equal(old.generation.model,'Lib Image');
});
test('local capabilities reject a stale cloud backend without fallback',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(url);return {ok:true,status:200,json:async()=>({schema:{}})};};
 try{await assert.rejects(modelCapabilities({kind:'image',model:LOCAL_IMAGE_MODEL}),/重启/);assert.equal(calls.length,1);}
 finally{globalThis.fetch=original;}
});
