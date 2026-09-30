const STYLE_ID = "daelab-material-hover-preview-style";

export const MATERIAL_HOVER_PREVIEW_CLASS = "daelab-material-hover-preview";
export const MATERIAL_HOVER_PREVIEW_WIDTH = 230;
export const MATERIAL_HOVER_PREVIEW_HEIGHT = 268;

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function getMaterialHoverPreviewPosition({
    anchor,
    viewportWidth,
    viewportHeight,
    previewWidth = MATERIAL_HOVER_PREVIEW_WIDTH,
    previewHeight = MATERIAL_HOVER_PREVIEW_HEIGHT,
    margin = 10,
} = {}) {
    const rect = anchor || {};
    const width = Math.max(1, finiteNumber(previewWidth, MATERIAL_HOVER_PREVIEW_WIDTH));
    const height = Math.max(1, finiteNumber(previewHeight, MATERIAL_HOVER_PREVIEW_HEIGHT));
    const availableWidth = Math.max(width + margin * 2, finiteNumber(viewportWidth, width));
    const availableHeight = Math.max(height + margin * 2, finiteNumber(viewportHeight, height));
    const anchorLeft = finiteNumber(rect.left);
    const anchorRight = finiteNumber(rect.right, anchorLeft);
    const anchorTop = finiteNumber(rect.top);
    let left = anchorRight + margin;
    let top = anchorTop;
    if (left + width + margin > availableWidth) left = anchorLeft - width - margin;
    left = Math.max(margin, Math.min(left, availableWidth - width - margin));
    top = Math.max(margin, Math.min(top, availableHeight - height - margin));
    return { left: Math.round(left), top: Math.round(top) };
}

export function ensureMaterialHoverPreviewStyles() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.${MATERIAL_HOVER_PREVIEW_CLASS} {
  position: fixed;
  z-index: 2147483000;
  width: ${MATERIAL_HOVER_PREVIEW_WIDTH}px;
  padding: 8px;
  border: 1px solid #6aa8ff;
  border-radius: 10px;
  color: #fff;
  background: rgba(18, 22, 29, .97);
  box-shadow: 0 10px 28px rgba(0,0,0,.48);
  pointer-events: none;
  box-sizing: border-box;
}
.${MATERIAL_HOVER_PREVIEW_CLASS} img {
  display: block;
  width: 212px;
  height: 212px;
  object-fit: contain;
  background: #252a33;
  border-radius: 6px;
}
.${MATERIAL_HOVER_PREVIEW_CLASS} span {
  display: block;
  padding-top: 6px;
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
    document.head.appendChild(style);
}

export function hideMaterialHoverPreview(owner) {
    const state = owner?.__daelabMaterialHoverPreviewState;
    if (!state) return;
    state.tip?.remove?.();
    globalThis.removeEventListener?.("blur", state.dismiss);
    globalThis.removeEventListener?.("resize", state.dismiss);
    document.removeEventListener?.("scroll", state.dismiss, true);
    owner.__daelabMaterialHoverPreviewState = null;
}

export function showMaterialHoverPreview({
    owner,
    entry,
    anchorElement,
    imageUrl,
    active = true,
} = {}) {
    hideMaterialHoverPreview(owner);
    if (!owner || !entry || !anchorElement?.isConnected || !active) return null;
    ensureMaterialHoverPreviewStyles();
    const tip = document.createElement("div");
    tip.className = MATERIAL_HOVER_PREVIEW_CLASS;
    tip.setAttribute("role", "tooltip");
    tip.dataset.materialId = String(entry.id || "");
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.src = String(imageUrl || "");
    const label = document.createElement("span");
    label.textContent = entry.label || entry.id;
    tip.append(image, label);
    document.body.appendChild(tip);
    const position = getMaterialHoverPreviewPosition({
        anchor: anchorElement.getBoundingClientRect(),
        viewportWidth: globalThis.innerWidth || document.documentElement.clientWidth,
        viewportHeight: globalThis.innerHeight || document.documentElement.clientHeight,
        previewWidth: tip.offsetWidth || MATERIAL_HOVER_PREVIEW_WIDTH,
        previewHeight: tip.offsetHeight || MATERIAL_HOVER_PREVIEW_HEIGHT,
    });
    tip.style.left = `${position.left}px`;
    tip.style.top = `${position.top}px`;
    const dismiss = () => hideMaterialHoverPreview(owner);
    owner.__daelabMaterialHoverPreviewState = { tip, dismiss };
    globalThis.addEventListener?.("blur", dismiss, { once: true });
    globalThis.addEventListener?.("resize", dismiss, { once: true });
    document.addEventListener?.("scroll", dismiss, true);
    return tip;
}
