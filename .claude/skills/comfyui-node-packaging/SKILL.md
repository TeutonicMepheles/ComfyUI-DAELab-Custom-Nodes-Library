---
name: comfyui-node-packaging
description: Configure ComfyUI extension registration, dependencies, bundled assets, or an explicitly requested registry release.
---

# ComfyUI Node Packaging

Work in the owning custom-node repository and preserve its existing registration style unless migration is requested. Published node IDs remain stable; change display names for presentation changes. Keep third-party asset licenses and package required fonts/icons.

Use the installed ComfyUI environment to check dependencies and API compatibility. A packaging task does not itself request a public release or a new dependency installation.

Choose the needed packaging reference:

- Package layout, entrypoint, single-file nodes, or conditional registration: [registration](references/registration.md).
- Dependencies, frontend assets, help/i18n, or standard folders: [assets-dependencies](references/assets-dependencies.md).
- Explicitly requested registry publishing or project scaffolding: [publishing](references/publishing.md).

For Python node implementation use [basics](../comfyui-node-basics/SKILL.md). Validate extension discovery and the assets affected by the packaging change.
