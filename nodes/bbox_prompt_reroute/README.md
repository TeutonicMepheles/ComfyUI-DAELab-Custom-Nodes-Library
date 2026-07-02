# BBox Prompt Reroute

## 节点信息

- 节点 ID：`BBoxPromptReroute`
- 显示名称：`BBox Prompt Reroute`
- 分类：`image/bbox`

## 功能

该节点用于转接一组正向和负向 `SAM3_BOXES_PROMPT`，方便在工作流中整理线缆。没有输入时会输出空的框提示结构，避免后续节点收到 `None`。

## 使用说明

1. 在节点搜索中添加 `BBox Prompt Reroute`。
2. 接入 `bboxes` 和 `neg_bboxes`。
3. 将输出继续连接到后续框提示消费者。

## 相关文件

- 后端：`node.py`
- 前端样式行为：`../../web/bbox_loader.js`
