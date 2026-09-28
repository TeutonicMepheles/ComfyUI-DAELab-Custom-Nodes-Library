# 最小设计与交互规范 v0.1

> 后续修订：用户指出独立陈列偏离现有创作画布样式。本页拟定色值/尺寸暂不作为产品迁移目标，以[原生 JSON 陈列](../native-gallery/README.md)为视觉基准重新校准；通用数据隔离和生命周期约束继续保留。

> 范围以[本轮改造范围](../SCOPE.md)为准：仅现有创作画布及相关节点；展厅、徽章 App Mode 不调整。

## 现状盘点

源码路径相对于仓库根目录；本表是直接读取当前代码得到的样本，不是全部 CSS 声明的统计。

| 来源 | 当前实现 | 处理决定 |
| --- | --- | --- |
| `web/creative_canvas.css` | 背景 #111214、卡片 #1c1d20、圆角 14px、焦点 #a5b4fc、system-ui 13px；媒体 contain | 作为画布基线；提取语义变量，保留媒体完整展示 |
| `web/daelab_studio_theme.mjs` / studioTheme | 背景 #17191c、强调 #b6ecd8、12px 字体、圆角 6/12px，大量 !important | 旧实现暂保留；迁移控件取消对旧全局覆盖的依赖 |
| `web/table_workbench_theme.mjs` / workbenchTheme | 按钮最小 30px；表格内容 14px；工作台 96vw/94vh；700px 断点 | 保留紧凑/舒适密度概念，尺寸由容器约束 |
| `web/list_editor_controls.mjs` / createIconButton | 24px 按钮、15px SVG、内联颜色、disabled 透明度 .35 | 复用可访问名称与画布事件隔离意图，提取共享行为；不复制 SVG 字符串为新图标 |
| `web/data_table_editor.mjs` / tableButton、tableDialog | 按钮阻止画布点击传播；原生 dialog；媒体 Enter/Space 打开预览 | 提取通用按钮/浮层；保留原生语义，补焦点返回和统一状态 |
| `web/creative_canvas_view.mjs` / createCreativeCanvas | 标题拖卡片、空白区平移、背景滚轮缩放；卡片内部滚动不缩放 | 保留这套操作分工；拆出容器行为 |
| `web/libtv_panel.js` / `web/libtv_batch_panel.mjs` | 节点参数与后端事件混合，交互区域阻止画布事件传播 | UI 提取后通过事件请求动作；任务和参数权威仍在控制器/后端 |

## 设计变量

拟定唯一入口 `frontend/src/design/tokens.css`，作用域 `.dae-ui`。下表为默认深色主题；消费方使用变量名称，不复制色值。统一主题变更影响已迁移实例，不影响只读上游面板。

| CSS 变量（前缀 --dae-） | 默认值 | 用途 |
| --- | --- | --- |
| bg-canvas / surface / surface-raised | #111214 / #1c1d20 / #25272b | 背景、卡片、浮层/控件 |
| surface-hover / border / border-control | #353840 / #393b40 / #737780 | 悬停、分隔线、可交互边界 |
| text / text-muted / text-on-accent | #e8e9eb / #a1a4ad / #171821 | 主文字、说明、强调按钮文字 |
| accent / focus | #a5b4fc / #a5b4fc | 主操作、焦点环 |
| success / warning / danger / info | #a4ddcb / #f2ca84 / #ffaaa8 / #b1cbfa | 状态文字，必须同时有文字标签 |
| space-1 / 2 / 3 / 4 / 6 | 4 / 8 / 12 / 16 / 24px | 布局间距 |
| radius-control / card / overlay | 8 / 14 / 12px | 控件、卡片、浮层 |
| font-family | system-ui, "Microsoft YaHei", sans-serif | 使用本机字体；不新增字体分发依赖 |
| font-caption / body / title | 12 / 14 / 16px | 说明、正文、卡片标题；行高 1.5 |
| control-height / control-height-compact | 36 / 32px | 默认/紧凑控件；图标点击区域同高 |
| icon-size / icon-size-compact | 18 / 16px | 图标尺寸，统一 Remix line 风格 |
| focus-width / focus-offset | 2 / 2px | 键盘焦点轮廓，不能只换颜色 |
| duration-fast | 120ms | 悬停/显隐；减少动态效果设置下为 0 |
| layer-card / floating / modal / notice | 0 / 20 / 40 / 60 | 仅在 DAELab 所拥有层内排序；宿主层级由适配器协调 |

