# Badge App Workflow V1

DAELab-owned routing and safety nodes for the `#8.6 - Badge Workflow` App Mode.

- Normalizes an uploaded effect render onto the workflow's 1024 square canvas.
- Selects exactly one entry path with lazy inputs.
- Selects semantic or material prompts without resolving the unused branch.
- Persists Color ID Maps by a digest of the canonical master and generation settings.
- Requires a two-stage selection snapshot confirmation before a local GPT edit.
- Selects local/studio results lazily so disabled branches do not execute.

All public identifiers use the `DAELAB.*` namespace and have no runtime dependency
on ComfyTV.
