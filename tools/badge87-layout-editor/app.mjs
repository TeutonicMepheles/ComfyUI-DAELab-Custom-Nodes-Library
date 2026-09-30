import {makeSeed,manifest,packProject,unpackProject,exportLayout,layoutHtml,BASE_CSS,escapeHtml} from './model.mjs';

const $=id=>document.getElementById(id);
const status=(message,error=false)=>{ $('status').textContent=message; $('status').style.color=error?'#ffb6a9':'#a5c8b9'; };
const download=(name,text,type='application/json')=>{
  const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const decode=s=>{ const e=document.createElement('textarea'); e.innerHTML=s; return e.value; };
try {
  const response=await fetch('/source.json');
  if(!response.ok) throw new Error(await response.text());
  const source=await response.json(), seed=makeSeed(source), expected=manifest(seed);
  const storageKey=`daelab-layout-editor-v1:${source.workflowHash}:${source.textHash}`;
  $('source').textContent=`${source.workflowName} · ${source.workflowHash.slice(0,10)}`;
  const register=editor=>{
    const common={copyable:false,removable:false,stylable:true,resizable:true,traits:[]};
    editor.DomComponents.addType('studio-page',{model:{defaults:{...common,draggable:false,resizable:false,droppable:'[data-studio-id]',name:'局部修改页面'}}});
    editor.DomComponents.addType('studio-section',{model:{defaults:{...common,draggable:'main',droppable:'[data-studio-id]',name:'功能区块'}}});
    editor.DomComponents.addType('studio-text',{
      extend:'text',
      model:{defaults:{...common,draggable:'section',droppable:false,name:'控件',traits:[{type:'studio-copy',name:'copy',label:'显示文字',changeProp:true}]}},
    });
    editor.TraitManager.addType('studio-copy',{
      createInput({component}){
        const input=document.createElement('textarea'); input.rows=4; input.setAttribute('aria-label','显示文字');
        Object.assign(input.style,{width:'100%',background:'#101820',color:'#dce5ef',border:'1px solid #435265',borderRadius:'5px',padding:'8px',font:'12px "Microsoft YaHei",sans-serif',resize:'vertical'});
        input.value=component.getEl()?.textContent||decode(component.get('content')||'');
        return input;
      },
      onEvent({elInput,component}){component.set('content','');component.components(escapeHtml(elInput.value));},
      onUpdate({elInput,component}){if(document.activeElement!==elInput) elInput.value=component.getEl()?.textContent||decode(component.get('content')||'');},
    });
  };
  const editor=grapesjs.init({
    container:'#editor',height:'100%',width:'auto',noticeOnUnload:false,storageManager:false,telemetry:false,
    plugins:[register],panels:{defaults:[]},selectorManager:{componentFirst:true},
    layerManager:{appendTo:'#layers'},traitManager:{appendTo:'#traits'},
    styleManager:{appendTo:'#styles',sectors:[
      {name:'尺寸',open:true,buildProps:['width','height','min-height','max-width']},
      {name:'布局与分栏',open:true,properties:[
        {property:'display',type:'select',options:[{id:'flex',label:'弹性布局'},{id:'block',label:'纵向排列'}]},
        {property:'flex-direction',type:'select',options:[{id:'row',label:'横向'},{id:'column',label:'纵向'}]},
        {property:'flex-wrap',type:'select',options:[{id:'wrap',label:'自动换行'},{id:'nowrap',label:'不换行'}]},
        {property:'gap',type:'integer',units:['px'],defaults:'12px'},
        {property:'justify-content',type:'select',options:[{id:'flex-start',label:'起始'},{id:'center',label:'居中'},{id:'space-between',label:'两端'}]},
        {property:'align-items',type:'select',options:[{id:'flex-start',label:'顶部'},{id:'center',label:'居中'},{id:'stretch',label:'拉伸'}]},
      ]},
      {name:'间距',open:false,buildProps:['padding','margin']},
      {name:'文字',open:true,buildProps:['font-size','font-weight','line-height','color','text-align']},
      {name:'外观',open:false,buildProps:['background-color','border-width','border-style','border-color','border-radius']},
    ]},
    deviceManager:{devices:[{id:'wide',name:'自适应',width:''},{id:'tablet',name:'768 px',width:'768px'},{id:'mobile',name:'390 px',width:'390px'}]},
    canvas:{styles:[]},
  });
  let restoring=true, saveTimer;
  const applyBase=()=>{
    const doc=editor.Canvas.getDocument(); if(!doc) return;
    let style=doc.getElementById('studio-base'); if(!style){style=doc.createElement('style');style.id='studio-base';doc.head.append(style);} style.textContent=BASE_CSS;
  };
  editor.on('canvas:frame:load',applyBase);
  const loadProject=project=>{restoring=true;editor.loadProjectData(project);applyBase();editor.UndoManager.clear();restoring=false;};
  const current=()=>packProject(editor.getProjectData(),source,expected);
  const presentation=()=>exportLayout(editor.getProjectData(),source,expected,decode);
  const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(current()));status('草稿已保存到本浏览器 · 原 8.7 未修改');}catch(e){status(e.message,true);}};
  editor.on('component:selected',c=>{
    $('selection').textContent=`${c.getName()} · ${c.getAttributes()['data-studio-id']||'文字'}`;
  });
  editor.on('update',()=>{if(!restoring){clearTimeout(saveTimer);saveTimer=setTimeout(persist,500);}});
  // Never leave the imported project in charge of edit permissions.
  editor.on('component:add',c=>{
    const id=c.getAttributes()['data-studio-id'];
    if(!id) return;
    c.set({copyable:false,removable:false,toolbar:[{attributes:{class:'fa fa-arrow-up'},command:'select-parent'},{attributes:{class:'fa fa-arrows'},command:'tlb-move'}]});
  });
  editor.on('load',()=>{
    let draft;
    try{const saved=localStorage.getItem(storageKey);if(saved) draft=unpackProject(JSON.parse(saved),source,expected);}catch(e){status(`草稿未载入：${e.message}`,true);}
    loadProject(draft||seed);
    status(draft?'已恢复本地草稿 · 当前为静态布局编辑':'已载入 8.7 局部修改布局 · 复杂控件使用占位预览');
  });
  const guarded=fn=>async()=>{try{await fn();}catch(e){status(e.message,true);}};
  $('undo').onclick=()=>editor.UndoManager.undo(); $('redo').onclick=()=>editor.UndoManager.redo();
  $('viewport').onchange=e=>editor.setDevice(e.target.value==='390px'?'mobile':e.target.value==='768px'?'tablet':'wide');
  $('save').onclick=guarded(()=>{download('badge87-local.layout-project.json',JSON.stringify(current(),null,2));status('已下载可继续编辑的工程 JSON');});
  $('load').onclick=()=>$('file').click();
  $('file').onchange=guarded(async()=>{
    const f=$('file').files[0]; if(!f) return;
    if(f.size>2_000_000) throw new Error('工程文件不能超过 2 MB');
    const data=unpackProject(JSON.parse(await f.text()),source,expected); loadProject(data);persist();$('file').value='';
  });
  $('reset').onclick=()=>$('reset-dialog').showModal();
  $('cancel-reset').onclick=()=>$('reset-dialog').close();
  $('confirm-reset').onclick=()=>{loadProject(seed);persist();$('reset-dialog').close();};
  $('preview').onclick=guarded(()=>{
    $('preview-frame').srcdoc=layoutHtml(presentation()); $('preview-dialog').showModal();
  });
  $('close-preview').onclick=()=>$('preview-dialog').close();
  $('export').onclick=guarded(()=>{
    const layout=presentation();
    // Single download avoids browser multiple-download blocking. This bundle contains no editor dependency.
    download('badge87-local.presentation.json',JSON.stringify({
      ...layout,previewHtml:layoutHtml(layout),
      integration:{status:'preview-only',note:'布局原型，未连接 8.7 执行器；不要用预览 HTML 替换现有 App Mode。'},
    },null,2));
    status('已导出布局 JSON（含静态预览 HTML）· 不包含编辑器、工作流参数或执行脚本');
  });
  $('html').onclick=guarded(()=>{download('badge87-local.preview.html',layoutHtml(presentation()),'text/html');status('已下载可独立打开的静态 HTML 预览');});
  window.addEventListener('beforeunload',()=>{clearTimeout(saveTimer);if(!restoring)persist();});
} catch(error) {status(`启动失败：${error.message}`,true);}
