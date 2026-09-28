# 第三阶段：独立共享控件陈列

> 后续范围修订：该独立环境保留为辅助测试；其新样式未被接受为产品基线。主要视觉验收改用[ComfyUI 原生 JSON 陈列](../native-gallery/README.md)，暂不把本环境主题迁入现有节点。

范围遵循 [SCOPE](../SCOPE.md)。日期 2026-09-28。

## 交付

独立 Vue/Vite 工程位于仓库 `frontend/`。六个共享组件已经实现；陈列和组合预览导入同一份组件。未注册真实节点，未修改展厅/徽章 App Mode 或 ComfyTV 上游。

启动和测试见 [frontend/README](../../../frontend/README.md)。组件契约沿用[第二阶段](../phase2/COMPONENTS.md)，当前实际映射为 `frontend/showcase/registry.js`；拟定 icons.ts 使用 icons.js 实现，工程采用 JS，不为单纯类型声明引入额外迁移。

## 验收证据

- [浏览器交互验证](evidence/verification.json)：双实例隔离、模拟生成、键盘、输入法、参数冲突、浮层关闭/焦点、视频暂停、任务状态、资源隔离、窄屏及主题对比度。
- [源码修改传播验证](evidence/source-updates.json)：C02—C06 同一源码样式和行为变化在两实例生效。C01 同类验证记录在浏览器交互报告中。所有临时修改已还原。
- [构建版本浏览器验证](evidence/production.json)：构建后的独立页面重复通过交互检查，未运行开发期源码修改测试。
- [范围与构建核验](evidence/scope.json)：旧运行文件哈希对比及构建信息。
- [组合预览](evidence/canvas.png)、[组件陈列](evidence/components.png)、[窄屏](evidence/narrow.png)。

复用选择：直接复用原有纯视口数学和本地 Remix 图标；保留既有表格/Prompt/任务实现。新 Vue 容器避免从旧 DOM 控件引入宿主状态与全局样式，不改旧调用方。

## 验证边界

当前页面使用内存示例数据，刷新重置。独立环境测试限制网络只允许本地陈列服务器，未依赖 ComfyUI；没有停止用户正在使用的服务。没有执行远端生成或验证工作流加载。真实节点接入、保存重开及跨模式恢复待第四阶段；不能把独立环境报告解释为真实宿主验收。

本阶段测试了指定主题色组合的计算对比度，不等于全部可访问性认证。后续若新增主题、状态或消费方，需补对应验证。
