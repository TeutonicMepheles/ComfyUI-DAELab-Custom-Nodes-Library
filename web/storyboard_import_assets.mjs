// Import-only drafts: original images are kept independently of generation selection.
export function initializeImportAssets(shot) {
    shot.references=(shot.candidate_assets||[]).map(asset_id=>({asset_id,selected:true,source_column:shot.candidate_asset_sources?.[asset_id]||'原稿'}));
    if(shot.image_url)shot.references.unshift({url:shot.image_url,selected:true});
    shot.disposition=!shot.image_prompt.trim()&&shot.references.length?'pending':'independent';
    return shot;
}
export function resolveImportRows(draft) {
    const rows=[];
    for(const source of draft){
        if(source.disposition==='pending')throw new Error(`原表第 ${source.source.row} 行只有图片，请选择独立保留或并入上一条`);
        const shot={...source,references:source.references.map(r=>({...r})),original_fields:[...source.original_fields],source:{...source.source,rows:[source.source.row]}};
        if(shot.disposition==='merge'){
            const previous=rows.at(-1);if(!previous)throw new Error('第一条记录不能并入上一条');
            previous.references.push(...shot.references);
            previous.source.rows.push(shot.source.row);
            previous.original_fields.push(...shot.original_fields.map(f=>({...f,name:`第 ${shot.source.row} 行 · ${f.name}`})));
            if(shot.image_prompt.trim())previous.image_prompt+='\n'+shot.image_prompt;
            if(shot.camera_notes.trim())previous.camera_notes+='\n'+shot.camera_notes;
        }else rows.push(shot);
    }
    return rows;
}
export async function materializeImportRows(draft,assets,uploadReference) {
    const rows=resolveImportRows(draft),uploaded=new Map(),shots=[];
    for(const source of rows){
        const originals=[],selected=[],referenceAssets=[];
        for(const [i,ref] of source.references.entries()){
            let url=ref.url;
            const asset=assets.find(a=>a.id===ref.asset_id);
            if(!url){
                const key=ref.file||ref.asset_id;
                if(!uploaded.has(key)){
                    if(ref.file)uploaded.set(key,await uploadReference(ref.file));
                    else {if(!asset)throw new Error('原稿图片缺失，请重新导入');const blob=await(await fetch(asset.data_url)).blob();uploaded.set(key,await uploadReference(new File([blob],asset.name,{type:blob.type})));}
                }
                url=uploaded.get(key);
            }
            const item={id:`${source.id}-ref-${i}`,url,name:ref.file?.name||`${ref.source_column||'参考图'} · ${i+1}`,source_column:ref.source_column||''};
            originals.push(item);if(ref.selected){selected.push(url);referenceAssets.push({...item,id:globalThis.crypto.randomUUID()});}
        }
        const {references,file,asset_id,candidate_assets,candidate_asset_sources,disposition,...shot}=source;
        shots.push({...shot,image_url:selected[0]||'',additional_reference_images:selected.slice(1),reference_assets:referenceAssets,original_assets:originals});
    }
    return shots;
}
