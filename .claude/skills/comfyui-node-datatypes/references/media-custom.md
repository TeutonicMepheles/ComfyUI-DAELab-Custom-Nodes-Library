# Video, 3D, custom types, or wildcard connections

Use only the sections needed for the current task.

Contents:
- VIDEO Type
- 3D Types
- Custom Types
- AnyType / Wildcard

## VIDEO Type

`VideoInput` is an abstract base class with methods:

```python
class VideoInput(ABC):
    def get_components(self) -> VideoComponents    # images tensor + audio + frame_rate
    def save_to(self, path, format, codec, metadata)
    def as_trimmed(self, start_time, duration) -> VideoInput | None
    def get_stream_source(self) -> str | BytesIO
    def get_dimensions(self) -> tuple[int, int]     # (width, height)
    def get_duration(self) -> float                  # seconds
    def get_frame_count(self) -> int
    def get_frame_rate(self) -> Fraction
    def get_container_format(self) -> str
```

Concrete implementations: `VideoFromFile`, `VideoFromComponents` (available via `from comfy_api.latest import InputImpl`).

## 3D Types

### File3D

```python
from comfy_api.latest import Types

# File3D wraps a 3D file (disk path or BytesIO stream)
file_3d = Types.File3D(source="/path/to/model.glb", file_format="glb")
file_3d.format              # "glb"
file_3d.is_disk_backed      # True
file_3d.get_data()          # BytesIO
file_3d.get_bytes()         # raw bytes
file_3d.save_to("/output/model.glb")
```

### MESH and VOXEL

```python
from comfy_api.latest import Types

mesh = Types.MESH(vertices=torch.tensor(...), faces=torch.tensor(...))
voxel = Types.VOXEL(data=torch.tensor(...))
```

## Custom Types

```python
# Simple: create inline custom type
MyData = io.Custom("MY_DATA_TYPE")

# Use in inputs/outputs
io.Schema(
    inputs=[MyData.Input("data")],
    outputs=[MyData.Output("MY_DATA")],
)
```

### Advanced: @comfytype decorator

For custom types with type hints or custom Input/Output classes:

```python
from comfy_api.latest._io import comfytype, ComfyTypeIO

@comfytype(io_type="MY_DATA_TYPE")
class MyData(ComfyTypeIO):
    Type = dict[str, Any]  # type hint for the data
```

## AnyType / Wildcard

```python
# Accept any single type (always a connection input, no widget)
io.AnyType.Input("anything")

# Accept specific multiple types
io.MultiType.Input("data", types=[io.Image, io.Mask, io.Latent])

# MultiType with widget override (shows widget for first type)
io.MultiType.Input(
    io.Float.Input("value", default=1.0),
    types=[io.Float, io.Int],
)
```
