import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261002-generation-pause';

// Instance-owned, non-modal text dock. Collapsing preserves the current draft.
export function createTextSide({root,getHost=()=>document.body}) {
    const panels=new Map();let active=null;
    const owner={};const otherOpened=e=>{if(e.detail!==owner)hide();};
    document.addEventListener('dae-table-text-open',otherOpened);
    const keyFor=(record,field)=>JSON.stringify([record,field]);
    function hide(){if(active)active.pane.hidden=true;active=null;}
    function collapse(){const panel=active;hide();if(panel)findCell(panel.record,panel.field)?.focus({preventScroll:true});}
    function closeAll(){hide();for(const p of [...panels.values()])p.body.close();}
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
            const body=document.createElement('div');body.className='table-text-side-body';pane.append(header,body);getHost().append(pane);
            panel={key,record,field,pane,body,id:pane.id};panels.set(key,panel);
            const cleanups=[];body.onCleanup=fn=>cleanups.push(fn);
            body.close=()=>{if(active===panel)hide();for(const dispose of cleanups.splice(0))dispose();pane.remove();panels.delete(key);};
            pane.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();collapse();}});
            active=panel;build(body);
        }
        const host=getHost();if(panel.pane.parentNode!==host)host.append(panel.pane);
        active=panel;panel.pane.hidden=false;
        panel.body.dispatchEvent(new Event('dae-text-side-show'));
        panel.body.querySelector('textarea,[contenteditable=true]')?.focus({preventScroll:true});
    }
    function findCell(record,field){return [...root.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===record&&e.dataset.field===field);}
    return {open,hide:collapse,closeAll,destroy(){closeAll();document.removeEventListener('dae-table-text-open',otherOpened);}};
}
