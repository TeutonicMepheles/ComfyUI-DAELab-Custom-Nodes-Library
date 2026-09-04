export const APP_PREVIEW_PROPERTY = "daelab_show_app_preview";
export const APP_PREVIEW_HEADING_PROPERTY = "daelab_app_preview_heading";

export function isAppPreviewEnabled(node) {
    return node?.properties?.[APP_PREVIEW_PROPERTY] === true;
}

export function resolveAppPreviewHeading(node, fallback = "当前图片参考") {
    const value = String(node?.properties?.[APP_PREVIEW_HEADING_PROPERTY] ?? "").trim();
    return value || fallback;
}

export function normalizeImageSelection(value) {
    if (value && typeof value === "object") {
        const filename = String(value.filename ?? "").trim();
        if (!filename) return null;
        return {
            filename,
            subfolder: String(value.subfolder ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""),
            type: String(value.type ?? "input").trim() || "input",
        };
    }

    let text = String(value ?? "").trim();
    if (!text) return null;

    let type = "input";
    const annotatedType = text.match(/\s+\[(input|output|temp)\]\s*$/i);
    if (annotatedType) {
        type = annotatedType[1].toLowerCase();
        text = text.slice(0, annotatedType.index).trim();
    }

    const normalized = text.replaceAll("\\", "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    const filename = parts.pop() ?? "";
    if (!filename) return null;
    return { filename, subfolder: parts.join("/"), type };
}

export function buildImageViewPath(selection, cacheToken = "") {
    if (!selection?.filename) return "";
    const params = new URLSearchParams({
        filename: selection.filename,
        subfolder: selection.subfolder ?? "",
        type: selection.type ?? "input",
    });
    if (cacheToken !== "") params.set("v", String(cacheToken));
    return `/view?${params.toString()}`;
}
