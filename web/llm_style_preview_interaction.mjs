import {createTableButton,tableIcon} from './table_controls.mjs?v=20261017-row-header-drag';
// Text and image modes share the same server-side transport and explicit apply/undo.
export function previewSignature(state) {
    return JSON.stringify([state.mode||'polish',state.source??'',state.instruction??'',state.model||'deepseek',state.mode==='reverse'?(state.previewImage?.revision||state.previewImage?.name||''):'']);
}
export function applyPreview(state) {
    const demo=state.demo;
    if(!demo?.result||demo.signature!==previewSignature(state)||demo.undo)return false;
    demo.undo={source:state.source??''};
    state.source=demo.result;
    demo.signature=previewSignature(state);
    return true;
}
export function undoPreview(state) {
    const demo=state.demo;
    if(!demo?.undo||state.source!==demo.result)return false;
    state.source=demo.undo.source;
    delete demo.undo;
    demo.signature=previewSignature(state);
    return true;
}
export function bindPreviewInteraction({node,root,source,instruction,select,run,upload,result,materialHint,sync,example}) {
    const saved=()=>{const s=node.properties.llmStylePreview||={version:1,mode:"polish"};s.source??=source.value;s.instruction??=instruction.value;return s;};
    const state=saved();
    state.source??=source.value;state.instruction??=instruction.value;
    const apply=root.querySelector('[aria-label="应用结果"]');
    const undo=root.querySelector('[aria-label="撤销应用"]');
    const paragraph=result.querySelector('p');
    const heading=result.querySelector('.llm-style-result-head');
    const actions=heading.querySelector('.llm-style-result-actions');
    result.before(heading);result.append(actions);
    const regenerate=createTableButton('',()=>run.click());tableIcon(regenerate,'restart-line','重新生成');regenerate.classList.add('llm-style-result-action');actions.append(regenerate);
    apply.setAttribute('aria-label','同意更改');

    const status=document.createElement('div');status.className='llm-style-preview-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');result.insertBefore(status,actions);
    const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.hidden=true;root.append(picker);
    const sourceSection=source.closest('.llm-style-source');
    const imageSection=document.createElement('section');imageSection.className='llm-style-section llm-style-image-source';
    const imageLabel=document.createElement('span');imageLabel.className='llm-style-label';imageLabel.textContent='参考图片';
    const image=document.createElement('img');image.className='llm-style-image-preview';image.hidden=true;
    const imageText=document.createElement('span');imageText.className='llm-style-image-text';
    upload.classList.add('llm-style-image-upload');upload.replaceChildren(image,imageText);upload.setAttribute('aria-label','选择参考图片');
    const removeImage=createTableButton('',()=>{if(busy)return;delete saved().previewImage;message='';changed();});tableIcon(removeImage,'delete-bin-line','移除参考图片');removeImage.classList.add('llm-style-image-remove');
    const imageHead=document.createElement('div');imageHead.className='llm-style-image-head';imageHead.append(imageLabel,removeImage);imageSection.append(imageHead,upload);sourceSection.after(imageSection);
    materialHint.parentElement.hidden=true;
    const listeners=[];let reader=null,busy=false,disposed=false,message='';
    const on=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
    const changed=()=>{node.graph?.change?.();render();};
    function render(){
        const s=saved(),d=s.demo,stale=d?.signature!==previewSignature(s);
        const reverse=s.mode==='reverse';sourceSection.hidden=reverse;imageSection.hidden=!reverse;root.dataset.inputMode=reverse?'image':'text';
        const imageData=s.previewImage?.dataUrl;image.hidden=!imageData;removeImage.hidden=!imageData;removeImage.disabled=busy;
        if(imageData&&image.getAttribute('src')!==imageData)image.src=imageData;
        image.alt=s.previewImage?.name||'参考图片';imageText.textContent=imageData?'点击替换图片':'选择本地图片或拖入';upload.classList.toggle('has-image',!!imageData);
        const valid=(reverse?!!imageData:!!source.value.trim())&&select.value==='deepseek';
        source.disabled=instruction.disabled=select.disabled=upload.disabled=busy;
        for(const b of root.querySelectorAll('[data-mode]'))b.disabled=busy;
        run.disabled=busy||!valid;run.setAttribute('aria-busy',String(busy));
        run.lastChild.textContent=busy?'生成中…':'生成';
        run.title=valid?(reverse?'将参考图片发送给 DeepSeek 反推提示词':'使用 DeepSeek 润色提示词'):s.mode==='reverse'?'请先选择图片':'请先填写原始文字';
        apply.disabled=busy||!d?.result||stale||!!d.undo;
        undo.disabled=busy||!d?.undo||s.source!==d.result;
        apply.title='同意更改：应用优化结果';undo.title='撤销本次应用';
        apply.hidden=!!d?.undo;undo.hidden=!d?.undo;regenerate.disabled=busy||!valid||!d?.result;regenerate.setAttribute('aria-busy',String(busy));
        paragraph.textContent=d?.result||'';
        const origin=d?.provider==='deepseek'?'DeepSeek 真实结果':'示例结果 · 未调用模型';
        status.textContent=message||(busy?'DeepSeek 正在生成 · 并发 1':d?.undo?origin+' · 已应用，可撤销':d?.result?(stale?'输入已改变 · 请重新生成':origin):reverse?'点击生成，将图片发送给 DeepSeek 分析':'点击生成获取 DeepSeek 优化建议');
        materialHint.textContent=s.previewImage?.name||'可接入文字与图片';
        materialHint.title='';
    }
    on(root,'input',e=>{if(e.target===source||e.target===instruction){message='';if(saved().demo)delete saved().demo.undo;changed();}});
    on(select,'change',()=>{message='';changed();});
    for(const b of root.querySelectorAll('[data-mode]'))on(b,'click',()=>{message='';changed();});
    upload.title='选择本地图片；点击生成后发送至 DeepSeek';
    on(upload,'click',()=>picker.click());
    function choose(file){
        if(!file||busy||disposed)return;
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)){message='请选择 PNG、JPEG 或 WebP 图片';render();return;}
        if(file.size>8*1024*1024){message='图片请小于 8 MB';render();return;}
        reader?.abort();const current=new FileReader();reader=current;busy=true;message='读取本地图片…';render();
        current.onload=()=>{if(disposed||reader!==current)return;busy=false;saved().previewImage={name:file.name,dataUrl:current.result,revision:crypto.randomUUID()};message='';picker.value='';changed();};
        current.onerror=()=>{if(disposed||reader!==current)return;busy=false;message='图片读取失败，请重新选择';render();};
        current.readAsDataURL(file);
    }
    on(picker,'change',()=>choose(picker.files?.[0]));
    on(upload,'dragover',e=>{e.preventDefault();e.stopPropagation();});
    on(upload,'drop',e=>{e.preventDefault();e.stopPropagation();choose(e.dataTransfer?.files?.[0]);});
    on(run,'click',async()=>{
        if(busy||run.disabled)return;
        busy=true;message='';const s=saved(),signature=previewSignature(s);render();
        {
            try{
                const requestId=crypto.randomUUID();
                const response=await fetch('/daelab/prompt-optimization/polish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractVersion:1,requestId,mode:s.mode||'polish',model:s.model||'deepseek',source:s.source,instruction:s.instruction,...(s.mode==='reverse'?{imageDataUrl:s.previewImage.dataUrl}:{})})});
                const data=await response.json();
                if(!response.ok)throw new Error(data.error||'润色失败，未自动重试');
                if(typeof data.result!=='string'||data.requestId!==requestId)throw new Error('返回结果无效，未自动重试');
                if(disposed)return;
                if(saved()!==s||signature!==previewSignature(s)||node.mode!==0){message='输入或节点状态已改变，结果未应用';return;}
                s.demo={result:data.result,signature,provider:'deepseek',model:data.model,usage:data.usage};
            }catch(error){if(!disposed)message=error instanceof TypeError?'连接中断，结果未知；未自动重试':error.message;}
            finally{busy=false;if(!disposed)changed();}
            return;
        }

    });
    on(apply,'click',()=>{if(applyPreview(saved())){message='';sync();changed();}});
    on(undo,'click',()=>{if(undoPreview(saved())){message='';sync();changed();}});
    render();
    const release=()=>{disposed=true;reader?.abort();for(const unbind of listeners)unbind();picker.remove();status.remove();};
    release.sync=render;return release;
}
