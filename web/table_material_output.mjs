import {isGeneration,generationInput,inputStamp} from './table_generation_model.mjs';
export function generationMaterials(table,fieldId){
 const field=table.fields.find(f=>f.id===fieldId);if(!isGeneration(field))return {version:1,ready:false,assets:[],skipped:0};
 const assets=[];let skipped=0;
 for(const row of table.records){
  const state=row.meta?.generationColumns?.[fieldId],value=row.values[fieldId];let valid=state?.phase==='complete';
  try{valid=valid&&state.stamp===inputStamp(generationInput(table,fieldId,row.id));}catch{valid=false;}
  if(!valid||!Array.isArray(value)||value.length!==1||!value[0]?.url){skipped++;continue;}
  assets.push({...value[0],provenance:{fieldId,recordId:row.id,requestId:state.requestId,materialId:value[0].id}});
 }
 return {version:1,label:field.name+' · 输出',ready:assets.length>0,assets,skipped};
}
