# Subgraph expansion or conditional execution blocking

Use only the sections needed for the current task.

Contents:
- Node Expansion - Subgraph Injection
- Execution Blocking

## Node Expansion - Subgraph Injection

Nodes can return a subgraph that replaces themselves during execution:

```python
from comfy_execution.graph_utils import GraphBuilder

class RepeatNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="RepeatNode",
            display_name="Repeat KSampler",
            category="sampling",
            enable_expand=True,
            inputs=[
                io.Model.Input("model"),
                io.Int.Input("repeat_count", default=2, min=1, max=10),
                io.Latent.Input("latent"),
            ],
            outputs=[io.Latent.Output("LATENT")],
        )

    @classmethod
    def execute(cls, model, repeat_count, latent):
        graph = GraphBuilder()
        current_latent = latent
        for i in range(repeat_count):
            sampler = graph.node("KSampler",
                model=model,
                latent_image=current_latent,
                # ... other params
            )
            current_latent = sampler.out(0)
        return io.NodeOutput(current_latent, expand=graph.finalize())
```

**Key rules for node expansion**:
- Set `enable_expand=True` in Schema
- Use `GraphBuilder` to construct subgraphs safely
- Return `io.NodeOutput(output_ref, expand=graph.finalize())`
- Node IDs in subgraph must be deterministic and unique
- Each subnode is cached separately

## Execution Blocking

Prevent downstream execution conditionally:

```python
class GateNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="GateNode",
            display_name="Gate",
            category="logic",
            inputs=[
                io.Boolean.Input("allow"),
                io.Image.Input("image"),
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, allow, image):
        if not allow:
            return io.NodeOutput(block_execution="Gate is closed")
        return io.NodeOutput(image)
```
