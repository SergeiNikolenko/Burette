import {
  pointInPolygon,
  polygonBounds,
  type LassoPoint,
} from "./chemical-space-lasso";

export type ScreenPoint = {
  x: number;
  y: number;
  depth: number;
  sourceRecordId: number;
};

export type ScreenViewport = {
  width: number;
  height: number;
};

export type ScreenCamera = {
  zoom: number;
  panX: number;
  panY: number;
};

export type ScreenPointIndex = {
  renderPoints: ScreenPoint[];
  renderPointCounts: Map<number, number>;
  hoverBuckets: Map<string, ScreenPoint[]>;
  bySourceRecordId: Map<number, ScreenPoint>;
  hoverCellSize: number;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SpatialNode = {
  bounds: Bounds;
  count: number;
  representative: ScreenPoint;
  points: ScreenPoint[] | null;
  children: SpatialNode[] | null;
};

export type SpatialPointIndex = {
  root: SpatialNode | null;
};

type RenderCandidate = {
  basePoint: ScreenPoint;
  screenPoint: ScreenPoint;
  count: number;
};

// A canvas with more than this many marks stops adding useful visual detail,
// while still making pointer movement and redraw work predictable on large grids.
export const MAX_SCREEN_RENDER_POINTS = 40_000;
const HOVER_CELL_SIZE = 16;
const MAX_LEAF_POINTS = 32;
const MAX_TREE_DEPTH = 22;

export function buildSpatialPointIndex(points: ScreenPoint[]): SpatialPointIndex {
  const finitePoints = points.filter((point) => (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.depth)
  ));
  if (finitePoints.length === 0) return { root: null };
  return {
    root: buildSpatialNode(finitePoints, boundsForPoints(finitePoints), 0),
  };
}

// The quadtree is built once for a projection. Pan and zoom only visit nodes
// intersecting the current viewport, and stop descending as soon as a node is
// smaller than one render cell. Zooming in therefore reveals the points that a
// coarser view aggregated without rescanning every molecule on each gesture.
export function buildCameraScreenPointIndex(
  spatial: SpatialPointIndex,
  viewport: ScreenViewport,
  camera: ScreenCamera,
): ScreenPointIndex {
  const renderCellSize = renderCellSizeFor(viewport);
  const visibleBounds = visibleBaseBounds(viewport, camera);
  const candidates: RenderCandidate[] = [];
  if (spatial.root) {
    collectRenderCandidates(
      spatial.root,
      visibleBounds,
      viewport,
      camera,
      renderCellSize,
      candidates,
    );
  }
  // Buckets are measured in base units so the grid rides with the data instead
  // of the screen. Panning then keeps picking the same molecule per cell; only
  // zooming, which changes what a cell covers, may pick a different one.
  return bucketRenderCandidates(candidates, renderCellSize / camera.zoom);
}

// Kept as a small compatibility surface for callers/tests that already hold
// screen-space points. Camera-aware collection rendering uses the quadtree API.
export function buildScreenPointIndex(
  points: ScreenPoint[],
  viewport: ScreenViewport,
): ScreenPointIndex {
  const spatial = buildSpatialPointIndex(points);
  return buildCameraScreenPointIndex(
    spatial,
    viewport,
    { zoom: 1, panX: 0, panY: 0 },
  );
}

export function sourceRecordIdsInSpatialPolygon(
  spatial: SpatialPointIndex | null,
  polygon: LassoPoint[],
  limit: number,
): number[] {
  if (!spatial?.root || polygon.length < 3 || limit <= 0) return [];
  const selected: number[] = [];
  collectPolygonSelection(
    spatial.root,
    polygon,
    polygonBounds(polygon),
    selected,
    limit,
  );
  return selected;
}

