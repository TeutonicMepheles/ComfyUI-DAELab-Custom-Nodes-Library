# Error handling or a combined lifecycle example

Use only the sections needed for the current task.

Contents:
- Error Handling
- Complete Lifecycle Example

## Error Handling

```python
@classmethod
def execute(cls, image, model):
    try:
        result = model.process(image)
    except RuntimeError as e:
        if "out of memory" in str(e):
            import torch
            torch.cuda.empty_cache()
            # Try with smaller batch
            result = process_in_chunks(image, model)
        else:
            raise
    return io.NodeOutput(result)
```

## Complete Lifecycle Example

```python
import time
import torch
from comfy_api.latest import ComfyExtension, io, ComfyAPISync

class FullLifecycleNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="FullLifecycleNode",
            display_name="Full Lifecycle Demo",
            category="example",
            inputs=[
                io.Image.Input("image"),
                io.Float.Input("threshold", default=0.5, min=0.0, max=1.0),
                io.Image.Input("optional_ref", optional=True, lazy=True),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
                io.Mask.Output("MASK"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def validate_inputs(cls, image, threshold, optional_ref=None):
        if threshold == 0.0:
            return "Threshold cannot be exactly 0"
        return True

    @classmethod
    def fingerprint_inputs(cls, image, threshold, optional_ref=None):
        # Re-execute if threshold changed; cache otherwise
        return threshold

    @classmethod
    def check_lazy_status(cls, image, threshold, optional_ref=None):
        # Only request optional_ref if threshold is high
        if threshold > 0.8 and optional_ref is None:
            return ["optional_ref"]
        return []

    @classmethod
    def execute(cls, image, threshold, optional_ref=None):
        node_id = cls.hidden.unique_id

        api = ComfyAPISync()  # use ComfyAPISync in sync execute; ComfyAPI in async
        api.execution.set_progress(0, 2)

        # Generate mask from threshold
        gray = image[:, :, :, 0] * 0.299 + image[:, :, :, 1] * 0.587 + image[:, :, :, 2] * 0.114
        mask = (gray > threshold).float()

        api.execution.set_progress(1, 2)

        # Apply mask
        result = image * mask.unsqueeze(-1)
        if optional_ref is not None:
            result = result + optional_ref * (1 - mask.unsqueeze(-1))

        api.execution.set_progress(2, 2)
        return io.NodeOutput(result, mask)
```
