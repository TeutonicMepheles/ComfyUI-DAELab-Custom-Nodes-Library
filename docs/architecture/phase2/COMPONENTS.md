# 首批组件目录与契约 v0.1

> 范围以[本轮改造范围](../SCOPE.md)为准：仅现有创作画布及相关节点；展厅、徽章 App Mode 不调整。

所有入口均为拟定，尚未建立文件或接入产品。统一位于 `frontend/src/ui/`，由 UI 模块维护；画布坐标和任务逻辑分别由 behaviors/application 管理。每项都有独立陈列案例，引用本组件源码，禁止复制。实例 props 只读，事件由拥有数据的控制器处理，组件不写 graph、widgets、任务账本。

## 复用与消费登记

| ID / 唯一拟定入口 | 已评估实现与决定 | 拟接入消费方 | 陈列 / 更新用例 |
| --- | --- | --- | --- |
| C01 ActionButton.vue | tableButton 与 createIconButton：提取原生按钮语义、标签和事件隔离；样式用 tokens | 表格工具栏、生成面板、卡片操作 | 双实例、busy、disabled、图标；U01/U02 |
| C02 ParameterField.vue | libtv_panel 参数与表格输入：复用字段校验思路，通用输入不嵌表格导航和模型能力请求 | 视频模型参数、卡片文本参数 | 文本/数字/选择/多行、无效值；U01/U03 |
| C03 OverlaySurface.vue | tableDialog、createWorkbench、showExistingPanel：提取容器和焦点生命周期，旧面板搬运留在适配器 | 卡片参数浮层、媒体预览、表格工作台 | modal/popover、嵌套、触发器删除；U01/U04 |
| C04 MediaPreview.vue | 表格 previewAsset、画布媒体、LibTV video：提取展示/暂停；合法 URL 校验和结果映射留在适配器 | 生成结果卡、素材卡、表格预览 | 图片/视频、空/加载/失败、输入/输出；U01/U05 |
| C05 TaskStatus.vue | storyboard_task_state 与批量报告：复用状态计算，展示层不解析任务账本 | 生成卡片、批处理摘要 | 所有任务状态、恢复操作；U01/U06 |
| C06 CanvasCard.vue | createCreativeCanvas：提取标题/插槽/选中/折叠，宿主面板租借和图连接留在适配器 | 素材卡、生成卡、表格卡 | 双卡片、折叠、非 Active、窄容器；U01/U04 |

现有模块路径：`web/data_table_editor.mjs`、`web/list_editor_controls.mjs`、`web/libtv_panel.js`、`web/table_workbench.mjs`、`web/creative_canvas_view.mjs`、`web/storyboard_task_state.mjs`、`web/libtv_batch_panel.mjs`。不提取新的完整表格编辑器；保留 createTableEditor 和独立纯模型。

## C01 ActionButton

- props：label 必填；icon 为已登记语义 key；variant=secondary|primary|danger|ghost（默认 secondary）；size=normal|compact；disabled=false；busy=false；iconOnly=false。
- event：activate。一次用户激活只产生一次事件；busy/disabled 都不发出。iconOnly 仍需 label 作为可访问名称。
- 无业务插槽；图标由映射管理。允许 variant/size，禁止覆盖 padding、focus、disabled 或点击逻辑。
- 默认/hover/focus 使用 DESIGN；busy 保留 label，error 由相邻表单/状态显示，空 label 是无效配置而非空按钮。

## C02 ParameterField

- props：fieldId、label、kind=text|multiline|number|select|toggle、value；options 为稳定 value/label；min/max/step；disabled、readonly、busy；error、hint；commitMode=blur|explicit（默认 blur）。
- events：commit({fieldId,value})、cancelDraft。value 是外部权威值；输入草稿仅属当前实例。合法失焦或单行 Enter 提交一次；multiline Enter 换行，失焦提交；显式模式由表单按钮请求提交。
- 非法数字不发送，保留草稿与错误；Escape 丢弃未提交草稿回到 value。外部 value 在脏草稿期间改变时显示冲突，要求使用新值或重新提交，不能静默覆盖。中文 composition 结束前不提交。
- 选择控件可显示空 options 和不可用原因；当前保存值不在 options 时显示“不再可用”并阻止新提交，不偷偷替换模型。异步 options 由功能模块提供。
- 允许 density 和末尾单位文本；不允许插槽替换核心输入。表格专有 Tab/方向键导航由表格容器适配，不能污染独立字段。

