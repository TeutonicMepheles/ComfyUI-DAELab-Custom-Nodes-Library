export const STATE_KEY = 'daelabCreativeCanvasV1';
export const TABLE_TYPES = ['DAELAB.Table', 'DAELAB.StoryboardImport', 'DAELAB.ComfyTV.GPTImageStoryboardStage'];
export function supportedNode(node) {
    return TABLE_TYPES.includes(node.type) || node.type?.startsWith('DAELAB.LibTV.') || node.type?.startsWith('ComfyTV.');
}
export function canvasState(graph) {
    graph.extra ||= {};
    const state = graph.extra[STATE_KEY] ||= {version:1, active:false, viewport:{x:60,y:60,zoom:0.8}, cards:{}};
    state.cards ||= {};
    state.viewport = normalizeViewport(state.viewport);
    return state;
}
export function normalizeViewport(v={}) {
    return {x:Number.isFinite(v.x)?v.x:60,y:Number.isFinite(v.y)?v.y:60,zoom:Math.min(2,Math.max(0.15,Number(v.zoom)||0.8))};
}
export function zoomAt(v, point, factor) {
    const zoom = normalizeViewport({...v,zoom:v.zoom*factor}).zoom;
    return {x:point.x-(point.x-v.x)*zoom/v.zoom,y:point.y-(point.y-v.y)*zoom/v.zoom,zoom};
}
export function cardState(state,node,index=0) {
    return state.cards[node.id] ||= {x:index%3*530,y:Math.floor(index/3)*440,width:TABLE_TYPES.includes(node.type)?1060:460,expanded:TABLE_TYPES.includes(node.type)};
}
export function socketCompatible(output,input) {
    const a=String(output),b=String(input);
    return a==='*'||b==='*'||a.split(',').some(t=>b.split(',').includes(t));
}
export function graphLinks(graph) {
    const links=graph.links;
    return links?.values ? [...links.values()] : Object.values(links||{});
}
export function localOutputPreview(message) {
    const url=message?.output?.find?.(u=>typeof u==='string'&&u.startsWith('/view?'));
    if(!url)return null;
    const params=new URL(url,'http://localhost').searchParams;
    if(params.get('type')!=='output')return null;
    const file=params.get('filename')||'';
    const kind=/\.(mp4|webm|mov)$/i.test(file)?'video':/\.(png|jpe?g|webp|gif)$/i.test(file)?'image':null;
    return kind?{url,kind}:null;
}
