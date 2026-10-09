import {batchTask} from './libtv_task_snapshots.mjs';
import {selectedTaskSummary} from './storyboard_task_state.mjs?v=20261001-frame-tags-dedup';
import { validateResultUrl, addVideoToCanvas } from './libtv_canvas_result.mjs?v=20260925-1';

const value=(node,key)=>node?.widgets?.find(w=>w.name===key)?.value;
export function batchControls(node,root,{app,set}) {
    const hint=document.createElement('p');hint.textContent='任务来自连接的通用表格或分镜表。已解析表格使用最终提示词；历史分镜沿用画面描述＋镜头备注。行内生成设置优先；切换首尾帧方式后请返回表格复核素材角色。';
    const run=document.createElement('button');run.textContent='生成选中分镜';run.dataset.primary='true';
    if(!value(node,'request_id') || value(node,'request_id')==='video-001')set('request_id',`batch-${crypto.randomUUID()}`);
    run.onclick=async()=>{
        try {
            const input=node.inputs.find(i=>i.name==='storyboard_json');
            const link=node.graph.links[input?.link];
            const source=link && node.graph.getNodeById(link.origin_id);
            source?.__syncPromptDefaults?.();
            const raw=value(source,'storyboard_data')||value(source,'table_data');
            if(!raw)throw new Error('请连接“剧本分镜导入”的 storyboard_json，并在任务表中勾选分镜。');
            const data=JSON.parse(raw),table=data.table||(data.fields&&data.records?data:null),rows=(table?.records||data.shots||[]).filter(s=>s.selected!==false);
            if(table){if(source.type==='DAELAB.Table'&&table.meta.prompt_mode!=='reviewed')throw new Error('请先完成字段映射并解析最终提示词');const check=selectedTaskSummary(table);if(check.invalid)throw new Error(`${check.invalid} 条记录待补充，请返回表格查看标记的单元格；尚未提交生成。`);}
            if(!rows.length)throw new Error('请至少勾选一行');
            if(!value(node,'project_uuid'))throw new Error('请先选择 LibTV 画布');
            if(!window.confirm(`提交 ${rows.length} 行到 LibTV？\n模型：${value(node,'model')} · 每行 ${value(node,'duration')} 秒（行内设置优先）\n会使用 LibTV 积分。相同批次编号恢复已有任务；新编号会重新生成。`))return;
            run.disabled=true;node.__libtvPanel.status.textContent='已请求加入 Comfy 队列；提交前会检查所有选中行。';
            await app.queuePrompt(0,1,[node.id]);
        }catch(e){node.__libtvPanel.status.textContent=e.message;}finally{run.disabled=false;}
    };
    const results=document.createElement('section');results.className='studio-results';results.setAttribute('aria-label','分镜生成结果');
    root.insertBefore(hint,node.__libtvPanel.status);root.insertBefore(run,node.__libtvPanel.status);root.append(results);
    node.__libtvPanel.batchResults=results;
    node.__libtvPanel.status.textContent='每行生成一个视频，逐行执行。失败时暂停后续行；用原批次编号再次运行可恢复。';
    node.__libtvPanel.batchApp=app;
    if(node.properties?.daelabLibTVBatch)showBatchReport(node,node.properties.daelabLibTVBatch);
}

export function showBatchReport(node,raw,live=false) {
    if(!raw)return;
    let report;try{report=typeof raw==='string'?JSON.parse(raw):raw;}catch{return;}
    if(report.batch_id!==value(node,'request_id') || (report.project_uuid && report.project_uuid!==value(node,'project_uuid')))return;
    batchTask(node,report,live);
    node.properties ||= {};node.properties.daelabLibTVBatch=report;
    const panel=node.__libtvPanel;if(!panel?.batchResults)return;
    panel.batchResults.replaceChildren();
    const labels={waiting:'尚未提交',running:'生成 / 恢复中',complete:'已完成',needs_recovery:'待恢复'};
    const done=report.rows.filter(r=>r.phase==='complete').length;
    panel.status.textContent=`${report.phase==='complete'?'批次完成':report.phase==='stopped'?'批次暂停':'正在处理'} · ${done}/${report.rows.length} 行完成\n批次：${report.batch_id}`;
    for(const row of report.rows){
        const item=document.createElement('article');item.className='studio-result';item.dataset.shotId=row.shot_id;
        const text=document.createElement('span');text.textContent=`分镜 ${row.shot_no} · ${labels[row.phase] || row.phase}${row.error?'\n'+row.error:''}`;item.append(text);
        if(row.url){
            try {
                const url=validateResultUrl(row.url);
                const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=url;item.prepend(video);
                const link=document.createElement('a');link.href=url;link.download=`分镜-${row.shot_no}.mp4`;link.textContent='下载';item.append(link);
                const send=document.createElement('button');send.textContent='加入画布';send.onclick=async()=>{try{await addVideoToCanvas(panel.batchApp,url,`分镜 ${row.shot_no} · LibTV`);}catch(e){panel.status.textContent=e.message;}};item.append(send);
            }catch(e){text.textContent+=' · '+e.message;}
        }
        panel.batchResults.append(item);
    }
    node.graph?.setDirtyCanvas?.(true,true);
    const input=node.inputs?.find(i=>i.name==='storyboard_json');
    const source=node.graph?.getNodeById(node.graph.links[input?.link]?.origin_id);
    source?.__storyboardResultUI?.();
}
