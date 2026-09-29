---
name: dae-custom-node-frontend-checklist
description: Diagnose or fix ComfyUI DOM-widget sizing, restore, or mode-state defects. Excludes backend-only changes.
---

# DAE Custom Node Frontend Checklist

Make the node compact, stable across lifecycle events, and still usable at its supported widths. Treat a saved workflow size as an input to investigate, not proof that the size is correct.

## Select the owning contract

- An audit authorizes inspection and reporting; a requested fix includes implementation and proportionate verification. Preserve unrelated work.
- Creative Canvas owns its panels and `web/creative_panel_state.mjs`; business packages retain their shared App Mode implementation. Keep ComfyTV read-only and unrelated exhibition/badge UI out of scope.
- For mode-state or exported-node changes, read [mode contracts](references/mode-contracts.md) and select canvas, business, or generic behavior. Do not add business App Mode files to the standalone canvas.
- For DOM sizing, layout CSS, or refresh/reopen defects, read the relevant sections of [height and layout](references/height-layout-checklist.md). A text-only change does not need a complete sizing investigation.
- Reuse existing controls and sizing helpers. When diagnosing restore behavior, compare saved size/widget order with live lifecycle measurements rather than treating saved dimensions as correct.

Use the read-only scanner when a source inventory or structural mode check will help:

```bash
node <skill-dir>/scripts/audit_frontend_layout.mjs <custom-node-repository>
```

The scanner reports its detected contract. For a renamed/ambiguous checkout, pass `--profile business`, `--profile canvas`, or `--profile generic` after inspecting its ownership rules. A DAELab-like folder name alone is insufficient. Findings are review leads; structural checks do not prove browser restoration.

## Implementation rules

- Keep installation and sizing idempotent. Multiple lifecycle callbacks or cache-busted module instances must not duplicate widgets or wrap callbacks repeatedly.
- Break height feedback loops. For compact auto-fit nodes, measure minimum content from a neutral height before applying the computed result. For user-resizable nodes, persist explicit user dimensions and guard programmatic resize callbacks.
- Constrain fixed DOM rows with matching minimum and maximum heights. Leave a row flexible only when expansion is an intended feature.
- Preserve stable widget names, serialization order, workflow migration, connections, and App Mode behavior.
- Add material-specific or node-specific CSS overrides instead of changing shared controls when the shared behavior is correct for other nodes.
- Version changed local module imports or add a safe cache-busting entry point when refresh testing shows stale frontend code. A versioned entry must remain side-effect safe when both the normal and versioned module URLs load.
- Do not edit saved workflow heights merely to conceal a frontend sizing bug. A runtime migration may compact legacy oversized nodes, but it must have a defined policy and remain idempotent.

## Verification gate

- Every frontend change still requires actual ComfyUI inspection of two instances, overflow/focus, mode switching, save/reload, and relevant zoom/viewports. Follow the owning repository's required checks.
- For sizing/restore defects, measure before/after dimensions and exercise the failing lifecycle with long/async content and supported widths. Repeat refresh/reopen when needed to establish convergence.
- Add regression coverage for the failed invariant. Run the business App Mode model test when its registry, shared mode logic, or integration changes; broaden to affected consumers when shared behavior changes. Do not run that nonexistent test in Creative Canvas.
- Schema/widget-order changes require relevant backend and serialization checks. A scanner, gallery, or model test does not establish browser correctness.
- Continue through implementation, relevant checks, real-page inspection, and correction of observed defects. If runtime inspection is blocked, report exactly what remains unverified.

## Completion report

Report the outcome, causal evidence and chosen sizing policy when relevant, controls reused, verification performed, and remaining runtime limitations.
