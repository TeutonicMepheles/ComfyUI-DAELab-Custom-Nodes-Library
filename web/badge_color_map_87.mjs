import { queueBadge87 } from './badge_execution_87_queue.mjs';
import { promptForRequest } from './badge_execution_87_model.mjs';
import { normalizeImageSelection, buildImageViewPath } from './app_mode_load_image_preview_model.mjs';

export async function generateGptColorMap87(graph, pixels, {cancelled, regenerate=false, allowGenerate=false}) {
    const {app} = await import('/scripts/app.js');
    const {api} = await import('/scripts/api.js');
    const {getBadgeNativeQueue} = await import('./badge_app_prototype.js');
    const meta = graph.extra.daelabBadgePrototypeV1;
    const source = normalizeImageSelection(graph.getNodeById(meta.localReferenceNodeId)?.widgets?.find(w=>w.name==='image')?.value);
    if (!source) throw new Error('请先选择目标图。');
    const sourceKey = JSON.stringify(source);
    const quality = graph.extra.daelabBadgeExecutionV1.quality || 'low';
    let record = meta.gptColorMap;
    if (regenerate || record?.sourceKey !== sourceKey || record?.quality !== quality) {
        if (!allowGenerate || cancelled()) return null;
        const request = {stage:'color_map',image:source,width:1024,height:1024,count:1,quality,
            map_revision:regenerate ? (record?.revision || 0)+1 : 0};
        const executor = graph.extra.daelabBadgeExecutionV1.executorNodeId;
        const queued = await queueBadge87(app, api, getBadgeNativeQueue(), graph,
            {output:promptForRequest(request,executor),workflow:graph.serialize()});
        const deadline = Date.now()+20*60*1000;
        let history;
        while(Date.now()<deadline) {
            if(cancelled()) return null;
            const response = await api.fetchApi(`/history/${encodeURIComponent(queued.prompt_id)}`);
            if(!response.ok) throw new Error('读取分区图任务状态失败。');
            history = (await response.json())[queued.prompt_id];
            if(history) break;
            await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(!history) throw new Error('分区图生成超时，请查看任务记录。');
        if(history.status?.status_str==='error') throw new Error(history.status.messages?.find(([type])=>type==='execution_error')?.[1]?.exception_message || 'GPT 分区图生成失败。');
        const image = history.outputs?.['113']?.images?.[0];
        if(!image) throw new Error('GPT 分区图未返回图片。');
        if(cancelled()) return null;
        record = {sourceKey,source,image:normalizeImageSelection(image),quality,revision:request.map_revision};
    }
    const image = new Image();
    image.src = api.apiURL(buildImageViewPath(record.image));
    await image.decode();
    if(cancelled()) return null;
    if(image.naturalWidth!==pixels.width || image.naturalHeight!==pixels.height) throw new Error('分区图与目标图尺寸不一致，请重新生成。');
    const canvas=document.createElement('canvas');
    canvas.width=pixels.width; canvas.height=pixels.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(image,0,0);
    meta.gptColorMap=record;
    return ctx.getImageData(0,0,canvas.width,canvas.height);
}
