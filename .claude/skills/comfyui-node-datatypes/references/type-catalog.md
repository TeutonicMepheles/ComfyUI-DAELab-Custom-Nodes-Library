# Looking up a socket type or import

Use only the sections needed for the current task.

Contents:
- Complete Type Reference
- Imports from comfy_api.latest

## Complete Type Reference

### Tensor/Data Types

| Type | V3 Class | Format | Description |
|---|---|---|---|
| IMAGE | `io.Image` | `torch.Tensor [B,H,W,C]` float32 0-1 | Batch of RGB images |
| MASK | `io.Mask` | `torch.Tensor [H,W]` or `[B,H,W]` float32 0-1 | Grayscale masks |
| LATENT | `io.Latent` | `{"samples": Tensor[B,C,H,W] or [B,C,T,H,W], "noise_mask"?: Tensor, "batch_index"?: list[int], "type"?: str}` | Latent space (4D image / 5D video) |
| CONDITIONING | `io.Conditioning` | `list[tuple[Tensor, PooledDict]]` | Text conditioning with pooled outputs |
| AUDIO | `io.Audio` | `{"waveform": Tensor[B,C,T], "sample_rate": int}` | Audio data |
| VIDEO | `io.Video` | `VideoInput` ABC | Video data (abstract base class) |
| SIGMAS | `io.Sigmas` | `torch.Tensor` 1D, length steps+1 | Noise schedule |
| NOISE | `io.Noise` | Object with `generate_noise()` | Noise generator |
| LORA_MODEL | `io.LoraModel` | `dict[str, torch.Tensor]` | LoRA weight deltas |
| LOSS_MAP | `io.LossMap` | `{"loss": list[torch.Tensor]}` | Loss map |
| TRACKS | `io.Tracks` | `{"track_path": Tensor, "track_visibility": Tensor}` | Motion tracking data |
| WAN_CAMERA_EMBEDDING | `io.WanCameraEmbedding` | `torch.Tensor` | WAN camera embeddings |
| LATENT_OPERATION | `io.LatentOperation` | `Callable[[Tensor], Tensor]` | Latent transform function |
| TIMESTEPS_RANGE | `io.TimestepsRange` | `tuple[int, int]` | Range 0.0-1.0 |

### Model Types (opaque, typically pass-through)

| Type | V3 Class | Python Type |
|---|---|---|
| MODEL | `io.Model` | `ModelPatcher` |
| CLIP | `io.Clip` | `CLIP` |
| VAE | `io.Vae` | `VAE` |
| CONTROL_NET | `io.ControlNet` | `ControlNet` |
| CLIP_VISION | `io.ClipVision` | `ClipVisionModel` |
| CLIP_VISION_OUTPUT | `io.ClipVisionOutput` | `ClipVisionOutput` |
| STYLE_MODEL | `io.StyleModel` | `StyleModel` |
| GLIGEN | `io.Gligen` | `ModelPatcher` (wrapping Gligen) |
| UPSCALE_MODEL | `io.UpscaleModel` | `ImageModelDescriptor` |
| LATENT_UPSCALE_MODEL | `io.LatentUpscaleModel` | Any |
| SAMPLER | `io.Sampler` | `Sampler` |
| GUIDER | `io.Guider` | `CFGGuider` |
| HOOKS | `io.Hooks` | `HookGroup` |
| HOOK_KEYFRAMES | `io.HookKeyframes` | `HookKeyframeGroup` |
| MODEL_PATCH | `io.ModelPatch` | Any |
| AUDIO_ENCODER | `io.AudioEncoder` | Any |
| AUDIO_ENCODER_OUTPUT | `io.AudioEncoderOutput` | Any |
| PHOTOMAKER | `io.Photomaker` | Any |
| POINT | `io.Point` | Any |
| FACE_ANALYSIS | `io.FaceAnalysis` | Any |
| BBOX | `io.BBOX` | Any |
| SEGS | `io.SEGS` | Any |

### 3D Types

