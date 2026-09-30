# Socket behavior, optional/hidden inputs, or conditional evaluation

Use only the sections needed for the current task.

Contents:
- Input Options (Common to All)
- Optional Inputs
- Hidden Inputs
- Lazy Evaluation

## Input Options (Common to All)

```python
io.Image.Input("image",
    optional=True,        # not required; creates optional input socket
    tooltip="Description shown on hover",
    lazy=True,            # lazy evaluation - only computed when needed
    advanced=True,        # hidden by default in compact mode
    raw_link=True,        # receive raw link reference instead of value
)
```

### force_input

Forces a widget input to appear as a connection socket instead of a widget:

```python
io.Float.Input("value",
    default=1.0,
    force_input=True,   # shows as socket, not slider
)
```

### socketless

Makes a widget input appear only as a widget with no input socket:

```python
io.String.Input("note",
    default="",
    socketless=True,     # widget only, no connection socket
)
```

## Optional Inputs

```python
class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MyNode",
            display_name="My Node",
            category="example",
            inputs=[
                io.Image.Input("image"),                        # required
                io.Mask.Input("mask", optional=True),           # optional
                io.Float.Input("blend", default=0.5),           # has default widget
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, image, mask=None, blend=0.5):
        # Optional inputs default to None when not connected
        if mask is not None:
            image = image * (1 - blend) + image * mask.unsqueeze(-1) * blend
        return io.NodeOutput(image)
```

## Hidden Inputs

Hidden inputs receive server-provided values, not user input:

```python
class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MyNode",
            display_name="My Node",
            category="example",
            inputs=[io.String.Input("text")],
            outputs=[io.String.Output()],
            hidden=[
                io.Hidden.unique_id,       # node's unique ID
                io.Hidden.prompt,           # full prompt data
                io.Hidden.extra_pnginfo,    # PNG metadata dict
                io.Hidden.dynprompt,        # dynamic prompt object
                io.Hidden.auth_token_comfy_org,  # auth token
                io.Hidden.api_key_comfy_org,     # API key
            ],
        )

    @classmethod
    def execute(cls, text):
        # Access hidden values via cls.hidden
        node_id = cls.hidden.unique_id
        prompt = cls.hidden.prompt
        extra = cls.hidden.extra_pnginfo
        return io.NodeOutput(f"{text} (node: {node_id})")
```

## Lazy Evaluation

Lazy inputs are only evaluated when actually needed, saving computation:

```python
class ConditionalNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ConditionalNode",
            display_name="Conditional",
            category="logic",
            inputs=[
                io.Boolean.Input("condition"),
                io.Image.Input("if_true", lazy=True),
                io.Image.Input("if_false", lazy=True),
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def check_lazy_status(cls, condition, if_true=None, if_false=None):
        """Return list of input names that need evaluation."""
        if condition and if_true is None:
            return ["if_true"]
        if not condition and if_false is None:
            return ["if_false"]
        return []

    @classmethod
    def execute(cls, condition, if_true, if_false):
        return io.NodeOutput(if_true if condition else if_false)
```

**Rules for lazy evaluation**:
- Mark inputs with `lazy=True`
- Implement `check_lazy_status()` classmethod
- Unevaluated inputs are `None`
- Return list of input names that need computing, or empty list
- Method may be called multiple times
