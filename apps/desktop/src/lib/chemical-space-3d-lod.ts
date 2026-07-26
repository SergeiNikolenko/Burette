export type Point2 = { x: number; y: number };

export type ProjectionSnapshot = {
  elements: number[];
  width: number;
  height: number;
};

type ProjectedPosition = Point2 & {
  depth: number;
};

type YieldControl = () => Promise<void>;

const PROJECTION_CHUNK_SIZE = 4_096;

export function representativePointIndices(recordCount: number, limit: number) {
  const boundedCount = Math.max(0, Math.min(recordCount, limit));
  if (boundedCount === recordCount) {
    return Array.from({ length: recordCount }, (_, index) => index);
  }
  if (boundedCount === 0) return [];
  if (boundedCount === 1) return [0];
  return Array.from(
    { length: boundedCount },
    (_, index) => Math.floor((index * (recordCount - 1)) / (boundedCount - 1)),
  );
}

export function positionsForIndices(
  positions: Array<[number, number, number]>,
  indices: number[],
) {
  const values: number[] = [];
  for (const index of indices) {
    const position = positions[index];
    if (!position) continue;
    values.push(position[0], position[1], position[2]);
  }
  return values;
}

export function boundedEdgePositions(
  positions: Array<[number, number, number]>,
  edges: Array<[number, number]>,
  limit: number,
) {
  const edgeCount = Math.max(0, Math.min(edges.length, limit));
  if (edgeCount === 0) return [];
  const values: number[] = [];
  const stride = edges.length / edgeCount;
  for (let sampleIndex = 0; sampleIndex < edgeCount; sampleIndex += 1) {
    const edge = edges[Math.floor(sampleIndex * stride)];
    const left = edge ? positions[edge[0]] : undefined;
    const right = edge ? positions[edge[1]] : undefined;
    if (!left || !right) continue;
    values.push(left[0], left[1], left[2], right[0], right[1], right[2]);
  }
  return values;
}

export async function cameraAwarePointIndices(
  positions: Array<[number, number, number]>,
  snapshot: ProjectionSnapshot,
  limit: number,
  isCancelled: () => boolean,
  yieldControl: YieldControl = yieldToBrowser,
) {
  if (limit <= 0 || snapshot.width <= 0 || snapshot.height <= 0) return [];
  const cellSize = screenCellSize(snapshot.width, snapshot.height, limit);
  const columns = Math.max(1, Math.ceil(snapshot.width / cellSize));
  const closestByCell = new Map<number, { index: number; depth: number }>();

  for (let index = 0; index < positions.length; index += 1) {
    if (index > 0 && index % PROJECTION_CHUNK_SIZE === 0) {
      await yieldControl();
      if (isCancelled()) return [];
    }
    const projected = projectPosition(positions[index], snapshot);
    if (
      !projected
      || projected.x < 0
      || projected.x >= snapshot.width
      || projected.y < 0
      || projected.y >= snapshot.height
    ) {
      continue;
    }
    const cellX = Math.floor(projected.x / cellSize);
    const cellY = Math.floor(projected.y / cellSize);
    const key = cellY * columns + cellX;
    const previous = closestByCell.get(key);
    if (!previous || projected.depth < previous.depth) {
      closestByCell.set(key, { index, depth: projected.depth });
    }
  }

  if (isCancelled()) return [];
  return [...closestByCell.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ index }) => index)
    .slice(0, limit);
}

export async function sourceRecordIdsInProjectedPolygon(
  positions: Array<[number, number, number]>,
  sourceRecordIds: number[],
  snapshot: ProjectionSnapshot,
  polygon: Point2[],
  limit: number,
  isCancelled: () => boolean,
  yieldControl: YieldControl = yieldToBrowser,
) {
  if (polygon.length < 3 || limit <= 0) return [];
  const bounds = polygonBounds(polygon);
  const selected: number[] = [];

  for (let index = 0; index < positions.length && selected.length < limit; index += 1) {
    if (index > 0 && index % PROJECTION_CHUNK_SIZE === 0) {
      await yieldControl();
      if (isCancelled()) return [];
    }
    const projected = projectPosition(positions[index], snapshot);
    if (
      !projected
      || projected.x < bounds.minX
      || projected.x > bounds.maxX
      || projected.y < bounds.minY
      || projected.y > bounds.maxY
      || !pointInPolygon(projected, polygon)
    ) {
      continue;
    }
    const sourceRecordId = sourceRecordIds[index];
    if (sourceRecordId !== undefined) selected.push(sourceRecordId);
  }

  return isCancelled() ? [] : selected;
}

function screenCellSize(width: number, height: number, limit: number) {
  let cellSize = Math.max(2, Math.ceil(Math.sqrt((width * height) / limit)));
  while (Math.ceil(width / cellSize) * Math.ceil(height / cellSize) > limit) {
    cellSize += 1;
  }
  return cellSize;
}

function projectPosition(
  position: [number, number, number] | undefined,
  snapshot: ProjectionSnapshot,
): ProjectedPosition | null {
  if (!position || snapshot.elements.length !== 16) return null;
  const [x, y, z] = position;
  if (![x, y, z].every(Number.isFinite)) return null;
  const elements = snapshot.elements;
  const clipX = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
  const clipY = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
  const clipZ = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
  const clipW = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
  if (!Number.isFinite(clipW) || clipW <= Number.EPSILON) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const depth = clipZ / clipW;
  if (![ndcX, ndcY, depth].every(Number.isFinite) || depth < -1 || depth > 1) return null;
  return {
    x: (ndcX * 0.5 + 0.5) * snapshot.width,
    y: (-ndcY * 0.5 + 0.5) * snapshot.height,
    depth,
  };
}

function polygonBounds(polygon: Point2[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

function pointInPolygon(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y)
      && point.x < (
        ((right.x - left.x) * (point.y - left.y))
        / (right.y - left.y || Number.EPSILON)
        + left.x
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
