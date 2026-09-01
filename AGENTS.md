# Repository rules

These rules apply to every custom node and every file under this repository.

## App mode Bypass behavior

- Every exported DAELab node must support automatic collapsing of its inputs or composite panel in the final App Mode UI whenever the node is Bypassed, Muted, or otherwise not in the normal Active mode. Restoring Active mode must restore the original UI state.
- Reuse the shared implementation in `web/app_mode_bypass.js` and `web/app_mode_bypass_model.mjs`; do not add a node-specific copy of the same visibility logic.
- When adding or renaming a node, update `DAELAB_NODE_TYPES` in `web/app_mode_bypass_model.mjs` and the coverage assertion in `tests/app_mode_bypass_model.test.mjs`. A node is not complete until its App Mode Bypass behavior has been tested.

## Frontend interaction reuse

- Before designing or implementing any interactive frontend behavior, search the existing files in `web/`, the node implementations in `nodes/`, and their tests for a reusable control, panel, model, state helper, or interaction pattern.
- Prefer importing, extending, parameterizing, or extracting shared code from an existing control over creating overlapping behavior. Preserve the existing control's serialization, workflow migration, connection, and App Mode semantics.
- Create a new control only when no existing control can meet the requirement without harming its established behavior. When overlap is substantial, refactor the common behavior into a shared module instead of duplicating it.
- In the implementation summary, state which existing controls were evaluated and what was reused, or briefly explain why a new control was necessary.
