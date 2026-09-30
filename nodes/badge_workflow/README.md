# Badge workflow nodes

Deterministic building blocks for workflow `#8.2 - 徽章工作流.json`.

- `Badge Design Canvas`: aspect-preserving normalization and authoritative foreground topology.
- `Badge Render Prompt Builder`: fixed front-view master prompt.
- `Badge Master Registration`: translation, uniform scale, and small-rotation registration with IoU rejection.
- `Badge Edit Mask Validator`: foreground intersection, binary/polarity checks, and empty/full-mask routing.
- `Badge Local Edit Prompt Builder`: mutually exclusive prompt/color/material/height operations.
- `Badge Height Patch`: absolute height replacement plus cut-out/solid topology updates.
- `Badge Deterministic Composite`: copies the previous master outside the validated mask exactly.
- `Badge Presentation Prompt Builder`: presentation-only studio and camera semantics.
- `Badge Edit State Save / Load`: portable zip package containing the master, design, height, topology, registration, prompts, and color-group configuration.

The material/color nodes and their color picker are reused from `GPTImage2MaterialPrompt`; no badge-specific color picker is introduced.
