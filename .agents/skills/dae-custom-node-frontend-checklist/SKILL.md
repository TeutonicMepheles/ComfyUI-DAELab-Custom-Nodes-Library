---
name: dae-custom-node-frontend-checklist
description: Audit and fix frontend layout and App Mode behavior for ComfyUI custom nodes in this repository, especially DAELab DOM-widget nodes whose size grows, stretches, clips, or changes after refresh, workflow reopen, restore, Bypass/Muted transitions, or frontend cache updates. Use when creating or reviewing a custom-node frontend or diagnosing persisted node-size instability; do not use for backend-only Python changes.
---

# DAE Custom Node Frontend Checklist

Make the node compact, stable across lifecycle events, and still usable at its supported widths. Treat a saved workflow size as an input to investigate, not proof that the size is correct.

## Start with scope and evidence

- Read the repository's `AGENTS.md` and inspect the working tree before editing. Preserve unrelated changes.
- Search existing frontend controls, sizing helpers, DOM widgets, App Mode behavior, and tests before adding a new implementation. Reuse established serialization and resize patterns when they match the requirement.
- Respect the requested task type: an audit or diagnosis authorizes inspection and reporting, while a requested fix authorizes implementation and proportionate verification.
- Locate the affected node type in frontend registration, backend schema, workflow JSON, and tests. Record saved `size`, properties, widget order, and whether the node is Active, Muted, or Bypassed.

Run the read-only scanner for a fast inventory:

```bash
node <skill-dir>/scripts/audit_frontend_layout.mjs <custom-node-repository>
```

Scanner findings are review leads, not automatic defects. Build the causal chain from runtime evidence before changing code.
For a DAELab repository, the scanner also performs a structural App Mode gate by comparing backend `NODE_CLASS_MAPPINGS`, `DAELAB_NODE_TYPES`, and the coverage assertion in `tests/app_mode_bypass_model.test.mjs`.

## Required layout audit

Read [references/height-layout-checklist.md](references/height-layout-checklist.md) before changing a node that uses `addDOMWidget`, overrides `computeSize` or `computeLayoutSize`, changes node layout CSS, or exhibits size changes after refresh/reopen.

Determine these points explicitly:

1. Which lifecycle callbacks create, restore, arrange, and resize the widgets?
2. Does any height calculation read the already-restored `node.size[1]` and feed it into a later `computeSize` or `setSize` call?
3. Which rows are fixed, content-sized, or intentionally flexible? Are both `minHeight` and `maxHeight` supplied when a row must not absorb surplus height?
4. Is the desired policy compact auto-fit, persisted manual resize, or a mixture? Do not force one policy onto all nodes.
5. Does width change the number of rows, aspect ratio, or required height? Derive height from content geometry, not from the current node height.
6. Can asynchronous catalog/image loading, App Mode transitions, or stale frontend modules reinstall the UI or recompute size in a different order?

## Implementation rules

- Keep installation and sizing idempotent. Multiple lifecycle callbacks or cache-busted module instances must not duplicate widgets or wrap callbacks repeatedly.
- Break height feedback loops. For compact auto-fit nodes, measure minimum content from a neutral height before applying the computed result. For user-resizable nodes, persist explicit user dimensions and guard programmatic resize callbacks.
- Constrain fixed DOM rows with matching minimum and maximum heights. Leave a row flexible only when expansion is an intended feature.
- Preserve stable widget names, serialization order, workflow migration, connections, and App Mode behavior.
- Add material-specific or node-specific CSS overrides instead of changing shared controls when the shared behavior is correct for other nodes.
- Version changed local module imports or add a safe cache-busting entry point when refresh testing shows stale frontend code. A versioned entry must remain side-effect safe when both the normal and versioned module URLs load.
- Do not edit saved workflow heights merely to conceal a frontend sizing bug. A runtime migration may compact legacy oversized nodes, but it must have a defined policy and remain idempotent.

## DAELab App Mode Bypass hard gate

Apply this gate to every node exported by a DAELab package, including nodes without a custom DOM panel:

- In the final App Mode UI, Bypassed, Muted, and any other non-Active mode must collapse or hide the node's selected inputs or composite panel. Returning to Active must restore the original visibility, enabled state, ARIA attributes, values, and layout without duplication.
- Reuse the shared implementation in `web/app_mode_bypass.js` and `web/app_mode_bypass_model.mjs`. Do not add a node-specific copy of mode observation, Inspector hiding, or restoration logic.
- When adding, removing, or renaming an exported node, update `DAELAB_NODE_TYPES` in `web/app_mode_bypass_model.mjs` and the exact coverage assertion in `tests/app_mode_bypass_model.test.mjs` in the same change.
- Compare the keys in backend `NODE_CLASS_MAPPINGS` with both frontend lists. Missing, extra, or renamed entries are blocking defects; a node is not complete until the lists agree and the App Mode tests pass.
- Keep node-specific App Builder input collapsing separate from mode-state hiding. Test canonical composite-input construction where the node groups several native widgets, then test shared Active/Muted/Bypassed behavior through the shared model.

## Verification gate

Before declaring the frontend complete, verify the meaningful subset of this matrix:

- new-node creation;
- workflow load with a legacy oversized saved height;
- two consecutive normal refreshes;
- close/reopen workflow or Comfy Desktop when available;
- minimum supported width and one wider width;
- representative content lengths and async-loaded catalogs/images;
- Active, Bypassed, and Muted App Mode states for every exported DAELab node, including Active-state restoration after each transition;
- serialization round-trip without widget holes, reorder, or duplicated DOM controls.

Prefer real-page measurements for layout claims: graph `node.size`, outer node CSS height, panel and widget bounding boxes, grid column count, and card aspect ratio. A screenshot is useful visual evidence but does not replace numeric checks.

Add regression tests around the invariant that failed, such as minimum-height measurement independent of restored height, stable row/column counts, idempotent installation, or canonical serialization. Run relevant frontend tests and backend tests if schema or widget order is involved.

For DAELab changes, always run at least:

```bash
node --test tests/app_mode_bypass_model.test.mjs
```

Also exercise the final App Mode UI because the model test proves registry and mode classification, not browser DOM restoration by itself.

## Completion report

Lead with the outcome, then state:

- the causal chain, distinguishing saved-state symptoms from the frontend defect;
- the sizing policy chosen and why;
- controls/helpers reused or why a node-specific override was required;
- measured before/after behavior across refresh/reopen;
- tests run and any environment limitation that prevented a matrix item.