## C03 OverlaySurface

- props：open、title、mode=popover|modal、anchor（popover 必须）、closePolicy=immediate|guarded、busy=false；默认 immediate。插槽 content/actions。
- events：requestClose({reason:escape|outside|button|anchorLost})、afterClose。open 由调用方控制；guarded 通过调用方的保存/放弃/继续选择决定是否关闭。busy 不自动锁住整个页面。
- modal 约束焦点，popover 不设置 aria-modal；Esc 只作用于最上层。打开后聚焦首个合理操作或标题，关闭返回触发器。锚点消失时请求关闭并由适配器清理，不留悬浮窗口。
- 内容 loading/error/empty 由内容插槽提供；容器始终保留可识别标题及关闭路径。内部滚动不缩放画布。表格工作台是此容器的组合，不是另复制一个 dialog。

## C04 MediaPreview

- props：asset={id,kind:image|video,url,name,role:input|output} 或 null；fit=contain|cover（默认 contain）；disabled=false。url 必须由适配器验证；组件不可接受任意 HTML。
- events：requestExpand(assetId)、loadError({assetId,reason})、requestRetry(assetId)。点击缩略图/Enter/Space 请求展开；视频播放控件点击不同时触发展开。
- 状态：empty 提示选择素材，loading 保持容器尺寸，ready 展示，error 显示失败和可用重试；disabled 禁止新操作并暂停。
- slot caption，仅补充文字。切换 assetId/url 时清除旧加载状态并暂停旧视频；不串用别的素材。卸载、关闭所属浮层或所属视图隐藏时暂停，由 visibility 行为明确传递，不能只依赖 CSS 隐藏。

## C05 TaskStatus

- props：state=idle|validating|queued|running|succeeded|failed|stopping|stopped|unknown；message；progress 可缺省；capabilities={canResume,canRetry,canStopPending} 全部默认 false。
- events：resume、retry、stopPending。请求身份、何时可执行及二次确认由应用层负责；retry 不等于 resume，不由展示组件生成 requestId。
- 无进度时显示阶段文字，不虚构百分比；unknown 显示“状态待核对”，只提供允许的核对/恢复，不宣告失败并新建任务。stopped 仅表示未提交项停止，远端运行项状态独立保留。
- 无可用操作时纯展示；状态区使用克制的 aria-live，不逐帧播报。actions 插槽只能放已授权动作；不能自行请求后端。颜色对应 DESIGN 语义且附文字。

## C06 CanvasCard

- props：cardId、title、selected=false、collapsed=false、active=true；插槽 media/content/actions/ports。events：select、requestCollapse、dragStart/dragMove/dragEnd（局部交互意图）。
- 位置、缩放、连线和持久化由画布控制器管理。坐标转换由共享 behavior 处理，组件不写真实节点 pos/size。标题 5px 阈值后拖动，操作区不拖动；结束只提交一次历史命令。
- 空内容给明确占位；错误由内容或 TaskStatus 展示；hover 不抖动尺寸；selected 边框、focus 环区分。collapsed 保留标题/摘要；非 Active 内容 inert，选择及恢复入口由宿主管理，不创建第二套 Bypass 规则。
- 允许宽度约束和插槽组合，不允许覆盖内部标题拖动规则。提供显式“移动”操作进入键盘定位：方向键每次移动 8 个画布单位、Enter 确认、Escape 撤销；只有定位模式消费方向键，不抢输入焦点。

## 更新与兼容矩阵

| 变更 | 生效与复核 | 实例数据 |
| --- | --- | --- |
| token/视觉 | 改唯一变量，检查所有登记消费方含窄屏/状态 | 不改数据 |
| 共享行为 | 改唯一组件或 behavior，运行对应 U 用例及消费方冒烟 | 不改参数；事件契约保持兼容 |
| 默认值 | 仅无显式值实例采用新默认；记录默认变更 | 保存值保留，不用 truthy 判断覆盖 0/false/空字符串 |
| props/events 破坏变更 | 更新契约版本与消费清单，必要时迁移期适配 | 不默默丢字段 |
| 持久化格式 | 显式 schema 迁移、旧格式读取、保存重开验证 | 保持身份与原数据；不可逆变化另定回退 |

陈列参数编辑只改示例实例，不回写全局源码。组件注册表记录 source、consumer、status=planned|integrated|legacy；实现时同步更新。缓存/构建版本由适配层负责，第三/四阶段证据必须包含实际加载版本。