export function nearestScreenPoint(
  index: ScreenPointIndex | null,
  point: { x: number; y: number },
  maxDistance: number,
): ScreenPoint | null {
  if (!index) return null;
  const cellRange = Math.max(1, Math.ceil(maxDistance / index.hoverCellSize));
  const centerX = Math.floor(point.x / index.hoverCellSize);
  const centerY = Math.floor(point.y / index.hoverCellSize);
  let nearest: ScreenPoint | null = null;
  let distanceSquared = maxDistance ** 2;

  for (let y = centerY - cellRange; y <= centerY + cellRange; y += 1) {
    for (let x = centerX - cellRange; x <= centerX + cellRange; x += 1) {
      const candidates = index.hoverBuckets.get(`${x}:${y}`);
      if (!candidates) continue;
      for (const candidate of candidates) {
        const nextDistance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
        if (nextDistance < distanceSquared) {
          nearest = candidate;
          distanceSquared = nextDistance;
        }
      }
    }
  }
  return nearest;
}

function buildSpatialNode(
  points: ScreenPoint[],
  bounds: Bounds,
  depth: number,
): SpatialNode {
  const representative = representativeForBounds(points, bounds);
  if (
    points.length <= MAX_LEAF_POINTS
    || depth >= MAX_TREE_DEPTH
    || (bounds.maxX - bounds.minX <= Number.EPSILON
      && bounds.maxY - bounds.minY <= Number.EPSILON)
  ) {
    return {
      bounds,
      count: points.length,
      representative,
      points,
      children: null,
    };
  }

  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const quadrants: ScreenPoint[][] = [[], [], [], []];
  for (const point of points) {
    const column = point.x >= midX ? 1 : 0;
    const row = point.y >= midY ? 1 : 0;
    quadrants[row * 2 + column].push(point);
  }
  const nonEmpty = quadrants.filter((quadrant) => quadrant.length > 0);
  if (nonEmpty.length <= 1) {
    return {
      bounds,
      count: points.length,
      representative,
      points,
      children: null,
    };
  }
  const children = nonEmpty.map((quadrant) => (
    buildSpatialNode(quadrant, boundsForPoints(quadrant), depth + 1)
  ));
  return {
    bounds,
    count: points.length,
    representative,
    points: null,
    children,
  };
}

function collectRenderCandidates(
  node: SpatialNode,
  visibleBounds: Bounds,
  viewport: ScreenViewport,
  camera: ScreenCamera,
  renderCellSize: number,
  candidates: RenderCandidate[],
) {
  if (!boundsIntersect(node.bounds, visibleBounds)) return;
  const screenWidth = (node.bounds.maxX - node.bounds.minX) * camera.zoom;
  const screenHeight = (node.bounds.maxY - node.bounds.minY) * camera.zoom;
  // Collapsing depends on the node's size alone, never on where the viewport
  // sits. Requiring full visibility made a cluster expand into its members the
  // moment a drag pushed it against an edge, which read as points popping.
  if (Math.max(screenWidth, screenHeight) <= renderCellSize) {
    candidates.push({
      basePoint: node.representative,
      screenPoint: screenPointForCamera(node.representative, viewport, camera),
      count: node.count,
    });
    return;
  }
  if (node.children) {
    for (const child of node.children) {
      collectRenderCandidates(
        child,
        visibleBounds,
        viewport,
        camera,
        renderCellSize,
        candidates,
      );
    }
    return;
  }
  for (const point of node.points ?? []) {
    if (!pointInBounds(point, visibleBounds)) continue;
    candidates.push({
      basePoint: point,
      screenPoint: screenPointForCamera(point, viewport, camera),
      count: 1,
    });
  }
}

