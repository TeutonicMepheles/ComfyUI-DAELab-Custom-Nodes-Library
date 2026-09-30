# Table generation columns

Status: implementation in progress. Product decisions confirmed by the user.

## First implementation checkpoint

Implemented: generation column creation, existing side-panel configuration, direct text and same-row structured column references, image/video transport through the official CLI, per-cell task receipts, bounded parallel execution, stop-before-submission, recovery, and local result backfill. Existing text can be promoted into the shared column-template editor without losing its contents. Copying rows clears generation identities and outputs.

## Parallel table generation

Table generation columns share a fixed process-wide concurrency budget of
32 jobs. No user configuration or environment variable is needed. Restart
ComfyUI after updating to load the scheduler. This is the
number of independent row jobs, not the number of candidates per row. The
standalone `DAELAB.LibTV.StoryboardBatch` node retains its existing serial path.

The entire submitted batch is preflighted before scheduling. Each running job
occupies a slot through generation and download. Independent jobs can finish in
any order; the existing request/record/column IDs route results to their original
cells. A failed row is recoverable without stopping unrelated rows. Stop only
affects waiting jobs; already submitted jobs finish normally. Recovered receipts
sharing an execution identity are serialized, and the persistent bridge request
lock and paid-command reconciliation remain in place to prevent resubmission.

Scheduler tests cover the global budget across batches, stop-before-start,
failure isolation, execution aliases, out-of-order receipts, duplicate submission,
preflight rejection and the fixed 32-job budget. They use local mocks and do not establish
the account's actual remote concurrency allowance. No paid validation is required.

2026-09-30 validation: 38 relevant Python tests and 23 table generation/prompt
Node tests passed on a branch based on `origin/main` (`bd9f58c`). No frontend
code changed. The currently running desktop backend still requires a restart
to load the scheduler; live paid parallel generation has not been exercised.

The bridge shares its persistent request protocol with video nodes. Image output adds decoding verification; structured spans are replaced with LibTV `{{Node ...}}` references without rewriting literal prompt text. A server-side input index recovers a request if workflow undo removed its browser receipt. Replacing an existing result is an explicit new request.

Validation: 31 relevant Node tests and 28 Python tests in ComfyUI's virtual environment pass. Tests include image download recovery with one paid-command mock invocation, missing-model rejection, stable column/row identity, stale result protection and receipt recovery after undo. These are isolated tests, not real paid generation evidence.

Outstanding acceptance gates:

- Live `libtv model search --type image` reported TLS ECONNRESET; the returned image/video catalog did not contain the requested models. Their current availability and full real schemas remain unverified. No alternate model was selected or paid generation submitted.
- ComfyUI at localhost:8000 was opened in the in-app browser, but UI targeting failed/misdirected actions and the Chrome control failed to initialize. The generation panel, two-instance isolation, overflow/focus, mode switching and save/reload have NOT passed actual visual acceptance.
- The running ComfyUI process has not been restarted to register the new table-generation routes. Restart and browser refresh are required before runtime acceptance. This checkpoint must not be described as production-ready or fully accepted.

## Scope

- Add a generation column with a settings icon and a text Generate action in its header.
- Reuse the existing side panel, controls, and column-template editor. No storyboard parsing is required.
- Prompt references identify columns by stable ID and resolve media from the same record. Translate structured references to LibTV references; never submit raw column labels as media identifiers.
- Support image and video output through the official LibTV CLI and existing local account. Requested models: Image-2, Image-2.5, Seedance 2, Seedance 2.5, Minimax H3. Verify actual identifiers and schemas; never substitute models silently.
- Settings apply to the entire column. One result per record. Let users bind an existing prompt column or create an empty prompt column.
- Generate selected records when any are selected; otherwise generate valid records with empty results. Show the affected count. Preserve previous results until replacement succeeds.
- Completed generation cells can be referenced by another column's prompt. Do not automatically execute dependencies.
- Reuse bridge connection/project selection through public services, not another node's DOM or private properties.

## Ownership and correctness

