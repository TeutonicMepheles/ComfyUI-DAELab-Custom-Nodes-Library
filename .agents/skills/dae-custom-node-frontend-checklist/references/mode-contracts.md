# Mode-state contracts by owner

Select the contract from the repository's ownership rules and implementation, not the presence of “DAELab” in its directory name. A read-only audit is not permission to extend another package's UI.

## DAELab business library

`ComfyUI-DAELab-Custom-Nodes-Library` owns final App Mode handling for its exported nodes, including those without a custom DOM panel.

- Reuse `web/app_mode_bypass.js` and `web/app_mode_bypass_model.mjs`. Keep node-specific composite-input construction separate from shared mode observation, Inspector hiding, and restoration.
- Every exported node must hide/collapse its selected inputs or composite panel while non-Active. Returning to Active restores original visibility, enabled state, ARIA state, values, and layout without duplicate controls.
- For added, removed, or renamed nodes, reconcile backend `NODE_CLASS_MAPPINGS`, frontend `DAELAB_NODE_TYPES`, and the exact coverage assertion in `tests/app_mode_bypass_model.test.mjs`.
- Run `node --test tests/app_mode_bypass_model.test.mjs` when exported-node coverage or shared mode behavior/integration changes. Exercise the affected final App Mode UI; for a shared change cover its consumers, including nodes without custom panels.

The scanner is a static inventory, not a Python evaluator. Constants, imported IDs, and mapping updates can make its backend inventory incomplete. An `INCOMPLETE`/null structural result requires reconciling the loaded registry or registration source; do not delete IDs merely because a text scan did not find them.

## Standalone Creative Canvas

`ComfyUI-DAELab-Creative-Canvas` owns its canvas, upload node, shared controls, theme, fonts, and gallery. Its panel availability lives in `web/creative_panel_state.mjs`.

- Reuse the owned availability binding. Non-Active panels collapse/hide and become inactive; Active restores the prior state. Clean up instance-owned bindings when disposed.
- Do not install business-library App Mode runtime/model/registry files into this repository. Do not hide another extension's DOM or the host Inspector to implement canvas availability.
- Keep `DAELAB.MediaUpload`, serialized slots, material JSON, and `daelabCreativeCanvasV1` compatible. Business panels use the public adapter contract; inspect `docs/adapter-contract.md` for integration changes.
- Use the repository's relevant panel, serialization, and adapter tests. For integration changes inspect both standalone and combined installations; paid generation is not a canvas validation step.

The scanner's canvas structural check verifies the expected panel helper exists, not that its behavior works. Inspect the loaded UI for acceptance.

## Other custom nodes

Follow the owning package's mode and serialization contract. Do not impose DAELab filenames or registry conventions on another extension. `--profile generic` performs the general sizing scan without a DAELab structural gate.

## Runtime acceptance

For the affected owned UI, exercise Active → Muted → Active and Active → Bypassed → Active, including reload while inactive. Verify visibility, values, focus/interaction state, and layout restoration without duplicate widgets or listeners. Preserve original disabled/hidden states, canonical serialization slots, and link identities. Inspect two real instances and save/reload; static file presence and model tests alone are insufficient.
