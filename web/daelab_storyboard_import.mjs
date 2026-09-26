import {draftTable, timeRangeNeedsReview} from "./daelab_storyboard_model.mjs?v=20260926";
import {stopCanvasPropagation} from "./list_editor_controls.mjs";

// Draft state stays outside the node until every reference upload has succeeded.
export function previewImport(result, uploadReference) {
    return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.style.cssText = "width:90vw;max-width:1400px;max-height:88vh;overflow:auto;background:#202631;color:#eee;padding:24px;border:1px solid #667;border-radius:12px;font-family:'Alibaba PuHuiTi 3',sans-serif";
        const el = (tag, text, parent = dialog) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
        dialog.dataset.storyboardImport = "true";
        el("style", `[data-storyboard-import] input,[data-storyboard-import] select,[data-storyboard-import] textarea,[data-storyboard-import] button{font:inherit;font-size:13px;border:1px solid #546170;border-radius:5px;padding:6px;background:#303947;color:#f0f3f6;box-sizing:border-box} [data-storyboard-import] textarea{width:100%;min-width:0;height:86px;resize:vertical} [data-storyboard-import] button{cursor:pointer;margin-right:8px} [data-storyboard-import] label{display:inline-flex;align-items:center;gap:6px;margin:8px 12px 8px 0} [data-storyboard-import] pre{white-space:pre-wrap} [data-storyboard-import] h2:focus{outline:none} [data-storyboard-import] small{color:#efbf78} [data-storyboard-import] summary{cursor:pointer;color:#adc8df;margin:6px 0}`);
        const title = el("h2", "预览分镜导入");
        el("p", "先选择表格与对应列，再修正内容。切换表或列会重建预览。确认前不会改变原有分镜。旁白等原文会保留，不加入生图提示词。");
        const warning = el("p", result.warnings.join("；"));
        const controls = el("div");
        const pick = el("select", "", controls);
        result.tables.forEach((t, i) => { const o = el("option", `${t.name}（${t.rows.length} 行）`, pick); o.value = i; });
        const headerLabel = el("label", "表头行", controls);
        const header = el("input", "", headerLabel); header.type = "number"; header.min = "1"; header.title = "表头所在行"; header.style.width = "70px";
        const mappingBox = el("div");
        const bulk = el("select");
        el("option", "同一参考图用于全部分镜…", bulk).value = "";
        result.assets.forEach((a, i) => {el("option", `图片 ${i + 1}`, bulk).value = a.id;});
        const rows = el("div");
        rows.style.cssText = "max-height:48vh;overflow:auto;margin-top:12px";
        const status = el("p");
        const footer = el("div");
        let draft = [], table, mapping, busy = false;
        function draw() {
            rows.replaceChildren();
            draft.forEach((shot, index) => {
                const row = el("div", "", rows); row.style.cssText = "display:grid;grid-template-columns:55px 95px 2fr 1fr 180px 65px;gap:8px;padding:10px 0;border-bottom:1px solid #556";
                for (const [key, label] of [["shot_no", "镜号"], ["time_range", "时长"], ["image_prompt", "画面内容"], ["camera_notes", "镜头备注"]]) {
                    const input = el("textarea", "", row); input.value = shot[key]; input.placeholder = label; input.setAttribute("aria-label", label);
                    input.oninput = () => {shot[key] = input.value;};
                }
                const ref = el("div", "", row), image = el("img", "", ref); image.style.cssText = "width:120px;height:70px;object-fit:contain";
                const select = el("select", "", ref); el("option", "无参考图", select).value = "";
                if (shot.image_url) el("option", "原有参考图", select).value = "existing";
                result.assets.forEach((a, i) => {el("option", `图片 ${i + 1}${shot.candidate_assets.includes(a.id) ? '（本行）' : ''}`, select).value = a.id;});
                select.value = shot.asset_id || (shot.image_url ? "existing" : "");
                const refresh = () => {image.src = result.assets.find(a => a.id === shot.asset_id)?.data_url || shot.image_url || ""; image.hidden = !shot.asset_id && !shot.image_url;};
                select.onchange = () => {delete shot.file; shot.asset_id = select.value === "existing" ? "" : select.value; if(select.value !== "existing") shot.image_url = ""; refresh();}; refresh();
                const upload = el("input", "", ref); upload.type = "file"; upload.accept = "image/*";
                upload.style.width = "100%";
                upload.onchange = () => {shot.file = upload.files[0]; if(shot.file) {image.src = URL.createObjectURL(shot.file); image.onload = () => URL.revokeObjectURL(image.src); image.hidden = false; shot.asset_id = ""; shot.image_url = "";}};
                const remove = el("button", "移除", row); remove.onclick = () => {draft.splice(index, 1); draw();};
                remove.style.alignSelf = "start";
                const note = el("small", "", rows);
                const updateNote = () => { note.textContent = `来源：${table.name} 第 ${shot.source.row} 行。` + (!shot.image_prompt.trim() ? "画面内容待补；" : "") + (timeRangeNeedsReview(shot.time_range) ? "时长待确认（当前默认 3 秒）；" : "") + (shot.candidate_assets.length > 1 && !shot.asset_id && !shot.image_url && !shot.file ? "本行有多张图片，请选择；" : ""); }; updateNote(); row.addEventListener("input", updateNote); row.addEventListener("change", updateNote);
                const raw = el("details", "", rows); el("summary", "查看原文（含旁白）", raw); el("pre", shot.original_fields.map(f => `${f.name}：${f.value}`).join("\n"), raw);
            });
            status.textContent = `共 ${draft.length} 个分镜。缺项可导入后补齐；生成前必须补齐画面内容。`;
        }
        function remap() { draft = draftTable(result, table, mapping, Number(header.value) - 1); draw(); }
        function changeTable() {
            table = result.tables[Number(pick.value)]; mapping = {...table.mapping}; header.value = table.header_index + 1; buildMapping();
        }
        function buildMapping() {
            mappingBox.replaceChildren();
            for(const [key,label] of [["shot_no","镜号"],["time_range","时长"],["image_prompt","画面内容"],["camera_notes","备注"],["reference_image","参考图路径"]]) {
                const wrap = el("label", label, mappingBox), s = el("select", "", wrap); el("option","不指定",s).value = "";
                (table.rows[Number(header.value)-1] || []).forEach((name,i) => {el("option", `${i+1}: ${name || '空列'}`,s).value=i;}); s.value = mapping[key] ?? "";
                s.onchange=()=>{ if(s.value === "") delete mapping[key]; else mapping[key]=Number(s.value); remap(); };
            } remap();
        }
        pick.onchange = changeTable; header.onchange = () => {header.value = Math.max(1, Math.min(table.rows.length, Number(header.value)||1)); buildMapping();};
        bulk.onchange = () => { if(bulk.value) {draft.forEach(s=>{s.asset_id=bulk.value; s.image_url=""; delete s.file;}); draw();} };
        const finish = value => {dialog.remove(); resolve(value);};
        const cancel = el("button", "取消", footer); cancel.onclick = () => {if(!busy) finish(null);};
        dialog.oncancel = event => {event.preventDefault(); if(!busy) finish(null);};
        for(const [mode,label] of [["append","确认追加"],["replace","确认替换全部分镜"]]) {
            const button = el("button", label, footer);
            button.style.background = mode === "append" ? "#245e82" : "#714e38";
            button.onclick = async () => {
                if(busy || !draft.length) return;
                busy=true; dialog.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=true); status.textContent="正在保存参考图…";
                try {
                    const uploaded=new Map(), shots=[];
                    for(const source of draft) {
                        const shot={...source};
                        if(shot.file) shot.image_url = await uploadReference(shot.file);
                        else if(shot.asset_id) {
                            if(!uploaded.has(shot.asset_id)) {const a=result.assets.find(a=>a.id===shot.asset_id); const blob=await (await fetch(a.data_url)).blob(); uploaded.set(a.id,await uploadReference(new File([blob],a.name,{type:blob.type})));}
                            shot.image_url=uploaded.get(shot.asset_id);
                        }
                        shots.push(shot);
                    }
                    finish({mode, result:{...result,shots}});
                } catch(error) {status.textContent=`导入未应用：${error.message}。可以重试或取消。`; busy=false; dialog.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=false);}
            };
        }
        dialog.addEventListener("pointerdown", stopCanvasPropagation); changeTable(); document.body.append(dialog); dialog.showModal(); title.tabIndex=-1; title.focus();
    });
}
