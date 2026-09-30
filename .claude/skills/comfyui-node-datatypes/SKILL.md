---
name: comfyui-node-datatypes
description: Resolve ComfyUI tensor shapes, runtime data formats, or custom socket types when implementing node data processing.
---

# ComfyUI Node Datatypes

Keep tensor layout, batch dimensions, value range, device, and metadata intact unless intentionally transforming them. Preserve unrelated LATENT dictionary keys. Check tensor presence with `is not None`, not truthiness.

Resolve model-specific shapes and API availability against the installed runtime; catalog entries are reference examples.

Read the relevant data contract:

- Looking up a socket type or import: [type-catalog](references/type-catalog.md).
- IMAGE, MASK, LATENT, CONDITIONING, or tensor conversion: [tensors](references/tensors.md).
- Video, 3D, custom types, or wildcard connections: [media-custom](references/media-custom.md).

Widget configuration examples live in [input widgets](../comfyui-node-inputs/references/widgets.md).
