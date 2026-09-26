// Uses ComfyTV's public asset API and registered loader; never imports upstream code.
export function resultUrl(message) {
    const file = message?.images?.find(f => /\.(mp4|webm|mov)$/i.test(f.filename || ""));
    if (!file) return null;
    return "/view?" + new URLSearchParams({filename:file.filename, subfolder:file.subfolder || "", type:file.type || "output"});
}

export function validateResultUrl(value) {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost" || url.pathname !== "/view" ||
        url.searchParams.get("type") !== "output" ||
        !/^daelab\/libtv\/[a-f0-9]{24}$/i.test(url.searchParams.get("subfolder") || "") ||
        !/^[\w.-]+\.(mp4|webm|mov)$/i.test(url.searchParams.get("filename") || "")) {
        throw new Error("只支持本地 LibTV 已生成视频");
    }
    return url.pathname + url.search;
}

export async function addVideoToCanvas(app, value, title) {
    const url = validateResultUrl(value);
    const graph = app.graph;
    const type = "ComfyTV.AssetVideoLoaderStage";
    const existing = graph?._nodes?.find(n => n.type === type && n.widgets?.some(w => w.name === "asset_url" && w.value === url));
    if (existing) return existing;
    if (!globalThis.LiteGraph?.registered_node_types?.[type]) throw new Error("当前服务未加载 ComfyTV，请在主服务中打开结果");
    const request = async (path, data) => {
        const response = await fetch(path, data ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)} : {});
        if (!response.ok) throw new Error(`ComfyTV 素材接口 ${response.status}`);
        return response.json();
    };
    const assets = (await request("/comfytv/assets?limit=1000")).assets || [];
    const asset = assets.find(a => a.payload_url === url) || (await request("/comfytv/assets", {
        name:title, media_type:"video", payload_url:url, mime_type:"video/mp4", source:"DAELAB.LibTV",
    })).asset;
    // Recheck after asynchronous asset lookup so repeated completion events cannot duplicate nodes.
    const duplicate = graph._nodes?.find(n => n.type === type && n.widgets?.some(w => w.name === "asset_url" && w.value === url));
    if (duplicate) return duplicate;
    const node = globalThis.LiteGraph.createNode(type);
    if (!node) throw new Error("ComfyTV 视频节点创建失败");
    node.title = title;
    const values = {asset_url:url,asset_id:asset.id,category:"all"};
    for (const w of node.widgets || []) if (w.name in values) w.value = values[w.name];
    const right = Math.max(0, ...(graph._nodes || []).map(n => n.pos[0] + n.size[0]));
    node.pos = [right + 80, 100];
    graph.add(node); graph.setDirtyCanvas?.(true,true);
    return node;
}
