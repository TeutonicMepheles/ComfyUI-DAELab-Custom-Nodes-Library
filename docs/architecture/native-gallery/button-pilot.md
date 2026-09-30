# Native creative button pilot

Scope: creative card Settings/Ports/Remove and LibTV New request ID/Restore preview. Twenty-six instances in Creative Canvas Controls share `web/creative_button.mjs`. The batch panel uses its existing New batch ID button. Generation, connection, table, upstream ComfyTV and exhibition/badge App Mode controls are outside this pilot.

## Ownership and reuse

- Existing `list_editor_controls.mjs` was reviewed: its icon-button factory embeds list-specific sizing/styles. Reusing it for text buttons would change the current appearance.
- Existing card and studio CSS remains the visual authority; this pilot changes no CSS. It extracts native button behavior, not the entire visual design system.
- `createCreativeButton(label, action)` constructs a native button with the shared binding. Native focus, Enter and Space semantics remain browser-owned.
- LibTV exposes references to existing buttons. Only creative panel leasing calls `bindCreativeButton`. Release/abandon restores the exact original onclick and owned attributes. No copied business action or node data lives in the helper.
- Promise-returning actions are disabled and aria-busy while pending. Their owner handles user-facing errors. Binding is idempotent; disposed async completions cannot overwrite a later binding.
- Actions must return their asynchronous work and leave temporary busy/disabled management to this helper. The current pilot actions meet that contract.

## Acceptance evidence

Run `node tools/creative_button_smoke.mjs` against localhost:8000. It loads the existing JSON in a fresh isolated browser, never overwrites the user's workflow, and blocks prompt POST requests.

`button-pilot-verification.json`: 15 passing browser checks, 26 shared instances, no page errors and no generation requests. Covers independent request IDs, card action, repeated-click guard, success/error cleanup, exact handler restoration over three mode roundtrips, idempotence, disposal during pending work, stale completion isolation, keyboard activation and serialization/reload. `button-pilot.png` records native rendering.

21 related Node tests passed: creative_canvas_model, app_mode_bypass_model, libtv_canvas_result.

Limitations: no full exhibition/badge App Mode visual regression was performed. No claim of completing all control migration or visual-token consolidation. CSS was not changed; before/after pixel equivalence was not measured. Next migrate one additional control family only after reviewing this pilot.
