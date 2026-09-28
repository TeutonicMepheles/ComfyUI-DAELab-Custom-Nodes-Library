import {initializeImportAssets,materializeImportRows} from './storyboard_import_assets.mjs';
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
        if(result.document_notes){const notes=el("details");el("summary","查看表外说明（保留原文，不自动加入提示词）",notes);el("pre",result.document_notes,notes);}
        const controls = el("div");
        const pick = el("select", "", controls);
        result.tables.forEach((t, i) => { const o = el("option", `${t.name}（${t.rows.length} 行）`, pick); o.value = i; });
        const headerLabel = el("label", "表头行", controls);
        const header = el("input", "", headerLabel); header.type = "number"; header.min = "1"; header.title = "表头所在行"; header.style.width = "70px";
        const mappingBox = el("div");
        const bulk = el("select");
        el("option", "追加共同参考图到全部分镜…", bulk).value = "";
        result.assets.forEach((a, i) => {el("option", `图片 ${i + 1}`, bulk).value = a.id;});
        const rows = el("div");
        rows.style.cssText = "max-height:48vh;overflow:auto;margin-top:12px";
        const status = el("p");
        const footer = el("div");
        let draft = [], table, mapping, busy = false;
        function draw() {
            rows.replaceChildren();
            draft.forEach((shot, index) => {
                const row = el("div", "", rows); row.style.cssText = "display:grid;grid-template-columns:55px 95px 2fr 1fr 280px 65px;gap:8px;padding:10px 0;border-bottom:1px solid #556";
                for (const [key, label] of [["shot_no", "镜号"], ["time_range", "时长"], ["image_prompt", "画面内容"], ["camera_notes", "镜头备注"]]) {
                    const input = el("textarea", "", row); input.value = shot[key]; input.placeholder = label; input.setAttribute("aria-label", label);
                    input.oninput = () => {shot[key] = input.value; if(key==="image_prompt"&&input.value.trim()&&shot.disposition==="pending")shot.disposition="independent"; const choice=row.querySelector("select[aria-label$=图片行处理]");if(choice)choice.value=shot.disposition;updateStatus();};
                }
                const ref = el("div", "", row);ref.style.cssText="min-width:0";const gallery=el("div","",ref);gallery.style.cssText="display:flex;gap:6px;overflow-x:auto;max-width:280px;padding-bottom:6px";
                shot.references.forEach((entry,i)=>{
                    const tile=el('div','',gallery);tile.style.cssText='flex:0 0 126px;width:126px;border:1px solid #546170;padding:4px';
                    const image=el('img','',tile);image.style.cssText='width:116px;height:70px;object-fit:contain';image.src=entry.url||result.assets.find(a=>a.id===entry.asset_id)?.data_url||'';
                    if(entry.file){image.src=URL.createObjectURL(entry.file);image.onload=()=>URL.revokeObjectURL(image.src);}
                    el('small',entry.source_column||'参考图',tile);const label=el('label',`图 ${i+1} 用于生成`,tile),check=el('input','',label);check.type='checkbox';check.checked=entry.selected;check.setAttribute('aria-label',`第 ${index+1} 条图 ${i+1} 用于生成`);check.onchange=()=>entry.selected=check.checked;
                    for(const [step,text] of [[-1,'前移'],[1,'后移']]){const b=el('button',text,tile);b.disabled=i+step<0||i+step>=shot.references.length;b.onclick=()=>{const [item]=shot.references.splice(i,1);shot.references.splice(i+step,0,item);draw();};}
                });
                const upload=el('input','',ref);upload.type='file';upload.multiple=true;upload.accept='image/*';upload.setAttribute('aria-label',`第 ${index+1} 条补图`);upload.style.width='100%';upload.onchange=()=>{shot.references.push(...[...upload.files].map(file=>({file,selected:true})));draw();};
                if(!shot.image_prompt.trim()&&shot.references.length||shot.disposition!=='independent'){
                    const disposition=el('select','',ref);disposition.setAttribute('aria-label',`第 ${index+1} 条图片行处理`);
                    for(const [value,label] of [['pending','请选择图片行归属'],['independent','独立保留，稍后补描述'],['merge','并入上一条分镜']]){const o=el('option',label,disposition);o.value=value;if(value==='merge'&&index===0)o.disabled=true;}
                    disposition.value=shot.disposition;disposition.onchange=()=>{shot.disposition=disposition.value;updateStatus();};
                }
                const remove = el("button", "移除", row); remove.onclick = () => {draft.splice(index, 1); draw();};
                remove.style.alignSelf = "start";
                const note = el("small", "", rows);
                const updateNote = () => { note.textContent = `来源：${table.name} 第 ${shot.source.row} 行。` + (!shot.image_prompt.trim() ? "画面内容待补；" : "") + (timeRangeNeedsReview(shot.time_range) ? "剧本时长待确认（视频时长另设）；" : "") + `原稿 ${shot.references.length} 张图；未勾选的图片仍保留在原稿图片列。`; }; updateNote(); row.addEventListener("input", updateNote); row.addEventListener("change", updateNote);
                const raw = el("details", "", rows); el("summary", "查看原文（含旁白）", raw); el("pre", shot.original_fields.map(f => `${f.name}：${f.value}`).join("\n"), raw);
            });
            updateStatus();
        }
        function updateStatus(){const pending=draft.filter(s=>s.disposition==='pending').length,merged=draft.filter(s=>s.disposition==='merge').length;status.textContent=`将导入 ${draft.length-merged} 条分镜，合并 ${merged} 条图片续行。${pending?pending+' 条图片行待确认归属。':'原稿图片全部保留，勾选的图片用于生成。'}`;}
        function remap() { draft = draftTable(result, table, mapping, Number(header.value) - 1).map(initializeImportAssets); draw(); }
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
        bulk.onchange = () => { if(bulk.value) {draft.forEach(s=>{if(!s.references.some(r=>r.asset_id===bulk.value))s.references.push({asset_id:bulk.value,selected:true});}); draw();} };
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
                    const shots=await materializeImportRows(draft,result.assets,uploadReference);
                    finish({mode, result:{...result,shots}});
                } catch(error) {status.textContent=`导入未应用：${error.message}。可以重试或取消。`; busy=false; dialog.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=false);}
            };
        }
        dialog.addEventListener("pointerdown", stopCanvasPropagation); changeTable(); document.body.append(dialog); dialog.showModal(); title.tabIndex=-1; title.focus();
    });
}
