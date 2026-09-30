# Scalar, combo, upload, and specialized widget declarations

Use only the sections needed for the current task.

Contents:
- Widget Input Types

## Widget Input Types

### INT

```python
io.Int.Input("seed",
    default=0,
    min=0,
    max=0xffffffffffffffff,
    step=1,
    control_after_generate=True,  # adds increment/decrement/randomize control
    display_mode=io.NumberDisplay.number,  # "number", "slider", or "gradient_slider"
    tooltip="Random seed for generation",
)
```

**NumberDisplay options**: `io.NumberDisplay.number`, `io.NumberDisplay.slider`, `io.NumberDisplay.gradient_slider`

**ControlAfterGenerate options**: `True` (default randomize), or `io.ControlAfterGenerate.fixed`, `.increment`, `.decrement`, `.randomize`

### FLOAT

```python
io.Float.Input("strength",
    default=1.0,
    min=0.0,
    max=10.0,
    step=0.01,
    round=0.001,         # rounding precision
    display_mode=io.NumberDisplay.slider,
    gradient_stops=[{"offset": 0.0, "color": [0, 0, 0]}, {"offset": 1.0, "color": [255, 255, 255]}],  # for gradient_slider mode
    tooltip="Effect strength",
)
```

### STRING

```python
# Single-line string
io.String.Input("name",
    default="",
    placeholder="Enter name...",
)

# Multi-line text area
io.String.Input("prompt",
    multiline=True,
    default="",
    placeholder="Enter prompt...",
    dynamic_prompts=True,  # enable dynamic prompt syntax
)
```

### BOOLEAN

```python
io.Boolean.Input("enabled",
    default=True,
    label_on="Enabled",
    label_off="Disabled",
    tooltip="Toggle this feature",
)
```

### COMBO (Dropdown)

```python
io.Combo.Input("mode",
    options=["option_a", "option_b", "option_c"],
    default="option_a",
    tooltip="Select processing mode",
    control_after_generate=True,  # adds increment/decrement/randomize control
)
```

**Combo with Enum**:
```python
from enum import Enum

class BlendMode(Enum):
    NORMAL = "normal"
    MULTIPLY = "multiply"
    SCREEN = "screen"

io.Combo.Input("blend", options=BlendMode, default=BlendMode.NORMAL)
# Enum values auto-converted to string list
```

**Combo with file upload**:
```python
io.Combo.Input("image_file",
    options=[],
    upload=io.UploadType.image,          # .image, .audio, .video, .model (for generic file upload)
    image_folder=io.FolderType.input,    # .input, .output, .temp
)
```

**Dynamic combo with remote options**:
```python
io.Combo.Input("model_name",
    options=[],
    remote=io.RemoteOptions(
        route="/internal/models/checkpoints",
        refresh_button=True,
        control_after_refresh="first",  # "first" or "last"
        timeout=5000,        # ms
        max_retries=3,
        refresh=60000,       # TTL refresh interval in ms
    ),
)
```

### MULTICOMBO (Multi-select Dropdown)

```python
io.MultiCombo.Input("tags",
    options=["tag1", "tag2", "tag3", "tag4"],
    default=["tag1"],
    placeholder="Select tags...",
    chip=True,  # display as chips
)
# Value type: list[str]
```

### COLOR (Color Picker)

```python
io.Color.Input("color",
    default="#ffffff",
    socketless=True,  # widget only by default
)
# Value type: str (hex color)
```

### BOUNDING_BOX (Rectangle Selector)

```python
io.BoundingBox.Input("region",
    default={"x": 0, "y": 0, "width": 512, "height": 512},
    socketless=True,
    component="my_component",  # optional custom UI component name
    force_input=False,
)
# Value type: {"x": int, "y": int, "width": int, "height": int}
```

### CURVE (Spline Editor)

```python
io.Curve.Input("curve",
    default=[(0.0, 0.0), (1.0, 1.0)],  # linear ramp
    socketless=True,
)
# Value type: list[tuple[float, float]]
```

### WEBCAM (Camera Capture)

```python
io.Webcam.Input("capture")
# Value type: str
```

### IMAGECOMPARE (Comparison Widget)

```python
io.ImageCompare.Input("comparison", socketless=True)
# Value type: dict
```
