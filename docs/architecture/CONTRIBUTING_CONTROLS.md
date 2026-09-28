# 创作画布控件规范已迁移

共享按钮、字段、主题、字体、原生画布与辅助 Vue 陈列由 [Creative Canvas 仓库](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Canvas) 单独维护。

开发前阅读该仓库的 `docs/architecture/CONTRIBUTING_CONTROLS.md` 和 `docs/adapter-contract.md`。本仓库通过 `web/creative_canvas_adapter.js` 接入自己的面板与操作；不复制画布实现，不读取其他业务节点的私有实现。

表格、分镜、LibTV、展厅和徽章仍属于本仓库。原 App Mode 继续复用本仓库的 `app_mode_bypass.js`，不依赖创作画布安装。ComfyTV 上游始终只读。
