# RMBG Config

为 `遮罩提取 (RMBG) 🎭`（节点 ID：`AILab_MaskExtractor`）集中提供背景类型和背景颜色参数。

## 输入与输出

节点将以下两个参数原样输出：

- `background`：`Alpha`、`original` 或 `Color`，默认 `Alpha`。
- `background_color`：RMBG 的 `COLORCODE` 颜色值，默认 `#FFFFFF`。

背景选择 `Color` 时，RMBG 节点使用 `background_color` 填充遮罩外区域；选择 `Alpha` 时输出透明背景。

## 连接方法

1. 在 `遮罩提取 (RMBG) 🎭` 节点上将 `background` 和 `background_color` 转换为输入端口。
2. 将本节点的两个同名输出连接到对应端口。

同一个输出可以连接多个 RMBG 节点，从而统一控制它们的背景设置。

## 应用构建模式

应用构建器会把 `background` 和 `background_color` 显示为一个 `RMBG Config` 组合输入。勾选或取消该组合输入时，两个参数会同时开启或关闭；组合输入内部仍可分别设置背景类型和颜色。
