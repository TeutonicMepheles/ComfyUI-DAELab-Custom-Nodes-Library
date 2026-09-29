# Dependencies, frontend assets, help/i18n, or standard folders

Use only the sections needed for the current task.

Contents:
- Dependencies: requirements.txt
- pyproject.toml
- Frontend Extensions (JavaScript)
- Help Pages
- Internationalization (i18n)
- Key Imports
- Using folder_paths

## Dependencies: requirements.txt

```
# requirements.txt
opencv-python>=4.8.0
requests>=2.28.0
```

**Important**: Only list dependencies not already included with ComfyUI. ComfyUI ships with: `torch`, `torchvision`, `torchaudio`, `numpy`, `PIL/Pillow`, `scipy`, `safetensors`, `transformers`, `accelerate`.

## pyproject.toml

```toml
[project]
name = "comfyui-my-nodes"
version = "1.0.0"
description = "My custom nodes for ComfyUI"
license = "MIT"
requires-python = ">=3.10"

[project.urls]
Repository = "https://github.com/username/comfyui-my-nodes"
```

## Frontend Extensions (JavaScript)

Place `.js` files in the `WEB_DIRECTORY`:

```
my_custom_nodes/
  js/
    my_widgets.js      # Custom widget implementations
    my_extension.js    # Extension hooks
```

```python
# __init__.py
WEB_DIRECTORY = "./js"
```

All `.js` files in this directory are loaded by the frontend automatically. CSS and other resources can be accessed at `extensions/my_custom_nodes/filename.css`.

## Help Pages

Create markdown documentation per node:

```
my_custom_nodes/
  docs/
    MyNode1.md         # filename matches node_id
```

```markdown
<!-- docs/MyNode1.md -->
# My Node 1

Processes images with adjustable value.

## Inputs
- **image**: The input image
- **value**: Processing strength (0.0 - 10.0)

## Outputs
- **IMAGE**: The processed image
```

## Internationalization (i18n)

```
my_custom_nodes/
  locales/
    zh/
      main.json
      nodeDefs.json    # node definition translations
```

```json
// locales/zh/nodeDefs.json
{
    "MyNode1_UniqueID": {
        "display_name": "我的节点1",
        "description": "处理图像",
        "inputs": {
            "image": { "display_name": "图像" },
            "value": { "display_name": "数值", "tooltip": "处理强度" }
        }
    }
}
```

## Key Imports

```python
# V3 API core
from comfy_api.latest import ComfyExtension, io, ui
from comfy_api.latest import ComfyAPI          # async runtime API (use with await)
from comfy_api.latest import ComfyAPISync      # sync runtime API (use in sync execute)
from comfy_api.latest import Input             # Input.Image, Input.Audio, Input.Mask, Input.Latent, Input.Video
from comfy_api.latest import InputImpl         # InputImpl.VideoFromFile, InputImpl.VideoFromComponents
from comfy_api.latest import Types             # Types.MESH, Types.VOXEL, Types.File3D, Types.VideoCodec
from typing_extensions import override

# Common utilities
import folder_paths                            # directory management
from server import PromptServer                # server-to-client messaging
from comfy_execution.graph_utils import GraphBuilder  # node expansion
```

## Using folder_paths

ComfyUI provides `folder_paths` for accessing standard directories:

```python
import folder_paths

# Standard directories
input_dir = folder_paths.get_input_directory()
output_dir = folder_paths.get_output_directory()
temp_dir = folder_paths.get_temp_directory()

# Model directories
checkpoint_paths = folder_paths.get_folder_paths("checkpoints")
lora_paths = folder_paths.get_folder_paths("loras")

# Register custom model folder
folder_paths.add_model_folder_path("my_models", "/path/to/models")

# Get model file list
models = folder_paths.get_filename_list("checkpoints")
```
