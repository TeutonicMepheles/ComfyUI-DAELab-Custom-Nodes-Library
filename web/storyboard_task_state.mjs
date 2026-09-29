import {promptConfig,promptField,promptState,promptFingerprint} from './table_prompt_model.mjs?v=20260930-inline4';
import {videoReferenceSpecs} from './table_video_references.mjs?v=20260929-refs3';
export function taskFingerprint(table,row) {
    if(table.meta.prompt_mode==='reviewed')return promptFingerprint(table,row);
    const bindings=table.meta.storyboard?.bindings||{};
    const urls=value=>Array.isArray(value)?value.map(a=>a.url):value||'';
    const specs=videoReferenceSpecs(table);
    return JSON.stringify([['image_prompt','camera_notes'].map(role=>row.values[bindings[role]]??''),urls(specs.some(s=>s.field.id===bindings.image_url)?row.values[bindings.image_url]:undefined),
        specs.filter(s=>s.field.id!==bindings.image_url).map(s=>urls(row.values[s.field.id])),Object.values(table.meta.storyboard?.generation_fields||{}).map(id=>row.values[id]??'')]);
}
export function storyboardTaskState(table,row) {
    if(table.meta.prompt_mode==='reviewed'||table.meta.prompt_config&&!table.meta.storyboard){
        const state=promptState(table,row),generation=row.meta?.generation,issues=state.error?[{field:promptField(table)||promptConfig(table).bindings?.image_prompt,message:state.error}]:[];
        if(table.meta.prompt_mode!=='reviewed'&&!table.meta.storyboard&&!issues.length)issues.push({field:promptField(table),message:'生成配置未启用，请重新解析或复核后启用'});
        let key=issues.length?'invalid':'ready',label=issues.length?'待补充':'未提交',hint=state.error||'提交前还会核对文件及模型参数';
        if(!issues.length&&generation){if(generation.fingerprint!==taskFingerprint(table,row)){key='changed';hint='当前编辑与已提交任务不同，请新建批次';}else{key=({waiting:'queued',running:'running',complete:'complete',needs_recovery:'recovery'})[generation.phase]||'ready';label=({queued:'等待生成',running:'生成中',complete:'已完成',recovery:'需恢复'})[key]||label;}}
        return {key,label,hint,issues,field:promptConfig(table).bindings?.generation_status};
    }
    const bindings=table.meta.storyboard?.bindings||{},fields=new Map(table.fields.map(f=>[f.id,f])),issues=[];
    const prompt=fields.get(bindings.image_prompt);
    if(!prompt||!['text','longtext','select'].includes(prompt.type))issues.push({field:bindings.image_prompt,message:'请绑定画面描述字段'});
    else if(!String(row.values[prompt.id]||'').trim())issues.push({field:prompt.id,message:'缺少画面描述'});
    for(const {field,required} of videoReferenceSpecs(table)){if(field.type!=='assets'||required&&!row.values[field.id]?.length)issues.push({field:field.id,message:`请检查${field.name}参考素材`});}
    let key='ready',label='可生成',hint='基础内容已齐全，提交前还会检查模型与参数';
    const generation=row.meta?.generation;
    if(generation){
        if(generation.fingerprint!==taskFingerprint(table,row)){key='changed';label='内容已修改';hint='当前内容与上次任务不同，重新生成前请新建批次';}
        else {const states={waiting:['queued','等待生成'],running:['running','生成中'],complete:['complete','已完成'],needs_recovery:['recovery','需恢复']};[key,label]=states[generation.phase]||[key,label];hint=generation.error||label;}
    }
    if(issues.length){key='invalid';label='待补充';hint=issues.map(i=>i.message).join('；');}
    return {key,label,hint,issues,field:bindings.generation_status};
}
export function selectedTaskSummary(table){
    const rows=table.records.filter(r=>r.selected),states=rows.map(r=>storyboardTaskState(table,r));
    return {selected:rows.length,invalid:states.filter(s=>s.key==='invalid').length,ready:states.filter(s=>['ready','changed'].includes(s.key)).length,
        active:states.filter(s=>['queued','running'].includes(s.key)).length,complete:states.filter(s=>s.key==='complete').length,
        issues:states.flatMap((s,i)=>s.issues.map(issue=>({record:rows[i].id,...issue})))};
}
