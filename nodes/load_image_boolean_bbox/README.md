# Load Image + BBox

## 节点信息

- 节点 ID：`LoadImageBooleanBBox`
- 显示名称：`Load Image + BBox`
- 分类：`image/bbox`

## 功能

该节点用于加载输入图片，并在前端画布上绘制正向和负向边界框。节点会输出图片、正向 `SAM3_BOXES_PROMPT`、负向 `SAM3_BOXES_PROMPT` 和一个自定义字符串，便于后续接入 SAM3 类节点或其他图像流程。

## 使用说明

1. 在节点搜索中添加 `Load Image + BBox`。
2. 选择或上传输入图片。
3. 在节点画布上绘制正向框和负向框。
4. 将 `bboxes` 和 `neg_bboxes` 输出连接到后续需要框提示的节点。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/bbox_loader.js`
