---
name: comfyui-node-advanced
description: Implement ComfyUI dynamic slots, matched socket types, conditional schemas, or execution subgraphs.
---

# ComfyUI Node Advanced

Use an advanced pattern only when the requested node behavior needs it. Preserve serialized slot identity and compatible connections; dynamic UI does not authorize changing saved workflow semantics.

Choose the relevant mechanism:

- MatchType, MultiType, Autogrow, DynamicCombo, or arbitrary inputs: [dynamic-inputs](references/dynamic-inputs.md).
- Subgraph expansion or conditional execution blocking: [expansion](references/expansion.md).
- Async execution or progress reporting: [runtime-api](references/runtime-api.md).

Node replacement for an intentional identity change lives in [migration compatibility](../comfyui-node-migration/references/node-replacement.md).
