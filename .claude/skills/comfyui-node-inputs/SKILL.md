---
name: comfyui-node-inputs
description: Configure ComfyUI Python input declarations, widget options, hidden values, or lazy inputs. Excludes browser UI implementation.
---

# ComfyUI Node Inputs

Preserve input IDs, serialized widget order, defaults, and connection compatibility unless the task changes that contract. Optional inputs need matching execution defaults. Hidden-input access differs between V1 and V3.

Choose the relevant reference; browser-side widgets belong to [frontend](../comfyui-node-frontend/SKILL.md):

- Scalar, combo, upload, and specialized widget declarations: [widgets](references/widgets.md).
- Socket behavior, optional/hidden inputs, or conditional evaluation: [connections-hidden-lazy](references/connections-hidden-lazy.md).
- V1 syntax or a complete multi-input example: [examples](references/examples.md).

For runtime tensor formats use [datatypes](../comfyui-node-datatypes/SKILL.md); for growing slots or conditional schemas use [advanced](../comfyui-node-advanced/SKILL.md).
