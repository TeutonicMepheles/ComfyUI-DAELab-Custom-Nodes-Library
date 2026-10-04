import {isGeneration} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
export function generationMaterials(table,fieldId){
 const field=table.fields.find(f=>f.id===fieldId);if(!isGeneration(field))return {version:1,ready:false,assets:[],skipped:0};
 const assets=[];let skipped=0;
 for(const row of table.records){
  const state=row.meta?.generationColumns?.[fieldId],value=row.values[fieldId];
  const valid=Array.isArray(value)?value.filter(a=>a?.url&&['image','video'].includes(a.kind)):[];
  if(!valid.length){skipped++;continue;}
  for(const asset of valid)assets.push({...asset,provenance:{...asset.provenance,fieldId,recordId:row.id,requestId:asset.provenance?.requestId||state?.requestId,materialId:asset.id}});
 }
 return {version:1,label:field.name+' · 输出',ready:assets.length>0,assets,skipped};
}
