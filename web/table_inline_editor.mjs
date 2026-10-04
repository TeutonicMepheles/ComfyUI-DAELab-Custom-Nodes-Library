import {createReferenceMenu} from './table_reference_menu.mjs?v=20261001-table-perf';

export function deletePromptReference(box,event){
 if(!['Backspace','Delete'].includes(event.key)||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return false;
 const selection=getSelection(),selector='.dae-prompt-ref[contenteditable="false"]';
 const reference=node=>(node.nodeType===1?node:node.parentElement)?.closest(selector);
 let chip=reference(event.target),range;
 if(chip&&box.contains(chip)){range=document.createRange();range.selectNode(chip);}
 else{
  if(!selection.rangeCount)return false;
  range=selection.getRangeAt(0).cloneRange();if(!box.contains(range.startContainer)||!box.contains(range.endContainer))return false;
  if(!range.collapsed){
   if(![...box.querySelectorAll(selector)].some(node=>range.intersectsNode(node)))return false;
   const start=reference(range.startContainer),end=reference(range.endContainer);if(start)range.setStartBefore(start);if(end)range.setEndAfter(end);
  }else{
   const backward=event.key==='Backspace';
   const adjacent=node=>{while(node!==box){const next=backward?node.previousSibling:node.nextSibling;if(next)return next;node=node.parentNode;if(node!==box&&['DIV','P'].includes(node.nodeName))return null;}return null;};
   let node=range.startContainer,offset=range.startOffset;
   if(reference(node))node=reference(node);
   else if(node.nodeType===3){if(backward?offset>0:offset<node.textContent.length)return false;node=adjacent(node);}
   else node=node.childNodes[backward?offset-1:offset]||adjacent(node);
   while(node){
    chip=reference(node);if(chip)break;
    if(node.nodeType===3&&node.textContent.length||['BR','DIV','P'].includes(node.nodeName))return false;
    node=(backward?node.lastChild:node.firstChild)||adjacent(node);
   }
   if(!chip)return false;range.selectNode(chip);
  }
 }
 const chips=[...box.querySelectorAll(selector)].filter(node=>range.intersectsNode(node));
 box.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(range);
 let repaired=false;
 if(!document.execCommand('delete')){range.deleteContents();range.collapse(true);selection.removeAllRanges();selection.addRange(range);repaired=true;}
 // Chromium may retain an empty non-editable span, which still serializes as a reference.
 for(const node of chips)if(box.contains(node)){node.remove();repaired=true;}
 if(repaired)box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:event.key==='Backspace'?'deleteContentBackward':'deleteContentForward'}));
 event.preventDefault();return true;
}

// Shared in-place editing lifecycle for text and structured prompt cells.
// Mutations use the table transaction owner; the displayed DOM is not replaced while typing.
export function bindInlineEditor({cell,box,label,read,write,reset,draw,columns,getColumnChip,onCleanup,allowDoubleClick=true,notify=()=>{}}){
 let active=false,composing=false,range=null,menu=null,picker=null,queryRange=null,wasDraggable=false,positionFrame=null;
 const position=()=>{if(menu&&positionFrame===null)positionFrame=requestAnimationFrame(()=>{positionFrame=null;place();});};
 const closeMenu=()=>{window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true);if(positionFrame!==null)cancelAnimationFrame(positionFrame);positionFrame=null;menu?.remove();menu=null;picker=null;queryRange=null;box.removeAttribute('aria-controls');box.removeAttribute('aria-activedescendant');};
 const selection=()=>{const s=getSelection();if(s?.rangeCount&&box.contains(s.anchorNode))range=s.getRangeAt(0).cloneRange();return range;};
 const persist=()=>{try{write(read());box.removeAttribute('aria-invalid');return true;}catch(e){box.setAttribute('aria-invalid','true');notify(e.message);return false;}};
 function insert(node,replace=range){box.focus();if(!replace||!box.contains(replace.startContainer)){replace=document.createRange();replace.selectNodeContents(box);replace.collapse(false);}replace.deleteContents();replace.insertNode(node);replace.setStartAfter(node);replace.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(replace);selection();}
 function place(){if(!menu)return;const r=queryRange?.getBoundingClientRect(),fallback=box.getBoundingClientRect(),anchor=r?.width||r?.height?r:fallback;const h=menu.getBoundingClientRect().height;
  menu.style.left=Math.max(8,Math.min(anchor.left,innerWidth-menu.getBoundingClientRect().width-8))+'px';menu.style.top=Math.max(8,Math.min(anchor.bottom+6,innerHeight-h-8))+'px';picker?.layout();}
 function choose(option){const node=getColumnChip(option);node.removeAttribute('tabindex');insert(node,queryRange);insert(document.createTextNode(''));closeMenu();persist();}
 function suggest(){closeMenu();if(!columns||composing)return;const r=selection();if(!r?.collapsed||r.startContainer.nodeType!==3)return;
  const prefix=r.startContainer.textContent.slice(0,r.startOffset),match=prefix.match(/@([^@\n]*)$/);if(!match)return;
  const options=columns().filter(f=>f.name.toLowerCase().includes(match[1].toLowerCase()));if(!options.length)return;
  queryRange=r.cloneRange();queryRange.setStart(r.startContainer,r.startOffset-match[0].length);
  picker=createReferenceMenu({options,onChoose:choose,onLayout:position});menu=picker.root;
  document.body.append(menu);box.setAttribute('aria-controls',menu.id);box.setAttribute('aria-activedescendant',picker.activeId||'');place();window.addEventListener('resize',position);document.addEventListener('scroll',position,{capture:true,passive:true});
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
  if(deletePromptReference(box,e)){selection();closeMenu();return;}
  if(menu&&['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape')closeMenu();else{picker.keydown(e.key);if(picker)box.setAttribute('aria-activedescendant',picker.activeId||'');}return;}
  if(e.key==='Escape'){e.preventDefault();finish(true);cell.focus();return;}
  if(e.key==='Enter'){e.preventDefault();selection();insert(document.createTextNode('\n'));persist();return;}
  if(e.key==='Tab'){finish();return;}
 });
 box.addEventListener('blur',e=>{if(active&&!composing&&!box.contains(e.relatedTarget))finish();});
 const dispose=()=>closeMenu();
 onCleanup?.(dispose);
 return {start,finish,dispose};
}
