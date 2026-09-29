# Image, mask, audio, video, text, or 3D previews

Use only the sections needed for the current task.

Contents:
- UI Preview Helpers
- Temporary Previews vs Permanent Saves

## UI Preview Helpers

Import `ui` from `comfy_api.latest`:

```python
from comfy_api.latest import io, ui
```

### PreviewImage

Display image previews on the node. Saves to temp directory automatically.

```python
# Constructor: PreviewImage(image, animated=False, cls=None)
class PreviewNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PreviewNode",
            display_name="Preview Image",
            category="image",
            is_output_node=True,
            inputs=[io.Image.Input("images")],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images):
        return io.NodeOutput(ui=ui.PreviewImage(images, cls=cls))
```

### PreviewMask

```python
# Constructor: PreviewMask(mask, animated=False, cls=None)
# Auto-converts mask to 3-channel grayscale for display
return io.NodeOutput(ui=ui.PreviewMask(masks, cls=cls))
```

### PreviewAudio

```python
# Constructor: PreviewAudio(audio, cls=None)
# Saves as FLAC to temp directory
return io.NodeOutput(ui=ui.PreviewAudio(audio, cls=cls))
```

### PreviewVideo

```python
# Constructor: PreviewVideo(values: list[SavedResult | dict])
return io.NodeOutput(ui=ui.PreviewVideo(saved_video_results))
```

### PreviewText

Display text output:

```python
return io.NodeOutput(ui=ui.PreviewText(value))
```

### PreviewUI3D

Display 3D model preview:

```python
return io.NodeOutput(ui=ui.PreviewUI3D(
    model_file=saved_result,   # SavedResult for the 3D file
    camera_info=camera_dict,   # camera position/target/zoom
    bg_image=image_tensor,     # optional background image (via **kwargs)
))
```

## Temporary Previews vs Permanent Saves

- **Previews** (PreviewImage, etc.) save to the `temp` directory and are ephemeral
- **Saves** (ImageSaveHelper.save_images) save to the `output` directory permanently
- Use `io.FolderType.temp`, `io.FolderType.output`, or `io.FolderType.input`
