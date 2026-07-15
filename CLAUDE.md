# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DAELab-maintained ComfyUI custom node library. Each node is a self-contained directory under `nodes/<snake_case_name>/` with its own `node.py`, `__init__.py`, and Chinese `README.md`. Frontend JavaScript extensions live flat in `web/`.

## Validation (no formal test suite)

There is no test runner or build step. Validate by running ComfyUI's Python compile check, then manually confirming nodes appear in the UI:

```powershell
cd <ComfyUI>
.\.venv\Scripts\python.exe -m compileall .\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
```

Then restart ComfyUI Desktop and verify the node is searchable, creatable, and survives a save/reload cycle.

## Architecture: node registration

Every node directory's `__init__.py` re-exports `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS` from its `node.py`:

```python
from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
```

The root `__init__.py` imports each sub-package into aliased names, then merges all mappings into the top-level `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`. It also exports `WEB_DIRECTORY = "./web"` — this is what ComfyUI uses to serve frontend scripts. **When adding a new node, you must update the root `__init__.py`** with a new import block and `.update()` call.

## Node conventions

- Nodes use the ComfyUI **V1 API** (`INPUT_TYPES`, `RETURN_TYPES`, `RETURN_NAMES`, `FUNCTION`, `CATEGORY`, `NODE_CLASS_MAPPINGS`) or the **V3 API** (`io.ComfyNode`, `define_schema`, `io.Schema`, `io.NodeOutput`). V3 nodes (boolean_list, polygon_mask, seedream_exhibition_prompt_builder) also export `NODE_CLASS_MAPPINGS` for compatibility. See the [V1→V3 migration guide](.claude/skills/comfyui-node-migration/SKILL.md).
- Node IDs are **stable** — never rename once published, as this breaks existing workflows.
- Category naming uses slash-separated paths: `image/polygon`, `image/bbox`, `SAM3`, `Seedream/Prompt`, `utils/logic`, `DAELab`.
- Optional fields: `SEARCH_ALIASES`, `DESCRIPTION`, `IS_CHANGED` (hash-based caching control), `VALIDATE_INPUTS`.
- The `hidden` input block is used for `unique_id` / `extra_pnginfo` to read workflow-level properties persisted in the PNG metadata. This is how polygon state, boolean config, and SAM3 prompt data survive save/reload.
- When a node produces UI-only outputs (preview images), return them via the `"ui"` key in the result dict alongside the `"result"` tuple:

```python
return {"result": (image_tensor, mask_tensor), "ui": {"source_image": [base64_jpeg]}}
```

## Recurring Python patterns

### IS_CHANGED / caching

Nodes that depend on workflow-persisted state (polygon data, boolean config) implement `IS_CHANGED` with `hashlib.sha256` to control execution caching. Hash all inputs plus the persisted properties from `extra_pnginfo`:

```python
@classmethod
def IS_CHANGED(cls, image, ..., unique_id=None, extra_pnginfo=None):
    digest = hashlib.sha256()
    digest.update(_tensor_digest(image).encode("utf-8"))
    # ... hash all inputs ...
    polygon_info = _get_node_polygon_info(unique_id, extra_pnginfo)
    digest.update(json.dumps(polygon_info, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()
```

### Reading persisted state from PNG metadata

Two helper functions are duplicated across nodes that need workflow-persisted state. They walk `extra_pnginfo["workflow"]["nodes"]` to find the node matching `unique_id`:

```python
def _get_workflow_node(unique_id, extra_pnginfo):
    # returns the node dict from extra_pnginfo["workflow"]["nodes"] matching unique_id

def _get_node_properties(unique_id, extra_pnginfo):
    # returns node.get("properties", {}) for the matching node
```

Properties are stored as JSON strings under keys like `polygon_info`, `boolean_list_items`, `sam3_prompts_data`, etc.

### Image loading via folder_paths

Use `folder_paths.get_annotated_filepath(image_name)` to resolve images from ComfyUI's input directory. Load with PIL + `ImageOps.exif_transpose`, handle multi-frame images via `ImageSequence.Iterator`.

### Color parsing

Both Python and JS contain duplicated color parsers supporting hex (`#FF0000`, `#F00` shorthand) and numeric (`255, 0, 0`) formats. The `COLOR` widget type (`"COLOR", {"default": "#FF0000"}`) provides a native color picker.

