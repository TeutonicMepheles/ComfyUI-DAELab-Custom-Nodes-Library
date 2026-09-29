# Table generation columns

Status: implementation in progress. Product decisions confirmed by the user.

## Scope

- Add a generation column with a settings icon and a text Generate action in its header.
- Reuse the existing side panel, controls, and column-template editor. No storyboard parsing is required.
- Prompt references identify columns by stable ID and resolve media from the same record. Translate structured references to LibTV references; never submit raw column labels as media identifiers.
- Support image and video output through the official LibTV CLI and existing local account. Requested models: Image-2, Image-2.5, Seedance 2, Seedance 2.5, Minimax H3. Verify actual identifiers and schemas; never substitute models silently.
- Settings apply to the entire column. One result per record. Let users bind an existing prompt column or create an empty prompt column.
- Generate selected records when any are selected; otherwise generate valid records with empty results. Show the affected count. Preserve previous results until replacement succeeds.
- Completed generation cells can be referenced by another column's prompt. Do not automatically execute dependencies.
- Reuse bridge connection/project selection through public services, not another node's DOM or private properties.

## Ownership and correctness

Business model, execution, API and UI belong to this repository. Shared canvas controls belong to the sibling Creative Canvas repository. ComfyTV is read-only.

Persist column configuration and record/column/request identities. Snapshot prompt, references and parameters before submission. Recover existing remote jobs after uncertain outcomes rather than resubmitting. Keep stale responses from overwriting edited, deleted or reloaded records. Download failures must not cause another generation.

Keep model settings derived from live capabilities. Report unavailable models and missing references before submission. Credentials remain in the existing CLI account store and are not serialized in workflows.

## Acceptance

- Test row selection, empty-result defaults, direct text and structured column prompts, completed-result references, stable identities, stale-result protection and recovery without paid submission.
- Verify image/video CLI schema mapping and mocked execution/download separately from real paid generation.
- Inspect actual ComfyUI with two table instances: settings, prompt editing, result preview, long content, focus, clipping, zoom, mode switching and save/reload.
- Preserve existing table editing, history and App Mode behavior. Run relevant frontend/backend suites and staged diff checks.
- Record verified behavior and any blocked live/model/runtime checks before reporting completion.

## Baseline

Local table development contains existing uncommitted surface changes; these are preserved and excluded from this initial plan commit. The implementation branch retains existing table/@-column work beyond remote main rather than dropping those dependencies.
