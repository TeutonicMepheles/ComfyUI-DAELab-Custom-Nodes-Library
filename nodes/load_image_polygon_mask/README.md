# Load Image + Polygon Mask

## Node Info

- Node ID: `LoadImagePolygonMask`
- Display name: `Load Image + Polygon Mask`
- Category: `image/polygon`

## Function

Loads an input image and displays editable closed polygons in the node UI. The first polygon defaults to a centered triangle. Hold `Shift` and left-click the image to add another default triangle at the clicked position.

The node outputs the original image with all polygon overlays composited at the original image size, plus the unchanged source image.

The node UI keeps both the editable polygon canvas and the default image preview, each with a visible title.
The canvas also shows a compact interaction note for `Shift + left-click` and `Shift + right-click`.

## Inputs

- `image`: input image selector/upload.
- `vertex_count`: selected polygon vertex count slider, 3 to 12.
- `color`: polygon color. Uses the `COLOR` widget compatible with LayerUtility/LayerStyle ColorPicker.
- `fill_opacity`: polygon fill opacity, 0 to 100.
- `outline_width`: polygon outline width, 0 to 20.

## Outputs

- `masked_image`: image with all polygon overlays.
- `source_image`: unchanged source image loaded by the node.

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
- Saved workflows restore the last selected image and polygon data when reopened.

## Files

- Backend: `node.py`
- Frontend: `../../web/polygon_mask_loader.js`
