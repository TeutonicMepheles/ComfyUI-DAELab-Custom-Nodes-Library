# Boolean List

## 节点信息

- 节点 ID：`BooleanList`
- 显示名称：`Boolean List`
- 分类：`utils/logic`

## 功能

`Boolean List` 用于在一个节点里维护多组布尔开关，并输出最多 64 个 `BOOLEAN` 端口。前端界面会把开关配置保存到工作流节点属性中，重新打开工作流后可以恢复配置。

## 使用说明

1. 在节点搜索中添加 `Boolean List`。
2. 在节点 UI 中添加、删除或修改布尔项。
3. 将需要的布尔输出连接到后续逻辑节点。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/boolean_list.js`
