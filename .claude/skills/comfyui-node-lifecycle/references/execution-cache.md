# Execution roots/order or cache invalidation

Use only the sections needed for the current task.

Contents:
- Execution Flow Overview
- Execution Order
- Cache Control: fingerprint_inputs (V3) / IS_CHANGED (V1)
- Output Nodes

## Execution Flow Overview

```
1. Prompt received from frontend
2. Validation phase
   ├── Look up each node class
   ├── Call INPUT_TYPES() / define_schema() for input specs
   ├── Validate connections and types
   └── Call validate_inputs() for each node
3. Build execution order (topological sort from output nodes)
4. For each node in order:
   ├── Cache check (fingerprint_inputs)
   ├── Input resolution (get upstream values)
   ├── Lazy evaluation (check_lazy_status)
   ├── Execute function
   └── Store outputs in cache
5. Return results to frontend
```

## Execution Order

ComfyUI executes from **output nodes backward**:
1. Identifies output nodes (`is_output_node=True`)
2. Builds dependency graph
3. Topological sort determines execution order
4. Only nodes connected to output nodes execute

## Cache Control: fingerprint_inputs (V3) / IS_CHANGED (V1)

Controls when a node re-executes vs uses cached results.

```python
class RandomNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="RandomNode",
            display_name="Random Value",
            category="utils",
            inputs=[
                io.Float.Input("min_val", default=0.0),
                io.Float.Input("max_val", default=1.0),
            ],
            outputs=[io.Float.Output("FLOAT")],
        )

    @classmethod
    def fingerprint_inputs(cls, min_val, max_val):
        """Return value compared to last run. Different value = re-execute."""
        # Return unique value each time to always re-execute
        import time
        return time.time()

    @classmethod
    def execute(cls, min_val, max_val):
        import random
        return io.NodeOutput(random.uniform(min_val, max_val))
```

**How caching works**:
- Before execution, `fingerprint_inputs()` is called with the same args as `execute()`
- Return value is compared to the previous run's return value
- If **same** → skip execution, use cached output
- If **different** → re-execute the node
- If `fingerprint_inputs` is not defined → cache based on input values

**V1 equivalent** (`IS_CHANGED`):
```python
@classmethod
def IS_CHANGED(s, min_val, max_val):
    return time.time()  # always re-execute
```

### not_idempotent Flag

For nodes whose separate instances must not share cached results:

```python
io.Schema(
    node_id="AlwaysRunNode",
    not_idempotent=True,  # prevents cache sharing between instances of the same node
    # ...
)
```

> **Important:** `not_idempotent=True` does **not** prevent a node from reusing its own cached output on subsequent runs. It only prevents cache sharing between different instances of the same node type that have identical inputs. To force re-execution every run (e.g., for file-writing nodes), you must also implement `fingerprint_inputs` (V3) or `IS_CHANGED` (V1) returning a unique value each time.

### has_intermediate_output Flag

For nodes with interactive UI that produce intermediate outputs (e.g., Image Crop, Painter). These behave like output nodes (UI results are cached and resent to the frontend on page refresh) but do NOT automatically get added to the execution list — they only execute if on the dependency path of a real output node.

```python
io.Schema(
    node_id="InteractiveCropNode",
    has_intermediate_output=True,
    # ...
)
```

## Output Nodes

Nodes with `is_output_node=True` are execution roots — ComfyUI traces backward from these:

```python
class SaveMyData(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveMyData",
            display_name="Save Data",
            category="output",
            is_output_node=True,  # marks as output node
            inputs=[
                io.String.Input("data"),
                io.String.Input("filename", default="output.txt"),
            ],
            outputs=[],  # output nodes may have no outputs
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, data, filename):
        import folder_paths, os
        output_dir = folder_paths.get_output_directory()
        with open(os.path.join(output_dir, filename), 'w') as f:
            f.write(data)
        return io.NodeOutput()
```
