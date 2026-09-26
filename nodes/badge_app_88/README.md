# Badge 8.8: target-image-only sampling (2026-09-18)

The current `#8.8 - Badge Workflow.json` is copied from current 8.7. It reuses
the same target selection, draft state, material lists, manual masks, templates,
generation controls, and optical/boundary processing. The only product difference
is that local colors are sampled from the current edit target. The source switch
and map generation/preview controls are hidden; changing the edit target updates
the existing reference and sampling path.

`extra.daelabBadgeTargetOnlyV1.version=1` selects this variant, distinct from the
historical experiment. `DAELAB.BadgeApp88TargetOnlyV1` delegates to current 8.7,
clears stale map inputs, rejects `color_map` requests, and reports version 8.8.
The authoritative region preview applies the same policy. Shared App Mode Bypass
includes the new executor. No segmentation or material semantics are changed.

Build with `python tools/build_badge88_target_workflow.py`. It generates repository
and workspace workflow copies independently from their respective 8.7 files,
verifies that 8.7 stays byte-identical, and preserves the old 8.8 as
`#8.8-Legacy - Badge Local Materials.json` before replacement.

## Historical 8.8 local region materials experiment

`DAELAB.BadgeApp88V1` adds `edit_mode: region_materials` for local color selections.
The workflow opts in with `extra.daelabBadgeLocalMaterialsV1.version: 1`; its
`nodeId` points to a separate instance of `DAELabBadgeMaterialRegionV1` (201).
`daelabBadgeExecutionV1` remains the shared stage-runner compatibility contract.
The 8.8 request compiler selects the new executor explicitly. Other edit modes
and build/studio execution delegate to the unchanged 8.7 backend implementation.

## Interaction and execution

- Choose local color selection and **设置区域材质**. Each list row owns a color,
  tolerance, material, strength, and supported color policy. Semantic and brush
  modes retain their separate existing controls.
- Use the current target or its validated GPT ID map for sampling. The map never
  replaces the edit image. Reference docking, image uploads, material thumbnails,
  compact row controls and native App Mode Bypass are reused.
- Preview either all regions or the currently selected row. Pixels are assigned
  once to the nearest matching color; equal distances retain the earlier row.
  Target alpha excludes holes. Empty/tiny rows stop execution before model calls.
- Save distinct material drafts per target. A target change clears preview tokens
  and map previews; changing back restores that target's saved draft.
- Freeze all region masks before generating. For each output, start from the
  target and apply one masked model call per row, preserving optical material
  changes. Never re-sample the edited intermediate image or snap mask boundaries.
- If a palette/original color reference is present, retain the color finish call.
  The final deterministic composite is always limited to the regions' union.
- The preview ledger hashes each region mask as well as the union, images and
  request. Swapping ID-map labels cannot reuse a token merely because the union
  is unchanged. Output paths use `Badge88/`.

## Validation (2026-09-11)

- 286 JavaScript tests and 152 Badge Python tests passed, including 8.7 regressions.
- Real App Mode browser smoke: two independently configured materials, correct
  node ownership, union/selected-row previews, mode-switch persistence, and live
  request compilation to `region_materials`.
- Synthetic 512×512 target: union 75,311 pixels, selected blue row 48,471 pixels.
  Real ComfyUI queue validation at 1024×1024 returned union 301,244 pixels and
  per-region counts 107,360 / 193,884, matching the scaled browser preview.
- Model graph tests verify fixed masks across generation, constraints and
  composition; two regions × two variants plus color finishing uses six calls.
- GPT image generation and visual material quality have **not** been accepted by
  this run. Browser/queue smoke uses a synthetic fixture and no paid model calls.

`tools/build_badge88_workflow.py` regenerates the repository template without
modifying 8.7. The local user copy was separately forked from the saved 8.7 to
retain its inputs, output selections, palette and generation settings.
Restart ComfyUI to register the new Python node, then load **#8.8 - Badge Workflow**.
