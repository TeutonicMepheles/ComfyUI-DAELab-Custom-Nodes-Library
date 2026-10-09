import {createTableButton as button,tableIcon} from './table_controls.mjs?v=20261009-review-r6';

// Instance-owned, non-modal text dock. Collapsing preserves the current draft.
export function createTextSide({root,getHost=()=>document.body}) {
    const panels=new Map();let active=null;
    const owner={};const otherOpened=e=>{if(e.detail!==owner)hide();};
    document.addEventListener('dae-table-text-open',otherOpened);
    const keyFor=(record,field,kind)=>JSON.stringify([record,field,kind]);
    function hide(){if(active){active.pane.hidden=true;active.body.dispatchEvent(new Event('dae-text-side-hide'));}active=null;}
    function collapse(){const panel=active;hide();if(panel){const anchor=panel.returnFocus,visible=anchor?.isConnected&&(!anchor.getClientRects||anchor.getClientRects().length>0);(visible?anchor:findCell(panel.record,panel.field))?.focus({preventScroll:true});}}
    function closeAll(){hide();for(const p of [...panels.values()])p.body.close();}
    function open(record,field,title,build,{toggle=false,kind='text',returnFocus=null}={}){
        const key=keyFor(record,field,kind);
        if(toggle&&active?.key===key){hide();return;}
        document.dispatchEvent(new CustomEvent('dae-table-text-open',{detail:owner}));
        hide();let panel=panels.get(key);
        if(!panel){
            const pane=document.createElement('aside');pane.className='dae-ui table-text-side';pane.id=`text-side-${crypto.randomUUID()}`;pane.setAttribute('aria-label',title);
            pane.dataset.sideKind=kind;
            const header=document.createElement('header'),heading=document.createElement('strong');heading.textContent=title;
            const control=button('关闭侧栏',collapse);
            tableIcon(control,'arrow-left-right-line','关闭侧栏');header.append(heading,control);
            const body=document.createElement('div');body.className='table-text-side-body';pane.append(header,body);getHost().append(pane);
            panel={key,record,field,pane,body,id:pane.id,returnFocus};panels.set(key,panel);
            const cleanups=[];body.onCleanup=fn=>cleanups.push(fn);
            body.close=()=>{if(active===panel)hide();for(const dispose of cleanups.splice(0))dispose();pane.remove();panels.delete(key);};
            // Native IMEs can report isComposing=false on their boundary key.
            // Track the session as well as 229 (IME-processed key), without
            // preventing the default Escape that dismisses native candidates.
            let composing=false;
            pane.addEventListener('compositionstart',()=>{composing=true;},true);
            pane.addEventListener('compositionend',()=>{composing=false;},true);
            pane.addEventListener('focusout',e=>{if(!pane.contains(e.relatedTarget))composing=false;});
            const imeKey=e=>composing||e.isComposing||e.keyCode===229;
            // Descendant editors can own Escape too; stop those handlers before
            // they collapse the dock, while leaving the native IME default intact.
            pane.addEventListener('keydown',e=>{if(imeKey(e))e.stopPropagation();},true);
            pane.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&!e.defaultPrevented&&!imeKey(e)){e.preventDefault();collapse();}});
            active=panel;build(body);
        }
        const host=getHost();if(panel.pane.parentNode!==host)host.append(panel.pane);
        panel.returnFocus=returnFocus;active=panel;panel.pane.hidden=false;
        panel.body.dispatchEvent(new Event('dae-text-side-show'));
        panel.body.querySelector('textarea,[contenteditable=true]')?.focus({preventScroll:true});
        return panel.body;
    }
    function findCell(record,field){return record?[...root.querySelectorAll('td[data-field]')].find(e=>e.dataset.record===record&&e.dataset.field===field):[...root.querySelectorAll('th[data-column]')].find(e=>e.dataset.column===field)?.querySelector('.field-title');}
    return {open,hide:collapse,closeAll,destroy(){closeAll();document.removeEventListener('dae-table-text-open',otherOpened);}};
}
