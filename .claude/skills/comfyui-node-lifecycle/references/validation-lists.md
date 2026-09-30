# Input validation, lazy evaluation, or list mapping

Use only the sections needed for the current task.

Contents:
- Input Validation: validate_inputs (V3) / VALIDATE_INPUTS (V1)
- Lazy Evaluation: check_lazy_status
- List Processing

## Input Validation: validate_inputs (V3) / VALIDATE_INPUTS (V1)

Validates inputs before execution. Runs during the validation phase.

```python
class ValidatedNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ValidatedNode",
            display_name="Validated Node",
            category="utils",
            inputs=[
                io.Int.Input("width", default=512, min=1, max=8192),
                io.Int.Input("height", default=512, min=1, max=8192),
            ],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def validate_inputs(cls, width, height):
        """Return True if valid, or error string if invalid."""
        if width % 8 != 0 or height % 8 != 0:
            return "Width and height must be multiples of 8"
        if width * height > 4096 * 4096:
            return "Total pixels exceed maximum (4096x4096)"
        return True

    @classmethod
    def execute(cls, width, height):
        import torch
        return io.NodeOutput(torch.zeros(1, height, width, 3))
```

**V1 equivalent**:
```python
@classmethod
def VALIDATE_INPUTS(s, width, height):
    if width % 8 != 0:
        return "Width must be a multiple of 8"
    return True
```

### Skipping Type Validation

To accept any type (wildcard inputs), include `input_types` parameter:

```python
@classmethod
def validate_inputs(cls, input_types: dict = None, **kwargs):
    # input_types contains the actual types of connected inputs
    # Returning True skips the default type checking
    return True
```

## Lazy Evaluation: check_lazy_status

Controls which lazy inputs actually need evaluation. See `comfyui-node-inputs` for full details.

```python
@classmethod
def check_lazy_status(cls, condition, value_a=None, value_b=None):
    """Called before execute. Return names of inputs that need evaluation."""
    if condition and value_a is None:
        return ["value_a"]
    if not condition and value_b is None:
        return ["value_b"]
    return []
```

**Key behaviors**:
- Only called if the node has lazy inputs
- May be called **multiple times** as inputs become available
- Unevaluated lazy inputs are `None`
- Return empty list (or `None`) when ready to execute
- Evaluated inputs retain their value across calls

## List Processing

### Receiving Lists

```python
# V3: is_input_list=True in Schema (same as V1 INPUT_IS_LIST)
# All inputs arrive as lists — including widget values like batch_size
# Widget values: use widget_value[0] to get the scalar
# Shorter lists are padded by repeating the last value

# V1: INPUT_IS_LIST = True to receive full lists
class ListNode:
    INPUT_IS_LIST = True
    # Now execute() receives lists instead of individual items
```

### Outputting Lists

```python
# V3
io.Image.Output("IMAGE", is_output_list=True)

# V1
OUTPUT_IS_LIST = (True,)  # tuple matching RETURN_TYPES
```
