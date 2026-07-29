const MIN_VERTICES = 3;


function clonePolygons(polygons) {
  return (polygons || []).map((polygon) => ({
    points: (polygon?.points || polygon || []).map((point) => ({
      x: Number(point?.x) || 0,
      y: Number(point?.y) || 0,
    })),
  }));
}


function validImageSize(size) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


export function migratePolygonsForImage(polygons, cleared, previousSize, nextSize) {
  const next = validImageSize(nextSize);
  if (!next) {
    throw new TypeError("A valid destination image size is required.");
  }

  if (cleared) {
    return {
      polygons: [],
      cleared: true,
      shouldCreateDefault: false,
      geometryChanged: (polygons || []).length > 0,
    };
  }

  const validPolygons = clonePolygons(polygons).filter(
    (polygon) => polygon.points.length >= MIN_VERTICES,
  );
  if (validPolygons.length === 0) {
    return {
      polygons: [],
      cleared: false,
      shouldCreateDefault: true,
      geometryChanged: false,
    };
  }

  const previous = validImageSize(previousSize);
  const scaleX = previous ? next.width / previous.width : 1;
  const scaleY = previous ? next.height / previous.height : 1;
  const migrated = validPolygons.map((polygon) => ({
    points: polygon.points.map((point) => ({
      x: clamp(point.x * scaleX, 0, next.width),
      y: clamp(point.y * scaleY, 0, next.height),
    })),
  }));

  return {
    polygons: migrated,
    cleared: false,
    shouldCreateDefault: false,
    geometryChanged: JSON.stringify(migrated) !== JSON.stringify(validPolygons),
  };
}


export function stagePolygonExecutionPreview(polygonWidget, encodedImage, imageValue) {
  if (!polygonWidget || !encodedImage) {
    return false;
  }
  polygonWidget.pendingSourceImageData = encodedImage;
  polygonWidget.pendingSourceImageValue = imageValue || `socket-image-${encodedImage.length}`;
  return true;
}
