# Intentional node replacement

Keep the original ID for a normal V1-to-V3 API migration. Use a replacement only when the task intentionally changes identity or schema. Record the original positional widget order, map links, and validate an old workflow through load/save/reload.

## NodeReplace - Migration Between Nodes

Register replacements so old workflows auto-migrate to new nodes:

```python
from typing_extensions import override
from comfy_api.latest import ComfyAPI, ComfyExtension, io

class MyExtension(ComfyExtension):
    @override
    async def on_load(self):
        api = ComfyAPI()
        await api.node_replacement.register(io.NodeReplace(
            new_node_id="MyNewNode_v2",
            old_node_id="MyOldNode",
            old_widget_ids=["width", "height", "mode"],  # positional widget order
            input_mapping=[
                {"new_id": "image_in", "old_id": "image"},     # rename input
                {"new_id": "size", "set_value": 512},           # set fixed value
            ],
            output_mapping=[
                {"new_idx": 0, "old_idx": 0},       # index-based, not name-based
            ],
        ))

    @override
    async def get_node_list(self):
        return [MyNewNodeV2]
```

**InputMap types**:
- `InputMapOldId`: `{"new_id": str, "old_id": str}` — map old input to new
- `InputMapSetValue`: `{"new_id": str, "set_value": Any}` — set fixed value on new
- Dot notation for autogrow inputs: `{"new_id": "images.image0", "old_id": "image1"}`

**OutputMap** (index-based, not name-based):
- `{"new_idx": int, "old_idx": int}` — map old output index to new

**old_widget_ids**: Required because workflow JSON stores widget values by position, not by ID. This list maps positional indexes to input IDs for correct migration.
