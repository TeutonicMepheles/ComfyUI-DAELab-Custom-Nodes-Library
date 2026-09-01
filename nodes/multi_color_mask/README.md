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
