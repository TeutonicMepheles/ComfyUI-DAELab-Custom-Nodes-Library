---
name: comfyui-node-lifecycle
description: Diagnose or change ComfyUI node caching, validation, lazy execution, or list processing.
---

# ComfyUI Node Lifecycle

Choose the mechanism responsible for the symptom. Preserve existing execution behavior outside the requested change; a cache repair does not imply an API migration.

`not_idempotent` and per-run cache invalidation are different mechanisms. Do not treat the flag as an unconditional rerun switch. Lazy inputs may remain unevaluated, and lazy-status callbacks may run more than once.

Read the relevant execution reference:

- Execution roots/order or cache invalidation: [execution-cache](references/execution-cache.md).
- Input validation, lazy evaluation, or list mapping: [validation-lists](references/validation-lists.md).
- Error handling or a combined lifecycle example: [runtime-examples](references/runtime-examples.md).

For server-to-browser events use [frontend events](../comfyui-node-frontend/references/events-services.md). Validate the changed execution invariant with relevant local fixtures; do not submit paid generation merely to test lifecycle plumbing.
