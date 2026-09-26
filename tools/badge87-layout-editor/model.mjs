export const FORMAT = 'DAELAB.Badge87LayoutProject';
export const VERSION = 1;
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const BASE_CSS = `
*{box-sizing:border-box}html{background:#10161e}body{margin:0;padding:24px;background:#10161e!important;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#e3ebf5;font-size:14px}
.studio-page{max-width:1050px;margin:auto;display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px}
.studio-section{display:flex;flex-wrap:wrap;align-content:flex-start;gap:12px;width:100%;min-width:0;padding:20px;border:1px solid #344353;border-radius:14px;background:#1b2531}
.studio-text{width:100%;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap;margin:0}
.studio-heading{font-size:17px;font-weight:700;color:#edf4fa}.studio-note{font-size:12px;color:#92a6bc}
.studio-control{padding:10px 14px;border:1px solid #48596d;border-radius:8px;background:#283747;width:auto;min-height:40px;text-align:center}
.studio-input{min-height:112px;text-align:left;width:100%;color:#97aabd;background:#121c27}
.studio-primary{background:#9fdcc2;color:#152c23;border-color:#9fdcc2;font-weight:700;width:100%}
.studio-placeholder{display:flex;align-items:center;justify-content:center;min-height:170px;width:100%;border:1px dashed #4a6178;border-radius:10px;background:linear-gradient(145deg,#263748,#16222e);color:#90a8bd;text-align:center}
@media(max-width:600px){body{padding:12px}.studio-section{width:100%!important;min-width:0!important;height:auto!important}.studio-text{max-width:100%}}
`;

export function makeSeed(source) {
  const m = source.messages;
  const t = key => { if (!Object.hasOwn(m,key)) throw new Error(`缺少源文案：${key}`); return m[key]; };
  const bind = (id, suffix) => {
    const key = source.inputKeys.find(k => k.includes(`:${id}:${suffix}`));
    if (!key) throw new Error(`工作流缺少绑定 ${id}:${suffix}`); return key;
  };
  const leaf = (id, name, text, cls = '', extra = {}) => ({
    type:'studio-text', tagName:'div', name, attributes:{'data-studio-id':id},
    classes:['studio-text', ...cls.split(' ').filter(Boolean)], content:escapeHtml(text), ...extra,
  });
  const label = (id, key, cls = '') => leaf(id,t(key),t(key),cls,{textKey:key});
  const section = (id, name, children) => ({type:'studio-section',tagName:'section',name,attributes:{'data-studio-id':id},classes:['studio-section'],components:children});
  const components = [{type:'studio-page',tagName:'main',name:'局部修改页面',attributes:{'data-studio-id':'local-page'},classes:['studio-page'],components:[
    section('reference','目标与参考图',[
      label('target-title','build_prototype.text_007','studio-heading'),
      leaf('target-picker','目标选择','当前编辑目标 · 上传图片 / 已生成结果','studio-control', {binding:bind(146,'image')}),
      leaf('reference-view','参考图区域','参考图显示区域\n编辑器使用占位图；真实图片由 8.7 提供','studio-placeholder'),
    ]),
    section('selection','定义修改区域',[
      label('selection-title','build_prototype.text_070','studio-heading'),
      label('select-color','build_prototype.text_071','studio-control'),
      label('select-brush','build_prototype.text_072','studio-control'),
      label('source-label','build_prototype.text_077','studio-note'),
      label('source-original','build_prototype.text_080','studio-control'),
      label('source-map','build_prototype.text_079','studio-control'),
      leaf('color-control','颜色选区面板','颜色选区控件 · 整体布局占位','studio-placeholder',{binding:bind(104,'multi_color_mask_v1_panel')}),
      leaf('mask-control','画笔选区面板','画笔 / 多边形选区 · 整体布局占位','studio-placeholder',{binding:bind(142,'polygon_canvas')}),
      label('selection-preview','build_prototype.text_097','studio-control'),
    ]),
    section('edit','描述修改内容',[
      label('edit-title','build_prototype.text_073','studio-heading'),
      label('edit-text','build_prototype.text_074','studio-control'),
      label('edit-material','build_prototype.text_076','studio-control'),
      leaf('prompt','提示词输入区域','在此输入修改描述（编辑器展示占位文字，不修改原提示词）','studio-control studio-input',{binding:bind(105,'value')}),
      leaf('material','材质控件','烤漆　透明漆　亚金　亚银　闪粉　水钻','studio-control',{binding:bind(106,'material_thumbnail_dom_selector')}),
    ]),
    section('generation','生成操作',[
      label('generation-title','generation_panel.text_001','studio-heading'),
      leaf('generation-size','继承尺寸提示','输出尺寸继承当前编辑目标','studio-note'),
      label('count-label','generation_panel.text_011','studio-control'),
      label('generate','generation_panel.text_024','studio-control studio-primary'),
      label('generation-status','generation_panel.text_027','studio-note'),
    ]),
  ]}];
  return {pages:[{id:'local',name:'局部修改',component:{type:'wrapper',components}}],styles:[]};
}

