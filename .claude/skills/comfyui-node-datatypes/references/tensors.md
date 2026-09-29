# IMAGE, MASK, LATENT, CONDITIONING, or tensor conversion

Use only the sections needed for the current task.

Contents:
- IMAGE Type
- MASK Type
- LATENT Type
- CONDITIONING Type
- Tensor Safety
- Type Conversion Patterns

## IMAGE Type

Images are `torch.Tensor` with shape `[B, H, W, C]`:
- **B** = batch size (1 for single image)
- **H** = height in pixels
- **W** = width in pixels
- **C** = channels (3 for RGB, values 0.0-1.0)

```python
import torch
import numpy as np
from PIL import Image as PILImage

class ImageProcessor(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageProcessor",
            display_name="Image Processor",
            category="image",
            inputs=[io.Image.Input("image")],
            outputs=[io.Image.Output("IMAGE")],
        )

    @classmethod
    def execute(cls, image):
        b, h, w, c = image.shape
        result = torch.clamp(image * 1.5, 0.0, 1.0)
        return io.NodeOutput(result)
```

### Loading / Saving Images

```python
from PIL import ImageOps

# Load from file → tensor
def load_image(path):
    img = PILImage.open(path)
    img = ImageOps.exif_transpose(img)   # fix rotation from camera EXIF
    if img.mode == "I":                  # handle 16-bit images
        img = img.point(lambda i: i * (1 / 255))
    img = img.convert("RGB")
    return torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)

# Tensor → save to file
def save_image(tensor, path):
    if tensor.dim() == 4:
        tensor = tensor[0]
    PILImage.fromarray(np.clip(255.0 * tensor.cpu().numpy(), 0, 255).astype(np.uint8)).save(path)

# Batch operations
batch = torch.cat([img1, img2], dim=0)    # stack into batch
single = image[i]                          # extract from batch [H,W,C]
single_batch = image.unsqueeze(0)          # add batch dim [1,H,W,C]
```

## MASK Type

`torch.Tensor` with shape `[H, W]` or `[B, H, W]`, values 0.0-1.0.

```python
# Invert mask
inverted = 1.0 - mask

# Mask ↔ Image conversion
alpha = mask.unsqueeze(0).unsqueeze(-1)                   # [1,H,W,1]
gray_mask = 0.299*img[:,:,:,0] + 0.587*img[:,:,:,1] + 0.114*img[:,:,:,2]
image_from_mask = mask.unsqueeze(-1).repeat(1, 1, 1, 3)  # [B,H,W,3]

# Ensure batch dim
if mask.dim() == 2:
    mask = mask.unsqueeze(0)  # [1, H, W]
```

## LATENT Type

Dict with typed keys:

```python
class LatentDict(TypedDict):
    samples: torch.Tensor       # [B, C, H, W] (image) or [B, C, T, H, W] (video) - required
    noise_mask: NotRequired[torch.Tensor]
    batch_index: NotRequired[list[int]]
    type: NotRequired[str]      # only for "audio", "hunyuan3dv2"
```

**Image models** (SD1.5, SDXL, SD3, Flux): 4D `[B, C, H, W]` — SD1.5/SDXL = 4 channels, SD3/Flux = 16 channels. Latent dimensions are 1/8 of pixel dims.

**Video models** (Hunyuan Video, Wan, Cosmos, LTX Video, Mochi): 5D `[B, C, T, H, W]` — T is the temporal (frame) dimension.

```python
samples = latent["samples"]
# Check dimensionality:
if samples.ndim == 5:
    B, C, T, H, W = samples.shape   # video latent
else:
    B, C, H, W = samples.shape      # image latent

# Always preserve extra keys when modifying:
result = latent.copy()
result["samples"] = modified_samples
```

## CONDITIONING Type

`list[tuple[Tensor, PooledDict]]` — a list of (cond_tensor, metadata_dict) pairs.

The `PooledDict` contains many optional keys for different models:

```python
class PooledDict(TypedDict):
    pooled_output: torch.Tensor
    control: NotRequired[ControlNet]
    area: NotRequired[tuple[int, ...]]
    strength: NotRequired[float]           # default 1.0
    mask: NotRequired[torch.Tensor]
    start_percent: NotRequired[float]      # 0.0-1.0
    end_percent: NotRequired[float]        # 0.0-1.0
    guidance: NotRequired[float]           # Flux-like models
    hooks: NotRequired[HookGroup]
    # ... many more model-specific keys (SDXL, SVD, WAN, etc.)
```

Combine conditioning: `result = cond_a + cond_b` (list concatenation).

## Tensor Safety

When checking if a tensor exists, always use `is not None` instead of truthiness:

```python
# CORRECT
if image is not None:
    process(image)

# WRONG — multi-element tensors don't support bool()
if image:       # raises RuntimeError
    process(image)

# For boolean conditions on tensors, use .all() or .any()
if (mask > 0.5).all():
    ...
```

## Type Conversion Patterns

```python
# IMAGE [B,H,W,C] → MASK [B,H,W]
mask = 0.299 * image[:,:,:,0] + 0.587 * image[:,:,:,1] + 0.114 * image[:,:,:,2]

# MASK [B,H,W] → IMAGE [B,H,W,C]
image = mask.unsqueeze(-1).repeat(1, 1, 1, 3)

# Resize image tensor
import torch.nn.functional as F
resized = F.interpolate(
    image.permute(0, 3, 1, 2),  # [B,C,H,W] for interpolate
    size=(new_h, new_w), mode='bilinear', align_corners=False
).permute(0, 2, 3, 1)  # back to [B,H,W,C]
```
