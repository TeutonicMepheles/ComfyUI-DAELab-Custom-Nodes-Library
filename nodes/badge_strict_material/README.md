# Badge strict material nodes

Deterministic editor-mode building blocks for `#8.5 - Badge Workflow.json`.

- `Badge Height Reference Align V1` registers the six-level height map to the flat-design foreground and blocks invalid height coverage before API execution.
- `Badge Height Locked Base V1` renders macro relief from the discrete height map without generative repainting.
- `Badge Material Constraint V1` locks OKLab chroma and height-owned low-frequency lightness while retaining material-specific mid/high-frequency detail. It adaptively raises weak-but-valid texture to a visible floor, keeps strict zero spill outside the real mask, and uses a deterministic material-specific fallback when the GPT candidate is invalid or imperceptible.
- `GPT-Image-2 Material Region Channel V1` is a canvas-visible, single-region paid-call boundary. Each channel expands exactly one native `OpenAIGPTImageNodeV2` only when its numbered active region exists, and emits an explicit `gpt_node_used` status. A billable request occurs only when that native child has a cache miss.
- `Badge Material Region Merge V1` combines four channel results with mutually exclusive strict masks and reports the actual GPT call count.
- `Badge Material Region Executor V1` remains registered for backward compatibility with older 8.5 drafts.
- `Badge Studio Composite V1` creates the final white background, restrained shadow, and edge light deterministically.

Visible channels use stable expansion IDs (`gpt_<region>` and `constraint_<region>`) so the native GPT and constraint children remain independently cacheable. Empty, transparent-lacquer, too-small, and out-of-range channels return the immutable base with a zero mask and never create an API child.

Each region serializes `material_strength` in the range `0.25..1.50`. `1.00` is the catalog-recommended intensity; glitter and rhinestone use stronger frequency profiles than lacquer or enamel while sharing the same color, height, and boundary gates.
