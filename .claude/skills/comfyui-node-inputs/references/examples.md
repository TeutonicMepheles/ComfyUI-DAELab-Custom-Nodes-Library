# V1 syntax or a complete multi-input example

Use only the sections needed for the current task.

Contents:
- V1 Input Format (Legacy Reference)
- Complete Example: Multi-Input Node

## V1 Input Format (Legacy Reference)

```python
@classmethod
def INPUT_TYPES(s):
    return {
        "required": {
            "image": ("IMAGE",),
            "strength": ("FLOAT", {
                "default": 1.0, "min": 0.0, "max": 10.0, "step": 0.01
            }),
            "mode": (["option_a", "option_b"],),
            "text": ("STRING", {"multiline": True, "default": ""}),
        },
        "optional": {
            "mask": ("MASK",),
        },
        "hidden": {
            "unique_id": "UNIQUE_ID",
            "prompt": "PROMPT",
            "extra_pnginfo": "EXTRA_PNGINFO",
        },
    }
```

## Complete Example: Multi-Input Node

```python
class AdvancedImageNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AdvancedImageNode",
            display_name="Advanced Image",
            category="image/advanced",
            description="Demonstrates various input types",
            inputs=[
                # Required connection input
                io.Image.Input("image", tooltip="Input image"),
                # Required widget inputs
                io.Float.Input("brightness", default=1.0, min=0.0, max=3.0,
                               step=0.1, display_mode=io.NumberDisplay.slider),
                io.Float.Input("contrast", default=1.0, min=0.0, max=3.0, step=0.1),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff,
                             control_after_generate=True),
                io.Combo.Input("blend_mode", options=["normal", "multiply", "screen"]),
                io.Boolean.Input("flip_horizontal", default=False),
                io.String.Input("label", default="", socketless=True),
                # Optional inputs
                io.Mask.Input("mask", optional=True),
                io.Image.Input("overlay", optional=True),
                # Advanced inputs (collapsed by default)
                io.Float.Input("gamma", default=1.0, min=0.1, max=3.0, advanced=True),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
                io.Mask.Output("MASK"),
            ],
        )

    @classmethod
    def execute(cls, image, brightness, contrast, seed, blend_mode,
                flip_horizontal, label, mask=None, overlay=None, gamma=1.0):
        result = image * brightness
        if flip_horizontal:
            result = torch.flip(result, dims=[2])
        if mask is not None:
            result = result * mask.unsqueeze(-1)
        return io.NodeOutput(result, mask if mask is not None else torch.ones(result.shape[:3]))
```
