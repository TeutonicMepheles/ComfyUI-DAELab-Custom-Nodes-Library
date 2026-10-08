# 提示词优化公共契约 K / v1

基线 `a42e85c9701db22b6d4036905657d74e236b84e8`。本契约与计划第 4–8 节共同生效。固定指令唯一代码来源为 `nodes/prompt_optimization/instructions.py`；计划第 5 节完整正文及 Q01–Q08 标准纳入本契约。共同请求 fixture 为 `tests/fixtures/prompt-optimization/requests.json`（九个输入，不是模型输出）。

## 服务 DTO

所有方法请求/响应携带 `contractVersion:1`，错误返回可展示的 `error`。端点前缀 `/daelab/prompt-optimization/`。JS 导出 `createPromptOptimizationApi({fetchApi})`，方法名与端点相同，接受一个对象。

`target={documentId,tableId,recordId,fieldId}`。表级 target 只有前两项。ID 是序列化 UUID；nodeId 不作为身份。`instanceId` 为面板挂载期 UUID。

`snapshot={contractVersion,target,revision,requestSeq,snapshotDigest,model,requirements,purpose,instructionVersion,instructionDigest,inputVersion,maxOutputTokens,input,inputText}`。input 精确遵循计划 5.3；inputText 是它的紧凑 Unicode JSON。snapshotDigest 是本地完整规范化快照的 SHA-256，包含引用结构/依赖/模板/行覆盖语义；本地结构映射与 URL 不发送 LLM。服务只从唯一固定指令来源构造 instructions，不信任客户端替代指令。输出预算默认 1024 tokens，能力与费率无效必须阻止开始。

- `capabilities({})` → `{models,defaultModel,instructionVersion,instructionDigest,inputVersion,available,reason,price}`。models 以 `{id,label,available}` 表示。
- `estimate({rows:[snapshot],skipped:[{recordId,reason}],model,maxOutputTokens})` → quote `{quoteId,snapshotDigest,status,price,inputTokens,expectedOutputTokens,maxOutputTokens,estimatedCredits,budgetUpperCredits,expiresAt,reason}`。status=`ready|unavailable|expired`；时间 Unix 毫秒。价格携带来源、版本与计价单位。
- `lease({target:{documentId,tableId},instanceId,leaseId?})` → `{leaseId,expiresAt}`。同视图续租；不同活动控制器不能同时控制。租约丢失只保留查询。
- `submit({quoteId,batchId,rows:[{requestId,snapshot}],leaseId,budgetCredits})` → batch；只建立持久化 queued 行。重复身份同内容幂等，不同内容冲突。
- K2 补充：unknown 后的新请求另传 `acknowledgeUnknownRequestIds:[旧requestId]`；仅由 UI 明确确认“可能重复计费”后提供。普通 retry/recover 不隐含该确认。`retry({acknowledgeUnknown})` 只准备新估算，用户再点开始才提交。
- `query/recover({batchId})` → batch `{batchId,rows,stopped,paused}`。行包含 `{requestId,snapshot,status,remoteResponseId,suggestion:{status,text,reason}?,error?,actualCredits:null|number,costEvidence?}`。recover 只能查询已有 ID，不创建响应。
- `permit({batchId,requestId,leaseId,snapshotDigest,revision,requestSeq})` → `{permitId,expiresAt}`。C 紧接当前表格同步检查后请求，许可短时有效且只能消费一次。
- `advance({batchId,requestId,leaseId,permitId})` → batch。B 在同一锁中校验许可/租约/停止/预算，先落盘 submitting 再调用。单批最多一行在途。无许可不能发送。
- `stop({batchId,leaseId})` → batch。只停止本批未发请求，无退款/取消远端承诺。
- `continue({batchId,leaseId,quoteId,budgetCredits})` → batch。必须由用户点击；恢复查询不会自动继续。变更行通过 `skip({batchId,requestId,leaseId,reason})` 标记跳过。

行状态 `queued/preparing/submitting/submitted/polling/succeeded/failed/skipped/stopped/unknown`；建议状态 `valid/unchanged/stale/invalid/applied`。unknown 绝不自动重发，显式新尝试前显示可能重复收费。

## UI 控制器

A 导出 `createPromptOptimizationPanel({controller,container,renderPrompt?})`，返回含 destroy 的对象，订阅状态增量更新，用户正在输入时不重建输入控件。

C 为每个范围持有控制器：`getState(),subscribe(listener),setRequirements(text),setModel(id),estimate(),submit(),stop(),recover(),continue(),retry(),apply(requestId),applyAll(),destroy()`；异步操作失败反映 `state.error`。subscribe 返回取消订阅。controller 不持 DOM，关闭侧栏不停止在途任务，节点释放销毁控制器并暂停剩余调度。

state：`{scope,fieldId,recordId,requirements,model,models,range:{total,processable,skipped:[{recordId,reason}]},quote,busy,error,rows,batchId,permissions:{canEstimate,canSubmit,canStop,canContinue,canRecover,canApplyAll}}`。UI row：`{requestId,recordId,label,before,after,status,suggestionStatus,reason,canApply,actualCredits}`；before/after 为纯文本显示（可由 renderPrompt 增强，不能 innerHTML）。quote 无可信价格时明确不可估算；estimatedCredits 与 budgetUpperCredits 分别展示。

菜单仅调用 `editor.openPromptOptimization({scope:'cell'|'column',fieldId,recordId?,anchor?})`。C 通过 `editor.openTextSide(recordId||'',fieldId,title,build,{kind:'optimization'})` 宿主。A 扩展 kind 使普通编辑/优化/生成互斥呈现但保留独立草稿。菜单积分通过 `editor.promptOptimizationEstimate({scope,fieldId,recordId})` 返回 Promise<quote>，仅估算，禁止提交。

## 本地事务与生命周期

C 独占模型、控制器、宿主装配。修订与最新请求序号存于节点 properties 的 `daelabPromptOptimizationV1` 并使用运行期单调高水位合并；不在整表 history。目标和依赖发生变化（包括撤销回相同正文）递增。应用在 editor.change 同步事务中重新检查身份/字段/修订/请求/指纹，批量只写有效提示词覆盖值，有变化才记一次历史。任务与建议只在服务账本，恢复不依据历史快照的忙碌状态。

文档身份位于 graph.extra；表身份位于节点 properties；复制节点重新生成表身份，产品“创建副本”显式更新文档身份。同一序列化工作流原样拷贝视为同一文档。不能猜文件名。

## 所有权与验证

A/B/C 文件归属遵循计划第 3 节；C 辅助环境代理仅写 tools/prompt_opt_*、docs/prompt-optimization-environment.md、web/vendor/prompt-optimization-shared/。共享契约变更先形成独立提交再同步消费者。

M0–M6、V01–V13、Q01–Q08 不降低门槛。mock 仅证明程序契约，不证明真实效果/费用。所有服务隔离 user/base/database；付费清单需用户授权，合并另需明确授权。
