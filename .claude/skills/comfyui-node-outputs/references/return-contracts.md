# Data/UI return values, output options, or existing V1 nodes

Use only the sections needed for the current task.

Contents:
- Basic Output
- Output Configuration
- NodeOutput Variants
- V1 Output Patterns (Legacy Reference)

## Basic Output

```python
class SimpleNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SimpleNode",
            display_name="Simple Node",
            category="example",
            inputs=[io.Float.Input("a"), io.Float.Input("b")],
            outputs=[
                io.Float.Output("SUM"),
                io.Float.Output("PRODUCT"),
            ],
        )

    @classmethod
    def execute(cls, a, b):
        # Values must match output order
        return io.NodeOutput(a + b, a * b)
```

## Output Configuration

```python
io.Schema(
    outputs=[
        io.Image.Output("IMAGE"),                    # basic output
        io.Int.Output("COUNT"),                      # integer output
        io.Float.Output("VALUE", display_name="Result"),  # custom display name
        io.String.Output("TEXT", tooltip="The processed text"),
        io.Image.Output("FRAMES", is_output_list=True),  # outputs a list
    ],
)
```

## NodeOutput Variants

```python
# Data only
return io.NodeOutput(image_tensor, mask_tensor)

# UI only (output node with no data outputs)
return io.NodeOutput(ui=ui.PreviewImage(images, cls=cls))

# Data + UI
return io.NodeOutput(image_tensor, ui=ui.PreviewImage(images, cls=cls))

# No output
return io.NodeOutput()

# Block execution
return io.NodeOutput(block_execution="Reason for blocking")

# Node expansion (positional args are outputs, not result= keyword)
return io.NodeOutput(output_ref, expand=graph.finalize())
```

## V1 Output Patterns (Legacy Reference)

```python
class V1SaveNode:
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save"

    def save(self, images, prefix):
        # ... save logic ...
        return {
            "ui": {
                "images": [
                    {"filename": "out.png", "subfolder": "", "type": "output"}
                ]
            }
        }

# Data + UI in V1:
class V1PreviewAndOutput:
    RETURN_TYPES = ("IMAGE",)
    OUTPUT_NODE = True
    FUNCTION = "run"

    def run(self, image):
        # ... preview logic ...
        return {
            "ui": {"images": [...]},
            "result": (processed_image,),
        }
```
