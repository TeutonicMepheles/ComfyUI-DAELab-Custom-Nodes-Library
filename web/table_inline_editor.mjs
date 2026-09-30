// Shared in-place editing lifecycle for text and structured prompt cells.
// Mutations use the table transaction owner; the displayed DOM is not replaced while typing.
export function bindInlineEditor({cell,box,label,read,write,reset,draw,columns,getColumnChip,onCleanup,allowDoubleClick=true,notify=()=>{}}){
 let active=false,composing=false,range=null,menu=null,queryRange=null,index=0,options=[],wasDraggable=false;
 const closeMenu=()=>{menu?.remove();menu=null;queryRange=null;box.removeAttribute('aria-controls');box.removeAttribute('aria-activedescendant');};
 const selection=()=>{const s=getSelection();if(s?.rangeCount&&box.contains(s.anchorNode))range=s.getRangeAt(0).cloneRange();return range;};
 const persist=()=>{try{write(read());box.removeAttribute('aria-invalid');return true;}catch(e){box.setAttribute('aria-invalid','true');notify(e.message);return false;}};
 function insert(node,replace=range){box.focus();if(!replace||!box.contains(replace.startContainer)){replace=document.createRange();replace.selectNodeContents(box);replace.collapse(false);}replace.deleteContents();replace.insertNode(node);replace.setStartAfter(node);replace.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(replace);selection();}
 function place(){if(!menu)return;const r=queryRange?.getBoundingClientRect(),fallback=box.getBoundingClientRect(),anchor=r?.width||r?.height?r:fallback;const h=menu.getBoundingClientRect().height;
  menu.style.left=Math.max(8,Math.min(anchor.left,innerWidth-300))+'px';menu.style.top=Math.max(8,Math.min(anchor.bottom+6,innerHeight-h-8))+'px';}
 function choose(i){const option=options[i];if(!option)return;const node=getColumnChip(option);node.removeAttribute('tabindex');insert(node,queryRange);insert(document.createTextNode(''));closeMenu();persist();}
 function highlight(){if(!menu)return;[...menu.children].forEach((e,i)=>e.setAttribute('aria-selected',String(i===index)));box.setAttribute('aria-activedescendant',menu.children[index]?.id||'');}
 function suggest(){closeMenu();if(!columns||composing)return;const r=selection();if(!r?.collapsed||r.startContainer.nodeType!==3)return;
  const prefix=r.startContainer.textContent.slice(0,r.startOffset),match=prefix.match(/@([^@\n]*)$/);if(!match)return;
  options=columns().filter(f=>f.name.toLowerCase().includes(match[1].toLowerCase()));if(!options.length)return;
  queryRange=r.cloneRange();queryRange.setStart(r.startContainer,r.startOffset-match[0].length);
  menu=document.createElement('div');menu.className='dae-ui dae-inline-columns';menu.id='columns-'+crypto.randomUUID();menu.setAttribute('role','listbox');menu.setAttribute('aria-label','引用列');
  options.forEach((f,i)=>{const item=document.createElement('button');item.type='button';item.id=menu.id+'-'+i;item.setAttribute('role','option');item.setAttribute('aria-label',f.name);item.append(getColumnChip(f));item.onpointerdown=e=>e.preventDefault();item.onclick=e=>{e.stopPropagation();choose(i);};menu.append(item);});
  document.body.append(menu);box.setAttribute('aria-controls',menu.id);index=0;highlight();place();
 }
 function start(event){if(active)return;active=true;wasDraggable=cell.draggable;cell.dataset.inlineEditing='true';cell.dispatchEvent(new CustomEvent('dae-inline-edit-start',{bubbles:true}));cell.draggable=false;draw?.(true);box.querySelectorAll('[contenteditable=false]').forEach(e=>e.removeAttribute('tabindex'));box.contentEditable='true';box.setAttribute('role','textbox');box.setAttribute('aria-label',label);box.setAttribute('aria-multiline','true');box.setAttribute('spellcheck','false');box.focus({preventScroll:true});
  // Preserve the double-click location; keyboard entry starts at the end.
  let caret=event?.clientX!=null?document.caretRangeFromPoint?.(event.clientX,event.clientY):null;
  if(!caret||!box.contains(caret.startContainer)){caret=document.createRange();caret.selectNodeContents(box);caret.collapse(false);}const s=getSelection();s.removeAllRanges();s.addRange(caret);selection();
 }
 function finish(cancel=false){if(!active)return;closeMenu();if(cancel)reset();active=false;box.contentEditable='false';delete cell.dataset.inlineEditing;cell.draggable=wasDraggable;box.removeAttribute('role');box.removeAttribute('aria-multiline');box.removeAttribute('aria-invalid');draw?.();}
 const double=e=>{if(!allowDoubleClick||e.target.closest('button'))return;e.preventDefault();e.stopPropagation();start(e);};
 const enter=e=>{if(e.target===cell&&e.key==='Enter'){e.preventDefault();e.stopPropagation();start();}};
 const edit=()=>start();cell.addEventListener('dblclick',double);cell.addEventListener('keydown',enter);cell.addEventListener('dae-edit-text',edit);
 box.addEventListener('compositionstart',()=>composing=true);box.addEventListener('compositionend',()=>{composing=false;persist();suggest();});
 box.addEventListener('input',()=>{if(active&&!composing){persist();suggest();}});
 box.addEventListener('paste',e=>{if(!active)return;e.preventDefault();e.stopPropagation();selection();insert(document.createTextNode(e.clipboardData.getData('text/plain')));persist();suggest();});
 box.addEventListener('keydown',e=>{if(!active)return;e.stopPropagation();if(composing||e.isComposing)return;
  if(menu&&['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape')closeMenu();else if(e.key==='Enter')choose(index);else{index=(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;highlight();}return;}
  if(e.key==='Escape'){e.preventDefault();finish(true);cell.focus();return;}
  if(e.key==='Enter'){e.preventDefault();selection();insert(document.createTextNode('\n'));persist();return;}
  if(e.key==='Tab'){finish();return;}
 });
 box.addEventListener('blur',e=>{if(active&&!composing&&!box.contains(e.relatedTarget))finish();});
 const position=()=>place();window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
 const dispose=()=>{closeMenu();window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true);};
 onCleanup?.(dispose);
 return {start,finish,dispose};
}
