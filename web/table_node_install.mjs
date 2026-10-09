// LiteGraph adds restored nodes before configuring their saved properties.
// Coalesce lifecycle hooks until the synchronous restore has finished.
const pending=new WeakSet();
export function scheduleTableInstall(node,install){
 if(pending.has(node))return;
 pending.add(node);
 queueMicrotask(()=>{pending.delete(node);if(node.graph)install(node);});
}
