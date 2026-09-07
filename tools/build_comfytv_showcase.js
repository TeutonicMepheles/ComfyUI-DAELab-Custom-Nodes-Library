const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

const OUTPUT_PATH = path.resolve(
  __dirname,
  "../user/default/workflows/ComfyTV-标志能力全景演示-无音频.json",
);

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`GET ${url} returned HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    }).on("error", reject);
  });
}

const COLORS = {
  guide: ["#315a48", "#243f34"],
  project: ["#38485d", "#293642"],
  image: ["#35536f", "#263d52"],
  storyboard: ["#68496f", "#4a344f"],
  layer: ["#735738", "#513e2a"],
  video: ["#3d5f62", "#2c4446"],
  panorama: ["#496a46", "#344c33"],
  three: ["#634d72", "#463751"],
  bridge: ["#6c5d39", "#4c422a"],
};

const GROUP_COLORS = {
  project: "#536d88",
  image: "#477aa0",
  storyboard: "#8a5c9e",
  layer: "#9a7647",
  video: "#4f8185",
  panorama: "#5f8b58",
  three: "#7d6290",
};

const DEFAULT_STORYBOARD = {
  document_title: "第一篇章：开篇·点题（0-30 秒）",
  source_filename: "",
  shots: [
    {
      shot_no: "01",
      time_range: "00-08s",
      duration: 8,
      image_url: null,
      prompt: "浩瀚星空铺开，浅蓝方块拼接成流动星轨；像素长征火箭方块造型点火升空，暖黄方块尾焰冲破像素云层，匀速向上飞行，画面干净通透。",
      image_prompt: "浩瀚星空铺开，浅蓝方块拼接成流动星轨；像素长征火箭方块造型点火升空，暖黄方块尾焰冲破像素云层，匀速向上飞行，画面干净通透。",
      camera_notes: "全景慢推，低饱和色调，深空蓝主色",
    },
    {
      shot_no: "02",
      time_range: "08-18s",
      duration: 10,
      image_url: null,
      prompt: "镜头顺滑下移，掠过像素箭体和卫星方块矩阵；聚焦微距视角，无数微小发光像素元器件整齐排布，细节精致，凸显航天底层构件。",
      image_prompt: "镜头顺滑下移，掠过像素箭体和卫星方块矩阵；聚焦微距视角，无数微小发光像素元器件整齐排布，细节精致，凸显航天底层构件。",
      camera_notes: "纵深运镜，微距特写，银白微光点缀元器件",
    },
    {
      shot_no: "03",
      time_range: "18-25s",
      duration: 7,
      image_url: null,
      prompt: "晨曦柔光笼罩闵行航天城，研究所像素风航拍；半透明像素基石光影轻柔叠加建筑表层，质感克制。",
      image_prompt: "晨曦柔光笼罩闵行航天城，研究所像素风航拍；半透明像素基石光影轻柔叠加建筑表层，质感克制。",
      camera_notes: "",
    },
  ],
};

const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

function normalizeList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function inputType(definition) {
  const raw = definition?.[0];
  return Array.isArray(raw) ? "COMBO" : raw;
}

function inputMeta(definition) {
  return definition?.[1] || {};
}

function isWidgetDefinition(definition) {
  const raw = definition?.[0];
  if (Array.isArray(raw)) return true;
  const meta = inputMeta(definition);
  return meta.socketless === true || WIDGET_TYPES.has(raw);
}

async function main() {
  const objectInfo = await getJson("http://127.0.0.1:8000/object_info");
  const workflow = {
    id: crypto.randomUUID(),
    revision: 0,
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: { ds: { scale: 0.2, offset: [500, 300] } },
    version: 0.4,
  };

  const byKey = new Map();
  let nextNodeId = 1;
  let nextLinkId = 1;
  let nextGroupId = 1;

  function note(key, title, text, pos, size, palette = "guide") {
    const [color, bgcolor] = COLORS[palette];
    const node = {
      id: nextNodeId++,
      type: "MarkdownNote",
      pos,
      size,
      flags: {},
      order: workflow.nodes.length,
      mode: 0,
      inputs: [],
      outputs: [],
      title,
      properties: { text },
      widgets_values: [text],
      color,
      bgcolor,
    };
    workflow.nodes.push(node);
    byKey.set(key, node);
    return node;
  }

  function stage(key, type, title, pos, size, options = {}) {
    const schema = objectInfo[type];
    if (!schema) throw new Error(`Node type is not registered: ${type}`);

    const socketOverrides = new Map(
      (options.sockets || []).map((socket) => [socket.name, socket]),
    );
    const inputs = [];
    const widgetValues = [];
    const seen = new Set();

    function addSocket(name, typeName, extra = {}) {
      if (seen.has(name)) return;
      inputs.push({
        localized_name: extra.localized_name || name,
        name,
        type: typeName,
        link: null,
        ...(extra.shape == null ? {} : { shape: extra.shape }),
      });
      seen.add(name);
    }

    function addWidget(name, definition) {
      if (seen.has(name)) return;
      const meta = inputMeta(definition);
      const value = Object.prototype.hasOwnProperty.call(options.widgets || {}, name)
        ? options.widgets[name]
        : (Object.prototype.hasOwnProperty.call(meta, "default") ? meta.default : "");
      inputs.push({
        localized_name: name,
        name,
        type: inputType(definition),
        widget: { name },
        link: null,
      });
      widgetValues.push(value);
      seen.add(name);
    }

    for (const socket of options.sockets || []) {
      addSocket(socket.name, socket.type, socket);
    }

    for (const section of ["required", "optional"]) {
      const names = schema.input_order?.[section]
        || Object.keys(schema.input?.[section] || {});
      for (const name of names) {
        const definition = schema.input?.[section]?.[name];
        if (!definition || inputType(definition) === "COMFY_AUTOGROW_V3") continue;
        if (!isWidgetDefinition(definition)) {
          addSocket(name, inputType(definition), socketOverrides.get(name) || {});
        }
      }
    }

    for (const section of ["required", "optional"]) {
      const names = schema.input_order?.[section]
        || Object.keys(schema.input?.[section] || {});
      for (const name of names) {
        const definition = schema.input?.[section]?.[name];
        if (definition && isWidgetDefinition(definition)) addWidget(name, definition);
      }
    }

    if (type === "LoadImage") {
      inputs.push({
        localized_name: "选择文件上传",
        name: "upload",
        type: "IMAGEUPLOAD",
        widget: { name: "upload" },
        link: null,
      });
      widgetValues.push("image");
    }

    const outputTypes = normalizeList(schema.output);
    const outputNames = normalizeList(schema.output_name);
    const outputs = outputTypes.map((typeName, index) => ({
      localized_name: outputNames[index] || `output_${index}`,
      name: outputNames[index] || `output_${index}`,
      type: typeName,
      links: [],
    }));

    const palette = options.palette || "image";
    const [color, bgcolor] = COLORS[palette] || COLORS.image;
    const node = {
      id: nextNodeId++,
      type,
      pos,
      size,
      flags: options.flags || {},
      order: workflow.nodes.length,
      mode: 0,
      inputs,
      outputs,
      title,
      properties: {
        "Node name for S&R": type,
        ...(type.startsWith("ComfyTV.")
          ? { comfytv_stage_uid: crypto.randomUUID() }
          : {}),
      },
      widgets_values: widgetValues,
      color,
      bgcolor,
    };
    workflow.nodes.push(node);
    byKey.set(key, node);
    return node;
  }

  function group(title, bounding, color) {
    workflow.groups.push({
      id: nextGroupId++,
      title,
      bounding,
      color,
      flags: {},
    });
  }

  function outputIndex(node, outputName) {
    const index = node.outputs.findIndex((output) => output.name === outputName);
    if (index < 0) throw new Error(`${node.type} has no output named ${outputName}`);
    return index;
  }

  function inputIndex(node, inputName) {
    const index = node.inputs.findIndex((input) => input.name === inputName);
    if (index < 0) throw new Error(`${node.type} has no input named ${inputName}`);
    return index;
  }

  function connect(fromKey, outputName, toKey, inputName) {
    const source = byKey.get(fromKey);
    const target = byKey.get(toKey);
    if (!source || !target) throw new Error(`Unknown connection: ${fromKey} -> ${toKey}`);
    const outSlot = outputIndex(source, outputName);
    const inSlot = inputIndex(target, inputName);
    const linkId = nextLinkId++;
    const linkType = source.outputs[outSlot].type;
    source.outputs[outSlot].links.push(linkId);
    target.inputs[inSlot].link = linkId;
    workflow.links.push([linkId, source.id, outSlot, target.id, inSlot, linkType]);
  }

  // 0. Project and guided tour.
  group("00｜开始这里：项目、运行方式与功能地图", [-40, -40, 6600, 660], GROUP_COLORS.project);
  note(
    "intro",
    "ComfyTV 标志能力全景演示｜无音频版",
    "# ComfyTV 标志能力全景演示\n\n本工作流集中展示：图片生成与挑选、浏览器端编辑、AI 图像编辑、文档分镜批量生图、图层/分镜编辑台、视频后期与 FX Chain、全景、多视角、3D 和原生 ComfyUI Bridge。\n\n## 推荐体验顺序\n\n1. 先看 01 图片区，运行 Image Stage 并在 Picker 中选图。\n2. 再体验 02 分镜区；GPT Image 2 会消耗 ComfyUI 账号积分。\n3. 视频、全景和 3D 均为独立分支，缺少模型或素材时不会影响其他区域。\n4. ComfyTV 节点采用单节点 Run 和最近一次输出快照；载入本文件不会自动运行。\n\n音频、音乐、配音、混音功能已全部排除。",
    [0, 0],
    [1040, 560],
    "guide",
  );
  stage(
    "project",
    "ComfyTV.ProjectStage",
    "项目｜ComfyTV 标志能力全景演示",
    [1110, 80],
    [520, 240],
    {
      palette: "project",
      widgets: {
        project_id: "comfytv-showcase-no-audio",
        project_name: "ComfyTV 标志能力全景演示（无音频）",
        schema_version: 1,
      },
    },
  );
  note(
    "platform-note",
    "平台能力｜不只是一张节点图",
    "## ComfyTV 平台能力\n\n- 每个 Stage 可独立运行，下游读取最近一次输出快照\n- 项目资产、生成历史和输出按项目保存\n- 支持导入 ComfyUI API Workflow、图形化绑定输入和保存预设\n- 侧栏资源库可管理图片、视频、模型、LUT、字体等\n- 提示词中可用 `@` 引用上游素材\n- Bridge 可连接原生及第三方 ComfyUI 节点\n- 可配置远程 ComfyUI 服务并预检能力",
    [1700, 20],
    [1040, 520],
    "project",
  );
  note(
    "safety-note",
    "运行提示｜成本与依赖",
    "## 运行提示\n\n- GPT Image 2 分镜会使用 ComfyUI 账号积分。\n- Local SD、LTX、Qwen、Flux 等工作流需要本地对应模型/自定义节点。\n- LUT 分支需要先从资源库选择 LUT。\n- 3D 分支已选择本机现有 GLB；也可在节点内换成其他模型。\n- 所有分区相互独立，可只体验已有依赖的部分。",
    [2810, 20],
    [900, 520],
    "bridge",
  );

  // 1. Image generation, selection, browser editing, AI editing and bridges.
  group("01｜图片：原生输入 → 生成/挑选 → 快速编辑 → AI 编辑 → 对比", [-40, 680, 6600, 1900], GROUP_COLORS.image);
  note(
    "image-note",
    "01 使用说明",
    "## 图片工作台\n\n`Load Image → Bridge To Image` 演示普通 ComfyUI 图像进入 ComfyTV。参考图可送入 Image Stage。\n\n主链：生成多图 → Picker 选图 → Crop/Rotate/Mirror → Image Edit → Outpaint → Upscale → Compare。\n\nInpaint 与 Grid Split 是并行分支；它们不会阻塞主链。",
    [0, 730],
    [560, 520],
    "image",
  );
  stage("native-image", "LoadImage", "普通 ComfyUI 输入图", [620, 760], [360, 420], {
    palette: "bridge",
    widgets: { image: "example_image.jpg" },
  });
  stage("bridge-to-image", "ComfyTV.BridgeToImage", "Bridge｜转入 ComfyTV Image", [1040, 860], [360, 260], {
    palette: "bridge",
  });
  stage("image-stage", "ComfyTV.ImageStage", "Image Stage｜生成 4 张候选图", [1460, 720], [620, 760], {
    palette: "image",
    sockets: [{ name: "images.image0", type: "COMFYTV_IMAGE", localized_name: "参考图 0" }],
    widgets: {
      workflow: "Local SD1.5",
      resolution: "1K",
      aspect_ratio: "16:9",
      batch_size: 4,
      main_prompt: "电影级航天科技视觉，一枚像素积木构成的火箭穿过深蓝星云，蓝白主色，暖金色尾焰，构图干净，细节丰富，无文字无水印",
      selected_index: 1,
    },
  });
  stage("image-picker", "ComfyTV.ImagePickerStage", "Image Picker｜候选池与单图选择", [2160, 720], [500, 760], {
    palette: "image",
    widgets: { selected_index: 1, pool: "" },
  });
  stage("crop", "ComfyTV.CropStage", "Crop｜浏览器内裁剪", [2740, 760], [420, 420], { palette: "image" });
  stage("rotate", "ComfyTV.RotateStage", "Rotate｜旋转", [3220, 760], [420, 380], {
    palette: "image",
    widgets: { angle: 0 },
  });
  stage("mirror", "ComfyTV.MirrorStage", "Mirror｜镜像", [3700, 760], [420, 380], {
    palette: "image",
    widgets: { flip_horizontal: false, flip_vertical: false },
  });
  stage("image-edit", "ComfyTV.ImageEditStage", "Image Edit｜指令式编辑", [4180, 720], [540, 600], {
    palette: "image",
    widgets: {
      workflow: "Qwen Edit 2511",
      main_prompt: "保持主体造型和构图一致，将背景改为清晨的航天发射中心，增强体积光与空间层次，不添加文字",
    },
  });
  stage("outpaint", "ComfyTV.OutpaintStage", "Outpaint｜扩展为宽银幕", [4800, 720], [540, 660], {
    palette: "image",
    widgets: {
      workflow: "Flux Fill Outpaint",
      pad_left: 256,
      pad_top: 0,
      pad_right: 256,
      pad_bottom: 0,
      feathering: 40,
      main_prompt: "电影级宽银幕航天发射场景，主体保持不变，左右自然延展深蓝星空、发射塔和地平线，蓝白与暖金色灯光",
    },
  });
  stage("upscale", "ComfyTV.UpscaleStage", "Upscale｜最终放大", [5420, 720], [500, 520], {
    palette: "image",
    widgets: { workflow: "Ultrasharp 4x", scale: "2x", main_prompt: "clean cinematic details, crisp edges" },
  });
  stage("compare", "ComfyTV.CompareStage", "Compare｜原图 / 处理结果", [5980, 720], [520, 620], { palette: "image" });
  stage("inpaint", "ComfyTV.InpaintStage", "Inpaint｜涂抹遮罩后局部重绘", [2740, 1390], [520, 650], {
    palette: "image",
    widgets: {
      workflow: "Flux Fill Inpaint",
      main_prompt: "在遮罩区域添加一组精致的航天器太阳能板，透视与光照匹配",
    },
  });
  stage("grid-split", "ComfyTV.GridSplitStage", "Grid Split｜2×2 网格拆分", [3340, 1390], [500, 560], {
    palette: "image",
    widgets: { rows: 2, cols: 2, border: 0, outer_border: false, selected_index: 1 },
  });
  stage("grid-picker", "ComfyTV.ImagePickerStage", "Picker｜选择拆分格", [3920, 1390], [480, 620], {
    palette: "image",
    widgets: { selected_index: 1, pool: "" },
  });
  stage("bridge-from-image", "ComfyTV.BridgeFromImage", "Bridge｜转回普通 IMAGE", [4800, 1510], [360, 220], {
    palette: "bridge",
  });
  stage("image-preview", "PreviewImage", "普通 ComfyUI 预览｜处理结果", [5260, 1380], [560, 520], {
    palette: "bridge",
  });

  connect("native-image", "IMAGE", "bridge-to-image", "image");
  connect("bridge-to-image", "image", "image-stage", "images.image0");
  connect("image-stage", "images", "image-picker", "batch");
  connect("image-picker", "image", "crop", "image");
  connect("crop", "image", "rotate", "image");
  connect("rotate", "image", "mirror", "image");
  connect("mirror", "image", "image-edit", "image");
  connect("image-edit", "image", "outpaint", "image");
  connect("outpaint", "image", "upscale", "image");
  connect("image-picker", "image", "compare", "image_a");
  connect("upscale", "image", "compare", "image_b");
  connect("image-picker", "image", "inpaint", "image");
  connect("image-picker", "image", "grid-split", "image");
  connect("grid-split", "images", "grid-picker", "batch");
  connect("upscale", "image", "bridge-from-image", "image");
  connect("bridge-from-image", "IMAGE", "image-preview", "images");

  // 2. GPT Image 2 storyboard and storyboard editor.
  group("02｜AI 分镜：文档解析/表格 → GPT Image 2 批量图 → Storyboard Editor", [-40, 2660, 4250, 1840], GROUP_COLORS.storyboard);
  note(
    "story-note",
    "02 使用说明",
    "## AI 分镜批量生成\n\n已填入三个示例分镜；配音旁白字段已移除，镜头备注可为空。可在节点顶部上传 DOCX/XLSX/PDF/TXT/CSV/JSON，识别后自动填入表格。\n\n点击 Story Board 节点的一键运行会逐行调用 ComfyUI 的 OpenAI GPT Image 2，按分镜数量输出图片 Batch，并消耗你的 ComfyUI 账号积分。",
    [0, 2710],
    [600, 660],
    "storyboard",
  );
  stage("story", "ComfyTV.GPTImageStoryboardStage", "Story Board｜文档导入 → 三分镜批量生成", [660, 2700], [720, 1260], {
    palette: "storyboard",
    widgets: {
      workflow: "OpenAI GPT Image 2 (Comfy Credits)",
      size: "1536x1024",
      custom_width: 1536,
      custom_height: 1024,
      background: "auto",
      quality: "low",
      seed: 0,
      main_prompt: "保持所有分镜的角色设定、世界观、色彩体系和美术风格一致；严格按照当前分镜的画面内容与镜头备注生成，不要添加字幕、水印或对白文字。",
      storyboard_data: JSON.stringify(DEFAULT_STORYBOARD),
      selected_index: 1,
      custom_params: "{}",
    },
  });
  stage("story-picker", "ComfyTV.ImagePickerStage", "分镜 Batch｜浏览并选择单张", [1460, 2700], [500, 780], {
    palette: "storyboard",
    widgets: { selected_index: 1, pool: "" },
  });
  stage("story-editor", "ComfyTV.StoryboardEditorStage", "Storyboard Editor｜洋葱皮/时间轴/Animatic", [2040, 2700], [760, 1120], {
    palette: "storyboard",
    widgets: {
      board_state: "{}",
      width: 1280,
      height: 720,
      captured_image: "",
      captured_images: "",
      animatic_video: "",
    },
  });
  stage("story-bridge", "ComfyTV.BridgeFromImage", "Bridge｜当前分镜转普通 IMAGE", [2920, 2790], [380, 230], {
    palette: "bridge",
  });
  stage("story-preview", "PreviewImage", "普通 ComfyUI 预览｜当前分镜", [3390, 2700], [600, 520], {
    palette: "bridge",
  });
  note(
    "story-export-note",
    "Storyboard Editor 能力",
    "## Storyboard Editor\n\n- 批量接收生成的分镜图片\n- 洋葱皮与逐格编辑\n- 分镜时间轴和时长管理\n- 浏览器内图层绘制\n- 导出 Animatic、GIF、PDF、ZIP\n- 支持 Fountain 分镜脚本导入",
    [2920, 3280],
    [700, 500],
    "storyboard",
  );

  connect("story", "images", "story-picker", "batch");
  connect("story", "images", "story-editor", "images");
  connect("story-picker", "image", "story-bridge", "image");
  connect("story-bridge", "IMAGE", "story-preview", "images");

  // 3. Non-destructive layer editor.
  group("03｜2D 图层：图层编辑台 → 单图/逐层 Batch 捕获", [4310, 2660, 2250, 1840], GROUP_COLORS.layer);
  note(
    "layer-note",
    "03 使用说明",
    "## Layer Editor\n\n在浏览器里创建栅格、文字、矢量、渐变和调整图层，使用蒙版、选区、魔棒、布尔与形态学工具完成非破坏编辑。\n\n支持撤销/重做、PSD 导入导出；Capture 输出合成图，Batch Capture 输出逐层图片批次。",
    [4360, 2710],
    [540, 520],
    "layer",
  );
  stage("layer-editor", "ComfyTV.LayerEditorStage", "Layer Editor｜Pentrado 图层编辑台", [4960, 2700], [760, 1120], {
    palette: "layer",
    widgets: { layer_state: "{}", width: 1280, height: 720, captured_image: "", captured_images: "" },
  });
  stage("layer-picker", "ComfyTV.ImagePickerStage", "Layer Batch｜选择单层", [5780, 2700], [500, 720], {
    palette: "layer",
    widgets: { selected_index: 1, pool: "" },
  });
  stage("layer-bridge", "ComfyTV.BridgeFromImage", "Bridge｜图层结果转 IMAGE", [4360, 3360], [360, 220], {
    palette: "bridge",
  });
  stage("layer-preview", "PreviewImage", "普通 ComfyUI 预览｜图层合成", [4360, 3630], [520, 500], {
    palette: "bridge",
  });

  connect("layer-editor", "images", "layer-picker", "batch");
  connect("layer-editor", "image", "layer-bridge", "image");
  connect("layer-bridge", "IMAGE", "layer-preview", "images");

  // 4. Video generation, editing, color, FX chain, scopes and timeline composition.
  group("04｜视频：图生视频 → 剪辑/调色 → 多重 FX → 单次渲染 → Scopes/Sequence", [-40, 4580, 6600, 2140], GROUP_COLORS.video);
  note(
    "video-note",
    "04 使用说明",
    "## 视频后期主链\n\n选中的图片作为 I2V 参考：Video Stage → Clip → Crop → Speed → Video Color → Glow → God Rays → Glitch → FX Chain。\n\nFX Chain 负责一次性落实前面累积的实时特效。随后用 Video Scopes 检查波形，并用 Transition + Sequence 演示转场和编排。\n\n`generate_audio` 已关闭。",
    [0, 4630],
    [590, 660],
    "video",
  );
  stage("video-stage", "ComfyTV.VideoStage", "Video Stage｜图生视频（无音频）", [650, 4620], [620, 800], {
    palette: "video",
    sockets: [{ name: "images.image0", type: "COMFYTV_IMAGE", localized_name: "首帧参考图" }],
    widgets: {
      workflow: "Local LTX 2.3 I2V",
      resolution: "720P",
      aspect_ratio: "16:9",
      duration_s: 5,
      generate_audio: false,
      main_prompt: "镜头缓慢向前推进，火箭稳定升空，星云和发射场产生细腻视差，运动连贯，电影感，无字幕",
      custom_params: "{}",
    },
  });
  stage("video-clip", "ComfyTV.VideoClipStage", "Clip｜截取片段", [1340, 4640], [420, 420], {
    palette: "video",
    widgets: { start_s: 0, end_s: 5 },
  });
  stage("video-crop", "ComfyTV.VideoCropStage", "Video Crop｜裁剪", [1820, 4640], [420, 440], {
    palette: "video",
    widgets: { x: 0, y: 0, w: 0, h: 0 },
  });
  stage("video-speed", "ComfyTV.VideoSpeedStage", "Speed｜变速/倒放", [2300, 4640], [440, 460], {
    palette: "video",
    widgets: { speed: 1, reverse: false, pitch_compensate: true },
  });
  stage("video-color", "ComfyTV.VideoColorStage", "Video Color｜色轮与曝光", [2800, 4600], [620, 820], {
    palette: "video",
    widgets: { exposure: 0.12, temperature: 6200, saturation: 0.08, vibrance: 0.2 },
  });
  stage("glow", "ComfyTV.GlowStage", "Glow｜辉光", [3490, 4640], [440, 500], {
    palette: "video",
    widgets: { threshold: 0.72, size: 4, bloom_ratio: 2, bloom_count: 5, gain: 0.8, mix: 0.45 },
  });
  stage("god-rays", "ComfyTV.GodRaysStage", "God Rays｜体积光", [3990, 4640], [460, 560], {
    palette: "video",
    widgets: { translate_x: 0.1, translate_y: -0.15, scale: 1.4, rotate_deg: 0, steps: 5, decay: 0.3, max_mode: false, mix: 0.28 },
  });
  stage("glitch", "ComfyTV.GlitchFXStage", "Glitch｜故障效果", [4510, 4640], [440, 500], {
    palette: "video",
    widgets: { chance: 0.18, block_h: 0.12, shift: 0.08, color_intensity: 2, seed: 7 },
  });
  stage("fx-chain", "ComfyTV.FXChainStage", "FX Chain｜一次性最终渲染", [5010, 4620], [500, 560], {
    palette: "video",
    widgets: { out_colorspace: "bt709", out_size: "source", out_fps: "source", out_codec: "h264", out_quality: "standard" },
  });
  stage("video-scopes", "ComfyTV.VideoScopesStage", "Video Scopes｜波形监看", [5590, 4620], [480, 560], {
    palette: "video",
    widgets: { scope: "waveform", at_seconds: -1 },
  });
  stage("scopes-bridge", "ComfyTV.BridgeFromImage", "Bridge｜Scopes 转 IMAGE", [6140, 4660], [360, 220], {
    palette: "bridge",
  });
  stage("scopes-preview", "PreviewImage", "普通 ComfyUI 预览｜视频示波器", [5890, 5210], [600, 500], {
    palette: "bridge",
  });
  stage("video-lut", "ComfyTV.VideoLUTStage", "可选｜LUT 资源库调色", [650, 5600], [500, 460], {
    palette: "video",
    widgets: { lut_file: "", interp: "tetrahedral" },
  });
  note(
    "lut-note",
    "LUT 分支提示",
    "LUT 节点已接到 Video Color 输出，但未接回主链。先在 ComfyTV 资源库选择 `.cube` LUT；确认效果后，可把它的输出改接 Glow。",
    [650, 6120],
    [500, 300],
    "video",
  );
  stage("transition", "ComfyTV.VideoTransitionStage", "Transition｜处理前后转场", [1290, 5600], [520, 540], {
    palette: "video",
    widgets: { transition: "smoothleft", duration: 1, offset: 0 },
  });
  stage("sequence", "ComfyTV.SequenceStage", "Sequence｜多片段编排", [1880, 5580], [620, 650], {
    palette: "video",
    sockets: [
      { name: "videos.video0", type: "COMFYTV_VIDEO", localized_name: "片段 0" },
      { name: "videos.video1", type: "COMFYTV_VIDEO", localized_name: "片段 1" },
    ],
    widgets: {
      segments: JSON.stringify([
        { slot: "video0", in_s: 0, out_s: 0, transition: "none", trans_dur: 0 },
        { slot: "video1", in_s: 0, out_s: 0, transition: "fade", trans_dur: 0.6 },
      ]),
    },
  });
  stage("contact-sheet", "ComfyTV.ContactSheetStage", "Contact Sheet｜视频缩略图总览", [2580, 5580], [540, 560], {
    palette: "video",
    widgets: { cols: 4, rows: 3, sheet_width: 1920, timecode: true },
  });
  stage("sheet-bridge", "ComfyTV.BridgeFromImage", "Bridge｜联系表转 IMAGE", [3200, 5700], [360, 220], {
    palette: "bridge",
  });
  stage("sheet-preview", "PreviewImage", "普通 ComfyUI 预览｜Contact Sheet", [3650, 5550], [600, 500], {
    palette: "bridge",
  });

  connect("image-picker", "image", "video-stage", "images.image0");
  connect("video-stage", "video", "video-clip", "video");
  connect("video-clip", "video", "video-crop", "video");
  connect("video-crop", "video", "video-speed", "video");
  connect("video-speed", "video", "video-color", "video");
  connect("video-color", "video", "glow", "video");
  connect("glow", "video", "god-rays", "video");
  connect("god-rays", "video", "glitch", "video");
  connect("glitch", "video", "fx-chain", "video");
  connect("fx-chain", "video", "video-scopes", "video");
  connect("video-scopes", "image", "scopes-bridge", "image");
  connect("scopes-bridge", "IMAGE", "scopes-preview", "images");
  connect("video-color", "video", "video-lut", "video");
  connect("fx-chain", "video", "transition", "video_a");
  connect("video-stage", "video", "transition", "video_b");
  connect("video-stage", "video", "sequence", "videos.video0");
  connect("transition", "video", "sequence", "videos.video1");
  connect("sequence", "video", "contact-sheet", "video");
  connect("contact-sheet", "image", "sheet-bridge", "image");
  connect("sheet-bridge", "IMAGE", "sheet-preview", "images");

  // 5. Panorama generation/view extraction.
  group("05｜全景：图生 360° → 当前视角 → 多视角 Batch", [-40, 6800, 3300, 1720], GROUP_COLORS.panorama);
  note(
    "pano-note",
    "05 使用说明",
    "## Panorama\n\n可由普通图片生成等距矩形 360° 全景，也可直接在节点内上传 HDRI/全景图。\n\nCurrent View 捕获当前观察方向；Multi-View 按视角数量批量输出，可继续送入 Picker。",
    [0, 6850],
    [520, 520],
    "panorama",
  );
  stage("panorama", "ComfyTV.PanoramaStage", "Panorama｜图生 360° 全景", [590, 6840], [650, 920], {
    palette: "panorama",
    widgets: {
      workflow: "Qwen-Image-Edit 2511 Image-to-Panorama",
      main_prompt: "清晨的未来航天发射基地，深蓝天空、发射塔、远处城市与地平线形成完整环绕环境，写实电影光照，无文字",
      manual_source: "",
      custom_params: "{}",
    },
  });
  stage("pano-current", "ComfyTV.PanoramaCurrentViewStage", "Current View｜当前视角捕获", [1320, 6840], [560, 660], {
    palette: "panorama",
    widgets: { yaw: 0, pitch: 0, fov: 75, aspect_ratio: "16:9", resolution: "1K" },
  });
  stage("pano-multi", "ComfyTV.PanoramaMultiViewStage", "Multi-View｜六视角 Batch", [1950, 6840], [620, 740], {
    palette: "panorama",
    widgets: { view_count: 6, aspect_ratio: "16:9", resolution: "1K", selected_index: 1 },
  });
  stage("pano-picker", "ComfyTV.ImagePickerStage", "Picker｜选择全景视角", [2640, 6840], [500, 700], {
    palette: "panorama",
    widgets: { selected_index: 1, pool: "" },
  });
  stage("pano-bridge", "ComfyTV.BridgeFromImage", "Bridge｜当前视角转 IMAGE", [1320, 7580], [360, 220], {
    palette: "bridge",
  });
  stage("pano-preview", "PreviewImage", "普通 ComfyUI 预览｜全景视角", [1740, 7640], [560, 500], {
    palette: "bridge",
  });

  connect("image-picker", "image", "panorama", "image");
  connect("panorama", "panorama", "pano-current", "panorama");
  connect("panorama", "panorama", "pano-multi", "panorama");
  connect("pano-multi", "images", "pano-picker", "batch");
  connect("pano-current", "image", "pano-bridge", "image");
  connect("pano-bridge", "IMAGE", "pano-preview", "images");

  // 6. 3D material, loader, primitive, boolean, mesh processing, line art and scene editor.
  group("06｜3D：材质 → 模型/基本体 → 布尔/网格 → 线稿；独立 Scene3D", [3330, 6800, 3230, 2200], GROUP_COLORS.three);
  note(
    "three-note",
    "06 使用说明",
    "## 3D 工作区\n\n左侧链路展示：图片估算 PBR 材质 → 本地模型 + 参数化基本体 → 布尔运算 → 网格优化 → 3D Line Art。\n\nScene3D 是独立多相机场景编辑器，可加入角色、灯光、基本体和关键帧路径，并捕获 Color/Depth/Normal/OpenPose/ID 通道。",
    [3380, 6850],
    [620, 620],
    "three",
  );
  stage("material", "ComfyTV.MaterialStage", "Material｜图片估算 PBR 材质", [4070, 6840], [560, 760], {
    palette: "three",
    widgets: { workflow: "Qwen3-VL 8B Estimate", material_state: "{}", captured_image: "", custom_params: "{}" },
  });
  stage("model-loader", "ComfyTV.ModelLoaderStage", "Model Loader｜本机 GLB + 材质绑定", [4700, 6840], [660, 820], {
    palette: "three",
    sockets: [{ name: "materials.material0", type: "COMFYTV_MATERIAL", localized_name: "材质 0" }],
    widgets: {
      material_bindings: "{}",
      captured_image: "",
      model: "3d/ArmoredWarrior_00005_.glb",
    },
  });
  stage("mesh-primitive", "ComfyTV.MeshPrimitiveStage", "Mesh Primitive｜参数化 Sphere", [4070, 7700], [560, 620], {
    palette: "three",
    widgets: { kind: "sphere", recipe: JSON.stringify({ radius: 0.45, widthSegments: 64, heightSegments: 32 }), captured_image: "" },
  });
  stage("mesh-boolean", "ComfyTV.MeshBooleanStage", "Mesh Boolean｜模型与基本体布尔", [5430, 6860], [560, 720], {
    palette: "three",
    widgets: { operation: "union", resolution: 256, smooth_iters: 1, transform_b: "", captured_image: "", transform_a: "" },
  });
  stage("mesh-op", "ComfyTV.MeshOpStage", "Mesh Ops｜简化/重拓扑/UV/导出", [5430, 7660], [560, 900], {
    palette: "three",
    widgets: { operation: "decimate", target_face_count: 50000, placement_mode: "midpoint", format: "glb" },
  });
  stage("line-art", "ComfyTV.LineArtStage", "3D Line Art｜轮廓/折痕/遮挡", [6070, 6880], [460, 680], {
    palette: "three",
    widgets: { width: 1024, height: 1024, thickness: 2, silhouette: true, crease: true, boundary: true, crease_angle: 60, occlusion: true, invert: false, camera: "" },
  });
  stage("line-bridge", "ComfyTV.BridgeFromImage", "Bridge｜3D 线稿转 IMAGE", [6070, 7630], [360, 220], {
    palette: "bridge",
  });
  stage("line-preview", "PreviewImage", "普通 ComfyUI 预览｜3D 线稿", [5960, 7910], [570, 500], {
    palette: "bridge",
  });
  stage("scene3d", "ComfyTV.Scene3DStage", "Scene3D｜多相机/灯光/关键帧/多通道", [3380, 7660], [620, 1080], {
    palette: "three",
    widgets: {
      scene_state: "{}",
      channel: "color",
      width: 1280,
      height: 720,
      captured_image: "",
      captured_images: "",
      captured_video: "",
    },
  });

  connect("image-picker", "image", "material", "image");
  connect("material", "material", "model-loader", "materials.material0");
  connect("model-loader", "model", "mesh-boolean", "model");
  connect("mesh-primitive", "model", "mesh-boolean", "model_b");
  connect("mesh-boolean", "model", "mesh-op", "model");
  connect("mesh-op", "model", "line-art", "model");
  connect("line-art", "image", "line-bridge", "image");
  connect("line-bridge", "IMAGE", "line-preview", "images");

  workflow.last_node_id = nextNodeId - 1;
  workflow.last_link_id = nextLinkId - 1;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    nodes: workflow.nodes.length,
    links: workflow.links.length,
    groups: workflow.groups.length,
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
