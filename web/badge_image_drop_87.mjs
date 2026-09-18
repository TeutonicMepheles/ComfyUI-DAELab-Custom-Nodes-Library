// Native image drags expose their original ComfyUI /view URL. Never import
// workflow metadata or fetch arbitrary remote URLs when choosing an edit target.
export function generatedImageFromDrop87(transfer, baseURL) {
    const candidates = [];
    for (const type of ['text/uri-list', 'text/plain']) {
        candidates.push(...String(transfer?.getData(type) || '').split(/\r?\n/).filter(line => !line.startsWith('#')));
    }
    const html = transfer?.getData('text/html');
    if (html && typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        candidates.push(...Array.from(doc.querySelectorAll('img[src]'), image => image.getAttribute('src')));
    }
    const base = new URL(baseURL);
    for (const candidate of candidates) {
        try {
            const url = new URL(candidate.trim(), base);
            if (url.origin !== base.origin || !/\/(?:api\/)?view$/.test(url.pathname)) continue;
            const filename = url.searchParams.get('filename');
            const type = url.searchParams.get('type') || 'output';
            if (!filename || !['output', 'temp'].includes(type)) continue;
            return {filename, subfolder: url.searchParams.get('subfolder') || '', type};
        } catch { /* Ignore unrelated drag payloads. */ }
    }
    return null;
}
