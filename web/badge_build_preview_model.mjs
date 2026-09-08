export function imagePoint(x, y, boxWidth, boxHeight, width, height) {
    const scale = Math.min(boxWidth / width, boxHeight / height);
    const left = (boxWidth - width * scale) / 2;
    const top = (boxHeight - height * scale) / 2;
    const px = Math.floor((x - left) / scale), py = Math.floor((y - top) / scale);
    return px >= 0 && py >= 0 && px < width && py < height ? [px, py] : null;
}

export function previewPixels(source, config, kind, view) {
    const output = new Uint8ClampedArray(source);
    let groups = config.groups || [];
    const selected = /^mask_(\d+)$/.exec(config.output || '');
    if (selected) groups = groups.slice(Number(selected[1]) - 1, Number(selected[1]));
    const colors = groups.map(group => ({ ...group,
        rgb: (String(group.color).replace('#', '').match(/.{2}/g) || []).map(x => parseInt(x, 16)),
        threshold2: Math.max(0, Number(group.threshold) || 0) ** 2,
    }));
    for (let i = 0; i < source.length; i += 4) {
        let match = null, distance = Infinity;
        for (const group of colors) {
            const d = group.rgb.reduce((sum, channel, c) => sum + (source[i + c] - channel) ** 2, 0);
            const hit = group.invert ? d > group.threshold2 : d <= group.threshold2;
            if (hit && d < distance) { match = group; distance = d; }
        }
        const gray = kind === 'height' ? (match ? match.gray ?? Math.round((match.layer || 0) * 255 / 5) : config.fallbackGray ?? 0) : match ? 255 : 0;
        if (view === 'mask') {
            output[i] = output[i + 1] = output[i + 2] = gray;
            output[i + 3] = 255;
        } else if (view === 'cutout') {
            output[i + 3] = match ? 0 : source[i + 3];
        } else if (view === 'overlay' && match) {
            const tint = [20, 220, 180];
            for (let c = 0; c < 3; c++) output[i + c] = Math.round(source[i + c] * .55 + tint[c] * .45);
        }
    }
    return output;
}
