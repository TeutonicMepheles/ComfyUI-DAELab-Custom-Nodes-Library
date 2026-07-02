# 新增节点维护指南

本文档用于规范后续在本仓库中新增 ComfyUI 节点的流程。目标是让节点代码、说明文档、插图资源和注册入口保持一致，方便协作者同步和维护。

## 1. 新建节点目录

每个节点使用一个独立目录，目录名使用小写蛇形命名：

```text
nodes/my_custom_node/
  node.py
  __init__.py
  README.md
  assets/
    .gitkeep
```

可以从 `templates/new_node/` 复制模板后改名。

## 2. 编写节点实现

`node.py` 至少需要包含节点类、`NODE_CLASS_MAPPINGS` 和 `NODE_DISPLAY_NAME_MAPPINGS`：

```python
class MyCustomNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "DAELab"

    def execute(self):
        return ("Hello from DAELab",)


NODE_CLASS_MAPPINGS = {
    "MyCustomNode": MyCustomNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MyCustomNode": "My Custom Node",
}
```

节点 ID 一旦发布后不要随意修改，否则会破坏已有工作流。

## 3. 添加节点导出

节点目录中的 `__init__.py` 使用固定写法：

```python
from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
```

然后在仓库根目录 `__init__.py` 中导入并合并映射：

```python
from .nodes.my_custom_node import (
    NODE_CLASS_MAPPINGS as MY_CUSTOM_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as MY_CUSTOM_DISPLAY_NAME_MAPPINGS,
)

NODE_CLASS_MAPPINGS.update(MY_CUSTOM_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS.update(MY_CUSTOM_DISPLAY_NAME_MAPPINGS)
```

`WEB_DIRECTORY = "./web"` 不需要修改。

## 4. 前端资源约定

如果节点需要前端扩展脚本，把 JS 放在根目录 `web/` 下：

```text
web/my_custom_node.js
```

前端脚本应通过节点 ID 判断目标节点，例如：

```js
if (nodeData.name !== "MyCustomNode") return;
```

文档截图、流程图和示意图不要放进 `web/`，应放到对应节点目录的 `assets/`：

```text
nodes/my_custom_node/assets/ui.png
nodes/my_custom_node/assets/workflow.drawio.svg
```

README 中使用相对路径引用：

```md
![节点界面](./assets/ui.png)
```

## 5. 编写中文 README

每个节点目录必须包含中文 `README.md`，建议包括：

- 节点 ID
- 显示名称
- 分类
- 输入/输出
- 功能说明
- 使用步骤
- 截图或 Mermaid 示例
- 相关文件

仓库总 README 的节点列表也要同步增加一行。

## 6. 验证

在 ComfyUI 根目录运行：

```powershell
cd C:\Users\Golajah\Documents\ComfyUI
.\.venv\Scripts\python.exe -m compileall .\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

再进行导入验证，确认新节点 ID 出现在 `NODE_CLASS_MAPPINGS` 中。最后重启 ComfyUI Desktop，确认节点可搜索、可创建、可保存到工作流。

## 7. 提交与同步

```powershell
cd C:\Users\Golajah\Documents\ComfyUI\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
git status
git add -A
git commit -m "Add MyCustomNode"
git push
```
