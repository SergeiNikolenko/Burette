export type LassoPoint = {
  x: number;
  y: number;
};

export type LassoSelectablePoint = LassoPoint & {
  sourceRecordId: number;
};

const MAX_SELECTION_POLYGON_VERTICES = 128;
const MIN_POINTER_DISTANCE = 2;

export function simplifyLassoPolygon(
  polygon: LassoPoint[],
  maxVertices = MAX_SELECTION_POLYGON_VERTICES,
): LassoPoint[] {
  if (polygon.length <= 2) return polygon;

  const radial: LassoPoint[] = [polygon[0]];
  for (const point of polygon.slice(1, -1)) {
    const previous = radial.at(-1) ?? polygon[0];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= MIN_POINTER_DISTANCE) {
      radial.push(point);
    }
  }
  radial.push(polygon.at(-1) ?? polygon[0]);
  if (radial.length <= maxVertices) return radial;

  return Array.from({ length: maxVertices }, (_, index) => (
    radial[Math.round((index * (radial.length - 1)) / (maxVertices - 1))]
  ));
}

export function sourceRecordIdsInPolygon(
  points: LassoSelectablePoint[],
  polygon: LassoPoint[],
): number[] {
  if (polygon.length < 3) return [];
  const bounds = polygonBounds(polygon);
  const selected: number[] = [];
  for (const point of points) {
    if (
      point.x < bounds.minX
      || point.x > bounds.maxX
      || point.y < bounds.minY
      || point.y > bounds.maxY
    ) {
      continue;
    }
    if (pointInPolygon(point, polygon)) selected.push(point.sourceRecordId);
  }
  return selected;
}

export function polygonBounds(polygon: LassoPoint[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(point: LassoPoint, polygon: LassoPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const left = polygon[index];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y)
      && point.x < ((right.x - left.x) * (point.y - left.y))
        / (right.y - left.y || Number.EPSILON)
        + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
