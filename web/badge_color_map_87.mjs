import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { refinedBadge87, selectedBadgeModel, BADGE_MODELS, localTargetSize87 } from './badge_refinement_87.mjs?v=20260916-ui-2';
import { queueBadge87 } from './badge_execution_87_queue.mjs?v=20260916-content-1';
import { promptForRequest, BADGE87_IMAGE_MODEL } from './badge_execution_87_model.mjs?v=20260917-target87-1';
import { normalizeImageSelection, buildImageViewPath } from './app_mode_load_image_preview_model.mjs';

export async function generateGptColorMap87(graph, pixels, {cancelled, regenerate=false, allowGenerate=false}) {
    const {app} = await import('/scripts/app.js');
    const {api} = await import('/scripts/api.js');
    const {getBadgeNativeQueue} = await import('./badge_app_prototype.js');
    const meta = graph.extra.daelabBadgePrototypeV1;
    const source = normalizeImageSelection(graph.getNodeById(meta.localReferenceNodeId)?.widgets?.find(w=>w.name==='image')?.value);
    if (!source) throw new Error(badgeText("color_map_87.text_001"));
    const sourceKey = JSON.stringify(source);
    const model = refinedBadge87(graph) ? selectedBadgeModel(graph, 'local') : BADGE87_IMAGE_MODEL;
    const quality = graph.extra.daelabBadgeExecutionV1.quality || 'low';
    let record = meta.gptColorMap;
    if (regenerate || record?.model !== model || record?.sourceKey !== sourceKey || record?.quality !== quality) {
        if (!allowGenerate || cancelled()) return null;
        const request = {stage:'color_map',model,image:source,width:1024,height:1024,count:1,quality,
            map_revision:regenerate ? (record?.revision || 0)+1 : 0};
        const executor = graph.extra.daelabBadgeExecutionV1.executorNodeId;
        const queued = await queueBadge87(app, api, getBadgeNativeQueue(), graph,
            {output:promptForRequest(request,executor),workflow:graph.serialize()});
        const deadline = Date.now()+20*60*1000;
        let history;
        while(Date.now()<deadline) {
            if(cancelled()) return null;
            const response = await api.fetchApi(`/history/${encodeURIComponent(queued.prompt_id)}`);
            if(!response.ok) throw new Error(badgeText("color_map_87.text_002"));
            history = (await response.json())[queued.prompt_id];
            if(history) break;
            await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(!history) throw new Error(badgeText("color_map_87.text_003"));
        if(history.status?.status_str==='error') throw new Error(history.status.messages?.find(([type])=>type==='execution_error')?.[1]?.exception_message || badgeText("color_map_87.text_004"));
        const image = history.outputs?.['113']?.images?.[0];
        if(!image) throw new Error(badgeText("color_map_87.text_005"));
        if(cancelled()) return null;
        record = {model,sourceKey,source,image:normalizeImageSelection(image),quality,revision:request.map_revision};
    }
    const image = new Image();
    image.src = api.apiURL(buildImageViewPath(record.image));
    await image.decode();
    if(cancelled()) return null;
    if(image.naturalWidth!==pixels.width || image.naturalHeight!==pixels.height) throw new Error(badgeText("color_map_87.text_006"));
    const canvas=document.createElement('canvas');
    canvas.width=pixels.width; canvas.height=pixels.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(image,0,0);
    meta.gptColorMap=record;
    return ctx.getImageData(0,0,canvas.width,canvas.height);
}
