# 提示词优化服务同版本无付费验证

日期：2026-10-08（Asia/Shanghai）。执行者：B。证据代码为 `73f15a21333c86c934cfdbdf192b9fa24168c1ab`；本记录是后续仅文档提交，不改变被测实现。本轮未执行任何真实付费请求，不能替代 V12/V13。

## 环境与隔离

| 项目 | 实际值 |
| --- | --- |
| 服务 | `http://127.0.0.1:8192` |
| 业务工作区 | `C:/Users/Golajah/.codex/worktrees/prompt-opt-service`，detached HEAD，启动及测试时工作区干净 |
| 业务插件装配 | `C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/b/custom_nodes/ComfyUI-DAELab-Custom-Nodes-Library`，Junction 指向上述唯一业务工作区 |
| 核心 | `C:/Users/Golajah/AppData/Local/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI`，`7a0b5eede3f9721c8faab290689893f36edc6d66`，ComfyUI `0.36.0` |
| 画布 | 锁定 `785bad3441550f580cb42b7a9532cc0f4ee547f9` 的独立装配副本，资源散列通过装配脚本检查 |
| 前端 | `1.52.7`，index SHA-256 `7BEA16054E79EC0090872257149ABF2BC402704DFA92C2556DB7499795EEB726` |
| Python | `C:/Users/Golajah/Documents/ComfyUI/.venv/Scripts/python.exe`，`3.12.11` |
| 关键依赖 | aiohttp `3.14.1`，pydantic `2.11.3`，torch `2.8.0+cu129`；隔离服务使用 CPU |
| 独立数据目录 | `C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/b/{user,input,output,temp}` |
| 账本 | 上述 `user/daelab/prompt-optimization/ledger.sqlite3` |

重启前逐个核验进程命令行同时包含 port `8192` 与确切 base `.../prompt-opt-validation/b`；仅停止匹配的 Python 启动器/子进程。使用 `tools/prompt_opt_environment.ps1 -Role b -Canvas locked -Start` 重启。启动日志明确仅加载两份预期插件，未触碰生产 `8000` 或其他角色服务。最终启动器 PID 为 `180596`（仅当次定位证据，不作为未来停止依据）。

## 检查结果

| 检查 | 方式与观察 | 结果 |
| --- | --- | --- |
| 服务账本、停止、幂等、租约与恢复 | `python -m unittest discover -s tests -p test_prompt_optimization.py -v`，22 项通过；含提交丢 ID→unknown、已有 ID 仅 GET、部分成功保留、同表不同批次串行、单次许可、失联显式继续、稳定身份只读发现 | 通过，传输替身 |
| 前端 API 边界 | `node --test tests/prompt_optimization_api.test.mjs`，2 项通过；临时账户凭据仅在本机 header，不入 DTO；失败不隐式重试 | 通过，fetch 替身 |
| 原生传输 | `tests/native_prompt_optimization_probe.py` 指向上述真实核心；原生 `sync_op_raw` 实际访问随机 loopback 端口 | 通过，远端服务为本地替身 |
| 原生请求装配 | 固定 instructions、单个 user/input_text JSON、max_output_tokens=1024 原样到达 loopback；独立 GET 查询 ID | 通过 |
| POST 重试 | loopback 返回 503；请求序列严格 `POST, GET, POST`，第二个 POST 没有自动重发；max_retries 与 max_retries_on_rate_limit 均为 0 | 通过 |
| 费用证据与脱敏 | 捕获替身 `X-Comfy-Credits-Used`；原生日志写入 `***`，不含 dummy 凭据。22 项服务测试同时验证重复查询不累加回执 | 通过，非真实账单 |
| HTTP 注册与模型能力 | 8192 实际 `capabilities` 返回三个原生可用且有可信积分费率的 gpt-4.1/mini/nano，默认 mini 未被替换 | 通过，真实本地服务 |
| HTTP 估算与本地任务 | `estimate → lease → submit → submit → query(batchId) → query(target) → query(other document) → stop → recover` 全部 200 | 通过，真实本地服务 |
| HTTP 安全边界 | 两行初始均 queued，重复 submit 复用 batchId，停止后两行均 stopped；remoteResponseId 始终 null，actualCredits 始终 null，新增原生 API 日志 0 | 通过；未调用 advance |
| 身份发现 | 没有工作流 batchId 引用时，target 精确发现原批次；改变 documentId 后返回空列表 | 通过 |

本地 HTTP 检查共 10 次；不提供真实账户凭据，不创建提交许可、不调用 advance。原生探针的 3 次网络操作全部到 loopback，真实 Partner POST 数量为 0。

## 价格与估算证据

服务直接读取 [Comfy Partner 官方积分价格表](https://docs.comfy.org/tutorials/partner-nodes/pricing#chat)，本轮返回每百万输入/输出 token：mini `84.4/337.6`，4.1 `422/1688`，nano `21.1/84.4`。价格没有用其他供应商美元直连价格替代。官方 markdown 留存散列为 `5ACE4F4104CA3D3DB8EFBA336E924E8902FE5A51F80CA3C95EA4CD132CC2E403`。

两行测试快照的完整输入保守估算为 `7092` tokens，预计输出 `122` tokens，最大输出预算合计 `2048` tokens；积分估算 `0.639752`，预算上界估算 `1.289970`。计数算法明确为 UTF-8 字节保守估算，加 32 个消息开销估算；不是准确 tokenizer 计数或真实消耗。输入包含唯一固定指令与完整 JSON。该测试没有 LLM 输出。

首次 capabilities 曾因官方站短暂 TLS EOF 返回 price=null / available=false。相同 Python 的独立读取也复现 `URLError(SSLEOFError)`，随后 curl 与 urllib 都恢复 HTTP 200。该次正确阻止开始，没有建付费请求；保留此失败观察，没有注入固定费率。确认站点恢复后，同 SHA 重启 8192 清除五分钟失败缓存，完整 HTTP 检查通过。此事实属于外部网络瞬时不可用，不能宣称离线仍能取得当前价格。

## 本地原始证据

以下文件位于 `C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/b/`，不在插件/生产目录。归档工作区前应一并保留：

- `environment.json`：完整启动参数、代码/依赖/资源版本、启动时干净状态。
- `logs/stderr.log`、`logs/stdout.log`：真实装配与启动日志；检查的两份日志未发现测试凭据。
- `evidence/service-tests-73f15a2.log`、`evidence/api-tests-73f15a2.log`：22+2 项测试输出。
- `evidence/native-probe-73f15a2.json`：原生 loopback 探针观察记录；原探针在临时目录验证日志脱敏后清理该临时目录。
- `evidence/http-service-probe-73f15a2.py`、`evidence/http-service-73f15a2.json`：可重跑的无付费 HTTP 检查和实际结果；本轮测试 batchId 为 `4488b5af-bff1-4a8f-8a09-abb90efaa549`。
- `evidence/privacy-environment-73f15a2.json`：日志/账本检查和依赖摘要。账本未包含 auth_token_comfy_org、api_key_comfy_org、Authorization 字段。
- `evidence/official-pricing-73f15a2.md`：本轮官方公开费率正文。

## 尚未由本记录证明

V12 的真实单格/整列调用、可归因真实费用、V13 的 Q01–Q08 模型效果，以及前端真实界面/应用事务验收不属于本轮服务复验结果。不得把本地替身回执或上述无付费任务计作真实付费验收通过。
