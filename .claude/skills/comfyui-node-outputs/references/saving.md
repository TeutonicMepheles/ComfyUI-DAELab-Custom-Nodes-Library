# Saving images or audio with metadata

Use only the sections needed for the current task.

Contents:
- Saving Images
- Saving Audio

## Saving Images

### Using ImageSaveHelper

The `ui.ImageSaveHelper` class provides static methods for various image formats:

```python
# Save as PNG (returns list[SavedResult])
results = ui.ImageSaveHelper.save_images(
    images,                              # tensor [B,H,W,C]
    filename_prefix="ComfyUI",
    folder_type=io.FolderType.output,    # output, temp, or input
    cls=cls,                             # node class (for metadata)
    compress_level=4,
)

# Save and get UI object directly (saves to output folder)
saved_ui = ui.ImageSaveHelper.get_save_images_ui(images, "ComfyUI", cls=cls)
return io.NodeOutput(ui=saved_ui)

# Save animated PNG
result = ui.ImageSaveHelper.save_animated_png(
    images, "anim", io.FolderType.output, cls=cls, fps=12.0, compress_level=4
)

# Save animated PNG and get UI
saved_ui = ui.ImageSaveHelper.get_save_animated_png_ui(images, "anim", cls=cls, fps=12.0, compress_level=4)

# Save animated WebP
result = ui.ImageSaveHelper.save_animated_webp(
    images, "anim", io.FolderType.output, cls=cls,
    fps=12.0, lossless=False, quality=80, method=4
)

# Save animated WebP and get UI
saved_ui = ui.ImageSaveHelper.get_save_animated_webp_ui(
    images, "anim", cls=cls, fps=12.0, lossless=False, quality=80, method=4
)
```

**Simple save node example:**

```python
class SaveImageNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveImageNode",
            display_name="Save Image",
            category="image",
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.String.Input("filename_prefix", default="ComfyUI"),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, filename_prefix):
        saved = ui.ImageSaveHelper.get_save_images_ui(images, filename_prefix, cls=cls)
        return io.NodeOutput(ui=saved)
```

### Manual Image Saving

```python
import os
import json
import numpy as np
from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo
import folder_paths

class CustomSaveNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CustomSaveNode",
            display_name="Custom Save",
            category="image",
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.String.Input("prefix", default="output"),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, prefix):
        output_dir = folder_paths.get_output_directory()
        results = []

        for i, image in enumerate(images):
            # Convert tensor to PIL
            img_array = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
            pil_image = PILImage.fromarray(img_array)

            # Add metadata
            metadata = PngInfo()
            if cls.hidden.prompt:
                metadata.add_text("prompt", json.dumps(cls.hidden.prompt))
            if cls.hidden.extra_pnginfo:
                for k, v in cls.hidden.extra_pnginfo.items():
                    metadata.add_text(k, json.dumps(v))

            # Save with counter
            filename = f"{prefix}_{i:05d}.png"
            filepath = os.path.join(output_dir, filename)
            pil_image.save(filepath, pnginfo=metadata)

            results.append(ui.SavedResult(
                filename=filename,
                subfolder="",
                type=io.FolderType.output,
            ))

        return io.NodeOutput(ui=ui.SavedImages(results))
```

## Saving Audio

The `ui.AudioSaveHelper` supports FLAC, MP3, and Opus formats:

```python
# Save audio (returns list[SavedResult])
results = ui.AudioSaveHelper.save_audio(
    audio,                               # {"waveform": Tensor, "sample_rate": int}
    filename_prefix="audio",
    folder_type=io.FolderType.output,
    cls=cls,
    format="flac",                       # "flac", "mp3", or "opus"
    quality="128k",                      # MP3: "V0","128k","320k"; Opus: "64k"-"320k"
)

# Save and get UI object
saved_ui = ui.AudioSaveHelper.get_save_audio_ui(audio, "audio", cls=cls, format="flac", quality="128k")
return io.NodeOutput(ui=saved_ui)
```

```python
class SaveAudioNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveAudioNode",
            display_name="Save Audio",
            category="audio",
            is_output_node=True,
            inputs=[
                io.Audio.Input("audio"),
                io.String.Input("prefix", default="audio"),
                io.Combo.Input("format", options=["flac", "mp3", "opus"], default="flac"),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, audio, prefix, format):
        saved = ui.AudioSaveHelper.get_save_audio_ui(audio, prefix, cls=cls, format=format)
        return io.NodeOutput(ui=saved)
```
