import {tableDialog,tableButton} from './data_table_editor.mjs';
import {isNodeAvailableInAppMode} from './app_mode_bypass_model.mjs';

// Move the existing UI, preserving its state, handlers and undo history.
export function createWorkbench(node,surface,{title='表格工作台',triggerLabel='展开工作台',onClose=()=>{}}={}) {
    const host=document.createElement('div');host.className='dae-table-host';
    host.style.cssText='height:520px;min-height:520px;max-height:520px;width:100%';
    const placeholder=document.createElement('div');placeholder.className='dae-workbench-placeholder';placeholder.hidden=true;
    placeholder.append(document.createTextNode('正在工作台中编辑'),tableButton('返回节点',()=>close()));host.append(surface,placeholder);
    let dialog=null,opener=null;
    const trigger=tableButton(triggerLabel,open);trigger.className='workbench-expand';
    function open(){
        if(dialog||!node.graph||!isNodeAvailableInAppMode(node))return;
        opener=document.activeElement;dialog=tableDialog(title);dialog.classList.add('dae-workbench');
        dialog.querySelector('h3').remove();placeholder.hidden=false;
        trigger.textContent='收起工作台';trigger.onclick=e=>{e.stopPropagation();close();};
        surface.dataset.expanded='true';dialog.append(surface);
        dialog.oncancel=e=>{e.preventDefault();close();};dialog.addEventListener('close',close,{once:true});
        trigger.focus();
    }
    function close(){
        if(!dialog)return;onClose();const current=dialog;dialog=null;
        // Native child dialogs may have been opened from this workbench.
        surface.querySelectorAll('video').forEach(v=>v.pause());
        host.prepend(surface);delete surface.dataset.expanded;placeholder.hidden=true;current.remove();
        trigger.textContent=triggerLabel;trigger.onclick=e=>{e.stopPropagation();open();};
        if(opener?.isConnected)opener.focus({preventScroll:true});
    }
    const onSync=()=>{if(!node.graph||!isNodeAvailableInAppMode(node)){onClose();close();}};
    globalThis.addEventListener('daelab:app-mode-synced',onSync);
    return {host,trigger,open,close,destroy(){close();globalThis.removeEventListener('daelab:app-mode-synced',onSync);}};
}

export function showExistingPanel(node,panel,title){
    if(!panel?.isConnected)return null;
    const parent=panel.parentNode,marker=document.createComment('panel-return');parent.insertBefore(marker,panel);
    const dialog=tableDialog(title);dialog.classList.add('dae-generation-dialog');
    const close=()=>{if(!dialog.isConnected)return;panel.querySelectorAll('video').forEach(v=>v.pause());if(marker.isConnected){marker.replaceWith(panel);}dialog.remove();globalThis.removeEventListener('daelab:app-mode-synced',onSync);};
    const onSync=()=>{if(!node.graph||!isNodeAvailableInAppMode(node))close();};
    dialog.append(tableButton('返回表格',close),panel);dialog.oncancel=e=>{e.preventDefault();close();};
    globalThis.addEventListener('daelab:app-mode-synced',onSync);return close;
}