function walk(nodes, fn) { for (const n of nodes || []) { if(typeof n !== 'object' || !n) throw new Error('无效组件'); fn(n); walk(n.components,fn); } }
export function rootNodes(project) {
  if(project?.pages?.length !== 1) throw new Error('工程必须只有局部修改页面');
  const page=project.pages[0];
  if(page.frames && page.frames.length!==1) throw new Error('工程必须只有一个画布');
  const wrapper=page.component || page.frames?.[0]?.component;
  if(!wrapper) throw new Error('工程缺少画布组件');
  return wrapper.components || [];
}
export function manifest(seed) {
  const result = {};
  walk(rootNodes(seed), n => { const id = n.attributes?.['data-studio-id']; if(id) result[id] = {type:n.type,binding:n.binding||'',textKey:n.textKey||''}; });
  return result;
}
const STYLE_KEYS = new Set('display flex-direction flex-wrap justify-content align-items align-content gap width height min-width min-height max-width max-height padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left font-size font-weight font-family line-height text-align color background-color border border-width border-style border-color border-radius flex flex-basis flex-grow flex-shrink'.split(' '));
export function safeStyle(style = {}) {
  const out = {};
  if(!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('样式格式无效');
  for(const [key,value] of Object.entries(style)) {
    if(!STYLE_KEYS.has(key)) throw new Error(`不支持的样式：${key}`);
    const s = String(value);
    if(s.length>160 || /[<>;{}\\@]|url\s*\(|expression\s*\(|\/\*/i.test(s)) throw new Error('样式含不允许的内容');
    out[key]=s;
  }
  return out;
}
export function validateProject(project, expected) {
  const seen = new Set(); let count=0;
  const visit = (n,parentType,depth) => {
    if(++count>800 || depth>20 || !n || typeof n !== 'object') throw new Error('组件结构无效或过深');
    if(n.script || n['script-export']) throw new Error('布局工程不允许脚本');
    const id = n.attributes?.['data-studio-id'];
    if(!id) {
      if(!['studio-text','text','textnode','default'].includes(parentType) || !['textnode','text','default'].includes(n.type||'default') || (n.tagName && !['span','b','strong','i','em','br','div'].includes(n.tagName))) throw new Error('未知组件');
      if(Object.keys(n.attributes||{}).length || Object.keys(n.style||{}).length || n.classes?.length) throw new Error('内部文字只支持纯文案');
    } else {
      const e=expected[id];
      if(!e || seen.has(id) || n.type!==e.type || (n.binding||'')!==e.binding || (n.textKey||'')!==e.textKey) throw new Error(`组件身份或绑定已改变：${id}`);
      if((n.type==='studio-page' && parentType!=='wrapper') || (n.type==='studio-section' && parentType!=='studio-page') || (n.type==='studio-text' && parentType!=='studio-section')) throw new Error('区块只能在页面内排序，控件只能在区块内移动');
      for(const key of Object.keys(n.attributes||{})) if(!['data-studio-id','id'].includes(key)) throw new Error(`不允许的属性：${key}`);
      if(n.attributes.id && !/^[\w-]+$/.test(n.attributes.id)) throw new Error('无效 DOM ID');
      if(n.classes?.some(c => typeof c!=='string' || !/^studio-[\w-]+$/.test(c))) throw new Error('无效组件样式类');
      safeStyle(n.style); seen.add(id);
    }
    // Text is always escaped again by the exporter; imported HTML is never trusted.
    if(n.content && (typeof n.content!=='string' || /<[^>]*>/.test(n.content))) throw new Error('请使用纯文字，不要输入 HTML 标签');
    for(const c of n.components||[]) visit(c,n.type||'default',depth+1);
  };
  for(const n of rootNodes(project)) visit(n,'wrapper',0);
  if(seen.size!==Object.keys(expected).length) throw new Error('工程缺少必需组件');
  for(const rule of project.styles||[]) {
    safeStyle(rule.style);
    if(rule.atRuleType || rule.mediaText || rule.state) throw new Error('请通过属性面板设置基础样式');
    for(const s of rule.selectors||[]) {
      const name=typeof s==='string'?s:s.name;
      if(!/^[#.\w-]+$/.test(name||'')) throw new Error('不支持的样式选择器');
    }
  }
  return true;
}
export function packProject(project, source, expected) {
  validateProject(project,expected);
  return {format:FORMAT,version:VERSION,source:{workflowHash:source.workflowHash,textHash:source.textHash,workflowName:source.workflowName},project:cleanProject(project)};
}
// Import only presentation data; discard GrapesJS runtime settings, assets, HTML tags and event handlers.
function cleanProject(project) {
  const clean=n=>{
    const id=n.attributes?.['data-studio-id'];
    return id?{type:n.type,tagName:n.type==='studio-page'?'main':n.type==='studio-section'?'section':'div',
      name:String(n.name||id),attributes:{...n.attributes},classes:n.classes||[],style:safeStyle(n.style),
      binding:n.binding||'',textKey:n.textKey||'',content:n.content||'',components:(n.components||[]).map(clean)}:
      {type:n.type||'default',tagName:n.tagName,content:n.content||'',components:(n.components||[]).map(clean)};
  };
  return {pages:[{id:'local',name:'局部修改',component:{type:'wrapper',components:rootNodes(project).map(clean)}}],
    styles:(project.styles||[]).map(r=>({selectors:r.selectors,style:safeStyle(r.style)}))};
}
export function unpackProject(data, source, expected) {
  if(data?.format!==FORMAT || data.version!==VERSION) throw new Error('不支持的工程格式');
  if(data.source?.workflowHash!==source.workflowHash || data.source?.textHash!==source.textHash) throw new Error('工程与当前 8.7 快照不一致，请保留旧文件并重新建立工程');
  validateProject(data.project,expected); return cleanProject(data.project);
}
export function exportLayout(project, source, expected, resolveText = s => s) {
  validateProject(project,expected);
  const textContent=n=>(n.tagName==='br'?'\n':'')+(n.components?.length?n.components.map(textContent).join(''):resolveText(n.content||''));
  const stylesById={};
  for(const rule of project.styles||[]) for(const selector of rule.selectors||[]) {
    const name=typeof selector==='string'?selector:selector.name;
    if((typeof selector==='object' && selector.type===2) || name.startsWith('#')) stylesById[name.replace(/^#/,'')]=safeStyle(rule.style);
    else throw new Error('导出只支持控件专属样式，请使用右侧属性面板');
  }
  const convert=n=>({id:n.attributes['data-studio-id'],type:n.type,binding:n.binding||undefined,textKey:n.textKey||undefined,
    classes:n.classes||[],style:{...stylesById[n.attributes.id],...safeStyle(n.style)},
    ...(n.type==='studio-text'?{text:textContent(n)}:{children:(n.components||[]).map(convert)})});
  return {format:'DAELAB.Badge87Presentation',version:1,stage:'local',previewOnly:true,source:{workflowHash:source.workflowHash,textHash:source.textHash},root:convert(rootNodes(project)[0])};
}
export function layoutHtml(layout) {
  const render=n=>{
    const tag=n.type==='studio-page'?'main':n.type==='studio-section'?'section':'div';
    const style=Object.entries(safeStyle(n.style)).map(([k,v])=>`${k}:${v}`).join(';');
    return `<${tag} data-studio-id="${escapeHtml(n.id)}" class="${escapeHtml(n.classes.join(' '))}" style="${escapeHtml(style)}">${n.children?n.children.map(render).join(''):escapeHtml(n.text)}</${tag}>`;
  };
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Badge 8.7 布局预览</title><style>'+BASE_CSS+'</style></head><body><p style="max-width:1050px;margin:0 auto 16px;color:#9aaec2;font-size:12px">局部修改 · 静态布局预览（未连接执行器）</p>'+render(layout.root)+'</body></html>';
}
