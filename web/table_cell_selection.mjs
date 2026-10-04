export function attachCellSelection({root,shell,getTable}){
 let anchor=null,end=null,selectionCache=null,cellSelectionDrag=null;
 const fields=()=>getTable().fields.filter(f=>!f.hidden);
 function selection(){if(!anchor||!end){selectionCache=null;return [];}const t=getTable();if(selectionCache?.table===t&&selectionCache.anchor===anchor&&selectionCache.end===end)return selectionCache.cells;const fs=fields(),a=t.records.findIndex(r=>r.id===anchor.record),b=t.records.findIndex(r=>r.id===end.record),c=fs.findIndex(f=>f.id===anchor.field),d=fs.findIndex(f=>f.id===end.field);if(Math.min(a,b,c,d)<0){selectionCache=null;return [];}const selectedFields=fs.slice(Math.min(c,d),Math.max(c,d)+1),cells=t.records.slice(Math.min(a,b),Math.max(a,b)+1).map(row=>selectedFields.map(field=>({row,field})));selectionCache={table:t,anchor,end,cells};return cells;}
 function clear(){anchor=null;end=null;mark();}
 root.addEventListener('dae-inline-edit-start',clear);
 function mark(){const selected=new Set(selection().flat().map(x=>x.row.id+'|'+x.field.id));shell.querySelectorAll('td[data-field]').forEach(td=>{const value=String(selected.has(td.dataset.record+'|'+td.dataset.field));if(td.dataset.selected!==value){td.dataset.selected=value;td.dispatchEvent(new Event('dae-cell-selection-change'));}});}
 function choose(record,field,extend=false){if(!extend||!anchor)anchor={record,field};end={record,field};mark();}
 function stopCellSelection(){
  const state=cellSelectionDrag;cellSelectionDrag=null;
  document.removeEventListener('pointermove',moveCellSelection,true);document.removeEventListener('pointerup',endCellSelection,true);document.removeEventListener('pointercancel',endCellSelection,true);window.removeEventListener('blur',stopCellSelection);
  if(state&&root.hasPointerCapture(state.pointer))root.releasePointerCapture(state.pointer);
 }
 function endCellSelection(e){if(e.pointerId===cellSelectionDrag?.pointer)stopCellSelection();}
 function moveCellSelection(e){
  const state=cellSelectionDrag;if(!state||e.pointerId!==state.pointer)return;
  if(!(e.buttons&1)){stopCellSelection();return;}
  if(!state.moved){if(Math.hypot(e.clientX-state.x,e.clientY-state.y)<4)return;state.moved=true;root.setPointerCapture(e.pointerId);getSelection()?.removeAllRanges();}
  e.preventDefault();
  const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('td[data-field]');
  if(cell&&shell.contains(cell)&&(end?.record!==cell.dataset.record||end?.field!==cell.dataset.field))choose(cell.dataset.record,cell.dataset.field,true);
 }
 function startCellSelection(e){
  if(e.button!==0||!e.isPrimary||e.defaultPrevented||e.target.closest('button,input,textarea,select,a,[contenteditable=true],[role=separator],.dae-prompt-ref,.dae-table-material,.content-material,.generation-prompt-settings'))return;
  const cell=e.target.closest('td[data-field]');if(!cell||!shell.contains(cell))return;
  stopCellSelection();cellSelectionDrag={pointer:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
  e.preventDefault();cell.focus({preventScroll:true});choose(cell.dataset.record,cell.dataset.field,e.shiftKey);
  document.addEventListener('pointermove',moveCellSelection,{capture:true,passive:false});document.addEventListener('pointerup',endCellSelection,true);document.addEventListener('pointercancel',endCellSelection,true);window.addEventListener('blur',stopCellSelection);
 }
 function preventDrag(e){if(cellSelectionDrag){e.preventDefault();e.stopPropagation();}}
 function lostCapture(e){if(e.pointerId===cellSelectionDrag?.pointer)stopCellSelection();}
 root.addEventListener('pointerdown',startCellSelection);
 root.addEventListener('dragstart',preventDrag,true);
 root.addEventListener('lostpointercapture',lostCapture);
 return {selection,choose,mark,clear,selectColumn:field=>{const rows=getTable().records;anchor=rows.length?{record:rows[0].id,field}:null;end=rows.length?{record:rows.at(-1).id,field}:null;mark();},get anchor(){return anchor;},get end(){return end;},get dragging(){return Boolean(cellSelectionDrag);},resetLayout(){stopCellSelection();selectionCache=null;},destroy(){stopCellSelection();root.removeEventListener('dae-inline-edit-start',clear);root.removeEventListener('pointerdown',startCellSelection);root.removeEventListener('dragstart',preventDrag,true);root.removeEventListener('lostpointercapture',lostCapture);}};
}