function bucketRenderCandidates(
  candidates: RenderCandidate[],
  baseCellSize: number,
): ScreenPointIndex {
  const renderBuckets = new Map<string, RenderCandidate>();
  const renderBucketCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = bucketKey(candidate.basePoint, baseCellSize);
    renderBucketCounts.set(key, (renderBucketCounts.get(key) ?? 0) + candidate.count);
    const current = renderBuckets.get(key);
    if (
      !current
      || distanceToCellCenter(candidate.basePoint, baseCellSize)
        < distanceToCellCenter(current.basePoint, baseCellSize)
    ) {
      renderBuckets.set(key, candidate);
    }
  }

  const renderPoints: ScreenPoint[] = [];
  const renderPointCounts = new Map<number, number>();
  const hoverBuckets = new Map<string, ScreenPoint[]>();
  const bySourceRecordId = new Map<number, ScreenPoint>();
  for (const [key, candidate] of renderBuckets) {
    const point = candidate.screenPoint;
    renderPoints.push(point);
    renderPointCounts.set(point.sourceRecordId, renderBucketCounts.get(key) ?? 1);
    bySourceRecordId.set(point.sourceRecordId, point);
    const hoverKey = bucketKey(point, HOVER_CELL_SIZE);
    const hoverCandidates = hoverBuckets.get(hoverKey);
    if (hoverCandidates) hoverCandidates.push(point);
    else hoverBuckets.set(hoverKey, [point]);
  }
  return {
    renderPoints,
    renderPointCounts,
    hoverBuckets,
    bySourceRecordId,
    hoverCellSize: HOVER_CELL_SIZE,
  };
}

function collectPolygonSelection(
  node: SpatialNode,
  polygon: LassoPoint[],
  polygonBox: Bounds,
  selected: number[],
  limit: number,
) {
  if (selected.length >= limit) return;
  const relation = boundsPolygonRelation(node.bounds, polygon, polygonBox);
  if (relation === "outside") return;
  if (relation === "inside") {
    collectAllSourceRecordIds(node, selected, limit);
    return;
  }
  if (node.children) {
    for (const child of node.children) {
      collectPolygonSelection(child, polygon, polygonBox, selected, limit);
      if (selected.length >= limit) break;
    }
    return;
  }
  for (const point of node.points ?? []) {
    if (pointInPolygon(point, polygon)) selected.push(point.sourceRecordId);
    if (selected.length >= limit) break;
  }
}

function collectAllSourceRecordIds(node: SpatialNode, selected: number[], limit: number) {
  if (selected.length >= limit) return;
  if (node.children) {
    for (const child of node.children) {
      collectAllSourceRecordIds(child, selected, limit);
      if (selected.length >= limit) break;
    }
    return;
  }
  for (const point of node.points ?? []) {
    selected.push(point.sourceRecordId);
    if (selected.length >= limit) break;
  }
}

function boundsPolygonRelation(
  bounds: Bounds,
  polygon: LassoPoint[],
  polygonBox: Bounds,
): "outside" | "inside" | "intersects" {
  if (!boundsIntersect(bounds, polygonBox)) return "outside";
  const corners = boundsCorners(bounds);
  const cornersInside = corners.map((corner) => pointInPolygon(corner, polygon));
  const polygonVertexInside = polygon.some((point) => pointInBounds(point, bounds));
  const boundaryCrosses = polygonEdgesIntersectBounds(polygon, bounds);
  if (
    cornersInside.every(Boolean)
    && !polygonVertexInside
    && !boundaryCrosses
  ) {
    return "inside";
  }
  if (
    cornersInside.every((inside) => !inside)
    && !polygonVertexInside
    && !boundaryCrosses
  ) {
    return "outside";
  }
  return "intersects";
}

function polygonEdgesIntersectBounds(polygon: LassoPoint[], bounds: Bounds) {
  const corners = boundsCorners(bounds);
  const rectangleEdges: Array<[LassoPoint, LassoPoint]> = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    for (const [left, right] of rectangleEdges) {
      if (segmentsIntersect(start, end, left, right)) return true;
    }
  }
  return false;
}

