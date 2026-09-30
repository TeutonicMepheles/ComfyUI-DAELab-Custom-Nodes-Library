# Table interaction refresh

## Row and column interaction review

Creative-canvas content tables use a dedicated row gutter and column drag handles.
The editor owns selection and SnapshotHistory; `table_structure.mjs` owns pointer
capture, insertion feedback, edge scrolling and the draft-only column popover.
`table_structure_model.mjs` reorders existing IDs, preserving hidden field slots,
prompt bindings, row metadata and asset identities. Native tables keep their
existing presentation. No generation or upstream changes are involved.

Accept against two real ComfyUI instances: multi-row and column reorder, cancel,
append/insert, empty table, draft cancellation, undo/redo, save/reload, mode
switches, long media rows, narrow layouts and canvas zoom. UI verification is
recorded separately from model tests.

### Verification, 2026-09-29

- Actual ComfyUI port 8207, `Row Column Interaction Review`: two real table
  instances; pointer row/column moves, keyboard multi-row move, draft cancel,
  column creation, save/reopen, graph/creative mode return, and 42%/83% zoom.
- Reused shared buttons, theme, Remix icons, column menus, splitter geometry,
  SnapshotHistory and optional Creative Canvas history boundaries. The new
  structure controller owns pointer lifecycle because whole-cell HTML dragging
  conflicts with content editing and cannot provide atomic multi-row moves.
- Native Ctrl+Z now uses the host workflow history in creative mode; explicit
  before/after boundaries keep a new row or reorder to one undo step. Verified
  on fresh `structure3` modules, preserving the other instance.
- 36 table JavaScript tests pass. Screenshot: workspace
  `output/table-structure-review/add-column.png`. No paid generation was run.
- Not yet stress-tested: 500-row edge scrolling, touch input and empty-table
  runtime behavior. Model checks do not replace these interaction checks.

Scope: generic and storyboard tables; material-group filling is excluded.

The business package owns records, selection, parsing, generation, undo and dialogs.
Creative Canvas owns shared theme and controls; consume those optionally without
making standalone business registration depend on that extension being installed.
Reuse the existing editor DOM in the workbench, preserving history and scroll.

Use a compact view toolbar and a contextual selection toolbar. Mapping is visible
before parsing; generation opens an explicitly named configuration step. Persist
user-selected panel height independently of incidental native node layout. Keep
parse results visible and prevent concurrent parsing within a table instance.

Verify two real nodes, long content, narrow/wide layouts, workbench return, keyboard
focus, modes and save/reload. No paid generation is needed for this UI acceptance.

## Verification, 2026-09-28

- Combined installation: actual ComfyUI on port 8207, two `DAELAB.Table`
  instances. Editing the copied table preserved the original; saved/reopened
  content remained distinct. Explicit heights restored as 1000px and 520px.
- Creative/native graph switching, compact summary to editor and return,
  table/cards and asset-group tab return were exercised. Mapping and the local
  compiler produced one success and two empty-body failures with persistent
  feedback. No generation service was invoked.
- Wide and 640px viewport checks: corrected card tracks spreading into empty
  columns. At 640x880 the open dialog was 607x847 and footer bottom was 815px,
  inside the viewport. Screenshots are in workspace `output/table-ui-review/`.
- Standalone business installation: temporary port 8228 with only the business
  package whitelisted loaded both tables and opened the native workbench. Shared
  controls/theme are optional; the table retains native controls and CSS fallbacks
  when the canvas extension is absent. The temporary server was stopped.
- 42 relevant business tests and 16 canvas tests passed; syntax and diff checks
  passed. Regression tests cover duplicate parses, failed retries, disposed
  requests and late property restoration of explicit height.
- Not claimed: paid generation, a second physical machine, per-glyph font
  verification, or visual Muted/Bypass transitions in a configured final App Mode.
  App Mode registry/state coverage passed; the QA workflows opened its initial
  setup screen, so that visual gate remains separate.


