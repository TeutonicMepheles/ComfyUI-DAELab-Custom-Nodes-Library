# ComfyUI Frontend Height and Layout Checklist

Use this reference for DOM-widget nodes, responsive thumbnail/panel layouts, and any node whose dimensions change after lifecycle events.

## Contents

1. Restore and lifecycle model
2. Height feedback loops
3. DOM grid and flex behavior
4. Sizing policies and safe patterns
5. Responsive preview grids
6. Cache and duplicate registration
7. App Mode and serialization
8. Runtime measurement checklist

## 1. Restore and lifecycle model

Map the actual callback order instead of assuming creation starts from defaults. A typical workflow load can involve:

1. backend node definition creates native widgets;
2. workflow configuration restores `size`, properties, and `widgets_values`;
3. extension callbacks add/hide/reorder DOM widgets;
4. Vue/LiteGraph lays out rows after the DOM exists;
5. asynchronous data or images rerender the panel;
6. App Mode or bypass logic hides and restores widgets.

Inspect `onNodeCreated`, `onConfigure`, `onAdded`, `onResize`, `onSerialize`, `arrange`, `computeSize`, `setSize`, `requestAnimationFrame`, and deferred promises. A callback scheduled from more than one lifecycle hook must coalesce or be idempotent.

Check workflow JSON directly. Record both graph `size` and runtime outer height; modern ComfyUI may add title/header space to the DOM CSS variable, so these numbers need not match exactly.

## 2. Height feedback loops

The common failure is a self-referential measurement:

```text
restored tall node
  -> auto/flexible DOM rows absorb surplus height
  -> computeSize reads the stretched rows
  -> code writes the computed height back to node.size
  -> workflow saves or reloads the tall height
```

High-risk patterns include:

- panel height derived from `node.size[1]` or `this.size[1]`;
- `Math.max(currentHeight, computedHeight)` in an initialization path;
- calling `arrange()` while the restored oversized height is authoritative, then persisting `computeSize()[1]`;
- using an unconstrained `auto` grid row for a panel that should remain content-sized;
- recomputing after asynchronous render without coalescing scheduled fits;
- wrapping `onResize` without distinguishing user resize from programmatic auto-fit.

Do not infer that `computeSize()` always returns minimum content height. Verify it against a deliberately oversized restored node.

## 3. DOM grid and flex behavior

Modern ComfyUI commonly renders widget rows in a grid/flex container. If the node is taller than the sum of minimum row heights, `auto` rows can share the extra space. This makes the material panel and multiline text areas appear taller even when their own content did not change.

For a fixed-height DOM row, return both bounds:

```js
widget.computeLayoutSize = () => ({
  minHeight: panelHeight(node.size?.[0]),
  maxHeight: panelHeight(node.size?.[0]),
  minWidth: MIN_WIDTH,
});
```

Also ensure the DOM element does not independently request extra height through `min-height`, fixed CSS height, padding, or an aspect-ratio calculation that disagrees with `computeLayoutSize`.

Leave out `maxHeight` only when the row is intentionally allowed to absorb surplus space. Document that choice in code or tests.

## 4. Sizing policies and safe patterns

Choose one policy per node.

### Compact auto-fit

Use when the node should open at minimum usable height and manual height is not a persisted preference. Break the restored-height feedback before measuring:

```js
function fitToMinimumContent(node, minimumWidth, fallbackHeight) {
  const width = Math.max(minimumWidth, Number(node.size?.[0]) || 0);
  const apply = (size) => node.setSize?.(size) ?? (node.size = size);
  apply([width, 1]);
  node.arrange?.();
  const measured = Number(node.computeSize?.()?.[1]);
  apply([width, Number.isFinite(measured) && measured > 1 ? measured : fallbackHeight]);
}
```

Schedule this after DOM widget creation. Coalesce repeated schedules and mark programmatic resize with a guard flag.

### Persisted manual resize

Use when users are expected to expand an editor or preview. Wrap `onResize` and store dimensions only when the resize is not programmatic. During rebuild, restore the saved explicit dimension, not an incidental layout result.

### Hybrid

Use a layout-version property or explicit user-resized property. Compact legacy nodes once, then preserve later user choices. Define the migration threshold and version; do not guess from one screenshot.

Never use a universal fixed height for nodes whose content count or width can change.

## 5. Responsive preview grids

