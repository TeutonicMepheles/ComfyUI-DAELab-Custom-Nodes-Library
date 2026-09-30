// Prototype-only color simplification, not the GPT semantic Color ID Map.
// Cache by decoded image identity: replacing an image cannot reuse an old map.
const maps = new WeakMap();
export function colorSelectionSource(image, useMap) {
    if (!image || !useMap) return image;
    if (!maps.has(image)) {
        const data = new Uint8ClampedArray(image.data);
        for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] / 85) * 85;
        }
        maps.set(image, { width: image.width, height: image.height, data });
    }
    return maps.get(image);
}

// Chunk actual work so progress can paint and navigation can cancel the job.
export async function generateColorSelectionSource(image, { onProgress = () => {}, cancelled = () => false } = {}) {
    if (!image) return null;
    const data = new Uint8ClampedArray(image.data);
    const chunk = 262144;
    onProgress(0);
    for (let start = 0; start < data.length; start += chunk) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (cancelled()) return null;
        const end = Math.min(data.length, start + chunk);
        for (let i = start; i < end; i += 4) {
            for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] / 85) * 85;
        }
        onProgress(Math.round(end / data.length * 100));
    }
    return { width: image.width, height: image.height, data };
}
