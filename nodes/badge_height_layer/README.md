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

该节点只接收 `height_profile`，不依赖材质、色块图或前景遮罩。它根据最终实际命中的层级动态输出：

- `prompt`：可直接连接 GPT Image 2 的高度建立提示词；只描述实际存在的层级，并明确禁止补出未使用层级或重新归一化高度。
- `height_report`：列出已配置层级、实际命中层级、空层级、逐层像素数、未匹配像素和排除的透明像素。

例如配置了 Layer 1、3、5，但 Layer 3 没有命中任何像素，Prompt 只会声明 `0.2 / 1.0`，报告会把 Layer 3 标记为 `Configured but empty`。

节点不羽化边缘。输入应为不含色卡和说明文字的干净颜色 ID 图；若实体和镂空使用相同 RGB，仅靠本节点无法区分，需在上游为镂空使用唯一占位色。
