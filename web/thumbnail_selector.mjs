const STYLE_ID = "daelab-thumbnail-selector-style";

export function catalogEntries(catalog) {
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return [];
    return Object.entries(catalog)
        .filter(([, value]) => value && typeof value === "object")
        .map(([id, value]) => ({ id, ...value }));
}

export function resolveCatalogId(catalog, value, fallbackId = "") {
    const entries = catalogEntries(catalog);
    const text = String(value ?? "").trim();
    if (entries.some((entry) => entry.id === text)) return text;
    const match = entries.find(
        (entry) => String(entry.label || entry.id).trim() === text
    );
    return match?.id || fallbackId || entries[0]?.id || "";
}

export function makeCatalogThumbnailUrl(entry, baseUrl, version = "") {
    if (!entry?.thumbnail) return "";
    const url = new URL(entry.thumbnail, baseUrl);
    if (version) url.searchParams.set("v", version);
    return url.toString();
}

export function ensureThumbnailSelectorStyles() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.daelab-thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}
.daelab-thumbnail-button {
  appearance: none;
  border: 1px solid #3a404c;
  border-radius: 7px;
  background: #1a1d24;
  color: #d6dce7;
  cursor: pointer;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 18px;
  gap: 4px;
  min-width: 0;
  height: 92px;
  padding: 5px;
  overflow: hidden;
  text-align: center;
}
.daelab-thumbnail-button:hover { border-color: #6aa8ff; }
.daelab-thumbnail-button:disabled { cursor: not-allowed; }
.daelab-thumbnail-button[data-selected="true"] {
  background: #243b63;
  border-color: #6aa8ff;
  box-shadow: inset 0 0 0 1px #6aa8ff;
  color: #ffffff;
}
.daelab-thumbnail-button img {
  display: block;
  width: 100%;
  height: 62px;
  object-fit: cover;
  border-radius: 5px;
  background: #2b303a;
}
.daelab-thumbnail-button span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 16px;
}
`;
    document.head.appendChild(style);
}

export function renderThumbnailGrid({
    container,
    entries,
    selectedId,
    getImageUrl,
    onSelect,
    buttonClassName = "",
    dataKey = "presetId",
    disabled = false,
    stopEvent,
}) {
    if (!container) return [];
    container.replaceChildren();
    const buttons = [];
    for (const entry of entries || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = ["daelab-thumbnail-button", buttonClassName]
            .filter(Boolean)
            .join(" ");
        button.dataset[dataKey] = entry.id;
        button.dataset.selected = String(entry.id === selectedId);
        button.title = entry.label || entry.id;
        button.disabled = disabled;

        const image = document.createElement("img");
        image.alt = entry.label || entry.id;
        image.draggable = false;
        image.src = getImageUrl?.(entry) || "";

        const label = document.createElement("span");
        label.textContent = entry.label || entry.id;
        button.append(image, label);

        if (stopEvent) {
            button.addEventListener("pointerdown", stopEvent);
            button.addEventListener("pointerup", stopEvent);
        }
        button.addEventListener("click", (event) => {
            stopEvent?.(event);
            onSelect?.(entry.id, entry, event);
        });
        container.appendChild(button);
        buttons.push(button);
    }
    return buttons;
}