## Text cell expansion, 2026-09-29

- Final prompt previews now determine their own height and wrap the complete text;
  the row grows with them instead of scrolling inside a fixed-height prompt box.
- Ordinary text and final prompt cells use equal 14px inner padding on both sides
  (plus the same table-cell inset). A shared corner icon appears on hover or
  keyboard focus and toggles a non-modal right-side text dock.
- Reused the existing shared buttons, Remix icons, prompt editor, revision guards,
  reference editing and review/save operations. Added `table_text_side.mjs` because
  the existing table dialog and workbench were modal; neither provides an
  instance-owned, collapsible text dock. Collapsing keeps drafts, Escape restores
  focus, opening another instance hides the previous dock, and workflow/mode
  teardown disposes all drafts and bindings.
- Actual ComfyUI on port 8207: two tables, complete 317-character final prompts,
  matching scroll/client heights, equal left/right padding, ordinary text save,
  prompt review/save, stale-draft rejection, collapse/reopen, keyboard focus,
  mode round trip, saved workflow reload, 80%/100% zoom, and 720x900 viewport.
  No text expansion opens a dialog. Sidebar scrolling keeps all actions reachable.
- All 49 relevant business tests, module syntax checks and diff whitespace checks
  passed. Screenshots: workspace `output/table-ui-review/text-cell-full-content.png`
  and `text-cell-side-panel.png`. No generation service was invoked.


## Table sizing, 2026-09-29

- Removed the adjacent-column swap button. Divider hit targets only span the
  header height; header hover reveals the lines, with keyboard/drag feedback.
- Reused the column-pair transaction/history and pointer-capture logic. Added
  optional `resizable`/`fullHeight` adapter capabilities to the canvas host;
  business tables opt in, without exposing private business state to the host.
- The right frame edge adjusts overall width, preserves column proportions and
  supports keyboard changes and undo. Layout widths survive save/reload, including
  workspace-capable nodes narrowed below their default width.
- Removed both host and table maximum heights in creative mode. Full rows determine
  height, and the canvas scrolls vertically instead of a clipped inner panel.
- Actual combined ComfyUI 8207: two instances at 820px/1100px, pointer column/frame
  resizing, keyboard sizing, undo, mode round trip, save/reload, 60% and fitted
  zoom, 720x900 viewport, and final-row access through canvas scrolling. Inner
  content/client heights matched (1617px and 1239px); no vertical truncation.
- Standalone canvas 8208: existing material group and three media instances loaded
  without business integration; none acquired table sizing controls.
- 49 business and 17 canvas tests passed; bundled font hashes, module syntax and
  diff whitespace checks passed. Evidence: workspace
  `output/table-ui-review/table-resize-full-height.png`.


## Reference identity and clean prompt cells, 2026-09-29

- Resolve reference display and hover previews by asset ID plus field ID across
  all existing media cells. Generation eligibility still respects explicit column
  exclusions; excluded columns no longer appear as deleted assets.
- Preserve reference selection when legacy asset columns migrate to mixed content.
  Frontend and backend prompt compilation both recognize media in content columns.
- Final-prompt cells contain full text and reference chips only. Editing, parsing
  and detailed validation remain in the existing side panel.
- Overall table width has a 640px minimum; the right edge has a zoom-independent
  16px hit target and visible grip. Each instance retains its own saved width.
- Actual ComfyUI 8207 verification used two copies of the user's example data,
  including excluded references and migrated content columns. Correct names and
  hover previews, clean cells, minimum-width dragging, independent widths, mode
  switching and reload were checked. The original workflow was not modified.
- Validation: 51 business JS tests, 17 canvas tests, 12 compiler tests, bundled
  font hashes and diff checks passed. The running backend was not restarted;
  backend content-column compatibility is unit-tested and loads on next restart.


## Column-bound prompt templates

