// App-only presentation contract. No graph sizing or control state is changed.
// Scoped overrides intentionally supersede legacy node inline styles while the
// original controls remain owned by their existing lifecycle / Bypass helpers.
export const BADGE_UI_CSS = `
[data-badge-ui="87"] {
  --badge-surface:#20282e; --badge-control:#2b333b; --badge-border:#52606b;
  --badge-text:#e4eaee; --badge-muted:#aab6c0; --badge-selected:#254a43;
  --badge-accent:#39c8b1; --badge-primary:#087fc7; --badge-focus:#80bfff;
  font:400 13px/20px Arial,"Microsoft YaHei",sans-serif; color:var(--badge-text);
}
[data-badge-ui="87"] :is(button,input,select,textarea) {
  font-family:inherit!important; font-size:13px!important; line-height:20px!important;
  box-sizing:border-box; font-variant-numeric:tabular-nums;
}
[data-badge-ui="87"] :is(.badge-build-base-prompt summary,.badge-build-workspace strong,.badge-generation strong,.badge-local-block-heading,.badge-height-introduction) {
  font:600 14px/22px Arial,"Microsoft YaHei",sans-serif!important;
}
[data-badge-ui="87"] .badge-generation > strong {display:block;}
[data-badge-ui="87"] [data-daelab-app-layout-owned="tabs"] {align-items:center;flex-wrap:wrap;}
[data-badge-ui="87"] .badge-stage-tabs {display:flex;align-items:center;gap:8px;flex:none;}
[data-badge-ui="87"] .badge-local-nav-source {
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1 1 220px;
  width:auto;min-width:220px;max-width:340px;margin:0;
}
[data-badge-ui="87"] > .badge-color-source {
  flex:none;margin:0 8px;padding:12px;background:var(--badge-surface);
  border:1px solid var(--badge-border);border-top:0;border-bottom:0;
}
[data-badge-ui="87"] :is(.badge-build-workspace [role="status"],.badge-build-filename,.badge-generation p,.badge-local-options p,.badge-color-source p,.badge-material-compact-strength,.badge-height-fallback) {
  font:400 12px/18px Arial,"Microsoft YaHei",sans-serif; color:var(--badge-muted);
}
[data-badge-ui="87"] .badge-function-tip {
  background:transparent!important; border:0; padding:0 0 8px!important;
  color:var(--badge-muted)!important; font:400 12px/18px Arial,"Microsoft YaHei",sans-serif!important;
}
[data-badge-ui="87"] :is(.badge-generation,.badge-local-options,[data-badge-local-body],.badge-height-tier) {
  background:var(--badge-surface); border-color:var(--badge-border);
}
[data-badge-ui="87"] .badge-generation {margin:16px 8px 8px;padding:16px;border-radius:10px;}
[data-badge-ui="87"] :is(button,select,textarea) {border-radius:6px;}
[data-badge-ui="87"] :is(.badge-build-workspace select,.badge-build-icon-button,.badge-build-capsule,.badge-generation-resolution-count > button,.badge-generation-count,.badge-generation-dimensions label) {
  height:36px; min-height:36px;
}
[data-badge-ui="87"] .badge-build-workspace select {padding:6px 8px;}
[data-badge-ui="87"] .badge-build-workspace .badge-build-icon-button {width:36px;height:36px;padding:8px;}
[data-badge-ui="87"] .badge-build-icon-button img {width:18px;height:18px;}
[data-badge-ui="87"] .badge-build-bar {gap:8px;}
[data-badge-ui="87"] .badge-build-capsule {border-radius:6px;background:var(--badge-control);color:var(--badge-text);}
[data-badge-ui="87"] .badge-build-capsule[data-enabled="true"] {border-color:var(--badge-border);background:var(--badge-control);color:var(--badge-text);}
[data-badge-ui="87"] .badge-build-capsule[data-expanded="true"] {border-color:var(--badge-accent);background:var(--badge-selected);color:#dcfff5;box-shadow:inset 0 0 0 1px var(--badge-accent);}
[data-badge-ui="87"] .badge-build-capsule > button {height:34px;padding:6px 10px;border-radius:6px;font-weight:500;}
[data-badge-ui="87"] .badge-build-capsule[data-expanded="true"] > button::after {content:none;}
[data-badge-ui="87"] .badge-build-capsule > button::after {content:'▸';position:static;display:inline;width:auto;height:auto;background:transparent;border-radius:0;margin-left:6px;color:var(--badge-muted);}
[data-badge-ui="87"] .badge-build-capsule[data-expanded="true"] > button::after {content:'▾';}
[data-badge-ui="87"] .badge-build-capsule-switch {width:32px;height:18px;flex:0 0 32px;margin:0 8px 0 0;}
[data-badge-ui="87"] .badge-build-capsule-switch::after {width:12px;height:12px;}
[data-badge-ui="87"] .badge-build-capsule-switch:checked::after {left:16px;}
[data-badge-ui="87"] :is(.badge-exclusive-pair,.badge-color-source .badge-color-source-toggle,.badge-build-workspace .badge-target-source) {
  width:100%;max-width:none;min-height:36px;padding:3px;gap:4px;
  box-sizing:border-box;border:1px solid var(--badge-border);border-radius:6px;background:var(--badge-control);
}
[data-badge-ui="87"] .badge-exclusive-pair > button {
  width:100%;max-width:none;min-width:0;min-height:28px;height:auto;padding:3px 8px;
  border-radius:4px;color:var(--badge-muted);background:transparent;font-weight:500;box-shadow:none;
}
[data-badge-ui="87"] .badge-exclusive-pair > button svg {width:16px;height:16px;}
[data-badge-ui="87"] .badge-exclusive-pair > button:is([aria-pressed="true"],[aria-checked="true"]) {
  background:var(--badge-selected);color:#dcfff5;box-shadow:inset 0 0 0 1px var(--badge-accent);
}
[data-badge-ui="87"] .badge-local-block-heading {min-height:32px;padding:0 0 8px;}
[data-badge-ui="87"] [data-daelab-app-layout-owned="tabs"] {gap:8px;padding:8px;}
[data-badge-ui="87"] [data-daelab-app-layout-owned="tabs"] [role="tab"] {min-height:36px;padding:6px 12px;font-weight:600;}
/* Thumbnail cards need their image + label height, not the compact input height. */
[data-badge-ui="87"] :is([data-badge-material-compact],.badge-height-color,[data-color-group-id]) :is(input:not([type="range"]):not([type="checkbox"]),select,button:not(.badge-material-strip-card)) {
  min-height:28px;height:28px!important;border-radius:6px!important;
  background:var(--badge-control);color:var(--badge-text);
}
[data-badge-ui="87"] [data-daelab-color-control] {height:28px!important;}
[data-badge-ui="87"] .badge-material-compact-line {grid-template-columns:36px 116px 74px 116px minmax(140px,1fr) 28px;gap:8px;}
[data-badge-ui="87"] .badge-material-compact-more {width:28px;}
[data-badge-ui="87"] .badge-material-compact-target > button img {width:20px!important;height:20px!important;}
[data-badge-ui="87"] :is(.badge-build-mask-preview,.badge-color-source-actions button) {
  min-height:28px;padding:3px 8px;border:1px solid var(--badge-border);border-radius:6px;
  background:var(--badge-control);color:var(--badge-text);font-size:13px;
}
[data-badge-ui="87"] .badge-build-mask-preview[aria-pressed="true"] {background:var(--badge-selected);border-color:var(--badge-accent);color:#dcfff5;}
[data-badge-ui="87"] .badge-generation-options {gap:8px;}
[data-badge-ui="87"] .badge-generation-options button {height:52px;padding:5px 8px;gap:4px;background:var(--badge-control);border-radius:6px;}
[data-badge-ui="87"] .badge-generation-tiers > button {height:36px;min-height:36px;}
[data-badge-ui="87"] .badge-generation-actions .badge-generation-count {height:44px;min-height:44px;}
[data-badge-ui="87"] .badge-generation-options button[aria-pressed="true"] {background:var(--badge-selected);border-color:var(--badge-accent);}
[data-badge-ui="87"] .badge-generation :is(.badge-generation-count,.badge-generation-dimensions label) {padding:6px 8px;background:var(--badge-control);border-radius:6px;}
[data-badge-ui="87"] .badge-generation .badge-generation-submit {height:44px;min-height:44px;font-weight:600;background:var(--badge-primary);color:white;}
[data-badge-ui="87"] :is(button,select,input,textarea):disabled {
  opacity:1!important;color:#88949e!important;background-color:#252c32!important;border-color:#3c464e!important;cursor:not-allowed;
}
[data-badge-ui="87"] .badge-generation-dimensions label[data-disabled="true"] {opacity:1;color:#88949e;background:#252c32;}
[data-badge-ui="87"] :is(button,input,select,textarea,summary):focus-visible {outline:2px solid var(--badge-focus)!important;outline-offset:2px;}
@container (max-width:620px) {
  [data-badge-ui="87"] .badge-material-compact-line {grid-template-columns:32px 116px 74px minmax(100px,1fr);}
  [data-badge-ui="87"] .badge-material-compact-strength {grid-column:2 / 4;}
  [data-badge-ui="87"] .badge-material-compact-more {grid-column:4;justify-self:end;}
}
/* Source choice and its conditional actions form one toolbar, not a form stack. */
[data-badge-ui="87"] .badge-color-source-row {
  display:flex;flex-wrap:nowrap;align-items:center;gap:8px;overflow-x:auto;
}
[data-badge-ui="87"] .badge-color-source-row > span {
  flex:none;white-space:nowrap;font-size:13px;line-height:20px;
}
[data-badge-ui="87"] .badge-color-source .badge-color-source-toggle {
  flex:1 0 184px;width:auto;min-width:184px;max-width:320px;
}
[data-badge-ui="87"] .badge-color-source-actions {
  display:flex;flex:none;align-items:center;gap:8px;margin-left:0;
}
[data-badge-ui="87"] .badge-color-source-actions button {
  flex:none;height:36px;min-height:36px;padding:6px 10px;white-space:nowrap;
}
[data-badge-ui="87"] .badge-color-source-actions button[hidden] {display:none!important;}
`;
