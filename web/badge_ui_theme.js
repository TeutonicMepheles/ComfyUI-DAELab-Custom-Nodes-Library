import { BADGE_UI_CSS } from './badge_ui_styles.mjs?v=20260909-material-strip-height';

// A separate entry lets ComfyUI discover theme updates even when it cached the
// existing workspace module. Reuse one style element across repeated imports.
const id = 'daelab-badge87-control-theme';
const style = document.getElementById(id) || document.createElement('style');
style.id = id;
style.textContent = BADGE_UI_CSS;
// Follow legacy head styles in document order regardless of extension load order.
document.body.append(style);
