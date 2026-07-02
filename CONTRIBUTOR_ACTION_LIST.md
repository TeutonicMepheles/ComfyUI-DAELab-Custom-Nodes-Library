# Contributor Action List

这份清单给所有协作者使用，目标是让大家用同一套流程共同开发、提交和同步 ComfyUI 自定义节点。

## 0. 协作原则

- 不直接修改 `main` 分支。
- 每个功能、修复或文档更新都使用单独分支。
- 提交前先从远程 `main` 同步最新代码。
- 节点 ID 发布后不要随意改名，避免破坏已有工作流。
- 新增节点必须同时提交代码、README 和必要的测试说明。

## 1. 第一次参与项目

1. 安装 Git 或 GitHub Desktop。
2. 克隆仓库到 ComfyUI 的 `custom_nodes` 目录：

   操作位置：Windows 开始菜单打开 **PowerShell**，不要使用 `cmd`。
   说明：下面的 `<ComfyUI>` 要替换成你自己的 ComfyUI 路径，例如 `C:\Users\你的用户名\Documents\ComfyUI`。

   ```powershell
   cd <ComfyUI>\custom_nodes
   git clone https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library.git
   cd ComfyUI-DAELab-Custom-Nodes-Library
   ```

3. 重启 ComfyUI Desktop，确认现有节点可以搜索到。
4. 阅读：
   - [README.md](./README.md)
   - [CONTRIBUTING.md](./CONTRIBUTING.md)
   - [templates/new_node/](./templates/new_node/)

## 2. 开始开发前

以下命令都在 **PowerShell** 中执行。先进入节点库仓库目录：

```powershell
cd <ComfyUI>\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

说明：`<ComfyUI>` 要替换成你自己的 ComfyUI 路径。

1. 切回 `main`：

   ```powershell
   git checkout main
   ```

2. 拉取最新代码：

   ```powershell
   git pull
   ```

3. 创建自己的功能分支：

   ```powershell
   git checkout -b feature/add-my-custom-node
   ```

分支命名建议：

- `feature/add-xxx-node`：新增节点
- `fix/xxx-node-bug`：修复问题
- `docs/update-xxx-readme`：更新文档
- `refactor/xxx-node-structure`：重构

## 3. 新增节点时

1. 从模板复制新节点目录：

   操作位置：PowerShell，且当前目录必须是 `ComfyUI-DAELab-Custom-Nodes-Library`。

   ```powershell
   Copy-Item -Recurse .\templates\new_node .\nodes\my_custom_node
   ```

2. 修改 `nodes/my_custom_node/node.py`：
   - 改类名。
   - 改节点 ID。
   - 改显示名称。
   - 定义输入、输出、分类和执行逻辑。

3. 修改 `nodes/my_custom_node/__init__.py`，通常保持模板默认内容即可。
4. 修改 `nodes/my_custom_node/README.md`，用中文写清楚：
   - 节点 ID
   - 显示名称
   - 分类
   - 输入/输出
   - 使用步骤
   - 示例或截图

5. 如需插图，把图片放进：

   ```text
   nodes/my_custom_node/assets/
   ```

6. 如需前端扩展，把 JS 放进：

   ```text
   web/my_custom_node.js
   ```

7. 更新根目录 `__init__.py`，把新节点加入统一注册。
8. 更新根目录 `README.md` 的节点列表。

## 4. 提交前自检

在 ComfyUI 根目录运行编译检查：

操作位置：Windows 开始菜单打开 **PowerShell**，不要使用 `cmd`。
说明：`<ComfyUI>` 要替换成你自己的 ComfyUI 路径。

```powershell
cd <ComfyUI>
.\.venv\Scripts\python.exe -m compileall .\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

然后重启 ComfyUI Desktop，至少确认：

- 节点能在搜索中找到。
- 节点能被创建。
- 节点输入输出符合预期。
- 工作流保存后重新打开不会丢节点。
- README 中图片路径可以在 GitHub 上正常显示。

## 5. 提交代码

以下命令都在 **PowerShell** 中执行。先进入节点库仓库目录：

```powershell
cd <ComfyUI>\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

说明：`<ComfyUI>` 要替换成你自己的 ComfyUI 路径。

1. 查看改动：

   ```powershell
   git status
   git diff
   ```

2. 暂存改动：

   ```powershell
   git add -A
   ```

3. 提交：

   ```powershell
   git commit -m "Add MyCustomNode"
   ```

提交信息建议：

- `Add MyCustomNode`
- `Fix BBoxPromptReroute empty input handling`
- `Update BooleanList README`
- `Refactor prompt preset docs`

## 6. 推送分支

操作位置：PowerShell，且当前目录必须是 `ComfyUI-DAELab-Custom-Nodes-Library`。

```powershell
git push -u origin feature/add-my-custom-node
```

如果使用 GitHub Desktop：

1. 确认当前分支不是 `main`。
2. 在左侧检查改动。
3. 填写 Summary。
4. 点击 `Commit to <branch>`。
5. 点击 `Publish branch` 或 `Push origin`。

GitHub Desktop 中不需要输入上面的 `git push` 命令；点击按钮即可。

## 7. 创建 Pull Request

在 GitHub 页面创建 PR：

```text
feature/add-my-custom-node -> main
```

PR 描述必须包含：

- 改动目的。
- 新增或修改的节点 ID。
- 输入/输出变化。
- 是否需要额外依赖。
- 测试结果。
- 截图或工作流示例，如果适用。

## 8. Review 和合并

- 至少等待仓库维护者检查后再合并。
- 如果收到修改意见，在同一个分支继续提交并 push。
- 不要关闭 PR 后重新开，除非维护者要求。
- PR 合并后，删除远程功能分支。

## 9. 合并后同步本地

操作位置：PowerShell，且当前目录必须是 `ComfyUI-DAELab-Custom-Nodes-Library`。

```powershell
git checkout main
git pull
git branch -d feature/add-my-custom-node
```

GitHub Desktop 替代操作：

1. 切换到 `main` 分支。
2. 点击 `Fetch origin`，如果出现 `Pull origin` 再点击一次。
3. 在 `Branch` 菜单中删除已经合并的功能分支。

如果本地还有未完成开发，先保存或提交当前改动，再切换分支。

## 10. 常见问题

### 我可以直接 push 到 main 吗？

不建议。除非维护者明确要求，否则所有开发都通过功能分支和 PR 合并。

### 我只改 README 也需要开分支吗？

需要。文档改动也走同样流程，方便追踪历史。

### 我的节点需要额外 Python 包怎么办？

在 PR 描述中明确说明依赖名称、用途和安装方式。不要静默引入依赖。

### 我的节点在自己机器可用，但别人不可用怎么办？

优先检查是否依赖了本地绝对路径、私有模型文件、未提交的前端资源或未说明的第三方节点。

### 我不熟悉命令行怎么办？

可以使用 GitHub Desktop 完成分支、提交、推送和 PR。关键规则不变：从 `main` 拉最新代码，创建功能分支，提交后发 PR。
