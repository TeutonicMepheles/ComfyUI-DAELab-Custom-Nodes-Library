# 业务库整合 · 2026-10-23

以远端 `main` 的 `d80d7e0` 为基线，包含本地 `7001b9c`、`416ee8c`、`683fce3`、`939a6cb`、`606ac30` 五个提交和其后的工作区改动。保留原提交历史、节点 ID、端口顺序、已完成任务、素材和工作流数据；本次只整理业务库，不修改 ComfyTV 上游。

## 功能与所有权

- 表格采用唯一提示词来源及稳定字段 ID 的同行 `@` 引用，保留整列模板、行覆盖、同步来源与撤销／重做。分镜解析器和通用表格通过既有交换契约向生成节点提供输入，首尾帧绑定随保存、重载和同步保留。
- 整列优化复用优化控制器、账本、修订校验、`table_controls`、`createSettingsPopover` 和编辑器事务，增加列级配置与结果汇总。可选 DeepSeek、本地 Qwen 和原生 Comfy GPT 积分通道，模型接入与保护引用归业务库；密钥不进入工作流。
- 图片／视频新云端任务使用 Comfy 账户积分，停用 LibTV 执行入口；旧任务不自动转成新的付费任务。提示词优化的自有 DeepSeek API 是独立能力。沿用 `LocalExecution`、既有生成面板及任务恢复机制，本地 H3 明确区分文生视频、首帧和首尾帧。
- 单条图片、视频或文本填满目标列现有行；多个素材按序填入，保留尾行和其他列。行头横向填充及单格追加保留。复用 `fillMaterialColumn`、编辑器事务、共享历史及公开适配器，不在宿主实现表格业务规则。
- 保留现有 App Mode Bypass 绑定和双实例隔离；修复表格面板恢复、同步表任务轮询归属，以及已有优化结果应用后的撤销／重做状态。

## Canvas 配套

联合安装配套 [Creative Canvas PR #12](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Canvas/pull/12)，宿主提交 `cebf322` 提供公开 `inputSnapshot` 的文本拖入、目标 `accepts` 过滤和面板上下文 `focus()`。应同时更新两库并刷新前端。业务独立安装仍使用本地控件与 App Mode；没有 Canvas 时不提供画布拖入入口。

Canvas 的按钮、字段、主题、字体、面板 lease 与历史通过公开桥接复用，本库不复制宿主实现。新的列级改写框仅组合既有业务控制器、设置弹层与共享控件，不替代节点生命周期。

## 本次自动检查

- Node 全量：654/654 通过，包括 App Mode、表格、优化、引用、生成、历史和徽章前端模型。
- Python 相关后端：172/172 通过，覆盖 `test_libtv_bridge.py`、`test_table*.py`、`test_prompt*.py`、`test_live_chain.py`；使用 ComfyUI 的 Python 3.12 环境，无模型执行或付费请求。
- 变更 JS/MJS/CJS 语法、Python `compileall`、Git 差异空白检查通过。
- CI 扩展原表格／LLM／生成集合，纳入优化、提示词来源、输入回归、视频任务和已修复的徽章颜色图夹具，并运行上述 Python 相关集合。部分旧徽章前端测试依赖仓库外的用户工作流，不能在干净检出运行，因此本地 654 项全量结果与 CI 相关集合分开报告。旧 LibTV 执行测试改为断言所有退役入口拒绝启动进程、保留缓存；回执／并发夹具同步 Comfy provider 和临时认证参数，保留重复提交、恢复与并发隔离断言。徽章前端夹具补入实际文本依赖及当前输出槽位，不改徽章产品代码。
- 全量 Python 检查另发现 `test_badge_prompt_calls.py` 的冻结历史基线不匹配，涉及未被本 PR 修改的徽章后端和基线夹具；不将相关子集通过写成全仓 Python 全绿。

## 实机证据与草稿范围

已有记录分别见 [整列优化](table-column-optimization.md)、[提示词来源](table-prompt-source.md)、[生成输入](generation-input-validation-20261023.md)、[Comfy 积分迁移](comfy-credit-generation.md)。这些记录包含当时的联合／独立安装、双实例、模式、保存刷新、缩放及焦点检查；本地 H3 实跑与既有云端结果验证是先前记录，不代表本次再次提交生成。

本次整合未重启服务或提交任何生成。常用 ComfyUI 8000、8188、8240、8241 端口未监听，最终整合版本的联合／独立安装实机复验尚未完成，两个 PR 保持草稿。GPT／DeepSeek／视频云端实际扣费和提供方输出不作为本次验证结论。
