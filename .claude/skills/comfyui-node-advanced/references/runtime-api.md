# Async execution or progress reporting

Use only the sections needed for the current task.

Contents:
- Async Execute
- Progress Reporting
- ComfyAPI - Runtime API

## Async Execute

V3 natively supports async execution:

```python
class AsyncNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AsyncNode",
            display_name="Async Node",
            category="utils",
            inputs=[io.String.Input("url")],
            outputs=[io.String.Output()],
        )

    @classmethod
    async def execute(cls, url):
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                text = await response.text()
        return io.NodeOutput(text)
```

## Progress Reporting

Report progress during long operations:

```python
from comfy_api.latest import ComfyAPISync  # sync version; use ComfyAPI + await for async execute

class SlowNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SlowNode",
            display_name="Slow Node",
            category="utils",
            inputs=[io.Int.Input("steps", default=100)],
            outputs=[io.String.Output()],
        )

    @classmethod
    def execute(cls, steps):
        api = ComfyAPISync()
        for i in range(steps):
            # ... do work ...
            api.execution.set_progress(i + 1, steps)
        return io.NodeOutput("done")
```

## ComfyAPI - Runtime API

```python
from comfy_api.latest import ComfyAPI, ComfyAPISync

# In sync execute(): use ComfyAPISync (no await)
api = ComfyAPISync()
api.execution.set_progress(value=50, max_value=100)
api.execution.set_progress(
    value=50, max_value=100,
    node_id=None,                   # optional: defaults to current node
    preview_image=pil_image,        # PIL Image or ImageInput tensor
    ignore_size_limit=False,
)

# In async execute(): use ComfyAPI (with await)
api = ComfyAPI()
await api.execution.set_progress(value=50, max_value=100)

# Node replacement registration (in async on_load)
await api.node_replacement.register(io.NodeReplace(...))
```
