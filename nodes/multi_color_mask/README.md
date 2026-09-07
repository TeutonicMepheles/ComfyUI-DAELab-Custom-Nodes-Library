# Multi Color Mask (DAELab)

根据一组或多组目标颜色生成蒙版。节点默认只有一组颜色输入，可在画布节点中按需增加或删除输入组。

## 输入与设置

- `images`：ComfyUI `IMAGE` 输入。
- `Add Mask Group`：增加一组 `enabled / color / threshold / invert` 设置，最多 16 组。
- `Remove Last Group`：删除最后一组，始终至少保留一组。
- `output_mask`：选择输出某个 `mask_N`，或输出全部已启用组的 `combined_mask`。
- `threshold`：使用 RGB 欧氏距离匹配颜色，范围为 0–255；数值越大，允许的颜色差异越大。

## 输出

- `mask`：由 `output_mask` 指定的单组蒙版或合并蒙版。

输入组和输出选择保存在节点属性中，工作流保存、复制和重新加载后会恢复。节点被设为 Bypass、Mute 等非 Active 模式时，已加入应用模式面板的设置会由 DAELab 的统一 Bypass 处理器折叠。

## V1 紧凑节点

`Multi Color Mask V1 (DAELab)` 使用独立节点 ID 和 `multi_color_mask_v1_config`，不会改变旧节点的加载与计算。V1 不显示每组 `enabled`：迁移时仅保留旧配置中已启用的颜色组，之后所有列表项都参与计算。

- 工具栏使用 ICON 在当前选中颜色后新增，或直接删除选中颜色；始终至少保留一组。
- 颜色、HEX 和阈值位于第一行，反转匹配位于第二行。
- 阈值数值框支持悬浮后左右拖动调整；单击后仍可直接输入 0–255。
- 输出选择与增删按钮位于同一工具栏，可选择合并全部颜色或单独颜色组。
- 每组使用稳定 ID；在输出某个单组蒙版时，于其前方新增或删除其他颜色不会改变实际输出目标。
- V1 面板采用按组数计算的紧凑固定高度，并在工作流恢复、刷新和 App Mode 往返后重新收敛到相同尺寸。