原生 dialog/top layer 不能仅靠这些 z-index 管理；浮层应挂在所属 modal 内，宿主集成阶段验证遮挡和键盘焦点。色值尚未通过浏览器对比度实测；第三阶段按正常文本 4.5:1、关键控件边界/焦点 3:1 的项目验收目标检查实际组合，失败则调整变量，不能标记为已经达标。

全局变量由 design 维护。实例允许 label、size、density、variant、媒体比例/contain；禁止局部重定义 accent、内部按钮样式或私自隐藏焦点环。业务状态只能通过契约传入。响应式：以容器宽度决定换行，320px 宽卡片可操作；浮层最大宽度为视口减 24px，表格可内部横向滚动，整页不产生意外横向滚动。

## 共同行为

| 状态 | 视觉与行为 |
| --- | --- |
| default / hover | 中性底色，hover 只作用于可操作控件，不改变布局 |
| focus | :focus-visible 2px 外框；有文本标签或 aria-label；Tab 顺序跟随阅读顺序 |
| disabled | 原生 disabled 或对应可访问语义；不发出动作；相关说明可在邻近文本读取 |
| busy | 保留按钮尺寸和标签，附“处理中”；拦截重复提交，忙碌不自动等于远端不可取消 |
| error | 紧邻错误文字与可行恢复动作；不只用红色；不自动发起新的付费请求 |
| empty | 说明缺失内容及有效动作；不展示别的实例或旧输出作为替代 |
| inactive node | 遵守共享 App Mode Bypass；创作画布内容不可操作，恢复时保留原状态 |

键盘：原生按钮 Enter/Space；输入保留正常编辑与中文输入法组合过程，组合期间 Enter 不提交；多行 Enter 换行。Escape 先关闭最内层浮层，再取消待连线，不能顺带清空内容。删除快捷键只在画布聚焦且不在文本编辑/浮层中时处理。输入草稿在明确提交时进入业务历史；失焦提交规则由 C02 统一定义。

指针：仅标题拖拽区域可移动卡片，按钮/输入/视频控件不启动拖拽；5px 移动阈值后开始拖动；释放、pointercancel、卸载均清理 capture。卡片内部滚轮滚内容，不传播为画布缩放；空白区左键平移、滚轮以光标为中心缩放。提供缩放/复位按钮，操作不只依赖手势。表格重排继续使用表格自己的句柄。

浮层：卡片参数默认使用锚定浮层，展开在视口内；素材大预览和需要确认的破坏操作使用模态。模态约束焦点并返回触发器；触发器已删除时返回所属画布。显式表单有未保存草稿时，外部点击不丢弃，关闭需选择保存/放弃/继续；即时提交参数没有这种草稿确认。非模态普通参数浮层外部点击可关闭。

媒体：默认 contain，比例槽只限制容器；缩略图可显式 cover，但完整预览保持 contain。视频不自动播放，切出可见上下文/关闭/卸载时暂停；加载失败显示本实例来源和重试。输入引用与生成输出分别标记，取色必须展示实际来源。

## 图标目录

复用本地 `web/vendor/remixicon/`，保留同目录 LICENSE 和 README。已核对存在以下资源，本轮未下载图标、未更改许可；实施分发时一并保留完整许可文本。

| 语义 | 现有文件 | 使用位置 |
| --- | --- | --- |
| creative-canvas | artboard-line.svg | 模式菜单 |
| upload | upload-2-line.svg | 素材导入 |
| media-library | folder-image-line.svg | 素材入口 |
| move-up / move-down | arrow-up-line.svg / arrow-down-line.svg | 适用的排序控件 |
| delete | delete-bin-line.svg | 删除动作 |

拟定 `frontend/src/design/icons.ts` 做语义映射，源资源保持唯一，不在各组件粘贴 SVG。关闭、播放、重试等未入库图标暂用文字按钮；第三阶段如需新图标，从批准的 Remix/Phosphor 官方资源补充来源记录和许可，不能用手绘 SVG 或 Unicode 符号冒充已入库图标。同一界面优先 Remix line。
