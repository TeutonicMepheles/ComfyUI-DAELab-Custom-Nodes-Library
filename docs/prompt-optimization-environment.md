# 提示词优化隔离环境与离线资源

2026-10-08 M0 工程基线。本文记录装配和 HTTP 检查，不代表界面、付费调用或 M6 通过。

## 服务与安装矩阵

| 角色 | URL | 业务工作树 | 安装状态 |
| --- | --- | --- | --- |
| A | http://127.0.0.1:8191 | `C:/Users/Golajah/.codex/worktrees/prompt-opt-ui` | 完全不安装 Creative Canvas；33 个 DAELAB 节点 |
| B | http://127.0.0.1:8192 | `C:/Users/Golajah/.codex/worktrees/prompt-opt-service` | 锁定 Canvas；36 个 DAELAB 节点 |
| C | http://127.0.0.1:8193 | `C:/Users/Golajah/.codex/worktrees/prompt-opt-integration` | 锁定 Canvas；36 个 DAELAB 节点 |

各环境基目录为 `C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/{a,b,c}`。实际业务插件路径为各基目录下的 `custom_nodes/ComfyUI-DAELab-Custom-Nodes-Library`，该目录是指向表中唯一业务工作树的 Junction。联合安装的唯一画布目录是 `custom_nodes/ComfyUI-DAELab-Creative-Canvas`，指向本环境 `dependencies/canvas-785bad3441550f580cb42b7a9532cc0f4ee547f9`，内容来自 `git archive`，未复制生产画布中的未提交文档。

每个基目录独立拥有 `user`、`input`、`output`、`temp`、`user/comfyui.db` 和日志。核心会在显式 temp 目录下再创建 `temp`，实际临时路径为各环境 `temp/temp`。没有传入 extra-model-paths 配置，没有启用 Manager，没有共享生产用户数据、输入、输出、数据库或账号凭据。模型路径也是各自空目录。任务账本应由服务实现放在对应 `user/daelab/prompt-optimization`。

生产 8000 未切换、重启或排队；原进程 162584/136428 的启动时间仍为 2026-10-07 21:52:50（本机时间）。本次只使用隔离环境 GET 请求，付费 POST 次数为 0。

## 锁定版本

- 核心真实目录：`C:/Users/Golajah/AppData/Local/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI`。
- ComfyUI `0.36.0`，完整提交 `7a0b5eede3f9721c8faab290689893f36edc6d66`；核查时工作树干净，无自动加载的 `extra_model_paths.yaml`。
- 前端包 `1.52.7`，显式使用 `C:/Users/Golajah/Documents/ComfyUI/.venv/Lib/site-packages/comfyui_frontend_package/static`。
- Python `3.12.11`，解释器 `C:/Users/Golajah/Documents/ComfyUI/.venv/Scripts/python.exe`。
- torch `2.8.0+cu129`、torchvision/torchaudio `0.23.0+cu129`/`2.8.0+cu129`、aiohttp `3.14.1`、pydantic `2.11.3`、numpy `2.3.5`。
- Canvas `785bad3441550f580cb42b7a9532cc0f4ee547f9`。
- 全部 Python 分发版本和前端入口哈希见 `tools/prompt_opt_runtime_lock.json`；启动脚本检测漂移后拒绝启动，不安装或更新共享依赖。

Desktop 旧 `AppData/Local/Programs/ComfyUI/resources/ComfyUI` 目录仍存在 `0.21.1`，不是本验收使用的核心。环境使用 CPU 模式，不占用生产 GPU。日志中既有 cu130 性能提示不代表本次升级了 torch；本次未修改依赖。

## 可重复装配

在业务仓库运行 PowerShell：

```powershell
./tools/prompt_opt_environment.ps1 -Role a -Canvas none -Start
./tools/prompt_opt_environment.ps1 -Role b -Canvas locked -Start
./tools/prompt_opt_environment.ps1 -Role c -Canvas locked -Start
```

省略 `-Start` 只装配和记录环境。脚本拒绝使用已被占用的端口或错误 Junction；不会停止任何服务，也不会自动删除已有安装。安装模式需要变更时，先核对当前隔离进程与装配 Junction，再由负责人明确停止该隔离进程并移除对应 Junction；不能递归删除真实工作树。启动通过 `Start-Process -WindowStyle Hidden`，日志在环境 `logs`，入口 PID 在 `launcher.pid`。Windows venv launcher 可能另派生实际 Python 进程，停止前须用监听端口反查实际 PID 和命令行。

每次装配生成 `environment.json`，包含业务完整 SHA、未提交状态、路径、全部版本和命令行。开发期间三份工作树正在变化，这些是 M0 启动快照，不能当作最终候选 R 的证据。M6 须对齐候选、重启隔离服务并重新记录。

## 共享资源

历史基线：业务 `web/creative_theme.css` 只转发 `/extensions/ComfyUI-DAELab-Creative-Canvas/creative_theme.css`；`tableIcon` 仅部分图标使用业务本地文件，其余回退到画布 URL。完全未安装画布时这些转发不可用。

本功能离线资源位于 `web/vendor/prompt-optimization-shared`，由脚本生成，不在副本中手写主题。路径如下：

- `creative_theme.css`：锁定画布的原始主题字节。
- `vendor/alibaba-puhuiti-3`：400/500/600 三份原始 WOFF2、原许可证、说明和字体原始 manifest，保持 CSS 相对路径。
- `vendor/remixicon`：锁定画布已有图标和许可证（包含 `arrow-left-right-line.svg`）。
- `vendor/remixicon/sparkling-line.svg`：画布锁定版本没有 AI 图标，因此增加 Remix Icon 官方 `9fb7967c0a4c09910161192bde99efd3df09f5eb` 提交的 `icons/Weather/sparkling-line.svg`；其同提交许可证保留为 `LICENSE-supplemental`。
- `source-manifest.json`：每份原件的来源、提交、字节数和 SHA-256。

```powershell
python tools/prompt_opt_assets.py --canvas-repo C:/Users/Golajah/Documents/ComfyUI/custom_nodes/ComfyUI-DAELab-Creative-Canvas
python tools/prompt_opt_assets.py --check
```

重新装配只读取画布 Git 对象；补充图标按固定官方 SHA 获取。`--check` 完全离线，检查全部 32 份原件、文件集合和原字体 manifest。未复制通用交互逻辑。A 负责在入口和共享控件中加载这些本地资源。

## 已取得的 M0 证据与边界

- 三服务 `/system_stats` 均返回核心 `0.36.0`、前端要求 `1.52.7`。
- 三服务 `OpenAIChatNode` schema 均包含 `gpt-4.1-mini`；未登录、未验证余额或付费模型可用性。
- A `/extensions` 无 Canvas 资源；B/C 仅含锁定 Canvas 和唯一业务插件（另有核心自带扩展）。日志列出相同装配路径，没有业务插件导入失败。
- C 通过 HTTP 读取全部 32 份共享资源，与来源 manifest SHA-256 一致；三份原始字体通过原 manifest 检查。
- 本机原始 JSON：`C:/Users/Golajah/.codex/workspaces/prompt-opt-validation/m0-http-evidence.json`；各环境 `environment.json`、`logs/stdout.log`、`logs/stderr.log`。

字体实际渲染、两个表格的交互、独立／联合 UI 和画布借还尚需 A/C 的真实浏览器验收；HTTP 资源可达与哈希正确不替代上述验收。
