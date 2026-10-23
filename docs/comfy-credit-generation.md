# Comfy 积分生成

业务库拥有云端生成适配，画布仅通过公开适配器展示面板。本次沿用表格生成配置、任务身份与本地回执、共享按钮/字段、Comfy 临时认证和原生队列执行。

- 所有新云端任务只允许 Comfy 账户积分；本地 Qwen/H3 仍使用本机模型。
- Seedance 2.0、Fast、Mini、2.5 与 MiniMax H3 保留精确模型身份。图片使用 Comfy 原生 GPT Image 型号，旧 Lib Image 名称不推断对应型号。
- 不再显示 LibTV 登录或目标画布入口。旧节点类型和端口、历史素材及回执保留；旧 LibTV 任务不会被恢复成新的 Comfy 付费任务，需要明确新建任务。
- 原生旧 LibTV 分镜批量入口停用，请将表格导入生成节点。原生生成节点输出继续读取面板中已完成的结果。
- 认证仅进入 Comfy 队列的 sensitive 数据，不保存到工作流、任务回执或请求指纹。没有登录或不支持的参数必须在入队前失败。
- 原生视频请求显式设置 watermark=false。这里只控制请求参数，不承诺提供方输出的所有视觉内容。

验证使用模型规格、原生工作流校验、无收费的队列测试及真实双实例界面。不得为验证提交收费生成。

## 2026-10-22 验证

- 已安装 ComfyUI 的 `execution.validate_prompt` 校验 31 组模型/模式图：视频 5 个型号各 5 种模式，图片 3 个型号各 2 种模式；未入队。入口为 `tools/comfy_credit_validate.py`。
- 10 项 Comfy 适配/认证/恢复测试、23 项本地 Qwen/H3 回归、26 项前端配置/历史/请求测试通过；Python/JS 语法与 diff 检查通过。
- `tools/comfy_credit_api_smoke.py` 在隔离服务验证精确 provider、无认证拒绝、LibTV 接口停用、已完成旧回执复用与未完成旧回执阻断；队列保持为空。
- `tools/comfy_credit_ui_smoke.cjs` 在业务库独立安装和 Canvas 联合安装中验证双实例、Fast/Mini 独立选型、本地转云端清理不支持的参数、键盘焦点、刷新恢复；联合安装另验 Bypass/恢复、原生/创作画布切换和 900px 视口菜单。旧工作流提示词、参数、结果、端口顺序恢复脚本亦通过。
- 复用 `table_controls`、`table_prompt_settings`、`table_generation_tasks` 与 `LocalExecution`。独立安装发现的删除按钮溢出通过共享 `tableIcon` 使用现有本地图标修复。
- 当前 8000 主服务重启后已读回 Fast 的 `provider=comfy`。实际云端生成、扣费与最终视频水印未提交验证；既有视频内容不变。修改尚未提交 Git。
