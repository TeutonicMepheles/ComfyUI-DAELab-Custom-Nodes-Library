// Provider adapter only; UI, review, apply and undo stay in the shared IO panel.
export async function optimizeRow(row,mode,instruction,{fetcher=fetch}={}){
    let imageDataUrl;
    if(mode==='reverse'){
        const url=row.image?.url;
        if(!url||(!url.startsWith('/view?')&&!/^data:image\/(png|jpeg|webp);base64,/.test(url)))throw new Error('请使用本地参考图片');
        const response=await fetcher(url);if(!response.ok)throw new Error('参考图片读取失败');
        const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('参考图片超过 8 MB');
        imageDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('参考图片读取失败'));reader.readAsDataURL(blob);});
    }
    const requestId=crypto.randomUUID();
    const response=await fetcher('/daelab/prompt-optimization/polish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractVersion:1,requestId,model:'qwen',mode,source:row.text||'',instruction,imageDataUrl})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'本地 Qwen 请求失败，未自动重试');
    if(data.requestId!==requestId||typeof data.result!=='string'||!data.result.trim())throw new Error('返回结果无效，未自动重试');
    return {...row,result:data.result,status:'completed',requestId,model:data.model,usage:data.usage};
}