Fixed column models resolve their exact configured `modelKey` through
`libtv model <key>`, rather than requiring membership in `model search` output.
The response must contain the same key, an official model name and a schema.
Capabilities and generation reuse that schema; mismatches block submission.
When CLI 1.1.3 echoes the key as the name, its temporary model catalog may be
an incomplete built-in fallback cached after a network failure. The bridge
expires only incomplete model-catalog cache envelopes, then uses an official
`libtv model search --type <kind> <key>` to obtain the exact matching display
name. Credentials and tool-spec caches are untouched. No display name is guessed;
missing or ambiguous refreshed names block submission. Preparation recovery also
refreshes the model name while preserving execution identity and reconciliation.
CLI query failures retain the underlying error and are reported as specification
query failures, rather than declaring the model unavailable. No alternate model
is selected. This resolution change passes 40 relevant Python tests. After a
Manager restart, the live table capabilities route successfully returned
Seedance 2.0 / `star-video2` with the official name `StarVideo 2.0` and its
schema. Earlier CLI TLS failures were intermittent. The confirmation browser
was refreshed and its two-table workflow restored; no paid job was submitted.
Catalog-refresh correction: 44 Python tests pass. The live official CLI now
returns all three fixed video models: Seedance 2.0 VIP (`star-video2`),
Seedance 2.5 (`star-video2.5`) and Minimax H3 (`MiniMax-Hailuo-H3`).

Business model, execution, API and UI belong to this repository. Shared canvas controls belong to the sibling Creative Canvas repository. ComfyTV is read-only.

Persist column configuration and record/column/request identities. Snapshot prompt, references and parameters before submission. Recover existing remote jobs after uncertain outcomes rather than resubmitting. Keep stale responses from overwriting edited, deleted or reloaded records. Download failures must not cause another generation.

Keep model settings derived from live capabilities. Report unavailable models and missing references before submission. Credentials remain in the existing CLI account store and are not serialized in workflows.

## Acceptance

- Test row selection, empty-result defaults, direct text and structured column prompts, completed-result references, stable identities, stale-result protection and recovery without paid submission.
- Verify image/video CLI schema mapping and mocked execution/download separately from real paid generation.
- Inspect actual ComfyUI with two table instances: settings, prompt editing, result preview, long content, focus, clipping, zoom, mode switching and save/reload.
- Preserve existing table editing, history and App Mode behavior. Run relevant frontend/backend suites and staged diff checks.
- Record verified behavior and any blocked live/model/runtime checks before reporting completion.

## Baseline

Local table development contains existing uncommitted surface changes; these are preserved and excluded from this initial plan commit. The implementation branch retains existing table/@-column work beyond remote main rather than dropping those dependencies.

## Prompt column fill and verified model names

- The image selector includes Lib Image, Lib Image 2.5 Pro and Lib Image 2.5 Fast, matched by their verified stable LibTV keys. CLI schema/preflight checks passed without paid generation.
- A writable prompt cell exposes “应用到整列”. It replaces every row override with the current prompt as a shared column template. Column references still resolve against each destination row; future rows inherit it. One undo restores the prior column state.
- Validation: 15 prompt/generation tests passed. Actual ComfyUI inspection confirmed the menu, two-row fill, one-step undo, save/reload and isolation from a second table. The running backend still requires restart to load the model mapping fix; paid generation has not been tested. Full multi-viewport and long-content checks remain pending.

### 网络中断自动恢复

已提交或提交状态不确定的任务，在网络错误或尚无视频时自动查询原节点；采用 5、10、20、30、30、60、60、120 秒退避（等待合计 335 秒，不含查询耗时）。结果下载网络失败也可恢复。不会自动重试准备阶段或再次执行 `--run`，平台明确失败立即停止。停止任务会终止后续恢复查询。并发仍为 32；恢复中的任务占用原并发位置。单元格显示简短提示，完整异常保留在本地任务回执 `errorDetail`。恢复超时后可手动恢复同一任务。

