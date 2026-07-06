# Load Image + Polygon Mask

## Node Info

- Node ID: `LoadImagePolygonMask`
- Display name: `Load Image + Polygon Mask`
- Category: `image/polygon`

## Function

Loads an input image and displays an editable closed polygon in the node UI. The polygon defaults to a centered triangle. Vertices can be dragged, and double-clicking an edge inserts a new vertex up to the 12-point limit.

The node outputs the original image with the polygon overlay composited at the original image size, plus a string note that can describe the polygon semantics.

The node UI keeps the editable polygon canvas and the default image preview. The polygon canvas is labeled `多边形编辑画布`, and the default preview area is labeled `原图预览`.

## Inputs

- `image`: input image selector/upload.
- `vertex_count`: polygon vertex count slider, 3 to 12.
- `color`: polygon color. Uses the `COLOR` widget compatible with LayerUtility/LayerStyle ColorPicker.
- `fill_opacity`: polygon fill opacity, 0 to 100.
- `outline_width`: polygon outline width, 0 to 20.
- `polygon_note`: note string passed through to the `string` output.

## Outputs

- `image`: image with the polygon overlay.
- `string`: the `polygon_note` value.

## UI

- Drag any vertex to reshape the polygon.
- Double-click any edge, including the closing edge, to insert a vertex.
- `Clear` removes the polygon and persists that cleared state.
- `Reset` regenerates a centered regular polygon using the current vertex count.
- `Refresh` redraws the preview image without changing saved vertices.
- `Undo` and `Redo` step through polygon edits.

## Files

- Backend: `node.py`
- Frontend: `../../web/polygon_mask_loader.js`
