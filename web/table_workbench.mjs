import {tableDialog,tableButton} from './data_table_editor.mjs?v=20261009-instructions-v5';
import {isNodeAvailableInAppMode} from './app_mode_bypass_model.mjs';

// Move the existing UI, preserving its state, handlers and undo history.
export function createWorkbench(node,surface,{title='表格工作台',triggerLabel='展开工作台',onClose=()=>{},onResize=()=>{}}={}) {
    const host=document.createElement('div');host.className='dae-table-host';
    node.properties||={};
    const height=()=>Math.max(360,Math.min(1000,Number(node.properties.daelabTableHeight)||520));
    const applyHeight=()=>{host.style.cssText=`height:${height()}px;min-height:${height()}px;max-height:${height()}px;width:100%`;};
    applyHeight();
    const size=document.createElement('label');size.className='table-height';size.textContent='面板高度';
    const slider=document.createElement('input');slider.type='range';slider.min='360';slider.max='1000';slider.step='20';slider.value=height();slider.setAttribute('aria-label','表格面板高度');
    slider.oninput=()=>{node.properties.daelabTableHeight=Number(slider.value);applyHeight();onResize();node.graph?.setDirtyCanvas?.(true,true);};size.append(slider);surface.append(size);
    const placeholder=document.createElement('div');placeholder.className='dae-workbench-placeholder';placeholder.hidden=true;
    placeholder.append(document.createTextNode('正在工作台中编辑'),tableButton('返回节点',()=>close()));host.append(surface,placeholder);
    let dialog=null,opener=null;
    const trigger=tableButton(triggerLabel,open);trigger.className='workbench-expand';
    function open(){
        if(dialog||!node.graph||!isNodeAvailableInAppMode(node))return;
        opener=document.activeElement;dialog=tableDialog(title);dialog.classList.add('dae-workbench');
        dialog.querySelector('h3').remove();placeholder.hidden=false;
        trigger.textContent='收起工作台';trigger.onclick=e=>{e.stopPropagation();close();};
        surface.dataset.expanded='true';size.hidden=true;dialog.append(surface);
        dialog.oncancel=e=>{e.preventDefault();close();};dialog.addEventListener('close',close,{once:true});
        trigger.focus();
    }
    function close(){
        if(!dialog)return;onClose();const current=dialog;dialog=null;
        // Native child dialogs may have been opened from this workbench.
        surface.querySelectorAll('video').forEach(v=>v.pause());
        host.prepend(surface);delete surface.dataset.expanded;size.hidden=false;placeholder.hidden=true;current.remove();
        trigger.textContent=triggerLabel;trigger.onclick=e=>{e.stopPropagation();open();};
        if(opener?.isConnected)opener.focus({preventScroll:true});
    }
    const onSync=()=>{if(!node.graph||!isNodeAvailableInAppMode(node)){onClose();close();}};
    globalThis.addEventListener('daelab:app-mode-synced',onSync);
    return {host,trigger,open,close,height,restoreHeight(){applyHeight();slider.value=height();},destroy(){close();globalThis.removeEventListener('daelab:app-mode-synced',onSync);}};
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
