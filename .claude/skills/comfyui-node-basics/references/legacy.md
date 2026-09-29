# Maintaining an existing V1 node or comparing its structure

Use only the sections needed for the current task.

Contents:
- V1 Node Structure (Legacy Reference)
- Key Differences: V3 vs V1

## V1 Node Structure (Legacy Reference)

V1 nodes use class attributes and `NODE_CLASS_MAPPINGS`:

```python
class MyNodeV1:
    CATEGORY = "my_category"
    FUNCTION = "execute"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
            }
        }

    def execute(self, image, strength):
        return (image * strength,)

NODE_CLASS_MAPPINGS = {"MyNodeV1": MyNodeV1}
NODE_DISPLAY_NAME_MAPPINGS = {"MyNodeV1": "My Node V1"}
```

## Key Differences: V3 vs V1

| Aspect | V3 | V1 |
|---|---|---|
| Base class | `io.ComfyNode` | Plain class |
| Execute method | `execute` classmethod (fixed name) | Instance method (custom name via `FUNCTION`) |
| Inputs | `io.Schema(inputs=[...])` | `INPUT_TYPES()` dict |
| Outputs | `io.Schema(outputs=[...])` | `RETURN_TYPES` tuple |
| Return value | `io.NodeOutput(...)` | Plain tuple |
| Registration | `ComfyExtension` + `comfy_entrypoint()` | `NODE_CLASS_MAPPINGS` dict |
| State | No instance state (classmethods) | Instance state allowed |
| Hidden inputs | `cls.hidden.prompt`, etc. | kwargs from `"hidden"` dict |
