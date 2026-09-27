import {stopCanvasPropagation} from './list_editor_controls.mjs';

export function conflictChoice(swap) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','调整单元格');
        dialog.style.cssText="background:#252d38;color:#eee;border:1px solid #657283;border-radius:10px;padding:24px;font-family:'Alibaba PuHuiTi 3',sans-serif";
        const text=document.createElement('p');text.textContent=swap?'目标已有内容，交换两格，还是移动并替换目标？':'目标已有内容，是否替换？';dialog.append(text);
        const done=value=>{dialog.remove();resolve(value);};
        for(const [value,label] of [...(swap?[['swap','交换']]:[]),['replace',swap?'移动并替换':'替换'],[null,'取消']]) {
            const button=document.createElement('button');button.textContent=label;button.style.cssText='padding:7px 14px;margin:4px';button.onclick=()=>done(value);dialog.append(button);
        }
        dialog.oncancel=e=>{e.preventDefault();done(null);};dialog.addEventListener('pointerdown',stopCanvasPropagation);
        document.body.append(dialog);dialog.showModal();
    });
}

