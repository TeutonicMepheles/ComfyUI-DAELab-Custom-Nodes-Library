// Stable item identity; no dependency on canvas DOM or node internals.
export function materialItem(table,key){
    let record,field,asset;
    try{[record,field,asset]=JSON.parse(key);}catch{return null;}
    const row=table?.records?.find(r=>r.id===record),values=row?.values?.[field];
    const item=Array.isArray(values)?values.find(a=>a.id===asset):null;
    if(!item?.url?.startsWith('/view?'))return null;
    const filename=new URL(item.url,'http://localhost').searchParams.get('filename')||'';
    const kind=item.kind||(/\.(png|jpe?g|webp)$/i.test(filename)?'image':/\.(mp4|webm|mov)$/i.test(filename)?'video':null);
    if(!['image','video'].includes(kind))return null;
    return {version:1,ready:true,assets:[{...item,kind,provenance:{...item.provenance,recordId:record,fieldId:field,assetId:asset}}]};
}
