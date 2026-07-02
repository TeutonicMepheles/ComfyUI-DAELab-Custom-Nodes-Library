# GPT Image Style Prompt Preset

## 节点信息

- 节点 ID：`GPTImageStylePromptPreset`
- 显示名称：`GPT Image Style Prompt Preset`
- 分类：`GPT-Image/Prompt`

## 功能

该节点用于基于主题、风格预设、色彩和语气生成适合 GPT Image 的提示词。风格数据来自仓库中的 `web/styles.json`，前端会读取缩略图和风格配置提供可视化选择。

## 使用说明

1. 在节点搜索中添加 `GPT Image Style Prompt Preset`。
2. 输入主题内容。
3. 选择风格、语气、主色和辅色。
4. 如需补充细节，在 `custom_append` 中追加描述。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/prompt_preset.js`
- 风格数据：`../../web/styles.json`
- 缩略图：`../../web/thumbs/`
