import {appliedSnapshot,outputText} from './llm_slot_model.mjs?v=20261015-mixed1';
import {app} from '/scripts/app.js';
import {createLLMStylePanel, STYLE_VARIANTS} from './llm_style_preview_panel.mjs?v=20261017-row-header-drag';

// Slot inputs and explicitly approved output; model calls remain an explicit panel action.
app.registerExtension({
    name:'DAELab.LLMStylePreview',
    registerCustomNodes(){
        for(const variant of STYLE_VARIANTS){
            class LLMStylePreview extends LGraphNode {
                constructor(){
                    super(variant.id==='B'?'LLM优化功能':`LLM 优化 · ${variant.label}`);
                    this.isVirtualNode=variant.id!=='B';
                    this.comfyClass=variant.type;this.serialize_widgets=true;
                    this.properties={llmStylePreview:{version:1,mode:'polish'}};
                    this.addInput('原文','STRING');this.addInput('参考图片','IMAGE');
                    this.addOutput('结果','STRING');
                    if(variant.id==='B'){this.addInput('素材组','DAELAB_ASSETS');this.addInput('多维表格','STRING');}
                    if(variant.id==='B'){
                        this.addInput('其他输入','*');
                        const output=this.addWidget('text','applied_text','',()=>{}, {serialize:true});
                        output.hidden=true;output.computeSize=()=>[0,-4];
                        output.serializeValue=()=>this.outputs?.[0]?.links?.length?outputText(this):'';
                    }
                    this.size=[variant.width,variant.height+80];
                }
                onAdded(){this.installPanel();}
                onConfigure(){if(variant.id==='B'){if(this.title==='LLM 优化 · B 双栏工作台')this.title='LLM优化功能';for(const [name,type] of [['素材组','DAELAB_ASSETS'],['多维表格','STRING'],['其他输入','*']])if(!this.inputs?.some(i=>i.name===name))this.addInput(name,type);}this.__llmStylePanel?.sync();}
                installPanel(){
                    if(this.__llmStylePanel)return;
                    const panel=createLLMStylePanel(this,variant);this.__llmStylePanel=panel;
                    const widget=this.addDOMWidget('llm_style_preview','custom',panel.root,{serialize:false,hideOnZoom:false,getMinHeight:()=>variant.height,getHeight:()=>variant.height,getValue:()=>'',setValue:()=>panel.sync()});
                    widget.serialize=false;widget.inputEl=panel.root;
                    widget.computeSize=width=>[width,variant.height];
                    widget.computeLayoutSize=()=>({minHeight:variant.height,maxHeight:variant.height,minWidth:variant.width});
                }
                onConnectInput(){return variant.id==='B';}
                onConnectOutput(){return variant.id==='B';}
                onExecute(){if(variant.id==='B'){try{this.setOutputData(0,outputText(this));}catch{this.setOutputData(0,null);}}}
                onRemoved(){this.__llmStylePanel?.destroy();delete this.__llmStylePanel;for(const w of this.widgets||[])if(w.name==='llm_style_preview')w.onRemove?.();this.widgets=(this.widgets||[]).filter(w=>w.name!=='llm_style_preview');}
            }
            LLMStylePreview.title=variant.id==='B'?'LLM优化功能':`LLM 优化 · ${variant.label}`;
            LLMStylePreview.category=variant.id==='B'?'DAELab/文本':'DAELab/样式预览';
            LiteGraph.registerNodeType(variant.type,LLMStylePreview);
        }
    },
});
let registered=false;
function register(){
    const api=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];
    if(registered||api?.version!==1)return;
    api.registerAdapter('daelab.llm-style-preview',{
        matches:node=>STYLE_VARIANTS.some(v=>v.type===node.type),
        menu:[{label:'LLM优化功能',type:'DAELAB.LLMStylePreviewB',icon:'sparkling-line'}],
        width:node=>STYLE_VARIANTS.find(v=>v.type===node.type)?.width||460,
        expanded:true,collapsible:false,floatingHeader:true,compactWidth:0,
        panel:node=>node.__llmStylePanel,
        summary:()=> 'LLM 优化 · 建议需显式应用',
        inputSelection:'first-free',
        canConnectOutput:node=>node.type==='DAELAB.LLMStylePreviewB',
        defaultOutputNode:{type:'DAELAB.TextInput',title:'优化结果'},
        inputSnapshot:node=>appliedSnapshot(node),
        tasks:node=>node.__llmStylePanel?.tasks?.()||[],
        remapCopy(node,mapping){const s=node.properties?.llmStylePreview;if(s?.inputIds)s.inputIds=s.inputIds.map(id=>String(mapping.get(id)??mapping.get(Number(id))??id));if(s)delete s.ioResult;node.__llmStylePanel?.sync();},
        inputLabels:{'原文':'原文','参考图片':'参考图片'},outputLabel:'结果',
    });
    registered=true;
}
globalThis.addEventListener('daelab:creative-canvas-ready',register);register();
