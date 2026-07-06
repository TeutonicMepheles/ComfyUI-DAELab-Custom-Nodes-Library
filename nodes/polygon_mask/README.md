# Polygon Mask

## Node Info

- Node ID: `PolygonMask`
- Display name: `Polygon Mask`
- Category: `image/polygon`

## Function

Accepts an `IMAGE` socket input and displays a single polygon editing canvas in the node UI. If the input is connected to ComfyUI `Load Image`, clicking `Load Image` reads that upstream image selection directly and loads it into the canvas without waiting for queue execution. Other `IMAGE` sources fall back to queue execution.

This node is based on the pre-SAM3 polygon editor version from commit `c389cc2`.

## Inputs

- `image`: `IMAGE` socket input. Connect an external image source such as ComfyUI `Load Image`.
- `vertex_count`: selected polygon vertex count slider, 3 to 12.
- `color`: polygon color. Uses the `COLOR` widget compatible with LayerUtility/LayerStyle ColorPicker.
- `fill_opacity`: polygon fill opacity, 0 to 100.
- `outline_width`: polygon outline width, 0 to 20.
- `polygon_data`: hidden advanced polygon storage managed by the node UI.

## Outputs

- `masked_image`: image with all polygon overlays.
- `raw_mask`: black/white mask at the input image size. Polygon fill regions are white, all other pixels are black.

## UI

- Hold `Shift` and left-click the image to add a new triangle polygon.
- Hold `Shift` and right-click a polygon to delete it.
- Click a polygon fill area to select it.
- Drag a selected polygon fill area to move the whole polygon without changing its shape.
- Drag any selected polygon vertex to reshape that polygon.
- Double-click any selected polygon edge, including the closing edge, to insert a vertex.
- `Clear` removes the selected polygon.
- `Reset` regenerates the selected polygon using the current vertex count while preserving its center.
- `Load Image` loads the connected `Load Image` node's current image into the editing canvas immediately; for non-file socket sources it queues the node and uses the returned image.
- `Refresh` redraws the preview image without changing saved vertices.
- `Undo` and `Redo` step through polygon edits.
- After connecting an `IMAGE` input, click `Load Image` to load the socket image into the editing canvas.
- Saved workflows restore the last selected image and polygon data when reopened.

## Files

- Backend: `node.py`
- Frontend: `../../web/polygon_mask.js`
