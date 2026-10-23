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

## 实机证据与范围

已有记录分别见 [整列优化](table-column-optimization.md)、[提示词来源](table-prompt-source.md)、[生成输入](generation-input-validation-20261023.md)、[Comfy 积分迁移](comfy-credit-generation.md)。这些记录包含当时的联合／独立安装、双实例、模式、保存刷新、缩放及焦点检查；本地 H3 实跑与既有云端结果验证是先前记录，不代表本次再次提交生成。

整合创建草稿时常用 ComfyUI 端口未监听；最终版本已补齐下列实机复验。GPT／DeepSeek／视频云端实际扣费和提供方输出不作为本次验证结论。

## 最终实机复验 · 2026-10-23

环境为当前 Comfy Desktop 核心 `3c1b7a17f`（ComfyUI 0.39.2、前端 1.53.10、Python 3.12.11）和 Chrome。联合安装 8250、业务独立安装 8251、Canvas 独立安装 8252 使用隔离 userdata、工作流副本和当前仓库目录。最初旧 0.21.1 核心缺少 GPT-6 Luna，切换到正确安装后所有最终检查重新执行并通过。

- `prompt_source_smoke.cjs`：两种安装的唯一提示词切换、文本同行引用、保存刷新通过；联合安装的预览／导出、复制／删除／恢复、缩放和模式切换，独立安装的原生 App Mode 通过。
- `column_optimization_smoke.cjs`：两种安装各实际完成两行本地 Qwen3.5-9B 改写。未应用前表数据不变，应用后保留唯一提示词与引用锚点；一次撤销／重做覆盖整次应用，第二实例不变，刷新后的账本／回执恢复通过。旧核心探索运行另外执行过同样本地验证，不计为当前核心证据。
- `column_optimization_provider_smoke.cjs`：三模型选择、真实 GPT-6 Luna 非付费积分报价、DeepSeek 条件设置入口、密钥草稿清除与不入工作流、嵌套 Escape／焦点、两实例及保存刷新通过。50% / 100% / 150%、800px / 360px 设置弹层可达；原生 App Mode 高面板中无横向溢出，Bypass 清理正常。
- `column_optimization_interaction_smoke.cjs`：输入法 Escape、改写草稿恢复、800px 菜单、三档缩放、Mute / Bypass、只读来源定位与公开 focus()、独立 App Mode 通过。脚本原先在 ResizeObserver 布局前测量而失败，现等待两帧再保留原边界断言；不放宽尺寸标准。三个复验脚本支持 `COMFY_COMBINED_URL` / `COMFY_STANDALONE_URL`，默认地址保持兼容。
- `comfy_credit_ui_smoke.cjs`：联合／独立安装各两个真实生成节点，Fast/Mini 精确选择、本地 H3 切换云端后移除不兼容设置、键盘焦点、保存重载通过；联合安装另验 Bypass、图形／画布和900px菜单。没有提交生成。
- 联合 Canvas 鼠标实拖确认单图片／视频／文本广播、多素材按序填充、不兼容目标拒收、源位置与另一表保留，以及真实 userdata 保存后刷新恢复。Canvas 独立安装、面板 lease/focus、收藏和窄屏修复详见配套 PR #12 的 `docs/validation.md`。
- `comfy_credit_validate.py` 在当前核心完成31种图片／视频原生输入图校验，不入队。`native_prompt_optimization_probe.py` 通过 loopback 假代理验证原生请求、Luna reasoning、认证缺失拒绝、401/402/429分类、日志脱敏和不自动重试；真实付费请求数为0。

实机截图经检查，以上 browser 报告无页面异常。证据存于仓库外 `.codex/workspaces/pr12-pr33-validation-20261023/current/`，包含 combined、standalone、prompt-source、provider-settings、interaction、generation-combined、generation-standalone、native-graphs 与 Canvas 验证 JSON。UI 脚本阻止 `/prompt`、生成提交或付费改写入口；实际推理仅运行本地 Qwen，未执行云端付费生成，也未重跑本地 H3 视频推理。全量 Python 历史徽章基线限制仍如上所述，未因实机通过改写为全仓全绿。
