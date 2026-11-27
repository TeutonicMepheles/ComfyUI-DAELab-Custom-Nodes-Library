import { normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';

export const REGION_KEY = 'daelabImageEditingV1';
export const BUILD_RESULTS_CHANGED = 'daelab:exhibition-build-results';
export const OUTPUT_ID = '90';
export const DEFAULT_POLYGON = [[.5,.32],[.65,.62],[.35,.62]];
const RMBG_FILES = Object.freeze({
    'RMBG-2.0':['config.json','model.safetensors','birefnet.py','BiRefNet_config.py'],
    INSPYRENET:['inspyrenet.safetensors'], BEN:['model.py','BEN_Base.pth'], BEN2:['BEN2.py','BEN2_Base.pth'],
});

export function installedRmbgModel(model, files) {
    const paths = new Set(files.map(path=>path.replaceAll('\\','/').toLowerCase()));
    return RMBG_FILES[model]?.every(file=>paths.has((model+'/'+file).toLowerCase())) ?? false;
}

export const EDIT_MODES = Object.freeze({ mask: ['semantic','replace','material'], annotation: ['semantic'] });

export function sourceRef(value) {
    const image = normalizeImageSelection(value);
    if (!image || !['input','output','temp'].includes(image.type) || /[\\/:\x00]/.test(image.filename) ||
        /^\.{1,2}$/.test(image.filename) || image.subfolder.split('/').some(part => /^\.{1,2}$/.test(part) || /[:\x00]/.test(part))) return null;
    return image;
}

export function imageKey(value) {
    return JSON.stringify(sourceRef(value));
}

export function imageWidgetValue(image) {
    const source = sourceRef(image);
    if (!source) throw new Error('图片引用无效，请重新载入。');
    return [source.subfolder, source.filename].filter(Boolean).join('/') + ' [' + source.type + ']';
}

export function validPolygon(points) {
    if (!Array.isArray(points) || points.length < 3 ||
        points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) return false;
    const [x, y] = points[0];
    const second = points.find(([u, v]) => u !== x || v !== y);
    if (!second) return false;
    const [u, v] = second;
    return points.some(([a, b]) => Math.abs((u-x)*(b-y) - (v-y)*(a-x)) > 1e-8);
}

export function ensurePolygon(draft) {
    if (!validPolygon(draft.polygon)) draft.polygon = structuredClone(DEFAULT_POLYGON);
}

export function defaultDraft() {
    return {
        position: 'mask', maskKind: 'color', edit: 'semantic', text: '', replacement: null, material: '',
        colors: [{ color: '#27894e', threshold: 30 }], polygon: null,
        strokes: { color: [], polygon: [], annotation: [] },
        sam: { mode: 'bbox', boxes: [], points: [] },
    };
}

export function setPosition(draft, position) {
    draft.position = position;
    if (!EDIT_MODES[position].includes(draft.edit)) draft.edit = 'semantic';
}

function addNode(output, id, classType, inputs) {
    output[id] = { class_type: classType, inputs };
    return [id, 0];
}

function startPrompt(base) {
    const output = {};
    const image = addNode(output, '1', 'LoadImage', { image: imageWidgetValue(base) });
    return { output, image };
}

function finishPrompt(output, image, prefix) {
    addNode(output, OUTPUT_ID, 'SaveImage', { images: image, filename_prefix: prefix });
    return output;
}

export function compileEdit({ base, draft, width, height, mask, guide, profile, seed }) {
    const { position, edit } = draft;
    if (!EDIT_MODES[position]?.includes(edit)) throw new Error('此位置选择方式不支持该修改方式。');
    if (!profile) throw new Error('此阶段没有可用的图像编辑模型。');
    const fields = profile.execution.inputs;
    const reference = index => `${fields.references}.image_${index}`;
    const { output, image } = startPrompt(base);
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
        throw new Error('底图尺寸无效。');
    }
    const description = String(draft.text ?? '').trim();
    const common = '保持图一的构图、透视、文字和未要求修改的内容。';
    const hasMask = position === 'mask';
    const references = { [reference(1)]: image };
    const maskRef = hasMask ? addNode(output, '2', 'LoadImageMask', { image: imageWidgetValue(mask), channel: 'red' }) : null;
    let prompt;

    if (edit === 'replace') {
        references[reference(2)] = addNode(output, '3', 'LoadImage', { image: imageWidgetValue(guide) });
        references[reference(3)] = addNode(output, '4', 'LoadImage', { image: imageWidgetValue(draft.replacement) });
        prompt = '图一是原图。图二中的红色覆盖区指示修改位置，图三是替换素材。按图一的透视、比例和光线在该位置重绘图三所示的对象，不保留图二的覆盖色。' + common;
    } else if (edit === 'material') {
        if (!draft.material) throw new Error('请选择材质。');
        prompt = addNode(output, '5', 'GPTImage2MaterialPrompt', {
            material_id: draft.material, base_prompt: '修改选区内的表面材质。' + common, additional_details: '',
        });
    } else {
        if (!description) throw new Error('请输入修改描述。');
        prompt = (hasMask ? '只修改指定遮罩内的区域。' : '图一是原图，图二的红色圈线仅指示要改的对象，请按描述修改该对象，并移除圈线。') + common + '\n' + description;
        if (!hasMask) references[reference(2)] = addNode(output, '3', 'LoadImage', { image: imageWidgetValue(guide) });
    }

    const inputs = {
        ...Object.fromEntries(Object.entries(profile.parameters).map(([key, rule]) => [fields[key], rule.default])),
        [profile.execution.modelField]: profile.provider,
        [fields.prompt]: prompt,
        [fields.seed]: seed,
        ...references,
    };
    if (hasMask && edit !== 'replace') inputs[fields.mask] = maskRef;
    let result = addNode(output, '6', 'OpenAIGPTImageNodeV2', inputs);
    if (hasMask) {
        const candidate = addNode(output, '7', 'ImageScale', { image: result, upscale_method: 'bicubic', width, height, crop: 'disabled' });
        result = addNode(output, '8', 'BadgeDeterministicComposite', { previous_master: image, edit_candidate: candidate, edit_mask: maskRef });
    }
    return finishPrompt(output, result, 'DAELab/LocalEdit');
}

