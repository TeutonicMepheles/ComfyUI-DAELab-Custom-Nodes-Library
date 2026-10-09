// History owns editable table content. Remote task receipts/results keep their
// current value when text history is restored, including completion after the edit.
const activePhases=new Set(['waiting','running','queued','preparing','submitting','recovering','pausing']);

function preserveLegacyResults(current,next){
 const bindings=(current.meta?.prompt_config||current.meta?.storyboard)?.bindings||{};
 const outputIds=[bindings.video_result,bindings.generation_status].filter(Boolean);
 const nextFields=new Set(next.fields.map(f=>f.id)),rows=new Map(next.records.map(r=>[r.id,r]));
 for(const live of current.records){
  if(!live.meta?.generation)continue;
  const row=rows.get(live.id),active=activePhases.has(live.meta.generation.phase);
  if(active&&(!row||outputIds.some(id=>!nextFields.has(id))))throw new Error('任务正在运行，暂不能撤销对应记录或生成结果字段');
  if(!row)continue;
  for(const id of outputIds)if(nextFields.has(id)){
   if(Object.hasOwn(live.values,id))row.values[id]=structuredClone(live.values[id]);else delete row.values[id];
  }
 }
}

export function preserveGenerationHistory(current,next){
 const fields=new Map(current.fields.filter(f=>f.presentation==='generation').map(f=>[f.id,f]));
 const nextFields=new Set(next.fields.map(f=>f.id));
 const records=new Map(current.records.map(r=>[r.id,r]));
 for(const row of next.records){
  const live=records.get(row.id);if(!live)continue;
  for(const [fieldId,state] of Object.entries(live.meta?.generationColumns||{}))if(activePhases.has(state.phase)&&!nextFields.has(fieldId))throw new Error('任务正在排队、运行或恢复，暂不能撤销或删除生成列');
  for(const name of ['generationColumns','generation']){
   if(live.meta?.[name]!==undefined){row.meta||={};row.meta[name]=structuredClone(live.meta[name]);}
   else if(row.meta)delete row.meta[name];
  }
  for(const id of fields.keys())if(nextFields.has(id)){
   if(Object.hasOwn(live.values,id))row.values[id]=structuredClone(live.values[id]);else delete row.values[id];
  }
 }
 preserveLegacyResults(current,next);
 if(current.meta?.generationProject!==undefined){next.meta||={};next.meta.generationProject=structuredClone(current.meta.generationProject);}
 return next;
}
