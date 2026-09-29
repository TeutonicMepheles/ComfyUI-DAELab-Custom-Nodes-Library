# Creating a V3 class or changing schema fields

Use only the sections needed for the current task.

Contents:
- Quick Start
- V3 Node Class Structure
- io.Schema Fields
- Important Rules

## Quick Start

```python
from comfy_api.latest import ComfyExtension, io

class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MyNode",
            display_name="My Custom Node",
            category="my_category",
            inputs=[
                io.Image.Input("image"),
                io.Float.Input("strength", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
            ],
        )

    @classmethod
    def execute(cls, image, strength):
        result = image * strength
        return io.NodeOutput(result)
```

## V3 Node Class Structure

Every V3 node requires:

1. **Inherit from `io.ComfyNode`**
2. **`define_schema(cls)`** - classmethod returning `io.Schema`
3. **`execute(cls, ...)`** - classmethod performing the computation

```python
import torch
from comfy_api.latest import io

class ImageBrighten(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageBrighten",          # unique identifier
            display_name="Brighten Image",     # shown in UI
            category="image/adjust",           # menu path
            description="Adjusts image brightness",
            inputs=[
                io.Image.Input("image"),
                io.Float.Input("factor", default=1.2, min=0.0, max=3.0, step=0.1),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
            ],
        )

    @classmethod
    def execute(cls, image, factor):
        result = torch.clamp(image * factor, 0.0, 1.0)
        return io.NodeOutput(result)
```

## io.Schema Fields

```python
io.Schema(
    node_id="UniqueNodeID",            # required: unique string ID
    display_name="Display Name",        # optional: shown in UI menus
    category="category/subcategory",    # menu hierarchy (default "sd")
    description="Node description",     # optional: tooltip text
    inputs=[...],                       # list of Input objects
    outputs=[...],                      # list of Output objects
    hidden=[...],                       # list of Hidden enum values
    is_output_node=False,               # True for nodes with side effects (save, preview)
    is_experimental=False,              # marks as experimental
    is_deprecated=False,                # marks as deprecated
    is_dev_only=False,                  # hidden unless dev mode enabled
    is_api_node=False,                  # marks as API-only node
    is_input_list=False,                # receive full lists instead of individual items
    not_idempotent=False,               # prevents cache sharing between node instances
    accept_all_inputs=False,            # accept arbitrary inputs via **kwargs
    enable_expand=False,                # allow node expansion (subgraphs)
    search_aliases=["alias1", "alias2"],# alternative search terms
    essentials_category="Basic",        # optional: Essentials tab category
    price_badge=None,                   # optional: PriceBadge for API nodes
    has_intermediate_output=False,      # True for nodes with interactive UI that produce intermediate outputs
)
```

## Important Rules

- `node_id` must be globally unique across all nodes
- `execute()` parameters must match input IDs exactly
- All methods are `@classmethod` in V3 (no instance state)
- Return `io.NodeOutput(val1, val2, ...)` matching output count
- Category uses `/` separator for hierarchy: `"image/transform"`
- Prefix category with `_` to hide from menus: `"_for_testing"`