For square previews, keep the geometry consistent across CSS and JavaScript:

```js
const card = Math.min(MAX_CARD, (innerWidth - gap * (columns - 1)) / columns);
const rows = Math.ceil(itemCount / columns);
const panelHeight = verticalPadding + rows * card + Math.max(0, rows - 1) * gap;
```

```css
.node-specific-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 120px));
  gap: 8px;
  justify-content: center;
}

.node-specific-card {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
}
```

Check:

- exact column and row count at supported widths;
- `buttonWidth / buttonHeight` near `1` for square cards;
- image `object-fit` behavior and label space;
- maximum card size so wide nodes do not create oversized previews;
- panel height formula matches actual CSS gaps, padding, insets, and max card size;
- additional catalog items produce more rows without clipping.

Prefer a node-specific override if a shared thumbnail selector is also used by nodes with a different layout contract.

## 6. Cache and duplicate registration

Frontend refreshes can keep an unchanged module URL in cache or in a module registry. When a `.mjs` model changes, version the importing URL:

```js
import { layoutModel } from "./layout_model.mjs?v=YYYYMMDD-layout-v2";
```

If a new cache-busting entry file is needed, make registration safe when both URLs execute:

- compare a global implementation version before `registerExtension`;
- mark installed nodes/widgets with the implementation version;
- remove or reuse owned widgets before rebuilding;
- wrap callbacks only once;
- ensure the versioned entry imports the current implementation and has no independent state mutation.

After code changes, inspect the actual page style/module version. A successful HTTP response does not prove the running page loaded it.

## 7. App Mode and serialization

For every node exported by a DAELab package, App Mode Bypass behavior is a release gate rather than an optional compatibility check.

### Shared implementation contract

- Use `web/app_mode_bypass.js` for observing mode changes and changing final App Mode UI state.
- Use `web/app_mode_bypass_model.mjs` for node recognition, Active/non-Active classification, graph lookup, and App Builder input/output assignment.
- Do not duplicate this behavior inside a node frontend. Node-specific code may collapse several native inputs into one canonical composite-panel input, but shared mode-state hiding and restoration stays in the shared files.
- Keep every backend `NODE_CLASS_MAPPINGS` key in `DAELAB_NODE_TYPES`. When a node is added, removed, or renamed, update the exact list assertion in `tests/app_mode_bypass_model.test.mjs` in the same change.

### Required behavior matrix

| Transition | Required final App Mode behavior |
| --- | --- |
| Active (`mode = 0`) | Selected inputs or composite panel are visible and retain their original enabled/ARIA/layout state. |
| Active -> Muted (`mode = 2`) | The affected inputs or composite panel collapse or hide. |
| Active -> Bypassed (`mode = 4`) | The affected inputs or composite panel collapse or hide. |
| Muted/Bypassed -> Active | Original visibility, enabled state, ARIA attributes, values, and layout return exactly once. |
| Repeated transitions/refresh | No duplicate DOM widget, callback wrapper, or stale hidden state appears. |

Also verify:

- hidden native widgets retain canonical serialization slots if required;
- `serialize: false` DOM controls do not create `null` holes or reorder backend values;
- links remain attached to stable widget/input names;
- workflow reload while the node is Muted or Bypassed starts collapsed, then restores correctly when returned to Active.

Run `node --test tests/app_mode_bypass_model.test.mjs` for registry and mode-classification coverage. Then verify the final App Mode page because browser DOM restoration is outside that model test. If widget order changes, add migration tests for legacy `widgets_values` arrays and named serialization.

## 8. Runtime measurement checklist

Use the real page when possible. Measure at least:

- graph node id/type and `node.size`;
- outer `[data-node-id]` style, including node width/height variables;
- panel `getBoundingClientRect()`;
- every widget row height;
- computed `gridTemplateColumns` and `gridTemplateRows`;
- first and last card bounding boxes and aspect ratios;
- console errors for failed local-module imports.

Test in this order:

1. load a workflow that contains an oversized saved node;
2. capture baseline measurements;
3. load the changed frontend in a fresh page or hard refresh;
4. measure again;
5. normal refresh twice and compare;
6. reopen the workflow or desktop session;
7. exercise App Mode state changes if applicable;
8. serialize and confirm widget values and node count remain stable.

The fix passes when dimensions converge to the intended policy and remain stable. Merely becoming smaller once is insufficient.
