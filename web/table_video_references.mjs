// Column-level video reference selection. Kept independent of the table/editor.
const config=t=>t.meta?.prompt_config||t.meta?.storyboard||{};
export function videoReferenceFields(t){
 const b=config(t).bindings||{},groups=t.meta?.asset_groups||[],legacy=t.meta?.video_reference_version!==1;
 const selected=t.fields.filter(f=>f.id!==b.video_result&&(f.video_reference===true||(legacy&&f.video_reference===undefined&&f.type==='assets'&&(f.id===b.image_url||groups.some(g=>g.field_id===f.id)))));
 // Preserve the primary reference's established first-frame position.
 return [...selected.filter(f=>f.id===b.image_url),...selected.filter(f=>f.id!==b.image_url)];
}
export function migrateVideoReferences(t){
 const ids=new Set(videoReferenceFields(t).map(f=>f.id));
 for(const f of t.fields)if(f.type==='assets')f.video_reference=ids.has(f.id);
 t.meta.video_reference_version=1;return t;
}
export function setVideoReference(t,id,enabled){
 migrateVideoReferences(t);
 const f=t.fields.find(f=>f.id===id);
 if(!f||f.type!=='assets'||id===config(t).bindings?.video_result)throw new Error('请选择图片列表字段');
 f.video_reference=Boolean(enabled);
}
export function videoReferenceSpecs(t){
 return videoReferenceFields(t).map(f=>({field:f,required:f.id!==config(t).bindings?.image_url&&(t.meta?.asset_groups||[]).some(g=>g.field_id===f.id&&g.required!==false)}));
}