参数校验按当前生成方式选择 settings 和 advancedSettings，避免 duration_auto/ratio_auto 覆盖单图模式参数。时长输入按 slider/min 识别数字类型。处理中恢复提示使用普通状态色；平台完成但缺少视频地址时提示等待结果写回。

生成类型列最小宽度为 400px；图标与列名、编辑、生成和停止按钮使用单行表头。长列名省略显示，列宽拖动及窄视口布局均遵守同一宽度下限。

### CLI 写回与终态错误边界（2026-09-30）

- CLI 的结构化 `failedReason` 或明确的“生成失败、积分返还”终态消息保存为 `platform_failure`，桥接回执进入 `failed`。同一请求再次恢复不会提交生成或重新查询；新生成必须使用明确的新请求。
- 历史 `needs_recovery` 回执中的明确退款失败消息，在状态 API 返回时纠正为 `failed`；网络错误和泛化的“生成失败”文字不据此判定终态。
- CLI 1.1.3 的 `nodesBatch` 写回仍可能在 TLS 握手阶段发生 `ECONNRESET`。仅当 CLI 已输出结果地址时，桥接层才能保全地址并补写；没有输出地址的失败仍未根治。平台 100% 不代表本地结果可用。
- 本轮核查的公开分发入口未找到 CLI 实现源码或按生成任务 ID 恢复的公开 CLI 命令。官方插件目录 https://github.com/liblib-ai/marketplace 提供远程 MCP，不是当前 CLI 的源码替代。
- 真正补齐此边界需要 CLI 在画布写回前原子保存终态结果，并提供仅查询原任务/重试同一写回的恢复命令。不得通过重复 `--run` 模拟恢复。
- 早先网络检查仅做当前路由的 3 次 TLS 握手，均通过证书验证；域名解析为本机隧道使用的地址。未进行可信的代理/直连 A/B 对比，不能据此断定故障来源。早先检查未修改网络设置，也未发起付费生成；后续实测见下文。

### 预览内状态控件

生成状态与操作叠放在 content-display 右上角，不增加单元格行高。waiting/running 显示阶段和进度圆环；仅在 CLI 确实提供百分比时展示该值，complete 显示勾；异常显示可点击的错误图标，完整说明保留在悬浮提示和详情。恢复与重新生成使用图标按钮，仍遵守原任务 ID 和明确重新生成语义。复用 table_controls 的共享按钮及本地 Remix 图标，并支持减少动态效果。
### 已完成结果的显示与保留

- 状态同步会检查“已完成但单元格缺失”的情况，不再只比较任务阶段和错误文本。待恢复、失败和停止状态也会定期查询本地回执；查询不会重新付费生成。
- 更换任务时保留旧任务的输入和身份，继续核对其迟到的结果。输入或模型已变化时不会自动覆盖当前单元格，可通过“已有生成结果”选择旧结果；媒体标注原模型，当前任务状态保留。
- 重新生成确认复用表格对话框，避免内嵌浏览器被原生确认框阻塞。入口、面板及模型模块同步更新缓存版本。

### 2026-09-30 实际回填验证

- 14 项前端生成/请求测试、59 项后端表格与 CLI 测试通过。实际 ComfyUI 两个表格实例均从空单元格自动补回视频，覆盖已有 complete 状态不变及 needs_recovery 转 complete；播放与图形/创作画布模式切换后正常。
- 原工作流五行均有可解码视频：第 2、3 行恢复此前 Seedance 2.5 结果并保留原模型标记；第 1、4 行的新 Seedance 2.0 任务经正常表格链路自动回填，第 5 行独立 CLI 生成下载成功后，经同输入回执恢复回填，保留实际 executionId。
- 默认连接与显式本机代理下各 3 次 CLI 只读查询均成功，不能据此断定网络根因。第 5 行最后一次长任务显式使用本机已有代理成功写回；此设置仅作用于该独立进程，未修改系统代理，也未硬编码到产品。CLI 未输出地址的 ECONNRESET 边界仍未根治，不能以平台 100% 或单次成功宣称永久解决。