### SAM3 custom data types

Nodes that interoperate with SAM3 use the custom type `SAM3_BOXES_PROMPT` for bbox prompt dicts (`{"boxes": [...], "labels": [...]}`). This is a soft dependency — the external `comfyui-sam3` package must be installed separately.

## SAM3 integration

Nodes that wrap SAM3 (`LoadImagePolygonMask`, `SAM3ComplexCollector`) dynamically import from the external `comfyui-sam3` custom node package. They create a `sys.modules` alias (`_daelab_external_comfyui_sam3_nodes`) pointing to `comfyui-sam3/nodes/`, then import `_model_cache` and `utils` from it. This is a **soft dependency** — the nodes work without SAM3 installed, but raise `RuntimeError` if SAM3 prompt data is provided without the model config.

## Frontend extension patterns

All JS files in `web/` register ComfyUI extensions via `app.registerExtension({ name: "daelab.NodeName", ... })`. The canonical pattern:

1. `beforeRegisterNodeDef(nodeType, nodeData)` — gate on `nodeData.name !== "MyNode"` to target only the right node.
2. Use `chainCallback(object, property, callback)` to hook into lifecycle methods. **Note:** `chainCallback` is NOT a shared utility — it is redefined identically at the top of every JS file that uses it. When creating a new frontend file, copy the definition from an existing file.
3. Lifecycle hooks used: `onNodeCreated`, `onExecuted`, `onSerialize`, `onConfigure`, `onResize`, `onDrawForeground`, `onConnectionsChange`, `onRemoved`.
4. Hide internal storage widgets with `widget.hidden = true` and `widget.computeSize = () => [0, -4]`. Replace them with custom DOM via `this.addDOMWidget()`.
5. Canvas-based UIs use `getBoundingClientRect()` to map mouse events to image coordinates. Guard against zero-size rects during initial layout (cached images can load synchronously during `onConfigure` before the DOM is sized).
6. Image loading for previews uses `api.apiURL("/view?...")` via the `getImageUrl()` helper.
7. Serialize state through hidden widgets (set `widget.value` + override `widget.serializeValue`) so it persists across workflow save/load. Also persist to `this.properties` for `onConfigure` restoration.
8. Use `app.graph.setDirtyCanvas(true, true)` to trigger re-renders after state changes.

### Polygon state persistence (localStorage cache)

Polygon nodes persist edit state to `localStorage` keyed by `DAELab.PolygonMask.<nodeId>.<imageHash>` as a fallback in case properties are lost. On restore, candidates are tried in order: widget value → `properties.polygon_data_value` → `properties.polygon_info` → localStorage cache.

### Shared prompt style infrastructure

`web/styles.json` defines style presets (aerospace, business, party_building) with labels, colors, thumbnails, and prompt text. `web/prompt_preset.js` loads this at runtime and provides the style selector UI. Both `GPTImageStylePromptPreset` and `SeedreamExhibitionPromptBuilder` share this infrastructure. Thumbnails live in `web/thumbs/`. The JS uses a `UI_VERSION` string for cache-busting the styles fetch.

## V3→V1 concept mapping

The installed `comfyui-node-*` skills all describe the **V3 API** (`io.ComfyNode`, `io.Schema`, `ComfyExtension`). This project uses the **V1 API**. When a skill is invoked, use this mapping to produce V1-compatible code:

