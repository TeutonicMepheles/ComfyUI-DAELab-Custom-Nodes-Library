// Shared brush geometry for the editor overlay and top mask preview.
export function drawBrushStrokes(ctx, strokes, width, height) {
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const stroke of strokes || []) {
        if (!stroke.points?.length || !(stroke.diameter > 0)) continue;
        ctx.lineWidth = stroke.diameter * Math.min(width, height);
        ctx.beginPath();
        stroke.points.forEach((point, i) => ctx[i ? 'lineTo' : 'moveTo'](point.x * width, point.y * height));
        ctx.stroke();
        for (const point of stroke.points) {
            ctx.beginPath(); ctx.arc(point.x * width, point.y * height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
        }
    }
}
export function drawSelectionMask(ctx, info, width, height) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    const polygons = Array.isArray(info.polygons) ? info.polygons : info.points ? [info.points] : [];
    for (const polygon of polygons) {
        const points = polygon.points || polygon;
        if (!Array.isArray(points) || points.length < 3) continue;
        ctx.beginPath();
        points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x ?? p[0], p.y ?? p[1]));
        ctx.closePath(); ctx.fill();
    }
    drawBrushStrokes(ctx, info.brush_strokes, width, height);
}
