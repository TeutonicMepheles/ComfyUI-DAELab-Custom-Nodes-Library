# Table generation columns

Status: implementation in progress. Product decisions confirmed by the user.

## First implementation checkpoint

Implemented: generation column creation, existing side-panel configuration, direct text and same-row structured column references, image/video transport through the official CLI, per-cell task receipts, bounded parallel execution, stop-before-submission, recovery, and local result backfill. Existing text can be promoted into the shared column-template editor without losing its contents. Copying rows clears generation identities and outputs.

## Parallel table generation

Table generation columns share a process-wide concurrency budget, defaulting to
two jobs. Set `DAELAB_LIBTV_TABLE_CONCURRENCY` before starting ComfyUI to change
the limit (1–8; invalid values fall back to 2; restart required). This is the
number of independent row jobs, not the number of candidates per row. The
standalone `DAELAB.LibTV.StoryboardBatch` node retains its existing serial path.

The entire submitted batch is preflighted before scheduling. Each running job
occupies a slot through generation and download. Independent jobs can finish in
any order; the existing request/record/column IDs route results to their original
cells. A failed row is recoverable without stopping unrelated rows. Stop only
affects waiting jobs; already submitted jobs finish normally. Recovered receipts
sharing an execution identity are serialized, and the persistent bridge request
lock and paid-command reconciliation remain in place to prevent resubmission.

Scheduler tests cover the global budget across batches, stop-before-start,
failure isolation, execution aliases, out-of-order receipts, duplicate submission,
preflight rejection and configuration. They use local mocks and do not establish
the account's actual remote concurrency allowance. No paid validation is required.

2026-09-30 validation: 38 relevant Python tests and 23 table generation/prompt
Node tests passed on a branch based on `origin/main` (`bd9f58c`). No frontend
code changed. The currently running desktop backend still requires a restart
to load the scheduler; live paid parallel generation has not been exercised.

The bridge shares its persistent request protocol with video nodes. Image output adds decoding verification; structured spans are replaced with LibTV `{{Node ...}}` references without rewriting literal prompt text. A server-side input index recovers a request if workflow undo removed its browser receipt. Replacing an existing result is an explicit new request.

Validation: 31 relevant Node tests and 28 Python tests in ComfyUI's virtual environment pass. Tests include image download recovery with one paid-command mock invocation, missing-model rejection, stable column/row identity, stale result protection and receipt recovery after undo. These are isolated tests, not real paid generation evidence.

Outstanding acceptance gates:

- Live `libtv model search --type image` reported TLS ECONNRESET; the returned image/video catalog did not contain the requested models. Their current availability and full real schemas remain unverified. No alternate model was selected or paid generation submitted.
- ComfyUI at localhost:8000 was opened in the in-app browser, but UI targeting failed/misdirected actions and the Chrome control failed to initialize. The generation panel, two-instance isolation, overflow/focus, mode switching and save/reload have NOT passed actual visual acceptance.
- The running ComfyUI process has not been restarted to register the new table-generation routes. Restart and browser refresh are required before runtime acceptance. This checkpoint must not be described as production-ready or fully accepted.

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

## Prompt column fill and verified model names

- The image selector includes Lib Image, Lib Image 2.5 Pro and Lib Image 2.5 Fast, matched by their verified stable LibTV keys. CLI schema/preflight checks passed without paid generation.
- A writable prompt cell exposes “应用到整列”. It replaces every row override with the current prompt as a shared column template. Column references still resolve against each destination row; future rows inherit it. One undo restores the prior column state.
- Validation: 15 prompt/generation tests passed. Actual ComfyUI inspection confirmed the menu, two-row fill, one-step undo, save/reload and isolation from a second table. The running backend still requires restart to load the model mapping fix; paid generation has not been tested. Full multi-viewport and long-content checks remain pending.
