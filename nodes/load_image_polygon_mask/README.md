# Load Image + Polygon Mask

## Node Info

- Node ID: `LoadImagePolygonMask`
- Display name: `Load Image + Polygon Mask`
- Category: `image/polygon`

## Function

Loads an input image and displays editable closed polygons plus a SAM3 prompt canvas in the node UI. The first polygon defaults to a centered triangle. Hold `Shift` and left-click the image to add another default triangle at the clicked position.

The node outputs the polygon composited image, the unchanged source image, SAM3 masks, and a SAM3 visualization image.

The node UI keeps the editable polygon canvas and replaces the default image preview with a SAM3 prompt drawing canvas.
The canvas also shows a compact interaction note for `Shift + left-click` and `Shift + right-click`.

## Inputs

- `image`: input image selector/upload.
- `vertex_count`: selected polygon vertex count slider, 3 to 12.
- `color`: polygon color. Uses the `COLOR` widget compatible with LayerUtility/LayerStyle ColorPicker.
- `fill_opacity`: polygon fill opacity, 0 to 100.
- `outline_width`: polygon outline width, 0 to 20.
- `sam3_model_config`: optional SAM3 model config from `LoadSAM3Model`; required when SAM3 prompts contain points or boxes.
- `sam3_prompts_data`: hidden advanced prompt storage managed by the node UI.

## Outputs

- `masked_image`: image with all polygon overlays.
- `source_image`: unchanged source image loaded by the node.
- `masks`: SAM3 masks generated from prompt points/boxes.
- `visualization`: source image with SAM3 masks overlaid.

## UI

- Hold `Shift` and left-click the image to add a new triangle polygon.
- Hold `Shift` and right-click a polygon to delete it.
- Click a polygon fill area to select it.
- Drag a selected polygon fill area to move the whole polygon without changing its shape.
- Drag any selected polygon vertex to reshape that polygon.
- Double-click any selected polygon edge, including the closing edge, to insert a vertex.
- `Clear` removes the selected polygon.
- `Reset` regenerates the selected polygon using the current vertex count while preserving its center.
- `Refresh` redraws the preview image without changing saved vertices.
- `Undo` and `Redo` step through polygon edits.
- In the SAM3 canvas, left-click adds a positive point, right-click adds a negative point, and `Shift` drag draws a box.
- `Run` queues SAM3 mask and visualization generation for the active prompt.
- `Load Masked Image` uses the latest `masked_image` as the SAM3 prompt canvas background; before queue execution it falls back to the current frontend polygon composite.
- SAM3 prompt tabs support multiple prompt groups, `Clear Prompt`, and `Clear All`.
- Saved workflows restore the last selected image, polygon data, and SAM3 prompts when reopened.

## Files

- Backend: `node.py`
- Frontend: `../../web/polygon_mask_loader.js`