| V3 (skills describe this) | V1 (this project uses this) |
|---|---|
| `class MyNode(io.ComfyNode):` | `class MyNode:` (plain class, no base) |
| `define_schema(cls)` → `io.Schema(...)` | `INPUT_TYPES(cls)` → `{"required": {...}}` |
| `io.Image.Input("image")` | `"image": ("IMAGE",)` |
| `io.Mask.Input("mask", optional=True)` | `"optional": {"mask": ("MASK",)}` |
| `io.Float.Input("strength", default=1.0, min=0.0, max=10.0, step=0.1)` | `"strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.1})` |
| `io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff)` | `"seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff})` |
| `io.String.Input("text", multiline=True)` | `"text": ("STRING", {"multiline": True, "default": ""})` |
| `io.Boolean.Input("flag", default=False)` | `"flag": ("BOOLEAN", {"default": False})` |
| `io.Combo.Input("mode", options=["a","b"])` | `"mode": (["a", "b"],)` |
| `io.Color.Input("color", default="#ff0000")` | `"color": ("COLOR", {"default": "#ff0000"})` |
| `hidden=[io.Hidden.unique_id, io.Hidden.extra_pnginfo]` | `"hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO"}` |
| `outputs=[io.Image.Output("IMAGE"), io.Mask.Output("MASK")]` | `RETURN_TYPES = ("IMAGE", "MASK")` |
| `display_name="My Node"` | `NODE_DISPLAY_NAME_MAPPINGS = {"MyNode": "My Node"}` |
| `category="image/polygon"` | `CATEGORY = "image/polygon"` |
| `return io.NodeOutput(image_tensor, mask_tensor)` | `return (image_tensor, mask_tensor)` |
| `return io.NodeOutput(ui=ui.PreviewImage(images, cls=cls))` | `return {"ui": {"images": [...]}, "result": (...,)}` |
| `fingerprint_inputs(cls, ...)` | `IS_CHANGED(cls, ...)` returning a hash string |
| `validate_inputs(cls, ...)` | `VALIDATE_INPUTS(cls, ...)` returning `True`/error string |
| `@classmethod` on `execute` | `def execute(self, ...):` (instance method, not classmethod) |
| `ComfyExtension` + `comfy_entrypoint()` | `NODE_CLASS_MAPPINGS = {"MyNode": MyNode}` |

### Translation rules

1. **V3 inputs** → `INPUT_TYPES()`: iterate `io.Schema(inputs=[...])`, emit each as `"name": ("TYPE", {...options})`. Split into `"required"` / `"optional"` dicts based on `optional=True`. Hidden inputs go into `"hidden"`.
2. **V3 outputs** → `RETURN_TYPES` + `RETURN_NAMES`: `io.X.Output("NAME")` → `RETURN_TYPES = ("X",)`, `RETURN_NAMES = ("NAME",)`. Multiple outputs use matching tuples.
3. **V3 execute** → instance method: drop `@classmethod`, change first param from `cls` to `self`. Keep parameter names matching input IDs. Return a plain tuple instead of `io.NodeOutput(...)`.
4. **V3 registration** → `NODE_CLASS_MAPPINGS`: instead of `ComfyExtension.get_node_list()`, export `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS` dicts at module level.
5. **V3 `ui.PreviewImage`** → V1 `"ui"` dict: return `{"ui": {"images": [{"filename": ..., "subfolder": ..., "type": "temp"}]}, "result": (tensor,)}`.

## Adding a new node

**Generate new nodes following V3 conventions from the `comfyui-node-*` skills, then translate to V1 via the mapping table above.** This ensures the generated code matches what the skills teach while producing valid V1 code for this project.

1. **Design in V3:** Invoke the relevant skill (`comfyui-node-basics` for structure, `comfyui-node-inputs` for widgets, `comfyui-node-outputs` for return types, `comfyui-node-lifecycle` for caching/validation). Design the node using V3 patterns (`io.Schema`, `io.NodeOutput`, classmethods).
2. **Translate to V1:** Apply the mapping table to convert the V3 design into V1 code (`INPUT_TYPES`, `RETURN_TYPES`, instance method, `NODE_CLASS_MAPPINGS`).
3. Copy `templates/new_node/` to `nodes/<snake_case_name>/` and replace `node.py` with the translated V1 code.
4. Update the root `__init__.py` to import and merge the new mappings.
5. If the node needs a frontend extension, add a JS file in `web/`.
6. Write a Chinese `README.md` in the node directory; add screenshots to `assets/`.
7. Run the compile check, restart ComfyUI, and verify.
8. Update the root `README.md` node list.

See `CONTRIBUTING.md` (Chinese node maintenance guide) and `CONTRIBUTOR_ACTION_LIST.md` (contributor workflow) for detailed instructions.

## Dependencies

No `requirements.txt`. Dependencies come from ComfyUI core (`torch`, `numpy`, `Pillow`, `folder_paths`, `comfy_api`). V3 nodes (`boolean_list`, `polygon_mask`, `seedream_exhibition_prompt_builder`) import from `comfy_api.latest` which is bundled with ComfyUI. The SAM3 integration is optional and requires `comfyui-sam3` installed separately as a sibling custom node.