| Type | V3 Class | Python Type | Description |
|---|---|---|---|
| MESH | `io.Mesh` | `MESH(vertices, faces)` | 3D mesh with vertices + faces tensors |
| VOXEL | `io.Voxel` | `VOXEL(data)` | Voxel data tensor |
| FILE_3D | `io.File3DAny` | `File3D` | Any supported 3D format |
| FILE_3D_GLB | `io.File3DGLB` | `File3D` | Binary glTF |
| FILE_3D_GLTF | `io.File3DGLTF` | `File3D` | JSON-based glTF |
| FILE_3D_FBX | `io.File3DFBX` | `File3D` | FBX format |
| FILE_3D_OBJ | `io.File3DOBJ` | `File3D` | OBJ format |
| FILE_3D_STL | `io.File3DSTL` | `File3D` | STL format (3D printing) |
| FILE_3D_USDZ | `io.File3DUSDZ` | `File3D` | Apple AR format |
| SVG | `io.SVG` | `SVG` | Scalable vector graphics |
| LOAD_3D | `io.Load3D` | `{"image": str, "mask": str, "normal": str, "camera_info": CameraInfo}` | 3D model with renders |
| LOAD_3D_ANIMATION | `io.Load3DAnimation` | Same as Load3D | Animated 3D model |
| LOAD3D_CAMERA | `io.Load3DCamera` | `{"position": dict, "target": dict, "zoom": int, "cameraType": str}` | 3D camera info |

### Widget Types (create UI controls)

| Type | V3 Class | Python Type | Description |
|---|---|---|---|
| INT | `io.Int` | `int` | Integer with min/max/step |
| FLOAT | `io.Float` | `float` | Float with min/max/step/round |
| STRING | `io.String` | `str` | Text (single/multi-line) |
| BOOLEAN | `io.Boolean` | `bool` | Toggle with labels |
| COMBO | `io.Combo` | `str` | Dropdown selection |
| COMBO (multi) | `io.MultiCombo` | `list[str]` | Multi-select dropdown |
| COLOR | `io.Color` | `str` (hex) | Color picker, default `#ffffff` |
| BOUNDING_BOX | `io.BoundingBox` | `{"x": int, "y": int, "width": int, "height": int}` | Rectangle region |
| CURVE | `io.Curve` | `list[tuple[float, float]]` | Spline curve points |
| IMAGECOMPARE | `io.ImageCompare` | `dict` | Image comparison widget |
| WEBCAM | `io.Webcam` | `str` | Webcam capture widget |
| HISTOGRAM | `io.Histogram` | `list[int]` | Histogram bin counts |

### Special Types

| Type | V3 Class | Description |
|---|---|---|
| `*` (ANY) | `io.AnyType` | Matches any type |
| COMFY_MULTITYPED_V3 | `io.MultiType` | Accept multiple specific types on one input |
| COMFY_MATCHTYPE_V3 | `io.MatchType` | Generic type matching across inputs/outputs |
| COMFY_AUTOGROW_V3 | `io.Autogrow` | Dynamic growing inputs |
| COMFY_DYNAMICCOMBO_V3 | `io.DynamicCombo` | Combo that reveals sub-inputs per option |
| FLOW_CONTROL | `io.FlowControl` | Internal testing only |
| ACCUMULATION | `io.Accumulation` | Internal testing only |

## Imports from comfy_api.latest

```python
from comfy_api.latest import (
    ComfyExtension,  # extension registration
    ComfyAPI,        # runtime API (progress, node replacement)
    io,              # all io types (io.Image, io.Schema, io.ComfyNode, etc.)
    ui,              # UI output helpers (ui.PreviewImage, ui.SavedImages, etc.)
    Input,           # Input.Image (ImageInput), Input.Audio, Input.Mask, Input.Latent, Input.Video
    InputImpl,       # InputImpl.VideoFromFile, InputImpl.VideoFromComponents
    Types,           # Types.MESH, Types.VOXEL, Types.File3D, Types.VideoCodec, etc.
)
```
