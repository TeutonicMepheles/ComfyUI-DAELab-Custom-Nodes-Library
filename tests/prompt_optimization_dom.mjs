// Small DOM double for lifecycle/controller tests; actual layout is verified in ComfyUI.
export class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.value='';this.style={setProperty(){}};this.classList={add(){}};this.isConnected=true;}
 append(...nodes){for(const e of nodes){e.parentNode=this;this.children.push(e);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 insertBefore(node,before){node.parentNode=this;this.children.splice(this.children.indexOf(before),0,node);}
 setAttribute(name,value){this[name]=value;}
 removeAttribute(name){delete this[name];}
 remove(){this.parentNode?.children.splice(this.parentNode.children.indexOf(this),1);this.isConnected=false;}
 getClientRects(){return [this.getBoundingClientRect()];}
 getBoundingClientRect(){return {left:100,right:400,top:600,bottom:700};}
 focus(){}
 contains(e){return e===this||this.children.some(n=>n.contains(e));}
}
export function installDom(t){
 const keys=['document','window','innerWidth','innerHeight','ResizeObserver','addEventListener','removeEventListener'],before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const doc=new EventTarget();Object.assign(doc,{createElement:tag=>new Element(tag),activeElement:null,body:new Element('body'),head:new Element('head'),getElementById:()=>null});
 Object.assign(globalThis,{document:doc,window:new EventTarget(),innerWidth:1700,innerHeight:1100,ResizeObserver:class{observe(){}disconnect(){}},addEventListener(){},removeEventListener(){}});
 doc.restore=()=>{for(const k of keys)if(before[k]===undefined)delete globalThis[k];else globalThis[k]=before[k];};return doc;
}
