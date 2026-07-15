# ComfyUI-DAELab-Custom-Nodes-Library

DAELab 维护的 ComfyUI 自定义节点库。

## 维护指南

- 多人协作请先阅读 [Contributor Action List](./CONTRIBUTOR_ACTION_LIST.md)。
- 后续新增节点请先阅读 [新增节点维护指南](./CONTRIBUTING.md)。
- 可从 [新节点模板](./templates/new_node/) 复制基础结构。
- README 和文档统一使用 UTF-8 编码；节点截图、流程图放在对应节点目录的 `assets/` 下。

## 节点列表

| 节点 ID | 显示名称 | 说明 |
| --- | --- | --- |
| `BooleanList` | `Boolean List` | 动态维护多组布尔输出。 |
| `SeedreamExhibitionPromptBuilder` | `Seedream Exhibition Prompt Builder` | 面向 Seedream 4.0/4.5 展厅写实渲染工作流，按主题、参考图用途、语义色彩和布尔条件生成自然语言结构化提示词。 |
| `BBoxPromptReroute` | `BBox Prompt Reroute` | 转接正向/负向 SAM3 框 prompt，仅整理工作流连线。 |
| `PolygonMask` | `Polygon Mask` | 接收外部 `IMAGE` socket，提供纯多边形编辑画布，输出 polygon 叠加图和原图尺寸黑白 `raw_mask`。 |
| `SAM3ComplexCollector` | `SAM3 Complex Collector` | 集 BBox 与交互式 collector 于一体，输出 SAM3 masks 和 visualization。 |

## 目录结构

```text
ComfyUI-DAELab-Custom-Nodes-Library/
  __init__.py
  nodes/
    boolean_list/
      node.py
      README.md
      assets/
    seedream_exhibition_prompt_builder/
      node.py
      README.md
    bbox_prompt_reroute/
      node.py
      README.md
      assets/
    polygon_mask/
      node.py
      README.md
    sam3_complex_collector/
      node.py
      README.md
    _shared_sam3.py
  templates/
    new_node/
  web/
    boolean_list.js
    prompt_preset.js
    bbox_loader.js
    polygon_mask.js
    sam3_complex_collector.js
    styles.json
    thumbs/
```

## 提示词节点

`SeedreamExhibitionPromptBuilder` 是 Seedream 展厅提示词节点，复用 `web/styles.json` 和 `web/prompt_preset.js` 的缩略图选择器，`style_id` 在前端显示中文标签。Color Picker 输入默认把 Hex 转成自然语言色彩描述，不在最终提示词中输出 `#RRGGBB`。

## 安装

将仓库克隆到 ComfyUI 的 `custom_nodes` 目录：

```powershell
cd <ComfyUI>\custom_nodes
git clone https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library.git
```

安装后重启 ComfyUI。

## 更新

在仓库目录中执行：

```powershell
cd <ComfyUI>\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
git pull
```

更新后建议重启 ComfyUI，确保前端脚本和节点定义重新加载。

## 注意事项

- 节点 ID 保持稳定，用于兼容已有工作流。
- 仓库按“每个节点一个目录”的方式组织后端代码和节点说明文档。
- 不要同时启用旧的分散节点目录，否则可能出现重复节点 ID。
- 前端资源集中放在 `web/` 下，以保持 ComfyUI 的 `WEB_DIRECTORY` 加载方式稳定。
