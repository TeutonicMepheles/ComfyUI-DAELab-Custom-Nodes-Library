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

## Image color-picking interaction

- Any App Mode interaction that requires sampling, matching, or verifying a color from an image must keep the corresponding reference image visible in the sticky reference area at the top of the interface.
- When the user activates or focuses the relevant color control, expand the actual current color source inline to the full available width of the top reference area. Do not require a separate modal as the primary color-picking view, and hide or de-emphasize unrelated thumbnails while the source is expanded.
- Resolve the expanded image through stable workflow-scoped input or source identifiers, never through mutable display labels. The displayed image must be the same source actually used by the color-processing path; do not substitute an upload, stale execution result, downstream output, or other potentially misleading fallback.
- If the required source is unavailable or invalid, keep a clear compact placeholder instead of expanding a substitute image. Leaving the color-picking context, changing tabs or routes, or rebuilding App Mode must restore the normal reference layout.
- Reuse the shared reference-dock and color-control activation contracts when available, and cover source mapping, expansion/reset behavior, missing-image handling, and App Mode lifecycle restoration with tests.

## Creative canvas development contract

- Before changing shared controls or adding a creative-canvas node, read and follow [the control and node development contract](docs/architecture/CONTRIBUTING_CONTROLS.md).
- Keep shared interaction code independent of business nodes; inject actions through explicit contracts and dispose all instance-owned bindings. New nodes must not call another node’s private implementation.
- Use the native ComfyUI gallery as the visual acceptance baseline. Preserve exhibition/badge App Mode and read-only ComfyTV upstream boundaries.

## UI design standards


### Material Design

- Use Material Design 3 as the design baseline for newly developed or explicitly
  redesigned custom UI: semantic color roles, typography, spacing, shape,
  elevation, and consistent interaction states. Adapt density to desktop creative
  tools; preserve established canvas gestures and business behavior.
- Reuse shared controls and design tokens instead of copying colors, dimensions,
  or interaction logic into individual nodes. For DAELab, the shared theme entry
  is `web/creative_theme.css`;
  the native creative canvas and auxiliary Vue gallery must use the same tokens.
- Scope styles to the owned UI (`.dae-creative` / `.dae-ui` for DAELab). These
  standards do not authorize restyling native ComfyUI, read-only upstream code,
  or existing exhibition/badge App Mode outside the requested task scope.
- Provide clear hover, focus, selected, disabled, busy, and error states. Preserve
  visible keyboard focus, respect reduced-motion preferences, and target at least
  4.5:1 text contrast and 3:1 contrast for essential control boundaries.
- Verify changes in the actual ComfyUI canvas and at least two real instances,
  including mode switching and save/reload. An independent gallery or CSS-only
  assertion is not sufficient product acceptance.

### Chinese typography and bundled fonts

- Use Alibaba PuHuiTi 3.0 for custom UI Chinese and mixed Chinese/Latin text.
  Prefer Regular (400) for body text, Medium (500) for titles and control labels,
  and SemiBold (600) for emphasis. Default sizes are 14px body, 16px node titles,
  and 12px supporting text, with approximately 1.5–1.6 line height.
- Reuse DAELab's `--dae-font-family` and the `DAELab PuHuiTi 3` CSS family alias
  defined in `web/creative_theme.css`. Keep typography consistent in leased node
  panels and native form controls; avoid node-specific system-font overrides.
- Bundle the original WOFF2 files with the extension and built distribution.
  Current assets live in
  `web/vendor/alibaba-puhuiti-3/`.
  Load them through relative `@font-face` URLs, without `local()` or external
  font services, so another machine does not need the fonts installed.
- Preserve the font's own license, copyright notices, and SHA-256 manifest with
  the assets. Reuse the supplied original files without conversion or subsetting;
  do not apply the repository's code license to third-party fonts.
- Check that packaged font files match the manifest and are actually emitted by
  the build. Verify actual rendered web-font usage and successful local loading
  after refresh, not just the CSS family name. Distinguish this verification from
  testing on a second physical machine; OS rasterization may still differ.

### Icon usage

- Whenever custom-developed content in this workspace needs icons, use open-source
  icons from [Phosphor Icons](https://phosphoricons.com/) or
  [Remix Icon](https://remixicon.com/).
- Prefer reusing an icon library already integrated into the project. Keep icon
  style, size, and stroke weight consistent within the same interface.
- Follow the license requirements of the chosen icon library and retain any
  required license notices.

### Required visual checks after frontend changes

- After every frontend logic change, inspect the affected UI in the actual
  ComfyUI interface before reporting completion. Apply the same checks to layout
  and styling changes; passing unit tests or a build does not establish visual
  correctness.
- Check for unintended overflow and clipping of text, controls, media, menus,
  tooltips, and focus outlines. Exercise expanded/collapsed states, long content,
  and relevant viewport sizes or canvas zoom levels. Ensure scrolling is owned
  by the intended container and all actions remain reachable.
- Check whether panels and content fill the available container as intended.
  Look for unexplained blank space, constrained width/height, nested scrollbars,
  and fixed dimensions that prevent resizing. Preserve intentional spacing and
  media aspect ratios; do not stretch content merely to fill space.
- Reassess container choice: inline panel, card, popover, or modal must suit the
  interaction and content. Check sizing, anchoring, layering, scroll ownership,
  and focus behavior. Fix inappropriate containers rather than masking problems
  with arbitrary fixed sizes or `overflow: hidden`.
- Review text-button versus icon-button choices. Use text for primary actions,
  unfamiliar operations, or ambiguous meanings; use icon-only buttons for familiar
  compact actions where the context is clear. Icon-only buttons require an
  accessible name, a discoverable tooltip, and an adequate hit area. Keep the
  same action's presentation consistent across instances.
- Inspect rendered screenshots and interact with the affected states. Correct
  observed layout defects and recheck before completion; if runtime inspection
  is blocked, explicitly report what remains visually unverified.
