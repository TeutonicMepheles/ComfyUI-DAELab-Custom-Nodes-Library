# 创作画布模式

在现有 ComfyUI 顶部「图形 / 工作流操作」菜单中选择「创作画布」。
通过同一个菜单的「图形」或画布底部「图形模式」返回。主服务刷新前端即可加载；
如果旧服务缺少 DAELAB.Table 或 DAELAB.LibTV.StoryboardBatch，需要先重启该旧服务加载已有后端节点。

## 已接入

- 多维表格与分镜表：原有 `createTableEditor`、素材组、提示词审核、字段映射、撤销重做、导入预览和批次结果回写。
- LibTV：原有 `__libtvPanel`、连接面板、模型参数、批量提交确认、任务恢复、视频回传及 `addVideoToCanvas`。
- ComfyTV：通过已注册节点添加功能，复用原 `comfytv_stage`/`comfytv_project` DOM 面板。
  原生控件之外的可见参数在卡片内编辑；原生运行按钮继续走 ComfyTV 自己的执行路径。
  没有从上游导入运行时模块，没有替换节点注册，也没有改动上游文件。
- 点击输出接口，再点击目标输入连接；双击连线可确认断开。已有输入连接的替换需要确认。
- 拖动卡片标题移动卡片；拖动空白处平移；空白处滚轮缩放；「适应」显示全部卡片。
- 「设置」就地展开/收起控件；「接口」展开参数接口。素材/执行结果可在收起时预览。

## 数据与生命周期

节点输入、连接与执行保持在原 Comfy 图中；创作布局单独保存在
`graph.extra.daelabCreativeCanvasV1`，不会覆盖原节点位置和尺寸。
模式和布局随工作流保存/打开；单纯切换模式不提交生成任务。
未知类型的底层节点仍保留在图中，通过图形模式编辑。

采用 DOM 画布容器直接承载已有控件，避免为表格和 ComfyTV Vue 卡片重写一套状态模型。
`leasePanel` 移动原面板并留下归还标记，保留 Vue Teleport、事件和表格历史；
返回图形、切换工作流时归还控件。延迟的宿主挂载完成后才接管，子对话框使用期间不抢回面板。
新增代码不改变 App Mode 的既有 Bypass/Muted 规则；创作模式中非 Active 卡片不可编辑运行。

## 菜单与图标

当前宿主的工作流操作菜单没有贡献项注册 API。本扩展使用局部兼容适配：
定位 `data-testid=view-mode-toggle`，仅向通过 `aria-labelledby` 关联的菜单添加自身条目。
不依赖中文菜单文案，不覆盖原菜单项。原按钮标签在退出后恢复。
宿主升级如果更改该 DOM 合约，需要重新验收适配；另注册了 `DAELAB.CreativeCanvas.Toggle` 命令。

图标使用本地 Remix Icon `artboard-line.svg`；来源和许可位于 `web/vendor/remixicon/`。

## 验证

```powershell
node --test tests/creative_canvas_model.test.mjs tests/app_mode_bypass_model.test.mjs tests/libtv_canvas_result.test.mjs
node tools/creative_canvas_smoke.cjs <evidence-directory>
```

浏览器脚本连接隔离服务 8199，需要 Playwright，并使用工作区已有的本地 LibTV 示例视频。
它验证菜单进入退出、真实表格编辑、批量设置连接、LibTV 参数、视频播放、拖动、接口连接、
工作流保存重开、两次刷新、窄视口，以及原生 ComfyTV 按钮执行本地抽帧并返回图片。
不提交 LibTV 付费生成；本次没有重新验证外部模型服务。

本轮证据：工作区 `output/DAELab/CreativeCanvas-QA/verification.json` 及同目录截图。
ComfyTV 功能选择器列出当前已注册类型；本轮实际运行验收覆盖视频加载与抽帧，
不代表每一种 ComfyTV 特效、3D、音频和外部模型节点都已逐一验证。
