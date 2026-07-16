# Boolean Group Bypass Controller

## 节点信息

- 节点 ID：`BooleanGroupBypassController`
- 显示名称：`Boolean Group Bypass Controller`
- 分类：`utils/logic`
- 输入：`boolean`，仅支持连接 `Boolean List Hierarchy` 的布尔输出
- 输出：无

## 功能

该节点把 `Boolean List Hierarchy` 中一个条目的前端状态映射到一个 ComfyUI 可视节点组：

- 默认逻辑：`true` 激活组内全部节点，`false` 将组内全部节点设为 Bypass。
- 可开启“反向逻辑”，交换上述映射。
- 使用 Boolean 条目的稳定 ID 追踪连接；条目改名或排序后不会错绑。
- 使用节点组 ID 持久化目标；组改名后仍保持绑定。
- 控制器是前端虚拟节点，正常情况下不会进入 API Prompt。

后端仅保留一个无副作用的空执行作为兼容回退。组状态同步、来源解析、冲突检测和界面提示全部在前端完成。

## 使用步骤

1. 添加 `Boolean Group Bypass Controller`。
2. 从 `Boolean List Hierarchy` 拖出目标 Bool，连接到控制器的 `boolean` 输入。
3. 在“目标组”下拉框中选择节点组；也可以把控制器放进目标组后点击“绑定所在组”。
4. 根据需要开启“反向逻辑”。
5. 查看状态栏确认当前为 `ACTIVE` 或 `BYPASS`。

状态栏同时显示当前来源条目和目标组。目标组下拉框会在重名组后附加稳定 ID，避免只靠标题造成误选。

## 行为约定

- 控制有效时，组内成员模式由控制器严格接管，手动修改会在下一轮同步时被覆盖。
- 控制器自身以及其他同类控制器不会被切换模式。
- 断开输入、删除控制器或改绑目标时，旧组保持最后状态。
- 同一组被多个控制器绑定，或受控组之间存在成员重叠时，相关控制器会停止写入并显示冲突。
- “绑定所在组”只在控制器恰好位于一个组内时生效；无组或重叠组需要手动选择。
- 不同工作流画布之间不会互相报告冲突或修改节点状态。

## 限制

组 Bypass 仍遵循 ComfyUI 原生的 Bypass 透传规则。输入输出类型无法透传的复杂拓扑，不能通过本节点改变这一限制。

删除控制器、断开来源或改绑目标不会主动恢复旧组状态；这样可以避免在控制关系消失时意外重写用户刚刚调整的节点模式。

## 测试覆盖

- 后端：强制布尔输入、无输出、虚拟节点的空执行回退和稳定注册 ID。
- 前端：对象/Map 链接解析、稳定条目 ID、组 ID、普通/反向映射、最小模式写入和冲突检测。

## 相关文件

- 后端注册：`node.py`
- 前端交互：`../../web/boolean_group_bypass_controller.js`
- 纯逻辑模型：`../../web/boolean_group_bypass_controller_model.mjs`
- 后端测试：`../../tests/test_boolean_group_bypass_controller.py`
- 前端测试：`../../tests/boolean_group_bypass_controller_model.test.mjs`
