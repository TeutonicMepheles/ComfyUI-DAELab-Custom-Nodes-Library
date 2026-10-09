import {isGeneration,rowGenerationConfig,setRowGenerationConfig,generationConfigField} from './table_generation_model.mjs?v=20261002-shared-prompt-generation-config';
import {isPrompt,promptField} from './table_prompt_model.mjs?v=20261001-frame-tags-dedup';
import {addField,addRecord,removeField,clone,uid,reorder,emptyValue} from './data_table_model.mjs?v=20261001-frame-tags-dedup';
import {createTableButton as button} from './table_controls.mjs?v=20261009-review-r6';
import {applyPromptToColumn} from './table_prompt_template.mjs?v=20261001-frame-tags-dedup';
import {previewContentAsset} from './table_content_view.mjs?v=20261009-review-r6';
import {createPromptOptimizationEntry} from './prompt_optimization_panel.mjs?v=20261009-review-r6';

const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};

// One instance-owned contextual menu; the existing editor remains the transaction
// owner. This module never reads another plugin's node or private application state.
export function installContentPresentation({root,editor,getTable,notify,editPromptTemplate}){
    const toolbar=el('aside','dae-ui content-context');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','表格选中操作');toolbar.hidden=true;document.body.append(toolbar);
    let selected=null,signature='',disposed=false,columnGrid=null,columnSelection=null,rowGrid=null,rowSelection=null,cellAnchor=null,columnAnchor=null,rowAnchor=null,optimizationEntry=null,nativeMenuOpen=false;
    const context=()=>globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root);
    const active=()=>context()?.presentation==='content'&&root.isConnected&&!!context()?.getViewport();
    const nativeActive=()=>nativeMenuOpen&&root.isConnected&&!context();
    const findCell=()=>{if(!selected?.record)return null;if(!cellAnchor?.isConnected||cellAnchor.dataset.field!==selected.field||cellAnchor.dataset.record!==selected.record)cellAnchor=root.querySelector(`td[data-field="${CSS.escape(selected.field)}"][data-record="${CSS.escape(selected.record)}"]`);return cellAnchor;};
    const field=()=>getTable().fields.find(f=>f.id===selected?.field);
    const mutate=fn=>{try{editor.change(fn);signature='';tick();}catch(e){notify(e.message);}};
    function rename(){const f=field();if(!f)return;const d=editor.openDialog('重命名列'),input=el('input');input.value=f.name;input.setAttribute('aria-label','列名称');const save=()=>{if(!input.value.trim())return;mutate(t=>t.fields.find(x=>x.id===f.id).name=input.value.trim());d.remove();};d.append(input,button('保存',save),button('取消',()=>d.remove()));input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)save();};input.focus();input.select();}
    function build(){
        const prompt=isPrompt(field());
        optimizationEntry?.destroy();optimizationEntry=null;
        toolbar.replaceChildren();const label=el('span','content-context-label',selected.kind==='table'?'表格':selected.kind==='column'?field()?.name:selected.kind==='row'?'行':'单元格');toolbar.append(label);
        if(prompt&&!field()?.readonly&&editor.openPromptOptimization&&editor.promptOptimizationEstimate&&(selected.kind==='column'||selected.kind==='cell'&&(nativeActive()||editor.selection().flat().length<=1))){
            const menuEditor={promptOptimizationEstimate:target=>editor.promptOptimizationEstimate(target),openPromptOptimization:target=>{editor.openPromptOptimization(target);if(nativeMenuOpen){nativeMenuOpen=false;toolbar.hidden=true;}}};
            optimizationEntry=createPromptOptimizationEntry({editor:menuEditor,target:{scope:selected.kind==='column'?'column':'cell',fieldId:selected.field,...(selected.kind==='cell'?{recordId:selected.record}:{})}});toolbar.append(optimizationEntry.element);
        }
        if(nativeActive())return;
        if(selected.kind==='table'){
            toolbar.append(button('提示词模板',()=>{let id=promptField(getTable());if(!getTable().fields.some(f=>f.id===id)){mutate(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});}editPromptTemplate?.(id);}),button('撤销',()=>{editor.restore();signature='';}),button('重做',()=>{editor.restore(true);signature='';}));
            const density=el('select');density.setAttribute('aria-label','内容显示');for(const [v,n] of [['comfortable','舒适'],['compact','紧凑']])density.add(new Option(n,v));density.value=getTable().meta.density||'comfortable';density.onchange=()=>mutate(t=>t.meta.density=density.value);toolbar.append(density);
        }else if(selected.kind==='column'){
            toolbar.append(button('重命名',rename));if(prompt)toolbar.append(button('编辑整列模板',()=>editPromptTemplate?.(selected.field)));const target=el('select');target.setAttribute('aria-label','列目标');for(const [v,n] of [['','无目标'],['image','图像生成']])target.add(new Option(n,v));target.value=field()?.goal||'';target.onchange=()=>mutate(t=>t.fields.find(f=>f.id===selected.field).goal=target.value);toolbar.append(target);
            toolbar.append(button('复制列',()=>mutate(t=>{const old=t.fields.find(f=>f.id===selected.field),next=addField(t,{...clone(old),id:uid(),name:old.name+' 副本'});reorder(t.fields,next.id,old.id,true);for(const r of t.records){r.values[next.id]=clone(r.values[old.id]??emptyValue(old));if(Array.isArray(r.values[next.id]))for(const a of r.values[next.id])a.id=uid();}selected={kind:'column',field:next.id};})),button('清空列',()=>mutate(t=>{const f=t.fields.find(f=>f.id===selected.field);delete f.promptTemplate;for(const r of t.records)r.values[f.id]=emptyValue(f);})),button('删除列',()=>mutate(t=>{removeField(t,selected.field);selected={kind:'table'};})));
        }else if(selected.kind==='row'){
            const recordId=selected.record;
            toolbar.append(button('复制行',()=>mutate(t=>{
                const source=clone(t.records.find(row=>row.id===recordId)),copy=addRecord(t,source.values,recordId);
                Object.assign(copy,source,{id:copy.id});
                if(copy.meta){delete copy.meta.generation;delete copy.meta.generationColumns;}
                selected={kind:'row',record:copy.id};
            })),button('清空行',()=>mutate(t=>{
                const row=t.records.find(row=>row.id===recordId);
                for(const field of t.fields)row.values[field.id]=field.promptTemplate?{kind:'column-template',version:1,segments:[]}:emptyValue(field);
                if(row.meta){delete row.meta.generation;delete row.meta.generationColumns;delete row.meta.generationFrames;}
            })),button('删除行',()=>mutate(t=>{t.records=t.records.filter(r=>r.id!==recordId);selected={kind:'table'};})));
        }else{
            const f=field(),value=getTable().records.find(r=>r.id===selected.record)?.values[f?.id],asset=Array.isArray(value)&&value.length===1?value[0]:null;
            const region=editor.selection().flat(),many=region.length>1;
            if(!many&&f?.type==='content'&&!f.readonly)toolbar.append(button('添加图片',()=>findCell()?.dispatchEvent(new Event('dae-upload'))));
            if(asset&&!many){const a=el('a','', '下载');a.href=asset.url;a.download=asset.name||'素材';toolbar.append(a);}
            toolbar.append(button('复制',()=>editor.copySelection()));
            if(!many&&prompt&&!f.readonly){const fill=button('应用到整列',()=>mutate(t=>{
                const source=t.records.find(row=>row.id===selected.record);
                applyPromptToColumn(t,selected.field,selected.record);
                for(const target of new Set(t.fields.filter(field=>isGeneration(field)&&field.generation.promptFieldId===selected.field).map(field=>generationConfigField(t,field.id)))){
                    const config=rowGenerationConfig(source,target.id,target.generation);
                    for(const row of t.records)setRowGenerationConfig(row,target.id,config);
                }
            }));fill.title='覆盖本列所有行的提示词和当前生成配置；@列引用仍读取各自行的素材，配置不再跟随默认值，可撤销';toolbar.append(fill);}
            toolbar.append(button(many?'清空选区':'清空',()=>editor.clearCells(region.length?region:[{row:{id:selected.record},field:f}])));
            toolbar.append(button('列操作',()=>{selected={kind:'column',field:selected.field};signature='';tick();}),button('表格操作',()=>{selected={kind:'table'};signature='';tick();}));
        }
    }
    function choose(e){
        if(toolbar.contains(e.target)||e.target.closest('dialog,.dae-table-material-preview,.table-text-side,.table-column-popover,.table-structure-control,.table-choice input,.generation-actions,.generation-cell-state'))return;
        if(nativeMenuOpen){nativeMenuOpen=false;selected=null;toolbar.hidden=true;}
        if(e.type==='focusin'&&!root.contains(e.target))return;
        if(!active()||!context()?.contains(e.target)){if(selected)editor.clearSelection();selected=null;toolbar.hidden=true;queueMicrotask(tick);return;}
        if(e.target.closest('[data-inline-editing=true]')){selected=null;editor.clearSelection();toolbar.hidden=true;root.querySelectorAll('[data-column-selected]').forEach(e=>delete e.dataset.columnSelected);queueMicrotask(tick);return;}
        const cell=e.target.closest('td[data-field]'),th=e.target.closest('th[data-column]'),row=e.target.closest('.table-choice[data-content-row]');
        selected=cell?{kind:'cell',field:cell.dataset.field,record:cell.dataset.record}:th?{kind:'column',field:th.dataset.column}:row?{kind:'row',record:row.dataset.contentRow}:{kind:'table'};
        if(selected.kind==='column')editor.selectColumn(selected.field);else if(selected.kind!=='cell')editor.clearSelection();signature='';queueMicrotask(tick);
    }
    function tick(){
        if(disposed)return;const showing=String(active());if(root.dataset.contentPresentation!==showing){root.dataset.contentPresentation=showing;editor.render();}
        const chosen=String(showing==='true'&&!!context()?.selected||nativeActive());if(root.dataset.contentSelected!==chosen)root.dataset.contentSelected=chosen;
        if(chosen==='false'&&selected){selected=null;editor.clearSelection();}
        if(showing!=='true'&&!nativeActive()){columnGrid=null;columnSelection=null;rowGrid=null;rowSelection=null;toolbar.hidden=true;return;}
        const grid=root.querySelector('table'),column=selected?.kind==='column'?selected.field:null;
        if(grid!==columnGrid||column!==columnSelection){
            columnGrid=grid;columnSelection=column;
            root.querySelectorAll('th[data-column],td[data-field]').forEach(e=>{const chosen=String(Boolean(column)&&(e.dataset.column||e.dataset.field)===column);if(e.dataset.columnSelected!==chosen)e.dataset.columnSelected=chosen;if(e.matches('th')&&e.getAttribute('aria-selected')!==chosen)e.setAttribute('aria-selected',chosen);});
        }
        const row=selected?.kind==='row'?selected.record:null;
        if(grid!==rowGrid||row!==rowSelection){
            rowGrid=grid;rowSelection=row;
            root.querySelectorAll('tr[data-record-id]').forEach(e=>{const chosen=String(Boolean(row)&&e.dataset.recordId===row);if(e.dataset.rowActive!==chosen)e.dataset.rowActive=chosen;const gutter=e.querySelector('.table-choice');if(gutter&&gutter.getAttribute('aria-selected')!==chosen)gutter.setAttribute('aria-selected',chosen);});
        }
        if((!active()||!context()?.selected)&&!nativeActive()||!selected){toolbar.hidden=true;return;}
        const key=JSON.stringify([selected,getTable().fields,editor.selection().reduce((count,row)=>count+row.length,0),selected.kind==='cell'?getTable().records.find(r=>r.id===selected.record)?.values[selected.field]:null]);if(key!==signature){signature=key;build();}
        positionToolbar();
    }
    function positionToolbar(){
        if(disposed)return;
        if(!selected||((!context()?.selected||!active())&&!nativeActive())||root.querySelector('[data-inline-editing=true],[data-structure-dragging],[data-structure-popup]')){toolbar.hidden=true;return;}
        if(selected.kind==='column'&&(!columnAnchor?.isConnected||columnAnchor.dataset.column!==selected.field))columnAnchor=root.querySelector(`th[data-column="${CSS.escape(selected.field)}"]`);
        if(selected.kind==='row'&&(!rowAnchor?.isConnected||rowAnchor.dataset.contentRow!==selected.record))rowAnchor=root.querySelector(`.table-choice[data-content-row="${CSS.escape(selected.record)}"]`);
        let anchor=selected.kind==='cell'?findCell():selected.kind==='column'?columnAnchor:selected.kind==='row'?rowAnchor:null;
        if(!anchor&&selected.kind!=='table'){selected={kind:'table'};signature='';return;}
        toolbar.hidden=false;const r=anchor?anchor.getBoundingClientRect():context().getBounds(),bounds=nativeActive()?{left:0,top:0,right:document.documentElement.clientWidth,bottom:document.documentElement.clientHeight,width:document.documentElement.clientWidth}:context().getViewport();toolbar.style.boxSizing='border-box';toolbar.style.maxWidth=Math.max(160,Math.min(bounds.width,document.documentElement.clientWidth)-32)+'px';const h=toolbar.getBoundingClientRect().height,w=toolbar.getBoundingClientRect().width;
        if(r.bottom<bounds.top||r.top>bounds.bottom){toolbar.hidden=true;return;}
        toolbar.style.left=Math.max(bounds.left+8,Math.min(r.left,Math.min(bounds.right,document.documentElement.clientWidth)-w-16))+'px';toolbar.style.top=Math.max(bounds.top+8,Math.min(r.top-h-10>=bounds.top?r.top-h-10:r.bottom+10,bounds.bottom-h-8))+'px';
    }
    const double=e=>{if(e.target.closest('button,input,.dae-column-divider'))return;const th=e.target.closest('th[data-column]');if(th&&root.contains(th)&&active()){e.preventDefault();e.stopPropagation();selected={kind:'column',field:th.dataset.column};rename();}};
    const showPreview=e=>previewContentAsset(editor,e.detail);
    const nativeContext=e=>{
        if(context()||!editor.openPromptOptimization||e.target.closest('[data-inline-editing=true],input,textarea,select'))return;
        const cell=e.target.closest('td[data-field]'),header=e.target.closest('th[data-column]'),fieldId=cell?.dataset.field||header?.dataset.column;
        const f=getTable().fields.find(item=>item.id===fieldId);if(!isPrompt(f)||f.readonly)return;
        e.preventDefault();e.stopPropagation();nativeMenuOpen=true;selected=cell?{kind:'cell',field:fieldId,record:cell.dataset.record}:{kind:'column',field:fieldId};signature='';tick();
    };
    const layout=()=>{if(root.dataset.contentPresentation!=='true'&&context()?.presentation==='content')tick();else positionToolbar();};
    const escape=e=>{if(e.key==='Escape'&&!e.isComposing&&!e.target.matches('input,textarea,select')){nativeMenuOpen=false;selected=null;editor.clearSelection();toolbar.hidden=true;tick();}};
    for(const type of ['pointerdown','focusin'])document.addEventListener(type,choose,true);
    document.addEventListener('keydown',escape,true);root.addEventListener('dblclick',double,true);root.addEventListener('dae-preview',showPreview);root.addEventListener('contextmenu',nativeContext);
    globalThis.addEventListener('dae-canvas-layout',layout);
    const timer=setInterval(tick,100);
    return {close(){nativeMenuOpen=false;if(selected)editor.clearSelection();selected=null;toolbar.hidden=true;},destroy(){disposed=true;clearInterval(timer);optimizationEntry?.destroy();toolbar.remove();for(const type of ['pointerdown','focusin'])document.removeEventListener(type,choose,true);document.removeEventListener('keydown',escape,true);root.removeEventListener('dblclick',double,true);root.removeEventListener('dae-preview',showPreview);root.removeEventListener('contextmenu',nativeContext);globalThis.removeEventListener('dae-canvas-layout',layout);}};
}
