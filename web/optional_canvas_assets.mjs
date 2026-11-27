let available;
export function canvasWebAssetsAvailable() {
    if (!globalThis.document?.baseURI) return Promise.resolve(false);
    available ??= fetch(new URL('/extensions', document.baseURI))
        .then(response => response.ok ? response.json() : [])
        .then(entries => entries.some(path =>
            path.startsWith('/extensions/ComfyUI-DAELab-Creative-Canvas/')))
        .catch(() => false);
    return available;
}
