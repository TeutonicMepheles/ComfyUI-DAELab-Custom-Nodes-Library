# Boolean List Hierarchy Get

## 节点信息

- 节点 ID：`BooleanListHierarchyGet`
- 显示名称：`Boolean List Hierarchy Get`
- 分类：`utils/logic`
- 输入：无可见输入
- 输出：所选 Root 分支对应的动态 `BOOLEAN` Socket，后端固定保留 64 路

## 功能

该节点以无连线方式引用同一工作流中的 `Boolean List Hierarchy`：

1. 在 `Source` 中选择来源节点。只有一个来源时会自动绑定。
2. 在 `Root branch` 中明确选择一个根项；即使只有一个根项也不会自动选择。
3. Get 节点按 Root → 子项 → 孙项的界面顺序生成输出 Socket。
4. `Include Root` 默认开启；关闭后只输出所选 Root 下的子项和孙项。

来源节点和根项都使用稳定 ID 保存，不依赖显示名称。来源节点重命名、条目重命名或同级排序后，Get 输出会自动更新，并按稳定条目 ID 保持已有连线。

## 自动同步

- 新建节点或未选择 `Root branch`：不显示任何 Boolean 输出 Socket。
- 新增子项或孙项：自动增加输出。
- 删除条目：移除对应输出；其他输出连线保持。
- 移动或重命名：输出顺序和名称同步，连线跟随稳定 ID。
- Bool 值、互斥关系、祖先状态或跨分支依赖变化：同步到隐藏快照并参与下一次执行。
- 来源节点或所选 Root 暂时不存在：保留最后的 Socket 结构，但所有输出强制为 `false`，状态栏显示错误。
- 主动切换来源或 Root：按新分支重建输出；不匹配的旧输出会断开。
- Get 的任意 Boolean 输出可以直接连接 `Boolean Group Bypass Controller`。

来源轮询只在存在 Get 节点时运行，并且只在状态实际变化时更新工作流。

## 执行与兼容

Get 节点没有可见数据连线。前端将所选完整分支以及该分支所需的跨分支前置条目写入隐藏 `config_json`；额外约束条目不生成输出 Socket。因此即使来源 Hierarchy 不在当前执行链中，后端也能复核依赖并输出快照值。

Python 后端会再次执行依赖、互斥和递归祖先级联，然后按照 Get 的动态输出顺序返回值。快照格式升级为版本 2，同时兼容版本 1；未显示的固定输出补为 `false`。现有 64 路输出协议及旧工作流无需迁移。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/boolean_list_hierarchy_get.js`
- 纯逻辑模型：`../../web/boolean_list_hierarchy_get_model.mjs`
- 后端测试：`../../tests/test_boolean_list_hierarchy_get.py`
- 前端测试：`../../tests/boolean_list_hierarchy_get_model.test.mjs`
