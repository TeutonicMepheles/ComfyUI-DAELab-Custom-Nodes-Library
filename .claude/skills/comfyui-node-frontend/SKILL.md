---
name: comfyui-node-frontend
description: Implement ComfyUI browser extension hooks, DOM widgets, commands, or panels. Excludes Python input declarations.
---

# ComfyUI Node Frontend

Preserve callback chaining, instance isolation, listener cleanup, widget identity, and serialization. Reuse the owning package's controls and theme. Changes to a node UI do not authorize changing native ComfyUI or unrelated App Mode surfaces.

For DAELab, identify the owning repository: Creative Canvas owns its shared controls, theme, fonts, and panel availability; business packages use the public adapter and retain their App Mode handling. Keep ComfyTV read-only.

Use Phosphor or Remix icons from the existing integration. API examples that accept icon classes require that icon library to be loaded; do not assume a new CSS class or SVG URL works in every icon slot.

Select only the relevant browser reference:

- Registration, lifecycle hooks, DOM widgets, or node properties: [hooks-widgets](references/hooks-widgets.md).
- Commands, settings, panels, menus, or badges: [commands-panels](references/commands-panels.md).
- Execution events, server messages, toasts, dialogs, or manager services: [events-services](references/events-services.md).
- Public imports and API stability boundaries: [imports](references/imports.md).

For a specific module signature, search [API reference](api-reference.md) by module name; verify compatibility with the installed frontend when uncertain.

For sizing, restore, or mode-state defects, use `dae-custom-node-frontend-checklist` when available; in standalone bundles follow the repository's equivalent rules. Complete frontend changes with actual ComfyUI inspection, two instances, overflow/focus, mode switching, save/reload, and relevant zoom/viewports. Fix observed defects; report runtime blockers explicitly. A build or gallery alone is not acceptance.
