// History owns editable table content. Remote task receipts/results keep their
// current value when text history is restored, including completion after the edit.
export function preserveGenerationHistory(current,next){
 const fields=new Map(current.fields.filter(f=>f.presentation==='generation').map(f=>[f.id,f]));
 const nextFields=new Set(next.fields.map(f=>f.id));
 const records=new Map(current.records.map(r=>[r.id,r]));
 for(const row of next.records){
  const live=records.get(row.id);if(!live)continue;
  for(const name of ['generationColumns','generation']){
   if(live.meta?.[name]!==undefined){row.meta||={};row.meta[name]=structuredClone(live.meta[name]);}
   else if(row.meta)delete row.meta[name];
  }
  for(const id of fields.keys())if(nextFields.has(id)){
   if(Object.hasOwn(live.values,id))row.values[id]=structuredClone(live.values[id]);else delete row.values[id];
  }
 }
 if(current.meta?.generationProject!==undefined){next.meta||={};next.meta.generationProject=structuredClone(current.meta.generationProject);}
 return next;
}