export function compileCutout({ base, mode, model, draft, width, height }) {
    const { output, image } = startPrompt(base);
    if (mode === 'rmbg') {
        if (!model) throw new Error('请选择主体物抠图模型。');
        const result = addNode(output, '2', 'RMBG', {
            image, model, background: 'Alpha', background_color: '#ffffff', process_res: 1024,
            sensitivity: 1, mask_blur: 0, mask_offset: 0, invert_output: false, refine_foreground: false,
        });
        return finishPrompt(output, result, 'DAELab/Cutout/RMBG');
    }
    if (mode !== 'sam') throw new Error('抠图模式无效。');
    const pixelBox = ({ start, end }, index) => ({
        id: 'box-' + index, x1: Math.min(start[0], end[0]) * width, y1: Math.min(start[1], end[1]) * height,
        x2: Math.max(start[0], end[0]) * width, y2: Math.max(start[1], end[1]) * height,
    });
    const positive = draft.boxes.filter(box => !box.negative).map(pixelBox);
    const negative = draft.boxes.filter(box => box.negative).map(pixelBox);
    const pixelPoints = sign => draft.points.filter(point => point.negative === sign).map(({ at }, index) => ({
        id: 'point-' + index, x: at[0] * width, y: at[1] * height,
    }));
    if (draft.mode === 'bbox' ? !positive.length : !positive.length && !pixelPoints(false).length) {
        throw new Error('请在底图上框选或标记要保留的物体。');
    }
    const loader = addNode(output, '2', 'LoadSAM3Model', { precision: 'auto', compile: false });
    const collector = addNode(output, '3', 'SAM3ComplexCollector', {
        image, sam3_model_config: loader, collector_mode: draft.mode,
        bboxes: JSON.stringify(positive), neg_bboxes: JSON.stringify(negative),
        multi_prompts_store: JSON.stringify([{
            id: 'cutout', name: '目标物体', positive_boxes: positive, negative_boxes: negative,
            positive_points: pixelPoints(false), negative_points: pixelPoints(true),
        }]),
    });
    const merged = addNode(output, '4', 'Masks Combine Batch', { masks: collector });
    const refined = addNode(output, '5', 'MaskFix+', { mask: merged, erode_dilate: 0, fill_holes: 26, remove_isolated_pixels: 0, smooth: 0, blur: 0 });
    const result = addNode(output, '6', 'AILab_MaskExtractor', {
        image, mask: refined, mode: 'extract_masked_area', background: 'Alpha', background_color: '#FFFFFF',
    });
    return finishPrompt(output, result, 'DAELab/Cutout/SAM3');
}
