# DAELAB - GPT Image 2 StoryBoard

- 节点 ID：`DAELAB.ComfyTV.GPTImageStoryboardStage`
- 分类：`DAELab/ComfyTV`
- 输出：`COMFYTV_IMAGES` 批量结果与 `COMFYTV_IMAGE` 当前选中图

这是一个由 DAELab 独立维护的 ComfyTV 兼容节点。它不会导入或修改 ComfyTV 源码，
只复用 ComfyTV 的数据类型名称，使生成结果仍可连接到 ComfyTV 的批量图片下游节点。

节点支持逐行编辑镜号、时长、画面提示词、可选镜头备注和可选参考图；支持导入
DOCX、XLSX/XLSM、CSV、TSV、TXT、Markdown 与 PDF 分镜文档。配音、旁白、对白、
台词等列会被解析器明确忽略。

运行时，每个有效分镜会调用一次 ComfyUI 原生 `OpenAIGPTImageNodeV2`，固定使用
`gpt-image-2` 且 `n=1`。认证信息只从当前已登录的 ComfyUI 请求内存转发到嵌套执行，
不会写入工作流或本地文件，因此不需要 OpenAI API Key，消耗计入 ComfyUI 账号积分。

## 使用

1. 在节点表格中新增分镜，或上传分镜文档。
2. 为每个分镜填写“画面内容”；镜头备注和参考图可以留空。
3. 可在节点设置中选择尺寸、背景和质量。
4. 点击节点内“一键运行”或 ComfyUI 顶部运行按钮。

生成中断时，已完成图片会在临时目录保留至多 6 小时；不修改分镜内容再次运行会从
失败分镜继续。

## 独立性

内置 API 工作流位于本节点目录的 `workflows/` 中。嵌套执行逻辑位于 `runtime.py`，
其执行模式参考了 MIT 许可的 ComfyTV 本地工作流运行器，但代码、HTTP 路由、前端
扩展和缓存目录都使用 DAELab 命名空间。
