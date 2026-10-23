import {createTableButton,tableIcon} from './table_controls.mjs?v=20261023-h3-size-r3';
import {isTextColumn,promptSourceId,setPromptSource} from './table_prompt_source.mjs';

export function promptSourceHeader({table,field,header,title,change,root,notify}) {
    if(!isTextColumn(table,field))return;
    const selected=promptSourceId(table)===field.id,label=selected?'取消提示词':'设为提示词';
    header.dataset.promptSource=String(selected);
    if(selected){const badge=document.createElement('span');badge.className='table-prompt-badge';badge.textContent='提示词';title.append(badge);}
    const hint=document.createElement('span');hint.className='table-prompt-hint';hint.textContent=label;hint.setAttribute('aria-hidden','true');
    const toggle=tableIcon(createTableButton('',()=>{
        try{
            change(next=>setPromptSource(next,promptSourceId(next)===field.id?null:field.id));
            [...root.querySelectorAll('.table-prompt-toggle')].find(button=>button.dataset.fieldId===field.id)?.focus({preventScroll:true});
        }catch(error){notify(error.message);}
    }),'chat-ai-line',`${label}：${field.name}`);
    toggle.removeAttribute('title');toggle.classList.add('table-prompt-toggle');toggle.dataset.fieldId=field.id;toggle.setAttribute('aria-pressed',String(selected));
    toggle.onpointerdown=event=>event.stopPropagation();toggle.ondragstart=event=>{event.preventDefault();event.stopPropagation();};
    header.append(hint,toggle);
}
