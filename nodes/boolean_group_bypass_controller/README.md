# Boolean Group Bypass Controller

## 节点信息

- 节点 ID：`BooleanGroupBypassController`
- 显示名称：`Boolean Group Bypass Controller`
- 分类：`utils/logic`
- 输入：`boolean`，支持连接 `Boolean List Hierarchy` 或 `Boolean List Hierarchy Get` 的布尔输出
- 输出：无

## 功能

该节点把 `Boolean List Hierarchy` 或其 Get 节点中的一个布尔状态映射到 ComfyUI 可视节点组：

- 默认逻辑：`true` 激活组内全部节点，`false` 将组内全部节点设为 Bypass。
- 可开启“反向逻辑”，交换上述映射。
- 使用 Boolean 条目的稳定 ID 追踪连接；条目改名或排序后不会错绑。
- 使用节点组 ID 持久化目标；组改名后仍保持绑定。
- 支持与 Boolean 祖先关系一致的嵌套节点组；共享成员按 Bypass 优先规则合成。
- 控制器是前端虚拟节点，正常情况下不会进入 API Prompt。

后端仅保留一个无副作用的空执行作为兼容回退。组状态同步、来源解析、冲突检测和界面提示全部在前端完成。

## 使用步骤

1. 添加 `Boolean Group Bypass Controller`。
2. 从 `Boolean List Hierarchy` 或 `Boolean List Hierarchy Get` 拖出目标 Bool，连接到控制器的 `boolean` 输入。
3. 在“目标组”下拉框中选择节点组；也可以把控制器放进目标组后点击“绑定所在组”。
4. 根据需要开启“反向逻辑”。
5. 查看状态栏确认当前为 `ACTIVE` 或 `BYPASS`。

状态栏同时显示当前来源条目和目标组。目标组下拉框会在重名组后附加稳定 ID，避免只靠标题造成误选。

## 层级嵌套

父 Bool 与子 Bool 可以分别绑定外层组和其内部子组。仅当两者来自同一个 Hierarchy、Boolean 条目存在 `parent_id` 祖先关系，并且父组成员包含全部子组成员时，成员重叠才合法。

合法重叠会先汇总全部控制计划，再按以下规则一次性写入节点模式：

- 父 `false`：父组和所有内部子组均为 Bypass。
- 父 `true`、子 `false`：父级专属节点保持 Active，子组为 Bypass。
- 父 `true`、子 `true`：父组和子组均为 Active。
- 三层及更多控制器仍采用同一规则：任意覆盖该节点的控制器要求 Bypass，最终即为 Bypass。

如果不需要让 Controller 直接绑定外层视觉组，也可以完全不使用重叠：外层组只作视觉框，父 Bool 控制父级专属分区，子 Bool 控制互不重叠的子分区。Hierarchy 会在父 Bool 关闭时递归关闭后代 Bool，而父 Bool 重新打开后不会强制打开子 Bool。

## 行为约定

- 控制有效时，组内成员模式由控制器严格接管，手动修改会在下一轮同步时被覆盖。
- 控制器自身以及其他同类控制器不会被切换模式。
- 断开输入、删除控制器或改绑目标时，不再被其他有效控制器覆盖的旧组成员保持最后状态；仍属于上层受控组的成员继续由剩余控制器同步。
- 同一组被多个控制器绑定时始终冲突。
- 兄弟 Bool、不同 Hierarchy、部分交叉或 Boolean 祖先方向与组包含方向相反的成员重叠会使整条相关重叠控制链停止写入并显示冲突。
- “绑定所在组”只在控制器恰好位于一个组内时生效；无组或重叠组需要手动选择。
- 不同工作流画布之间不会互相报告冲突或修改节点状态。

## 应用构建模式联动

控制器改变组内节点模式后，共享的 `web/app_mode_bypass.js` 会同步检查本库节点对应的应用输入。进入 Bypass、Mute 或其他非正常执行模式的节点，其最终应用输入会折叠隐藏；恢复 Active 后按原有 `hidden`、`inert` 和 `aria-hidden` 状态恢复。

该联动覆盖本库注册的普通节点和组合面板节点，不改变 `linearData.inputs` 的持久输入顺序，也不会删除应用构建器配置。控制器本身仍是前端虚拟节点，不会因此进入 API Prompt。

## 限制

组 Bypass 仍遵循 ComfyUI 原生的 Bypass 透传规则。输入输出类型无法透传的复杂拓扑，不能通过本节点改变这一限制。

删除控制器、断开来源或改绑目标不会主动恢复旧组状态；这样可以避免在控制关系消失时意外重写用户刚刚调整的节点模式。

## 测试覆盖

- 后端：强制布尔输入、无输出、虚拟节点的空执行回退和稳定注册 ID。
- 前端：对象/Map 链接解析、Hierarchy/Get 双来源、稳定条目 ID、祖先链、失效 Get 强制 `false`、组 ID、普通/反向映射、三层 Bypass 优先合成、顺序无关性和冲突链检测。

## 相关文件

- 后端注册：`node.py`
- 前端交互：`../../web/boolean_group_bypass_controller.js`
- 纯逻辑模型：`../../web/boolean_group_bypass_controller_model.mjs`
- 应用输入显隐：`../../web/app_mode_bypass.js`
- 应用显隐纯逻辑：`../../web/app_mode_bypass_model.mjs`
- 后端测试：`../../tests/test_boolean_group_bypass_controller.py`
- 前端测试：`../../tests/boolean_group_bypass_controller_model.test.mjs`
