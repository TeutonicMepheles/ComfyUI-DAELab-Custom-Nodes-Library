# 剧本分镜导入

新增节点：`DAELAB - 剧本分镜导入`（`DAELAB.StoryboardImport`）。重启 ComfyUI 后可搜索添加。

可直接加载空白工作流：[storyboard-import.json](workflows/storyboard-import.json)。

导入流程：


1. 上传或拖入 Word 分镜表。
2. 选择表格、表头行，以及镜号、时长、画面内容等对应列。切换表或列会重建当前预览。
3. 检查分镜原文和配图，修正缺项。同一张图可以应用到全部分镜。
4. 点击“确认追加”或“确认替换全部分镜”。取消不改变原数据；图片上传失败也不会应用分镜修改。
5. 将 `storyboard_json` 输出连接到旧 GPT Image 2 StoryBoard 节点新增的 `imported_storyboard` 输入。连接后以输入数据为准；生图仍需手动运行，并按原节点规则消耗 ComfyUI 额度。

旧生图节点仍可独立使用，它的上传入口也使用同一套预览确认流程。所有改动均在 DAELab 节点库内，未修改 ComfyTV。

导入后的表格支持整行排序、单元格交换/移动、列重排和撤销：[分镜表拖动编辑说明](TABLE.md)。

## 保存什么

输出为 STRING 类型 JSON。当前表格封装使用 `schema_version: 4`，`table` 是编辑数据真值，`shots` 为兼容投影；旧版独立 shots 仍可迁移。`shots` 中每行包含：

| 字段 | 用途 |
|---|---|
| id | 保存后不变的分镜 ID；生成结果通过 shot_id 对应它 |
| shot_no、time_range、duration | 镜号、原始时间文本、换算秒数 |
| image_prompt、camera_notes | 画面提示词、镜头备注 |
| image_url | ComfyUI 本地参考图地址 |
| source | 原文件、表格编号（从 0 开始）、原行号（从 1 开始） |
| original_fields | 导入时各列的原文，包括旁白；不会自动进入生图提示词 |

兼容旧版保存数据。缺画面内容的行会保留，生成前需要补齐。时间无法识别时沿用 3 秒默认值，并在导入预览中提示确认。

## 本版范围

- Word 表格优先；一次选择一张表，多张表可分次追加。
- Word 内嵌栅格图片按所在行匹配。多张候选图由用户选择，正文图片可从图片列表选择；暂不猜测浮动图片与邻近段落的对应关系。
- 图片转为 PNG，不缩小像素尺寸；单图超过 2500 万像素、总提取图片超过 32 MB、不可解码图片会提示手动补图。上传文件最大 20 MB，Office 解压最大 128 MB。
- Word 最多读取每表 500 行、64 列，超出明确提示。其他格式保留原兼容能力并提示相同读取上限；不提取其内嵌图片。
- 图片使用唯一文件名，不覆盖旧图。失败后已成功上传的图片可能留在 ComfyUI input 中，但原分镜不会被替换。
- 普通长篇剧本的智能拆镜、OCR 和提示词润色不在本次实现范围。

## 复用与验收

复用 `daelab_storyboard_model.mjs`、现有分镜表格、`list_editor_controls.mjs`、`dynamic_widget_lifecycle.mjs`、共享 App Mode Bypass 机制。导入预览需要选表、列对应和确认提交，与已有颜色选择弹窗用途不同，因此单独增加导入弹窗模块。

单元测试覆盖 DOCX 多表、图片对应、缺项保留、原文字段、ID 保存恢复、旧节点兼容、App Mode 节点注册。

`tools/storyboard_import_smoke.cjs` 在独立的本地 ComfyUI 测试实例中验证真实上传、取消、追加/替换、上传失败保护、刷新、节点连线和免费导入执行。测试素材由 `tests/storyboard_fixture.py` 生成，不冒充真实业务文档。未触发收费生图。

2026-09-26 验收：9 项 Python 测试、24 项 JavaScript 测试通过；浏览器完整流程通过，无页面异常。实际验证了 App Mode 的 Active / Bypass / Muted 切换恢复及空白模板加载。此为初版记录；2026-09-27 已追加真实文稿与 4 个视频验收，详见 [完整记录](PROMPT_PARSE_ACCEPTANCE.md)。

App Mode 复用共享控制器，并补齐新版前端含 graph ID 的控件定位；窄侧栏默认保留表格横向滚动，也可主动切换卡片视图。
