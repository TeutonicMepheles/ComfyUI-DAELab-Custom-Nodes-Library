# GPT Image2 Config

为多个 `OpenAI GPT Image 2` 节点集中提供输出尺寸、背景和质量参数。

## 节点信息

- 节点 ID：`GPTImage2Config`
- 显示名称：`GPT Image2 Config`
- 分类：`DAELab/OpenAI`
- 输出：`size`、`background`、`quality`

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

旧工作流若分别暴露了三个成员，前端会按最早出现位置折叠成稳定的 `gpt_image2_config_panel` 输入，并保留已有面板配置。节点进入 Bypass、Mute 或其他非正常执行模式时，最终应用中的组合输入会隐藏；恢复正常模式后重新显示。

## 依赖与边界

- Config 节点本身只传递字符串，不调用 OpenAI、不需要 API Key、模型文件或额外 pip 包。
- 真正执行生成的 `OpenAI GPT Image 2` 节点仍需要其节点实现、OpenAI 凭证、可用额度和网络访问。
- 完整交付需包含根 `__init__.py`、`web/gpt_image2_config.js`、`web/gpt_image2_config_panel.mjs` 和共享的 `web/app_mode_bypass.js`。

## 测试与相关文件

- 后端：`node.py`
- 前端面板：`../../web/gpt_image2_config.js`
- 面板纯逻辑：`../../web/gpt_image2_config_panel.mjs`
- 后端测试：`../../tests/test_gpt_image2_config.py`
- 前端测试：`../../tests/gpt_image2_config_panel.test.mjs`
