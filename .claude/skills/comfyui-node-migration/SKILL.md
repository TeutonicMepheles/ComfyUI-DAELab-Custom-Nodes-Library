---
name: comfyui-node-migration
description: Migrate ComfyUI nodes from V1 to V3 when requested, preserving saved workflow compatibility.
---

# ComfyUI Node Migration

Apply only to a requested API migration or its compatibility review. Maintaining or fixing a V1 node is not authorization to migrate it.

- Preserve the published node ID, input names, socket indices, widget order/defaults, and serialized properties. The Python class name may change without changing `node_id`.
- Inspect instance state before converting methods; V3 execution uses classmethods. Preserve state semantics through an appropriate explicit owner, not a mechanical deletion of `__init__`.
- For an intentional node identity or schema change, provide a replacement mapping and prove that a saved old workflow restores its values and links correctly.
- Verify the target API exists in the installed runtime. Preserve the package's exported node coverage and relevant mode handling.

Choose the relevant migration reference:

- Migration steps, before/after example, method and registration changes: [v1-v3](references/v1-v3.md).
- Looking up a specific property or input conversion: [field-mappings](references/field-mappings.md).

For a deliberately changed node ID or slot mapping, use [node replacement](references/node-replacement.md).

Completion requires old-workflow load/save compatibility, node registration, and relevant execution checks, including caching/lazy inputs where changed. If UI behavior changes, apply the repository's actual ComfyUI acceptance requirements. Continue through failures caused by the migration; do not stop after the first code conversion.
