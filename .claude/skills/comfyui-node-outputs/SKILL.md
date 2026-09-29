---
name: comfyui-node-outputs
description: Implement ComfyUI node return contracts, UI previews, or saved media outputs.
---

# ComfyUI Node Outputs

Match returned values to declared output slots. Preserve downstream types and saved workflow compatibility. Distinguish temporary previews from permanent output files; use existing save helpers where possible.

Select the needed output path:

- Data/UI return values, output options, or existing V1 nodes: [return-contracts](references/return-contracts.md).
- Image, mask, audio, video, text, or 3D previews: [previews](references/previews.md).
- Saving images or audio with metadata: [saving](references/saving.md).

Confirm helper signatures against the installed runtime when adapting an example. Preview delivery is distinct from browser rendering; inspect the real node when changing its visible output.
