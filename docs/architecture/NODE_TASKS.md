# 创作画布任务展示接入

公共契约由 Canvas 仓库的 `docs/task-contract.md` 维护。本库只返回 adapter.tasks(node) 的纯数据快照，不导入 Canvas 实现，不构造胶囊 DOM，不复制胶囊样式。

| 业务 | 提供者 | 显示内容 |
| --- | --- | --- |
| 多维表格 / 剧本解析器中的生成列 | table_generation_tasks → task_snapshots | 按图片/视频汇总全部记录，已完成行数、阶段、异常行数；只有一个进行中任务时展示它的真实平台百分比 |
| 提示词优化 | attachPromptOptimization → task_snapshots | 合并已有控制器，按 requestId 去重；已结束行数、准备/等待、当前请求时长、暂停/待处理 |
| 最终提示词解析 | createPromptEditor.tasks | 整批解析总量、等待时长和返回汇总；不伪造逐行完成进度 |
| 文档导入 / AI 归类 | createScriptParserPanel.tasks | 文档读取、字段图片整理、模型等待；实例与请求身份防止旧响应覆盖 |
| LibTV 单条 | libtv_task_snapshots | 监听当前图的 execution_start + executing；当前前端 executing 的 detail 是节点 ID，用 prompt_id 匹配完成/错误/中断；不虚构提交前排队或平台百分比 |
| LibTV 批次 | showBatchReport → libtv_task_snapshots | 已完成行数、当前行生成/恢复、批次待恢复；保存的 running 报告首次显示待核对 |

Canvas 未安装时这些提供者可独立存在，不参与任务提交。新状态只保存在实例闭包/WeakMap，不写入工作流、widget 或 undo。生成行及优化账本仍使用原业务恢复协议；胶囊显示不会重试或计费。

优化账本发现后，以现有 localOnly recover 恢复目标控制器供节点级展示；恢复后的未发送行必须继续遵循原来的费用确认，不自动继续发送。完成提示只对本实例观察到的转换计时，历史成功不重复通知。

UI 验证用独立验收工作流和无收费状态样例；付费模型调用不作为视觉测试的前提。
