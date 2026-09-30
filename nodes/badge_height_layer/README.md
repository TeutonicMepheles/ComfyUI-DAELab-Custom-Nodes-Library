# Badge Height Layer (DAELab)

将平面分色稿中的颜色映射为离散徽章高度：镂空为 `0.0`，一至五层固定为 `0.2 / 0.4 / 0.6 / 0.8 / 1.0`。

## 输入与配置

- `images`：ComfyUI `IMAGE` 输入。
- `Add Color Group`：增加颜色组，最多 16 组。
- 每组包含 `enabled / color / threshold / layer`。
- `layer`：选择 `Cut Out` 或 `Layer 1` 至 `Layer 5`。
- `threshold`：RGB 欧氏距离容差。一个像素同时落入多个颜色容差时，归属距离最近的颜色；距离完全相同时，高层优先。

## 输出

- `height_mask`：`MASK` 格式离散高度图。
- `height_image`：三通道灰度 `IMAGE`，便于预览或作为图像模型的结构参考。
- `unmatched_mask`：未命中任何启用颜色的像素，白色表示需要检查的区域。
- `height_profile`：记录已配置层级、实际命中层级、每层像素数和对应 Alpha/灰度值，连接到 `Badge Height Establish Prompt Builder`。

## Badge Height Establish Prompt Builder

该节点必须接收 `height_profile`，并可选接收 `material_semantics`。它根据最终实际命中的层级动态输出：

- `prompt`：向后兼容的中性灰高度样机提示词。只描述实际存在的层级，禁止补出未使用层级或重新归一化高度；固定输出统一中性灰、无实际材质的正视浮雕样机。
- `height_report`：列出已配置层级、实际命中层级、空层级、逐层像素数、未匹配像素和排除的透明像素。
- `structure_prompt`：仅包含高度、轮廓优先级、边界截面、镂空和设计锁定。灰度值被描述为有序的相对高度类别，不宣称 GPT 能输出经过标定的工程 Z 值。
- `base_render_prompt`：节点内部把 `structure_prompt`、参考色锁定、`material_semantics`、明确的不透明纯白背景、正视相机和禁止项组合成 #8.4 第一阶段完整提示词；无需再使用外部静态文本和 `Text Concatenate`。Image 1 的综合色相、饱和度和基础明度拥有最高优先级，禁止材质导致全局或分区变暗、变亮、增对比、色调映射或重新配色。

三个提示词输出共享同一套动态高度层级。`structure_prompt` 明确把宏观几何作为自己的唯一职责；`base_render_prompt` 则把固有色、涂层、反射、粗糙度、微观纹理和输出约束合并为单一、可检查的提示词。

例如配置了 Layer 1、3、5，但 Layer 3 没有命中任何像素，Prompt 只会声明 `0.2 / 1.0`，报告会把 Layer 3 标记为 `Configured but empty`。

## Badge Height Layer V1

`Badge Height Layer V1 (DAELab)` 使用独立节点 ID `DAELabBadgeHeightLayerV1`，不会替换已有工作流中的旧节点。

- 每个颜色层固定两行：第一行编辑颜色与阈值，第二行选择语义高度。
- 阈值数值框支持悬浮后左右拖动调整；单击后仍可直接输入 0–255。
- 高度选项明确显示镂空、最低层、次低层、中间层、次高层、最高层，以及对应的归一化高度与灰度值。
- 点击颜色层任意区域会选中该层；工具栏 ICON 在选中层后新增，或直接删除选中层。
- V1 不包含 `enabled` 开关；迁移旧配置时只保留原先启用的颜色层。
- 面板的颜色、阈值和高度统一写入隐藏的 `height_layer_config` 输入；排队与序列化前会核对 draft、节点属性、隐藏 widget 和队列值，格式错误或不一致会阻止执行。
- 前四个输出保持与旧节点一致，并追加 `applied_config`、`config_digest` 与 `config_report`，用于确认 Python 后端实际采用的配置。

节点不羽化边缘。输入应为不含色卡和说明文字的干净颜色 ID 图；若实体和镂空使用相同 RGB，仅靠本节点无法区分，需在上游为镂空使用唯一占位色。
