# 唯一提示词来源与文本引用

表格业务拥有 `meta.generationInput = {version: 1, promptFieldId: string | null}`。列头的 Remix `chat-ai-line` 图标切换此绑定；同一表最多一个提示词标签。图标使用 32px 点击区、20px 图形，悬浮提示在列头内显示。普通文本模板不等于生成来源。

迁移只采用一致的旧显式 final_prompt / generation.promptFieldId 绑定。缺少绑定或存在冲突时要求选择；显式取消、删除来源后不按列顺序回退。复制列不复制表级绑定，改名、隐藏和排序保持 ID。切换与删除使用既有编辑器事务和宿主撤销记录。

`@` 通过菜单插入稳定字段 ID，按本行取值。纯文本的旧 column-template 可作文本源；含引用的模板禁止递归、自引用。直接粘贴 @列名保持文字。空值、删除和类型变化必须报错。整列模板与单行覆盖保留原有结构；清空覆盖使用空段落文档，恢复模板使用空字符串的旧兼容语义。

任务导入保留依赖列原值，仅将选定来源转为编辑文档。新任务使用表级绑定；已提交回执的 input 快照、结果与历史不改写。同步依赖值和结构后重新校验，取消来源、断开输入或删除源行阻止新提交，恢复源行后解除阻止。预览与生成节点导出共用 resolveColumnPrompt；Python 解析器维持同样的纯文本展开规则。

共享按钮、主题、历史通过既有 table_controls 可选桥接；无 Canvas 安装仍使用业务包的本地主题与图标。Canvas 不承载业务绑定或模板解析。

验证记录（2026-10-23）：

- `node --test tests/table*.test.mjs tests/video*.test.mjs`：100 项通过。
- `python -m unittest discover -s tests -p test_prompt_source.py`：3 项通过；`test_prompt_compiler.py`：16 项通过。
- 修改的 15 个前端模块通过语法检查，`git diff --check` 通过。
- `tools/prompt_source_smoke.cjs` 在本地真实 ComfyUI 组合安装（8240）及业务包独立安装（8241）通过。两个实例覆盖列头悬浮提示、键盘切换、同一编辑事务撤销/重做、复制及删除列、删除节点后恢复、保存重载、50%/100%/150% 缩放、800px 窄视口和原生 App Mode。预览结果与实际连接生成节点的 `generationInput` 输出一致。
- 验证使用独立用户、输入及输出目录；未改变用户运行中的主工作流。请求拦截记录为 0 次生成提交，页面错误为 0；不作为付费模型出图/视频验证。

界面复测需先启动上述两个隔离实例，再执行 `NODE_PATH=<Playwright 所在 node_modules> node tools/prompt_source_smoke.cjs <证据目录>`；可用 `CHROME_PATH` 指定 Chrome。输出包含 `verification.json`、保存的工作流和实际界面截图。

已有 Desktop 会话补验（2026-10-23）：用户的 `03-本地H3-文生视频与首尾帧-完整Showcase` 在旧会话中仍使用缓存模块，首次隔离测试未覆盖该情况。统一更新表格相关模块及其导入链的版本为 `20261023-prompt-source-r2` 后，在同一个 Desktop 窗口刷新，旧表格列头出现图标；实际点击、Ctrl+Z 恢复均通过。另在当前 8000 服务载入用户刚保存的工作流，验证两个表格互不影响、上游同步不丢失来源绑定，导出的生成提示词等于原“画面”内容。生成提交次数为 0。
