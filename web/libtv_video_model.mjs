const value=(node,name)=>node.widgets?.find(w=>w.name===name)?.value;
export function videoIdentity(node){return JSON.stringify(['project_uuid','request_id','model'].map(n=>value(node,n)||''));}
export function validateVideoDraft(values,linked=[],caps=null){
    if(!values.project_uuid?.trim())throw new Error('请先选择 LibTV 画布或填写画布 ID');
    if(!values.request_id?.trim())throw new Error('请先填写任务编号');
    if(!linked.includes('prompt')&&!linked.includes('text_input')&&!values.prompt?.trim())throw new Error('请输入描述，或连接文本节点');
    if(!Number.isInteger(Number(values.duration))||Number(values.duration)<=0)throw new Error('时长必须为正整数');
    let refs;try{refs=JSON.parse(values.reference_files||'[]');}catch{throw new Error('参考素材路径必须是 JSON 数组');}
    if(!Array.isArray(refs)||refs.some(r=>typeof r!=='string'||!r.trim()))throw new Error('参考素材路径必须是非空字符串数组');
    if(linked.includes('last_frame')&&!linked.includes('first_frame'))throw new Error('连接尾帧前，请先连接首帧');
    if(values.mode==='text2video'&&(refs.length||linked.some(n=>['first_frame','last_frame','reference_images','reference_video'].includes(n))))throw new Error('文生视频不接收参考素材，请切换输入模式');
    if(values.mode==='frames2video'&&!linked.includes('first_frame')&&refs.length===0)throw new Error('首尾帧模式需要参考图片');
    if(values.mode==='singleImage2video'&&!linked.includes('first_frame')&&!linked.includes('reference_images')&&refs.length===0)throw new Error('首帧模式需要一张参考图片');
    if(caps){
        for(const [field,key] of [['model','model'],['mode','modes'],['resolution','resolution']]){
            if(field==='model'){if(caps.model!==values.model)throw new Error('模型已变化，请重新读取参数');}
            else if(caps[key]?.length&&!caps[key].includes(values[field]))throw new Error('当前模型不支持所选'+(field==='mode'?'输入模式':'分辨率'));
        }
        const d=Number(values.duration),range=caps.duration||{},ratios=caps.ratioByMode?.[values.mode]||caps.ratio;
        if(d<(range.min??0)||d>(range.max??Infinity)||(range.enum?.length&&!range.enum.includes(d)))throw new Error('时长超出当前模型允许范围');
        if(ratios?.length&&!ratios.includes(values.ratio))throw new Error('当前模式不支持所选画幅');
        if(values.sound&&!caps.sound)throw new Error('当前模型不支持声音开关');
    }
    return true;
}
export function videoResultAssets(node){
    const url=node.properties?.daelabLibTVResult,identity=node.properties?.daelabLibTVResultIdentity;
    if(!url||identity&&identity!==videoIdentity(node))return {version:1,ready:false,assets:[]};
    return {version:1,ready:true,assets:[{kind:'video',url,name:node.properties?.daelabLibTVResultName||node.title||'视频结果',provenance:{requestId:value(node,'request_id'),model:value(node,'model')}}]};
}
