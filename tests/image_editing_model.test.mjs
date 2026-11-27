import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCutout, compileEdit, DEFAULT_POLYGON, defaultDraft, ensurePolygon, setPosition, sourceRef, OUTPUT_ID } from '../web/image_editing_model.mjs';

const base = { filename:'base.png', subfolder:'fixture', type:'input' };
const mask = { filename:'mask.png', subfolder:'fixture', type:'input' };
const guide = { filename:'guide.png', subfolder:'fixture', type:'input' };
const replacement = { filename:'cut.png', subfolder:'DAELab/Cutout', type:'output' };
const dimensions = { width:640, height:480 };
const profile = {
    provider: 'matched-provider',
    execution: {
        modelField: 'model',
        inputs: {
            prompt:'prompt', references:'model.images', mask:'model.mask', seed:'seed', count:'n',
            size:'model.size', width:'model.custom_width', height:'model.custom_height',
            background:'model.background', quality:'model.quality', complexity:'model.complexity',
        },
    },
    parameters: {
        count:{default:1}, size:{default:'auto'}, width:{default:1024}, height:{default:1024},
        background:{default:'auto'}, quality:{default:'medium'}, complexity:{default:'high'},
    },
};
const graph = draft => compileEdit({base,mask,guide,...dimensions,draft,profile,seed:1});

test('empty and collapsed polygons initialize without replacing a usable outline', () => {
    for (const polygon of [null, [], [[.5,.5],[.5,.5],[.5,.5]], [[.1,.1],[.2,.2],[.3,.3]]]) {
        const draft = {...defaultDraft(), polygon};
        ensurePolygon(draft);
        assert.deepEqual(draft.polygon, DEFAULT_POLYGON);
        assert.notEqual(draft.polygon, DEFAULT_POLYGON);
    }
    const saved = [[.1,.1],[.4,.6],[.3,.2]];
    const draft = {...defaultDraft(), polygon:saved};
    ensurePolygon(draft);
    assert.equal(draft.polygon,saved);
});

test('local edit dependencies contain a single send and keep the final output isolated', () => {
    const draft = {...defaultDraft(),text:'调整表面'};
    const semantic = graph(draft);
    assert.equal(semantic['6'].inputs.model,'matched-provider');
    assert.equal(semantic['6'].inputs['model.complexity'],'high');
    assert.deepEqual(semantic['6'].inputs['model.mask'],['2',0]);
    assert.equal(semantic['6'].inputs.n,1);
    assert.equal(semantic['6'].inputs['model.size'],'auto');
    assert.equal(semantic['6'].inputs['model.custom_width'],1024);
    assert.equal(semantic['6'].inputs['model.custom_height'],1024);
    assert.deepEqual(semantic[OUTPUT_ID].inputs.images,['8',0]);
    assert.deepEqual(Object.values(semantic).filter(n=>n.class_type.startsWith('OpenAI')).map(n=>n.inputs.n),[1]);
    assert.equal(semantic['1040'],undefined);
    assert.equal(semantic['1058'],undefined);
    const material = graph({...draft,edit:'material',material:'烤漆'});
    assert.deepEqual(material['6'].inputs.prompt,['5',0]);
});

test('image replacement uses separate guides and composites only inside the mask', () => {
    const output = graph({...defaultDraft(),edit:'replace',replacement});
    assert.equal(output['6'].inputs['model.mask'],undefined);
    assert.deepEqual(output['6'].inputs['model.images.image_3'],['4',0]);
    assert.equal(output['4'].inputs.image,'DAELab/Cutout/cut.png [output]');
    assert.deepEqual(output['8'].inputs.edit_mask,['2',0]);
    assert.equal(output['7'].inputs.width,640);
});

test('annotation is a separate image reference and permits only semantic edit', () => {
    const draft = {...defaultDraft(),edit:'replace',text:'调整帆板'};
    setPosition(draft,'annotation');
    assert.equal(draft.edit,'semantic');
    const output = graph(draft);
    assert.equal(output['6'].inputs['model.mask'],undefined);
    assert.deepEqual(output['6'].inputs['model.images.image_2'],['3',0]);
    assert.equal(output['2'],undefined);
    assert.throws(()=>graph({...draft,edit:'material'}),/不支持/);
});

test('cutout paths execute independently and require a positive target', () => {
    const rmbg = compileCutout({base,mode:'rmbg',model:'RMBG-2.0'});
    assert.deepEqual(Object.values(rmbg).map(n=>n.class_type),['LoadImage','RMBG','SaveImage']);
    const draft = defaultDraft().sam;
    assert.throws(()=>compileCutout({base,mode:'sam',draft,...dimensions}),/框选/);
    draft.boxes=[{start:[.75,.5],end:[.25,.25],negative:false}];
    const sam=compileCutout({base,mode:'sam',draft,...dimensions});
    assert.deepEqual(JSON.parse(sam['3'].inputs.bboxes)[0],{id:'box-0',x1:160,y1:120,x2:480,y2:240});
    assert.ok(Object.values(sam).every(n=>!['RMBG','OpenAIGPTImageNodeV2'].includes(n.class_type)));
    assert.equal(sam['6'].inputs.background,'Alpha');
});

test('image drag references reject traversal and preserve local host media identity',()=>{
    assert.equal(sourceRef({filename:'../escape.png'}),null);
    assert.equal(sourceRef({filename:'base.png',subfolder:'folder/../secret'}),null);
    assert.deepEqual(sourceRef({filename:'base.png',type:'temp'}),{filename:'base.png',subfolder:'',type:'temp'});
});
