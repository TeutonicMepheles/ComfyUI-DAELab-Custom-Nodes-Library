# Package layout, entrypoint, single-file nodes, or conditional registration

Use only the sections needed for the current task.

Contents:
- Project Structure
- Entry Point: __init__.py
- Single-File Node
- Node ID Best Practices
- Common Patterns

## Project Structure

```
ComfyUI/custom_nodes/
  my_custom_nodes/
    __init__.py            # Entry point (required)
    nodes.py               # Node class definitions
    requirements.txt       # Python dependencies
    pyproject.toml         # Package metadata
    README.md              # Documentation
    js/                    # Frontend extensions (optional)
    │   └── my_extension.js
    docs/                  # Help pages (optional)
    │   └── MyNode.md
    locales/               # i18n translations (optional)
        └── zh/
            └── main.json
```

## Entry Point: __init__.py

### V3 Registration (Recommended)

```python
# __init__.py
from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .nodes import MyNode1, MyNode2, MyNode3

WEB_DIRECTORY = "./js"  # optional: frontend JS extensions

class MyNodesExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [MyNode1, MyNode2, MyNode3]

    @override
    async def on_load(self):
        # Optional: run initialization logic when extension loads
        pass

async def comfy_entrypoint() -> MyNodesExtension:
    return MyNodesExtension()
```

### V1 Registration (Legacy)

```python
# __init__.py
from .nodes import MyNode1, MyNode2

NODE_CLASS_MAPPINGS = {
    "MyNode1": MyNode1,
    "MyNode2": MyNode2,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MyNode1": "My Node 1",
    "MyNode2": "My Node 2",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
```

## Single-File Node

For very simple nodes, everything can be in one file:

```python
# ComfyUI/custom_nodes/my_simple_node.py
import torch
from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

class InvertImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SimpleInvert",
            display_name="Simple Invert",
            category="image",
            inputs=[io.Image.Input("image")],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, image):
        return io.NodeOutput(1.0 - image)


class SimpleExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [InvertImage]

async def comfy_entrypoint():
    return SimpleExtension()
```

## Node ID Best Practices

- Use a **globally unique** prefix: `"MyProject_NodeName"` or `"username.NodeName"`
- Never change `node_id` after release (breaks saved workflows)
- Use `display_name` for user-facing name changes
- Use `search_aliases` for discoverability: `search_aliases=["alias1", "alias2"]`

## Common Patterns

### Organizing Multiple Node Files

```python
# __init__.py
from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .image_nodes import BlurNode, SharpenNode, ResizeNode
from .text_nodes import ConcatNode, FormatNode
from .util_nodes import SwitchNode, DebugNode

class MyExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [
            BlurNode, SharpenNode, ResizeNode,
            ConcatNode, FormatNode,
            SwitchNode, DebugNode,
        ]

async def comfy_entrypoint():
    return MyExtension()
```

### Conditional Node Loading

```python
class MyExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        nodes = [BasicNode]
        try:
            import cv2
            from .opencv_nodes import OpenCVNode
            nodes.append(OpenCVNode)
        except ImportError:
            pass
        return nodes
```
