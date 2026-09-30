# Looking up a specific property or input conversion

Use only the sections needed for the current task.

Contents:
- Property Mapping
- Input Type Mapping

## Property Mapping

| V1 Property | V3 Equivalent |
|---|---|
| `CATEGORY = "image"` | `io.Schema(category="image")` |
| `FUNCTION = "my_func"` | Always `execute` (fixed name) |
| `RETURN_TYPES = ("IMAGE",)` | `outputs=[io.Image.Output()]` |
| `RETURN_NAMES = ("image",)` | `outputs=[io.Image.Output(display_name="image")]` |
| `OUTPUT_TOOLTIPS = ("tip",)` | `outputs=[io.Image.Output(tooltip="tip")]` |
| `OUTPUT_NODE = True` | `io.Schema(is_output_node=True)` |
| `DEPRECATED = True` | `io.Schema(is_deprecated=True)` |
| `EXPERIMENTAL = True` | `io.Schema(is_experimental=True)` |
| `API_NODE = True` | `io.Schema(is_api_node=True)` |
| `NOT_IDEMPOTENT = True` | `io.Schema(not_idempotent=True)` |
| `DESCRIPTION = "..."` | `io.Schema(description="...")` |
| `SEARCH_ALIASES = [...]` | `io.Schema(search_aliases=[...])` |
| `INPUT_IS_LIST = True` | `io.Schema(is_input_list=True)` |
| `OUTPUT_IS_LIST = (True,)` | `io.Image.Output(is_output_list=True)` |
| `DEV_ONLY = True` | `io.Schema(is_dev_only=True)` |
| `ESSENTIALS_CATEGORY = "Basic"` | `io.Schema(essentials_category="Basic")` |

## Input Type Mapping

| V1 Input | V3 Input |
|---|---|
| `("IMAGE",)` | `io.Image.Input("id")` |
| `("MASK",)` | `io.Mask.Input("id")` |
| `("LATENT",)` | `io.Latent.Input("id")` |
| `("MODEL",)` | `io.Model.Input("id")` |
| `("CLIP",)` | `io.Clip.Input("id")` |
| `("VAE",)` | `io.Vae.Input("id")` |
| `("CONDITIONING",)` | `io.Conditioning.Input("id")` |
| `("INT", {"default": 0, ...})` | `io.Int.Input("id", default=0, ...)` |
| `("FLOAT", {"default": 1.0, ...})` | `io.Float.Input("id", default=1.0, ...)` |
| `("STRING", {"multiline": True})` | `io.String.Input("id", multiline=True)` |
| `("BOOLEAN", {"default": True})` | `io.Boolean.Input("id", default=True)` |
| `(["opt1", "opt2"],)` | `io.Combo.Input("id", options=["opt1", "opt2"])` |
| `("CONTROL_NET",)` | `io.ControlNet.Input("id")` |
| `("CLIP_VISION",)` | `io.ClipVision.Input("id")` |
| `("CLIP_VISION_OUTPUT",)` | `io.ClipVisionOutput.Input("id")` |
| `("STYLE_MODEL",)` | `io.StyleModel.Input("id")` |
| `("GLIGEN",)` | `io.Gligen.Input("id")` |
| `("UPSCALE_MODEL",)` | `io.UpscaleModel.Input("id")` |
| `("AUDIO",)` | `io.Audio.Input("id")` |
| `("VIDEO",)` | `io.Video.Input("id")` |
| `("SAMPLER",)` | `io.Sampler.Input("id")` |
| `("SIGMAS",)` | `io.Sigmas.Input("id")` |
| `("NOISE",)` | `io.Noise.Input("id")` |
| `("GUIDER",)` | `io.Guider.Input("id")` |
| `("HOOKS",)` | `io.Hooks.Input("id")` |
| `("LORA_MODEL",)` | `io.LoraModel.Input("id")` |
| `("MESH",)` | `io.Mesh.Input("id")` |
| `("VOXEL",)` | `io.Voxel.Input("id")` |
| `("FILE_3D",)` | `io.File3DAny.Input("id")` |
| `("FILE_3D_GLB",)` | `io.File3DGLB.Input("id")` |
| `("SVG",)` | `io.SVG.Input("id")` |
| `("COLOR",)` | `io.Color.Input("id")` |
| `("BOUNDING_BOX",)` | `io.BoundingBox.Input("id")` |
| `("CURVE",)` | `io.Curve.Input("id")` |
| `("LATENT_UPSCALE_MODEL",)` | `io.LatentUpscaleModel.Input("id")` |
| `("MODEL_PATCH",)` | `io.ModelPatch.Input("id")` |
| `("HOOK_KEYFRAMES",)` | `io.HookKeyframes.Input("id")` |
| `("AUDIO_ENCODER",)` | `io.AudioEncoder.Input("id")` |
| `("AUDIO_ENCODER_OUTPUT",)` | `io.AudioEncoderOutput.Input("id")` |
| `("TRACKS",)` | `io.Tracks.Input("id")` |
| `("LOSS_MAP",)` | `io.LossMap.Input("id")` |
| `("TIMESTEPS_RANGE",)` | `io.TimestepsRange.Input("id")` |
| `("LATENT_OPERATION",)` | `io.LatentOperation.Input("id")` |
| `("WEBCAM",)` | `io.Webcam.Input("id")` |
| `("PHOTOMAKER",)` | `io.Photomaker.Input("id")` |
| `("WAN_CAMERA_EMBEDDING",)` | `io.WanCameraEmbedding.Input("id")` |
| `("LOAD_3D",)` | `io.Load3D.Input("id")` |
| `("LOAD_3D_ANIMATION",)` | `io.Load3DAnimation.Input("id")` |
| `("LOAD3D_CAMERA",)` | `io.Load3DCamera.Input("id")` |
| `("FILE_3D_GLTF",)` | `io.File3DGLTF.Input("id")` |
| `("FILE_3D_FBX",)` | `io.File3DFBX.Input("id")` |
| `("FILE_3D_OBJ",)` | `io.File3DOBJ.Input("id")` |
| `("FILE_3D_STL",)` | `io.File3DSTL.Input("id")` |
| `("FILE_3D_USDZ",)` | `io.File3DUSDZ.Input("id")` |
| `("POINT",)` | `io.Point.Input("id")` |
| `("FACE_ANALYSIS",)` | `io.FaceAnalysis.Input("id")` |
| `("BBOX",)` | `io.BBOX.Input("id")` |
| `("SEGS",)` | `io.SEGS.Input("id")` |
| `("IMAGECOMPARE",)` | `io.ImageCompare.Input("id")` |
| `("*",)` | `io.AnyType.Input("id")` or `io.MultiType.Input("id", types=[...])` |