function segmentsIntersect(
  firstStart: LassoPoint,
  firstEnd: LassoPoint,
  secondStart: LassoPoint,
  secondEnd: LassoPoint,
) {
  const firstSideA = orientation(firstStart, firstEnd, secondStart);
  const firstSideB = orientation(firstStart, firstEnd, secondEnd);
  const secondSideA = orientation(secondStart, secondEnd, firstStart);
  const secondSideB = orientation(secondStart, secondEnd, firstEnd);
  if (
    firstSideA !== 0
    && firstSideB !== 0
    && secondSideA !== 0
    && secondSideB !== 0
  ) {
    return firstSideA !== firstSideB && secondSideA !== secondSideB;
  }
  return (
    (firstSideA === 0 && pointOnSegment(secondStart, firstStart, firstEnd))
    || (firstSideB === 0 && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (secondSideA === 0 && pointOnSegment(firstStart, secondStart, secondEnd))
    || (secondSideB === 0 && pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function orientation(start: LassoPoint, end: LassoPoint, point: LassoPoint) {
  const cross = (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x);
  if (Math.abs(cross) <= 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(point: LassoPoint, start: LassoPoint, end: LassoPoint) {
  return (
    point.x >= Math.min(start.x, end.x) - 1e-9
    && point.x <= Math.max(start.x, end.x) + 1e-9
    && point.y >= Math.min(start.y, end.y) - 1e-9
    && point.y <= Math.max(start.y, end.y) + 1e-9
  );
}

function boundsForPoints(points: ScreenPoint[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function representativeForBounds(points: ScreenPoint[], bounds: Bounds) {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let representative = points[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
    if (distance < closestDistance) {
      representative = point;
      closestDistance = distance;
    }
  }
  return representative;
}

function visibleBaseBounds(
  viewport: ScreenViewport,
  camera: ScreenCamera,
): Bounds {
  const topLeft = basePointFromCamera({ x: 0, y: 0 }, viewport, camera);
  const bottomRight = basePointFromCamera(
    { x: viewport.width, y: viewport.height },
    viewport,
    camera,
  );
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

function screenPointForCamera(
  point: ScreenPoint,
  viewport: ScreenViewport,
  camera: ScreenCamera,
): ScreenPoint {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    ...point,
    x: centerX + camera.panX + (point.x - centerX) * camera.zoom,
    y: centerY + camera.panY + (point.y - centerY) * camera.zoom,
  };
}

function basePointFromCamera(
  point: LassoPoint,
  viewport: ScreenViewport,
  camera: ScreenCamera,
): LassoPoint {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    x: centerX + (point.x - centerX - camera.panX) / camera.zoom,
    y: centerY + (point.y - centerY - camera.panY) / camera.zoom,
  };
}

function renderCellSizeFor(viewport: ScreenViewport) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  let cellSize = Math.max(
    1,
    Math.ceil(Math.sqrt(((width + 1) * (height + 1)) / MAX_SCREEN_RENDER_POINTS)),
  );
  while (
    Math.ceil((width + 1) / cellSize)
      * Math.ceil((height + 1) / cellSize)
    > MAX_SCREEN_RENDER_POINTS
  ) {
    cellSize += 1;
  }
  return cellSize;
}

function boundsCorners(bounds: Bounds): [LassoPoint, LassoPoint, LassoPoint, LassoPoint] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function boundsIntersect(left: Bounds, right: Bounds) {
  return !(
    left.maxX < right.minX
    || left.minX > right.maxX
    || left.maxY < right.minY
    || left.minY > right.maxY
  );
}

function pointInBounds(point: LassoPoint, bounds: Bounds) {
  return (
    point.x >= bounds.minX
    && point.x <= bounds.maxX
    && point.y >= bounds.minY
    && point.y <= bounds.maxY
  );
}

function bucketKey(point: LassoPoint, cellSize: number) {
  return `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
}

function distanceToCellCenter(point: LassoPoint, cellSize: number) {
  const cellX = Math.floor(point.x / cellSize);
  const cellY = Math.floor(point.y / cellSize);
  const centerX = (cellX + 0.5) * cellSize;
  const centerY = (cellY + 0.5) * cellSize;
  return (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
}
