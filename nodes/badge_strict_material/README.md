# Badge strict material nodes

Deterministic editor-mode building blocks for `#8.5 - Badge Workflow.json`.

- `Badge Material Canvas Normalize V1` uses the actual baked-enamel base image as the canvas authority and resizes flat artwork, discrete height, and foreground masks to that exact size with nearest-neighbor interpolation before masked GPT edits.
- `Badge Height Reference Align V1` registers the six-level height map to the flat-design foreground and blocks invalid height coverage before API execution.
- `Badge Height Locked Base V1` renders macro relief from the discrete height map without generative repainting.
- `Badge Material Constraint V1` locks OKLab chroma and height-owned low-frequency lightness while retaining material-specific mid/high-frequency detail. It adaptively raises weak-but-valid texture to a visible floor, keeps strict zero spill outside the real mask, and uses a deterministic material-specific fallback when the GPT candidate is invalid or imperceptible.
- `GPT-Image-2 Material Region Channel V1` is a canvas-visible, single-region paid-call boundary. Each channel expands exactly one native `OpenAIGPTImageNodeV2` only when its numbered active region exists, and emits an explicit `gpt_node_used` status. A billable request occurs only when that native child has a cache miss.
- `Badge Material Region Merge V1` combines four channel results with mutually exclusive strict masks and reports the actual GPT call count.
- `Badge Material Region Executor V1` remains registered for backward compatibility with older 8.5 drafts.
- `Badge Studio Composite V1` creates the final white background, restrained shadow, and edge light deterministically.
- `DAELAB.BadgeSemanticRegionGPTChannelV1` performs one prompt-driven local repaint against a single immutable image and a foreground-clipped real mask. Disabled, empty, and too-small selections do not expand a native GPT node.
- `DAELAB.BadgeSemanticRegionMergeV1` merges four prompt-driven channels deterministically; slots 1 through 4 define the priority when masks overlap, and pixels outside all masks remain bit-identical to the material master.
- `DAELAB.BadgeStudioBackgroundGPTV1` exposes one optional GPT-Image-2 call that can edit only the inverse, optionally dilated badge foreground mask. It cannot regenerate subject pixels.
- `DAELAB.BadgeStudioColorLockV1` uses normalized flat artwork to pull foreground OKLab chroma back toward the source while retaining the editable master's lightness and texture, then reinserts that foreground over the generated studio background.

Visible channels use stable expansion IDs (`gpt_<region>` and `constraint_<region>`) so the native GPT and constraint children remain independently cacheable. Empty, transparent-lacquer, too-small, and out-of-range channels return the immutable base with a zero mask and never create an API child.

Each region serializes `material_strength` in the range `0.25..1.50`. `1.00` is the catalog-recommended intensity; glitter and rhinestone use stronger frequency profiles than lacquer or enamel while sharing the same color, height, and boundary gates.

The `#8.6` PP branch deliberately uses no GPT-generated segmentation. Its single local-edit mask comes from `DAELabMultiColorMaskV1` operating on the normalized original flat artwork, and its prompt is exposed directly in App Mode. Studio generation is downstream-only, explicitly targets a pure white seamless background, and is never reused as the local-edit coordinate master.
