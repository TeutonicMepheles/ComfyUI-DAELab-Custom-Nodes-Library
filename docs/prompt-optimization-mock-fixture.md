# MOCK 界面与应用验收种子

这是离线人工状态种子，不是 LLM 效果或真实费用证据；不新增产品 mock 开关。

生成器：`tools/prompt_opt_mock_seed.py` 调用同目录 `.mjs`，通过指定候选中的 `ensureIdentity`、`OptimizationRevisions`、`freezeSnapshot(begin:true)` 建立工作流身份与冻结输入；再用真实 `Service` 加可控传输替身创建独立 SQLite 账本。要求输出 base 尚不存在，拒绝覆盖任何已有目录，不访问运行服务、不读取凭据、不使用原生远端传输。结束时 checkpoint 并关闭 SQLite。

示例命令（Windows PowerShell；目录必须更换为未存在的验收目录）：

```powershell
& C:/Users/Golajah/Documents/ComfyUI/.venv/Scripts/python.exe tools/prompt_opt_mock_seed.py `
  --repository C:/Users/Golajah/.codex/worktrees/prompt-opt-integration `
  --base C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/mock-8194-r2
```

本轮已生成上述 `mock-8194-r2`，来源候选 `a835c847565f7b6c7d6ba1f71df4661ed9d68902`，不要重跑覆盖。`MOCK-manifest.json` 记录实际代码、路径、模拟传输调用、身份与预期结果。

| 文件 / 节点 | 内容 | 实际 UI 检查 |
| --- | --- | --- |
| `MOCK-valid-workflow.json` | 1 条有效建议，提示词继承含文字列引用的列模板 | 打开该格优化入口，查看恢复建议，应用；只创建该行覆盖；撤销恢复继承；重做恢复应用；保存/刷新后从账本找回 |
| `MOCK-batch-workflow.json` | 同一列 3 行：有效、unchanged、stale | 打开整列入口；只第一行可应用，批量应用只产生一次有效编辑事务；其他两行不改变 |
| `MOCK-unchanged-workflow.json` | 1 条原样输出 | 显示未改动，不提供有效应用，不制造行覆盖/空历史 |
| `MOCK-invalid-workflow.json` | 人工删除保护引用标记 | 显示无效及原因，禁止应用 |
| `MOCK-unknown-workflow.json` | 人工提交后响应丢失 | 显示未知及可能费用风险，查询不重发；不得把它记成失败后自动重试 |
| `MOCK-failed-workflow.json` | 人工明确拒绝 | 显示失败，保留原提示词 |
| `MOCK-prompt-optimization-states.json` | 六表合并视图 | 跨实例状态/选择隔离，所有标题都明确标为 MOCK |

文件放在新 base 的 `user/default/workflows/`；单状态文件是同一 MOCK 逻辑文档中不同测试表的独立视图，不用于证明产品“另存为/复制”身份行为。每表有独立 tableId。工作流刻意不保存 batchId 引用，依靠精确 documentId/tableId 从独立账本发现任务。

画布状态显式配置 `active:false`、viewport `{x:40,y:40,zoom:0.65}`、卡片 `width:1100,expanded:true`；组合工作流卡片 x 间隔 1250，避免锁定画布默认间距造成重叠。此为 fixture 布局，不修改画布实现。

生成后已重新读取序列化工作流并用真实模型重新冻结八行：七行摘要完全匹配，仅人为修改引用文字并递增修订的 stale 行不匹配。六批账本均为终态，不存在 queued/preparing/submitting/submitted/polling，所有 actualCredits 为 null，模拟调用总数写入 manifest；真实付费数量为 0。

8194 使用独立 base/user/input/output/temp/database，业务 Junction 指向集成候选，Canvas 指向已锁定资源副本。不要复制账号凭据，不要替换 8193 的活账本。建议启动时把核心 `--comfy-api-base` 指向无远端代理的本机闭合端口（例如 `http://127.0.0.1:18194`），防止在 MOCK 页面误点击新优化后触及付费平台。这是核心已有的隔离启动配置，不是产品 mock 开关。开始实际界面验证前记录服务实际候选；如候选改变影响冻结规则，应在新目录重新生成。

本文件只证明 fixture 生成/一致性检查已完成；应用、撤销、重载、视觉与键盘交互仍须由 C 在真实 ComfyUI 界面执行并记录结果。不得以种子本身替代真实 UI 操作，也不得把人工建议当作 Q01–Q08 模型效果。
