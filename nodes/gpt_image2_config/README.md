# GPT Image2 Config

为多个 `OpenAI GPT Image 2` 节点集中提供输出尺寸、背景和质量参数。

## 输入与输出

节点将以下三个下拉参数原样输出：

- `size`：`auto` 或 GPT Image 2 支持的预设分辨率。
- `background`：`auto` 或 `opaque`。
- `quality`：`low`、`medium` 或 `high`。

该节点仅面向 `gpt-image-2`，不提供旧模型的透明背景，也不提供 `Custom` 自定义宽高。

## 连接方法

1. 在 `OpenAI GPT Image 2` 节点上选择 `gpt-image-2`。
2. 将 `model.size`、`model.background`、`model.quality` 分别转换为输入端口。
3. 将本节点的 `size`、`background`、`quality` 同名输出连接到对应端口。

同一个输出可以连接多个 GPT Image 2 节点，从而统一控制它们的生成参数。

## 应用构建模式

应用构建器会把 `size`、`background`、`quality` 显示为一个 `GPT Image2 Config` 组合输入。勾选或取消该组合输入时，三个参数会同时开启或关闭；组合输入内部仍可分别设置三个参数值。
