// Connection state is transient DOM state. Credentials never enter workflow properties.
export function fallbackCapabilities(model) {
    const h3=model==="Minimax H3";
    return {model, resolution:h3?["768P","2K"]:model==="Seedance 2.5"?["480p","720p","1080p"]:model==="Seedance 2.0"?["480p","720p","1080p","4k"]:["480p","720p"],
        modes:h3?["text2video","singleImage2video","frames2video","mixed2video"]:["text2video","singleImage2video","frames2video","image2video","mixed2video"],
        duration:{min:h3?5:4,max:model==="Seedance 2.5"?30:15},sound:!h3};
}

export function compatibleValues(values, caps) {
    const result = {...values};
    for (const [field, key] of [["resolution", "resolution"], ["ratio", "ratio"], ["mode", "modes"]]) {
        const choices = caps[key];
        if (choices?.length && !choices.includes(result[field])) result[field] = choices[0];
    }
    const duration = caps.duration || {};
    if (duration.enum?.length && !duration.enum.includes(Number(result.duration))) result.duration = duration.enum[0];
    else result.duration = Math.min(duration.max ?? 30, Math.max(duration.min ?? 4, Number(result.duration) || 4));
    if (!caps.sound) result.sound = false;
    return result;
}

export async function connectionRequest(action, method = "GET") {
    const response = await fetch(`/daelab/libtv/connection/${action}`, {method, cache:"no-store"});
    if (response.status === 404) throw new Error("连接服务尚未加载，请重启当前 ComfyUI 后刷新页面。");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "连接请求失败");
    return data;
}

export function connectionPanel(root, {get, set, capabilities}) {
    const section = document.createElement("section");
    section.className = "refs";
    const title = document.createElement("strong"); title.textContent = "LibTV 账号连接";
    const state = document.createElement("p"); state.setAttribute("role", "status");
    state.textContent = "每台机器登录一次；账号凭据不会保存到工作流。";
    const login = document.createElement("button"); login.type="button"; login.textContent="登录 / 更换 LibTV 账号";
    const check = document.createElement("button"); check.type="button"; check.textContent="检查连接 / 读取画布";
    const select = document.createElement("select"); select.setAttribute("aria-label", "选择 LibTV 画布");
    select.add(new Option("登录后读取画布，或在下方填写画布 ID", ""));
    const more = document.createElement("button"); more.type="button"; more.textContent="读取下一页画布"; more.hidden=true;
    let page=1, polling=false;
    select.onchange=()=>{if(select.value)set("project_uuid",select.value);};
    async function projects(append=false) {
        const data = await connectionRequest(`projects?page=${page}`);
        if (!append) select.replaceChildren(new Option("选择生成结果存放的 LibTV 画布", ""));
        for(const item of data.projects) select.add(new Option(item.name, item.uuid));
        if([...select.options].some(o=>o.value===get("project_uuid")))select.value=get("project_uuid");
        more.hidden=data.projects.length<50;
        if (!select.value && get("project_uuid")) state.textContent += "；当前使用工作流中填写的画布 ID。";
    }
    async function refresh() {
        check.disabled=true;
        try {
            const data = await connectionRequest("status");
            state.textContent = data.connected ? `已连接：${data.account}` : data.state==="cli_missing" ? "未找到官方 LibTV CLI，请安装后重试。" : "暂未验证连接：请登录，或检查网络后重试。";
            if (data.connected) {page=1; await projects(); await capabilities(false);}
            return data.connected;
        } catch(error) {state.textContent=error.message; return false;}
        finally {check.disabled=false;}
    }
    check.onclick=refresh;
    more.onclick=async()=>{more.disabled=true;try{page++;await projects(true);}catch(error){page--;state.textContent=error.message;}finally{more.disabled=false;}};
    login.onclick=async()=>{
        if(polling)return;
        login.disabled=true;polling=true;
        try{
            await connectionRequest("login","POST");
            state.textContent="已在本机默认浏览器打开 LibTV。完成登录后点击“检查连接”；登录窗口最多等待 5 分钟。";
        }catch(error){state.textContent=error.message;}
        finally{login.disabled=false;polling=false;}
    };
    section.append(title,state,login,check,select,more);
    root.append(section);
}
