import {effectivePrompt,toColumnPrompt} from './table_prompt_template.mjs?v=20261023-h3-size-r3';
import {LOCAL_VIDEO_MODEL,setRowGenerationConfig,syncGenerationFrameTags} from './table_generation_model.mjs?v=20261023-h3-size-r3';

export function replaceLinkedTaskText(table,row,config,texts){
 const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
 doc.segments=[...doc.segments.filter(s=>s.type==='frame'||s.type==='column'),{type:'text',text:texts.join('\n')}];
 row.values[config.promptFieldId]=doc;
}

export function bindLinkedTaskReference(table,row,fieldId,config,column){
 if(config.model===LOCAL_VIDEO_MODEL)throw new Error('本地 H3 FL 不支持多图或视频参考，请使用首帧／尾帧接口，或点击提示词中的帧标签选择图片');
 const doc=toColumnPrompt(effectivePrompt(table,row,config.promptFieldId),row);
 // Bind the current linked assets by identity; replacing a video must not leave
 // its previous asset ID in the prompt, or add duplicate references on reload.
 doc.segments=doc.segments.filter(s=>s.type!=='column'||s.fieldId!==column.id);
 doc.segments.unshift(...row.values[column.id].map(a=>({type:'column',fieldId:column.id,assetId:a.id})));
 row.values[config.promptFieldId]=doc;
 if(config.kind!=='video')return;
 const columns=table.fields.filter(f=>['reference_images','reference_video'].includes(f.videoInput));
 const hasVideo=columns.some(f=>row.values[f.id]?.some?.(a=>a.kind==='video'));
 const next={...config,mode:hasVideo?'mixed2video':'image2video'};
 setRowGenerationConfig(row,fieldId,next);
 delete row.meta?.generationFrames?.[fieldId];
 syncGenerationFrameTags(table,fieldId,table.fields.find(f=>f.id===fieldId).generation,row.id);
}
