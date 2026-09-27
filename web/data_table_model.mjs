// Business-independent table model. No storyboard, ComfyUI or provider dependencies.
export const FIELD_TYPES = ['text','longtext','number','checkbox','select','assets','json'];
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function emptyValue(field) {return field.type==='assets'?[]:field.type==='checkbox'?false:field.type==='number'?null:'';}
export function convertValue(field,value) {
    if(field.type==='assets') {
        if(value==null || value==='')return [];
        let items=value;
        if(typeof value==='string')items=value.trim().startsWith('[')?JSON.parse(value):value.split(/\n/).filter(Boolean).map(url=>({url,name:'素材'}));
        if(!Array.isArray(items) || items.some(a=>!a || typeof a.url!=='string'))throw new Error('素材字段需要素材列表或本地 /view 地址');
        return items.map(a=>{if(!a.url.startsWith('/view?'))throw new Error('请选择 Comfy 本地素材');return {...a,id:a.id||uid(),name:String(a.name||'素材')};});
    }
    if(field.type==='checkbox') {
        if([true,1,'1','true','是'].includes(value))return true;
        if([false,0,'0','false','否','',null,undefined].includes(value))return false;
        throw new Error('勾选字段请填写 true / false');
    }
    if(field.type==='number') {if(value==='' || value==null)return null;const n=Number(value);if(!Number.isFinite(n))throw new Error('请输入有效数字');return n;}
    if(field.type==='select' && value && !field.options?.includes(String(value)))throw new Error('内容不在该字段的选项中');
    if(field.type==='json') {if(typeof value==='object')return clone(value);if(!value)return '';return JSON.parse(value);}
    return String(value ?? '');
}
export function normalizeTable(value={}) {
    const raw=typeof value==='string'?JSON.parse(value||'{}'):value;
    if(!raw || typeof raw!=='object' || Array.isArray(raw) || (raw.fields&&!Array.isArray(raw.fields)) || (raw.records&&!Array.isArray(raw.records)))throw new Error('表格数据格式错误');
    const ids=new Set();
    const fields=(raw.fields || []).map(f=>{
        const id=String(f.id||uid());if(ids.has(id))throw new Error('字段 ID 重复');ids.add(id);
        return {...clone(f),id,name:String(f.name||'未命名字段'),type:FIELD_TYPES.includes(f.type)?f.type:'text',hidden:Boolean(f.hidden),width:Math.min(600,Math.max(100,Number(f.width)||180))};
    });
    const recordIds=new Set();
    const records=(raw.records || []).map(r=>{
        const id=String(r.id||uid());if(recordIds.has(id))throw new Error('记录 ID 重复');recordIds.add(id);
        // Preserve values for unknown/deleted fields until an explicit delete operation.
        return {...clone(r),id,selected:r.selected!==false,values:clone(r.values||{})};
    });
    return {version:1,fields,records,view:raw.view==='cards'?'cards':'table',meta:clone(raw.meta||{})};
}
export function addField(table,spec={}) {
    const field={id:uid(),name:'新字段',type:'text',width:180,hidden:false,...spec};
    if(table.fields.some(f=>f.id===field.id))throw new Error('字段 ID 已存在');
    table.fields.push(field);return field;
}
export function removeField(table,id) {table.fields=table.fields.filter(f=>f.id!==id);for(const row of table.records)delete row.values[id];if(table.meta.asset_groups)table.meta.asset_groups=table.meta.asset_groups.filter(g=>g.field_id!==id);}
export function addRecord(table,values={},afterId=null) {
    const record={id:uid(),selected:true,values:clone(values)};
    const at=afterId?table.records.findIndex(r=>r.id===afterId)+1:table.records.length;
    table.records.splice(at,0,record);return record;
}
export function duplicateSelected(table) {
    const records=[];for(const r of table.records){records.push(r);if(r.selected)records.push({...clone(r),id:uid()});}table.records=records;
}
export function reorder(items,sourceId,targetId,after=false) {
    if(sourceId===targetId)return;
    const from=items.findIndex(x=>x.id===sourceId),target=items.findIndex(x=>x.id===targetId);if(from<0||target<0)return;
    const [item]=items.splice(from,1);items.splice(items.findIndex(x=>x.id===targetId)+(after?1:0),0,item);
}
export function setValue(table,recordId,fieldId,value) {
    const field=table.fields.find(f=>f.id===fieldId),record=table.records.find(r=>r.id===recordId);
    if(!field || !record)throw new Error('字段或记录已不存在');if(field.readonly)throw new Error('此字段由数据来源更新');
    record.values[fieldId]=convertValue(field,value);
}
export function transferValue(table,from,to,mode='swap') {
    const a=table.fields.find(f=>f.id===from.field),b=table.fields.find(f=>f.id===to.field);
    if(!a||!b||a.readonly||b.readonly)throw new Error('此字段不可拖动');
    if(a.type!==b.type)throw new Error('请在同类型字段之间拖动');
    if(from.record===to.record && from.field===to.field)return;
    const source=table.records.find(r=>r.id===from.record),target=table.records.find(r=>r.id===to.record);
    if(!source||!target)throw new Error('记录已不存在');
    const av=clone(source.values[a.id]??emptyValue(a)),bv=clone(target.values[b.id]??emptyValue(b));
    // Validate both destinations before changing either cell (notably select options).
    const nextTarget=convertValue(b,av),nextSource=mode==='swap'?convertValue(a,bv):emptyValue(a);
    source.values[a.id]=nextSource;target.values[b.id]=nextTarget;
}
export function parseTSV(text) {
    const rows=[[]];let cell='',quoted=false;
    for(let i=0;i<text.length;i++){
        const c=text[i];
        if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else if(!cell || quoted)quoted=!quoted;else cell+=c;}
        else if(!quoted && (c==='\t'||c==='\n'||c==='\r')){rows.at(-1).push(cell);cell='';if(c!=='\t'){if(c==='\r'&&text[i+1]==='\n')i++;rows.push([]);}}
        else cell+=c;
    }
    if(quoted)throw new Error('粘贴文本的引号未闭合');
    rows.at(-1).push(cell);if(rows.length>1&&rows.at(-1).length===1&&rows.at(-1)[0]==='')rows.pop();return rows;
}
export function pasteMatrix(table,recordId,fieldId,matrix) {
    const copy=clone(table),fields=copy.fields.filter(f=>!f.hidden),ri=copy.records.findIndex(r=>r.id===recordId),ci=fields.findIndex(f=>f.id===fieldId);
    if(ri<0||ci<0)throw new Error('请先选择起始单元格');
    if(matrix.some(row=>ci+row.length>fields.length))throw new Error('粘贴超出当前可见字段，请先添加字段');
    if(ri+matrix.length>500)throw new Error('每张表最多 500 行');
    while(copy.records.length<ri+matrix.length)addRecord(copy);
    matrix.forEach((row,i)=>row.forEach((value,j)=>setValue(copy,copy.records[ri+i].id,fields[ci+j].id,value)));
    table.records=copy.records;
}
export function encodeTSV(matrix) {return matrix.map(row=>row.map(value=>{const s=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');return /[\t\n\r"]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}).join('\t')).join('\n');}
export class SnapshotHistory {
    constructor(limit=60){this.undoStack=[];this.redoStack=[];this.limit=limit;this.group=null;}
    record(before,after,group=null){if(before===after)return;if(!group||group!==this.group)this.undoStack.push(before);if(this.undoStack.length>this.limit)this.undoStack.shift();this.group=group;this.redoStack=[];}
    restore(current,redo=false){const from=redo?this.redoStack:this.undoStack,to=redo?this.undoStack:this.redoStack;if(!from.length)return null;to.push(current);this.group=null;return JSON.parse(from.pop());}
}
