import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20260930-inline4';

// Instance-owned, non-modal text dock. Collapsing preserves the current draft.
export function createTextSide({root}) {
    const panels=new Map();let active=null;
    const owner={};const otherOpened=e=>{if(e.detail!==owner)hide();};
    document.addEventListener('dae-table-text-open',otherOpened);
    const keyFor=(record,field)=>JSON.stringify([record,field]);
    function sync(){
        for(const cell of root.querySelectorAll('[data-text-cell]')){
            const control=cell.querySelector('.table-text-expand');if(!control)continue;
            const expanded=active?.key===keyFor(cell.dataset.record,cell.dataset.field);
            const label=`${expanded?'折叠':'展开'} ${cell.dataset.label}`;
            control.setAttribute('aria-expanded',String(expanded));
            control.setAttribute('aria-controls',active?.id||'');
            tableIcon(control,expanded?'arrow-left-right-line':'fullscreen-line',label);
        }
    }
    function hide(){if(active)active.pane.hidden=true;active=null;sync();}
    function collapse(){const panel=active;hide();if(panel)findCell(panel.record,panel.field)?.querySelector('.table-text-expand')?.focus({preventScroll:true});}
    function closeAll(){hide();for(const p of panels.values())p.pane.remove();panels.clear();}
    function open(record,field,title,build,{toggle=false}={}){
        const key=keyFor(record,field);
        if(toggle&&active?.key===key){hide();return;}
        document.dispatchEvent(new CustomEvent('dae-table-text-open',{detail:owner}));
        hide();let panel=panels.get(key);
        if(!panel){
            const pane=document.createElement('aside');pane.className='dae-ui table-text-side';pane.id=`text-side-${crypto.randomUUID()}`;pane.setAttribute('aria-label',title);
            const header=document.createElement('header'),heading=document.createElement('strong');heading.textContent=title;
            const control=button('折叠文本面板',collapse);
            tableIcon(control,'arrow-left-right-line','折叠文本面板');header.append(heading,control);
            const body=document.createElement('div');body.className='table-text-side-body';pane.append(header,body);document.body.append(pane);
            panel={key,record,field,pane,body,id:pane.id};panels.set(key,panel);
            body.close=()=>{if(active===panel)hide();pane.remove();panels.delete(key);};
            pane.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();collapse();}});
            active=panel;build(body);
        }
        active=panel;panel.pane.hidden=false;sync();
        panel.body.querySelector('textarea,[contenteditable=true]')?.focus({preventScroll:true});
    }
    function findCell(record,field){return [...root.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===record&&e.dataset.field===field);}
    function decorate(cell,action){
        cell.dataset.textCell='true';const control=button('展开文本',action);control.classList.add('table-text-expand');
        control.addEventListener('pointerdown',e=>e.stopPropagation());control.addEventListener('dblclick',e=>e.stopPropagation());cell.append(control);sync();
    }
    return {open,decorate,sync,hide:collapse,closeAll,destroy(){closeAll();document.removeEventListener('dae-table-text-open',otherOpened);}};
}
