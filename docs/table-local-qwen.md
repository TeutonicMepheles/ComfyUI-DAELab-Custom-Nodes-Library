# Local Qwen table generation

Status: local text-to-image flow verified, 2026-10-13. Baseline business 3c18ba1, canvas b8fd8b1.

## Scope and ownership

Business repository owns the Qwen adapter and generation settings. Reuse the
existing table prompt controls, column defaults, cell overrides, receipts,
history and result writeback. Canvas needs no model dependency.

First preset: Qwen-Image-2.1 Turbo, installed INT8 diffusion / Q8 GGUF encoder /
F16 mmproj / BF16 VAE, text-to-image only. Use the previously validated native
workflow (8 steps, Euler/simple, CFG 1, batch size 1, Qwen cache).
Reference images are rejected explicitly. No automatic model or cloud fallback.
New image columns default to local Qwen; existing workflows keep their settings.

## Execution and concurrency

Extract the existing native execution lifecycle from H3. Both adapters share
one process-wide local job semaphore (1), across tables and submissions, and
submit to the existing ComfyUI native queue. Do not start another GPU server.
Preserve pause, original-prompt recovery and result identity; a missing original
job must never be silently regenerated. Pause may interrupt only its own prompt.
Bound Qwen dimensions to multiples of 32, 256–2048, at most 2,097,152 pixels;
default 1024 square. These are this workstation preset limits, not model limits.

## Acceptance

Test exact graph/model configuration, invalid inputs, missing dependencies,
shared local serial execution, duplicate recovery, pause isolation and cell
writeback. Run one real row then a two-row batch in the actual desktop service.
Inspect two table instances, configuration isolation, keyboard focus, overflow,
zoom, active/mute/bypass and save/reload. No LibTV generation calls. Coordinate
against the native queue while the independent H3 download/session continues.

## Validation — 2026-10-13

- Desktop ComfyUI 0.39.2 / frontend 1.53.10, RTX 5080, port 8000.
  Restarted through the existing Manager endpoint while the native queue was
  empty; retained the desktop launch configuration and model paths. No second
  GPU server; the independent H3 session remained in its download phase.
- Real UI submissions: one 1024-square row, followed by two rows at the same
  resolution. Exact native execution times: 35.383 s (cold), 15.314 s and
  13.163 s (warm). All three completed and returned one image per original row.
  Native timestamps show no execution overlap. This is a three-image smoke
  test, not a sustained throughput or peak VRAM benchmark.
- Paused the waiting second row, observed the first continuing, then resumed
  the second. Native history contains one execution per row; no duplicate jobs.
- Saved and reloaded two real table instances: results remained [1, 2], modes
  restored to Active, and per-instance seeds remained independent. Native and
  creative canvas views both display the same results. Inspected 65% and 102%
  zoom, focused numeric fields, invalid 1000px width, a scrolled settings panel,
  and edge-positioned popovers in the 1280x720 viewport.
- UI regression found in the existing canvas host: inactive business panels
  were dimmed but still expanded. The Canvas repository now uses the shared
  active-state helper to hide body/media while preserving saved expansion;
  Bypass/Mute and Active restoration were inspected with the other table active.
- Automated validation: 252 relevant Node tests in the business repository,
  43 table Python tests, 36 LibTV Python tests with mocks, and 31 Canvas tests.
  Optional integration/standalone boundaries are covered by contract tests;
  this run used the actual combined installation, not a second standalone runtime.
- No paid/cloud generation. H3 generation remains outside this validation;
  Qwen reference-image mode is intentionally rejected, not silently ignored.

Local evidence (kept outside Git):
`user/default/workflows/Qwen-Table-Local-Acceptance-20261013.json`,
`user/qwen-table-validation/receipts.json`, `native-history.json`, and screenshots.
Outputs are under `output/DAELab/table-local-qwen/`.