Owned by business table modules. Reuse the existing text side panel, shared table
buttons, structured prompt compiler, immutable media snapshots and revision guards.
A prompt field stores a versioned column template; a nonempty row value is an
explicit override (legacy documents remain intact). Column tokens bind field IDs,
resolve within the current row, and contribute either text or one media asset.
Template references determine media inclusion and order. Missing columns and empty
cells are distinct errors. Generation resolves a fresh concrete document before
submission, retaining existing provider conversion and recovery snapshots.


Template acceptance (2026-09-29):
- Actual canvas 8207, two real Table nodes: header icons, @ picker, per-row text
  preview, template save, independent row override/reset, preserving legacy rows,
  rename propagation, and replacing a media cell with clipboard paste while the
  column token remains unchanged. Graph/creative mode round trip and save/reload
  retain both the shared template and stable column IDs.
- Reused the existing side dock, Remix assets, table button entry, rich reference
  preview and shared structured segment reader. No canvas core changes this turn.
- 56 table/interaction JS tests and 15 compiler tests passed. The saved QA workflow
  also compiled both rows against actual local media with ordered references and
  return fingerprints. No external generation was called. Existing running backend
  processes were not restarted; the compiler changes load after a ComfyUI restart.
- Existing final prompts are retained as per-row overrides by default. The column
  editor offers an explicit replace-overrides checkbox; individual rows can reset
  to the shared template. Data is versioned and old prompt documents remain valid.

## 2026-09-30 — Inline text and prompt editing

- Text and prompt cells reuse `bindInlineEditor` on their existing display DOM. Double-click places the caret; edits use the existing table transaction owner without rebuilding the focused DOM. No nested textarea, fixed editor height or inner scrollbar.
- Prompt typing `@` opens a caret-anchored column picker. Structured chips retain stable field IDs and show same-row media thumbnails. Editing an inherited template creates a row override; legacy prompt documents remain intact until edited.
- Reused the existing structured segment reader, column resolver, reference preview, shared tokens and bundled Remix icons. Header labels use 16px / 24px typography, 20px icons and an 8px gap.
- Runtime acceptance: actual ComfyUI on dedicated port 8207, two table instances, plain-text edits, legacy prompt edits, inline column insertion, Escape cancellation, graph/canvas mode switching and save/reload. Saved values and column references survived reload. Text has no nested clipping; focus outline style is none on the text itself, with selection on the cell boundary.
- Evidence: `output/table-ui-review/inline-prompt-editing.png` in the ComfyUI workspace. No generation request or paid service call was made.

### Inline presentation follow-up
- Linked asset outlines now draw inside the asset bounds, avoiding clipping by media scrollers.
- Prompt lines use 28px line-height with 24px reference chips; media and labels align within the same line box.
- Starting inline editing clears the table selection through the existing selection owner and dismisses the contextual toolbar. Editing cells have no selected background or selection border.
- Verified in two actual ComfyUI table instances: `data-selected=false`, transparent editing background, no selection shadow, and linked asset outline offset -2px. All 33 table tests pass. Screenshots: `output/table-ui-review/inline-highlight-fix.png` and `inline-edit-deselected.png` in the ComfyUI workspace.

## 公共宿主边界 · 2026-09-30

本轮继续以完整本地备份 e9fe664 为业务基线，不切换旧远端 main。适配器声明 presentation 和 selectionSurface；Canvas 拥有卡片、标题、选中轮廓与视口平移。业务通过 API v1 的 getPanelContext 读取呈现、选中状态和边界，操作栏及拖动自动平移不再查询宿主 CSS 类或派发 WheelEvent。

table_structure 删除逐帧末行／末列位移；表内末行、末列与横向滚动由 table_ui 自身管理。数据、生成状态、LibTV、列宽比例和结构编辑事务仍归业务库。原生两实例、模式归还／恢复、保存重载及 23%／44% 缩放检查通过；未进行付费生成。须配套当前 Canvas 公共布局接口版本更新。
