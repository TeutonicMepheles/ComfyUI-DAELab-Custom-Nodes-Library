---
name: comfyui-node-basics
description: Define a ComfyUI Python node class and schema. Use for new nodes or structural changes to a node definition.
---

# ComfyUI Node Basics

Use the API style supported by the target package. A repair to a V1 node does not imply a V3 migration.

- Preserve published node IDs, socket order, widget serialization, and existing workflows. DAELab-owned nodes use stable `DAELAB.*` IDs.
- In V3, node methods use classmethods; execution returns `io.NodeOutput` in schema output order. Match parameter names to input IDs and avoid instance state.
- Check the installed implementation when a referenced API is missing or differs from the example. Examples are patterns, not a mandate to upgrade ComfyUI.

Read only the reference needed for the task:

- Creating a V3 class or changing schema fields: [node-schema](references/node-schema.md).
- Maintaining an existing V1 node or comparing its structure: [legacy](references/legacy.md).

For extension registration, use [packaging](../comfyui-node-packaging/SKILL.md). Load [migration](../comfyui-node-migration/SKILL.md) only for a requested API migration.
