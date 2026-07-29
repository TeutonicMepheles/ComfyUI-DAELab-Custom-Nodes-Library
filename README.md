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
| `BooleanListHierarchy` | `Boolean List Hierarchy` | 维护最多 64 个带三层祖先级联、同层互斥组、跨分支 AND 依赖和稳定 ID 的布尔输出。 |
| `BooleanListHierarchyGet` | `Boolean List Hierarchy Get` | 无连线选择 Hierarchy 的 Root 分支，并自动生成该分支的 Bool 输出。 |
| `BooleanGroupBypassController` | `Boolean Group Bypass Controller` | 将 Hierarchy 或 Hierarchy Get 的指定 Bool 映射为可视节点组状态，并支持与 Boolean 祖先关系一致的嵌套 Bypass 合成。 |
| `SeedreamExhibitionPromptBuilder` | `Seedream Exhibition Prompt Builder` | 面向 Seedream 5.0 Pro 展厅写实渲染工作流，按主题、参考图用途、语义色彩和布尔条件生成分段提示词。 |
| `BBoxPromptReroute` | `BBox Prompt Reroute` | 转接正向/负向 SAM3 框 prompt，仅整理工作流连线。 |
| `PolygonMask` | `Polygon Mask` | 接收外部 `IMAGE` socket，提供不会自动排队的多边形编辑画布，并输出叠加图和原图尺寸黑白 `raw_mask`。 |
| `SAM3ComplexCollector` | `SAM3 Complex Collector` | 集 BBox 与交互式 collector 于一体，支持节点内独立 Run、会话缓存和增量分割。 |

## 目录结构

```text
ComfyUI-DAELab-Custom-Nodes-Library/
  __init__.py
  nodes/
    boolean_list/
      node.py
      README.md
      assets/
    boolean_list_hierarchy/
      node.py
      README.md
    boolean_list_hierarchy_get/
      node.py
      README.md
    boolean_group_bypass_controller/
      node.py
      README.md
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
    boolean_list_hierarchy.js
    boolean_list_hierarchy_model.mjs
    boolean_list_hierarchy_get.js
    boolean_list_hierarchy_get_model.mjs
    boolean_group_bypass_controller.js
    boolean_group_bypass_controller_model.mjs
    prompt_preset.js
    bbox_loader.js
    polygon_mask.js
    polygon_mask_connection.mjs
    sam3_complex_collector.js
    prompt_preset_model.mjs
    styles.json
    thumbs/
  tests/
```

## 提示词节点

`SeedreamExhibitionPromptBuilder` 是面向 Seedream 5.0 Pro 的展厅提示词节点，复用 `web/styles.json` 和 `web/prompt_preset.js` 的缩略图选择器，`style_id` 在前端显示中文标签。`base_prompt` 始终作为基础输入并显示在面板顶部；模板模式在其后按目标、参考约束、设计材质、配色、灯光摄影组织段落。Color Picker 输入会同时输出自然语言色彩语义和标准化 `#RRGGBB`。

## 交互式节点

- `Boolean List Hierarchy` 使用稳定条目 ID 保存连线，支持 Root、子项、孙项、同父项互斥组、跨分支多前置依赖、整棵子树排序、缩进、提升和递归级联删除。
- `Boolean List Hierarchy Get` 无需连接来源节点，可选择一个 Root 分支并自动同步该分支的输出及其跨分支依赖上下文。
- `Boolean Group Bypass Controller` 是前端虚拟控制器，不参与正常 API Prompt；它支持 Hierarchy 与 Hierarchy Get 双来源，并允许父 Bool 的外层组与子 Bool 的内层组按 Bypass 优先规则安全合成。
- `Polygon Mask` 可直接读取相连 `Load Image` 的当前选择；其他图像来源使用最近一次用户主动运行返回的预览，不会因点击 `Load Image` 自动排队。
- `SAM3 Complex Collector` 的首次 `Run` 会只执行必要的上游依赖和 collector 以建立缓存，后续可在不执行下游节点的情况下更新当前交互式 prompt 或全部 BBox prompt 的预览。

## 测试

仓库同时包含 Python 后端测试和 Node.js 前端纯逻辑测试：

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/*.test.mjs
```

完整编译检查请在 ComfyUI 根目录执行：

```powershell
.\.venv\Scripts\python.exe -m compileall .\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

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
