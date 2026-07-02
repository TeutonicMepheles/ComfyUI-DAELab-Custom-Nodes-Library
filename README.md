# ComfyUI-DAELab-Custom-Nodes-Library

DAELab 维护的 ComfyUI 自定义节点库。

## 维护指南

- 多人协作请先阅读 [Contributor Action List](./CONTRIBUTOR_ACTION_LIST.md)。
- 后续新增节点请先阅读 [新增节点维护指南](./CONTRIBUTING.md)。
- 可从 [新节点模板](./templates/new_node/) 复制基础结构。
- README 和文档插图统一使用 UTF-8 编码；节点截图、流程图放在对应节点目录的 `assets/` 下。

## 节点列表

| 节点 ID | 显示名称 | 说明 |
| --- | --- | --- |
| `BooleanList` | `Boolean List` | 动态维护多组布尔输出。 |
| `GPTImageStylePromptPreset` | `GPT Image Style Prompt Preset` | 基于风格预设、主/辅色彩和附加提示生成结构化提示词 |
| `LoadImageBooleanBBox` | `Load Image + BBox` | 加载图片并绘制正向/负向边界框，输出可用于 SAM3 的Prompt |
| `BBoxPromptReroute` | `BBox Prompt Reroute` | 转接正向/负向 SAM3 框Prompt，仅整理工作流连线 |

## 目录结构

```text
ComfyUI-DAELab-Custom-Nodes-Library/
  __init__.py
  nodes/
    boolean_list/
      node.py
      README.md
      assets/
    gpt_image_prompt_preset/
      node.py
      README.md
      assets/
    load_image_boolean_bbox/
      node.py
      README.md
      assets/
    bbox_prompt_reroute/
      node.py
      README.md
      assets/
  templates/
    new_node/
  web/
    boolean_list.js
    prompt_preset.js
    bbox_loader.js
    styles.json
    thumbs/
```

## 安装

将仓库克隆到 ComfyUI 的 `custom_nodes` 目录：

```powershell
cd <ComfyUI>\custom_nodes
git clone https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library.git
```

安装后重启 ComfyUI。

## 更新

```powershell
cd <ComfyUI>\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
git pull
```

更新后建议重启 ComfyUI，确保前端脚本和节点定义重新加载。

## 注意事项

- 节点 ID 保持稳定，用于兼容已有工作流。
- 仓库按“每个节点一个目录”的方式组织后端代码和节点说明文档，多人协作开发时避免彼此耦合。
- 不要同时启用旧的分散节点目录，否则可能出现重复节点 ID。
- 前端资源集中放在 `web/` 下，以保持 ComfyUI 的 `WEB_DIRECTORY` 加载方式稳定。
