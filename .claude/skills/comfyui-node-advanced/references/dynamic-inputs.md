# MatchType, MultiType, Autogrow, DynamicCombo, or arbitrary inputs

Use only the sections needed for the current task.

Contents:
- MatchType - Generic Type Connections
- MultiType - Accept Multiple Types
- Autogrow - Dynamic Growing Inputs
- DynamicCombo - Conditional Inputs
- Accept All Inputs

## MatchType - Generic Type Connections

`MatchType` ensures that inputs and outputs sharing a template have the same type at connection time. Like generics in typed languages.

```python
class PassThrough(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # Template(template_id, allowed_types=AnyType) - optional type constraint
        template = io.MatchType.Template("T")
        return io.Schema(
            node_id="PassThrough",
            display_name="Pass Through",
            category="utils",
            inputs=[
                io.MatchType.Input("value", template=template),
            ],
            outputs=[
                io.MatchType.Output(template=template, display_name="output"),
            ],
        )

    @classmethod
    def execute(cls, value):
        return io.NodeOutput(value)
```

When the user connects an IMAGE to the input, the output automatically becomes IMAGE type.

### Switch Node Pattern

```python
class Switch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        template = io.MatchType.Template("switch")
        return io.Schema(
            node_id="Switch",
            display_name="Switch",
            category="logic",
            inputs=[
                io.Boolean.Input("switch"),
                io.MatchType.Input("on_false", template=template, lazy=True),
                io.MatchType.Input("on_true", template=template, lazy=True),
            ],
            outputs=[
                io.MatchType.Output(template=template, display_name="output"),
            ],
        )

    @classmethod
    def check_lazy_status(cls, switch, on_false=None, on_true=None):
        if switch and on_true is None:
            return ["on_true"]
        if not switch and on_false is None:
            return ["on_false"]

    @classmethod
    def execute(cls, switch, on_true, on_false):
        return io.NodeOutput(on_true if switch else on_false)
```

## MultiType - Accept Multiple Types

A single input that accepts several different types:

```python
io.MultiType.Input("data",
    types=[io.Image, io.Mask, io.Latent],
    optional=True,
)
```

## Autogrow - Dynamic Growing Inputs

Inputs that automatically add more slots as the user connects to them. Two template modes:

### TemplatePrefix (numbered slots)

```python
class ConcatImages(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ConcatImages",
            display_name="Concat Images",
            category="image",
            inputs=[
                io.Autogrow.Input("images",
                    template=io.Autogrow.TemplatePrefix(
                        input=io.Image.Input("img"),  # template for each slot
                        prefix="image_",              # slot names: image_0, image_1, ...
                        min=2,                        # minimum visible slots (default 1)
                        max=16,                       # maximum slots (default 10, hard limit 100)
                    ),
                ),
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, images: io.Autogrow.Type):
        # images is a dict: {"image_0": tensor, "image_1": tensor, ...}
        tensors = [v for v in images.values() if v is not None]
        return io.NodeOutput(torch.cat(tensors, dim=0))
```

### TemplateNames (named slots)

```python
io.Autogrow.Input("inputs",
    template=io.Autogrow.TemplateNames(
        input=io.Float.Input("val"),
        names=["red", "green", "blue", "alpha"],  # specific slot names
        min=3,  # first 3 are required
    ),
)
# Creates slots: "red" (required), "green" (required), "blue" (required), "alpha" (optional)
```

**Key behaviors**:
- Widget inputs in template are forced to connection-only (`force_input=True`)
- Slots below `min` are required; above `min` are optional
- Maximum 100 names total

## DynamicCombo - Conditional Inputs

A combo dropdown where each option reveals different sub-inputs:

```python
class ProcessNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ProcessNode",
            display_name="Process Node",
            category="processing",
            is_output_node=True,
            inputs=[
                io.DynamicCombo.Input("mode", options=[
                    io.DynamicCombo.Option("resize", [
                        io.Int.Input("width", default=512, min=1, max=8192),
                        io.Int.Input("height", default=512, min=1, max=8192),
                    ]),
                    io.DynamicCombo.Option("blur", [
                        io.Float.Input("radius", default=5.0, min=0.1, max=100.0),
                    ]),
                    io.DynamicCombo.Option("sharpen", [
                        io.Float.Input("amount", default=1.0, min=0.0, max=10.0),
                    ]),
                ]),
                io.Image.Input("image"),
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, mode: io.DynamicCombo.Type, image, **kwargs):
        # mode is a dict with the combo value + sub-inputs
        # key for selected option matches the DynamicCombo input ID
        if mode["mode"] == "resize":
            width = mode["width"]
            height = mode["height"]
            # ... resize logic
        return io.NodeOutput(image)
```

**Nested DynamicCombo**:
```python
io.DynamicCombo.Input("outer", options=[
    io.DynamicCombo.Option("option1", [
        io.DynamicCombo.Input("inner", options=[
            io.DynamicCombo.Option("sub1", [io.Float.Input("val")]),
            io.DynamicCombo.Option("sub2", [io.Int.Input("count")]),
        ])
    ]),
])
```

## Accept All Inputs

Accept arbitrary inputs not defined in the schema:

```python
class FlexibleNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="FlexibleNode",
            display_name="Flexible Node",
            category="utils",
            accept_all_inputs=True,
            inputs=[io.Combo.Input("mode", options=["a", "b"])],
            outputs=[io.String.Output()],
        )

    @classmethod
    def validate_inputs(cls, mode, **kwargs):
        return True  # skip validation for dynamic inputs

    @classmethod
    def execute(cls, mode, **kwargs):
        # kwargs contains all dynamic inputs
        return io.NodeOutput(str(kwargs))
```
