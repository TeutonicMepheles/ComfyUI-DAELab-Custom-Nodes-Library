# Seedream Exhibition Prompt Builder

## 节点信息

- 节点 ID：`SeedreamExhibitionPromptBuilder`
- 显示名称：`Seedream Exhibition Prompt Builder`
- 分类：`Seedream/Prompt`

## 功能

该节点用于替代工作流中由 `GPT Image Style Prompt Preset`、多个 `LazySwitchKJ` 和 `Text Concatenate` 组成的提示词拼接段。节点会根据主题风格、颜色、语气、补充描述和 5 个布尔条件，生成符合 Seedream 4.0/4.5 提示词规范的完整结构化提示词。

当前版本不提供 `visible_text` 输入，不会自动把补充描述包装为画面可见文字。需要在画面中出现的标语或标题建议作为单独提示词节点处理，并确保只对真实可见文字使用双引号。

## 布尔输入

- `use_theme_template`：是否使用 `web/styles.json` 中的主题模板。
- `use_space_reference`：是否把参考图作为展厅空间布局与建筑结构参考。
- `include_people_placeholder`：是否将参考图中的占位人物或示意人形替换为写实游客，仅在启用空间参考时生效。
- `use_element_reference`：是否使用参考图中的物品或元素作为元素参考。
- `lock_edit_region`：是否要求元素保持在原本位置，仅在启用元素参考时生效。

## 相关文件

- 后端：`node.py`
- 风格数据：`../../web/styles.json`
- 前端缩略图选择器：`../../web/prompt_preset.js`
