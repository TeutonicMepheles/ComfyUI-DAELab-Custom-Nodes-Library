# ComfyUI 工作流版本管理

这个 Git 仓库用于保护本机 ComfyUI 工作流编辑，默认只跟踪：

- `user/default/workflows/**/*.json`
- `user/default/comfy.settings.json`
- 这个版本管理说明、辅助脚本和 Git 钩子

模型、输出图片/视频、输入素材、缓存、虚拟环境和 `custom_nodes` 第三方节点源码不会进入这个外层仓库。

## 日常流程

编辑前保存一个稳定点：

```powershell
.\tools\git-save-workflow.ps1 "Before editing workflow"
```

编辑后查看改了什么：

```powershell
git status --short
git diff -- user/default/workflows
```

确认没问题后提交：

```powershell
.\tools\git-save-workflow.ps1 "Update workflow"
```

只撤销某个工作流文件到上一次提交：

```powershell
git restore -- user/default/workflows/你的工作流.json
```

查看历史：

```powershell
git log --oneline -- user/default/workflows
```

恢复某个历史版本时，先找到提交号，再执行：

```powershell
git restore --source <提交号> -- user/default/workflows/你的工作流.json
```

## 临时试验分支

做风险较高的实验前，可以新建分支：

```powershell
git switch -c experiment/my-workflow-change
```

实验成功后可以继续提交；实验失败时切回主分支：

```powershell
git switch main
```

