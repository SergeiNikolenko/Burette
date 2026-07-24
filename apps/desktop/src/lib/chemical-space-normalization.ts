type Position3 = [number, number, number];

const BULK_RADIUS_QUANTILE = 0.9;
const MAX_NORMALIZED_RADIUS = 1.45;

export function normalizeChemicalSpacePositions(positions: Position3[]): Position3[] {
  if (!positions.length) return [];

  const center = [0, 1, 2].map((axis) => median(positions.map((position) => position[axis])));
  const centered = positions.map((position) => (
    position.map((value, axis) => value - center[axis]) as Position3
  ));
  const radii = centered.map((position) => Math.hypot(...position)).sort((left, right) => left - right);
  const bulkRadius = Math.max(
    1e-6,
    radii[Math.floor((radii.length - 1) * BULK_RADIUS_QUANTILE)],
  );

  return centered.map((position) => {
    const scaled = position.map((value) => value / bulkRadius) as Position3;
    const radius = Math.hypot(...scaled);
    if (radius <= 1) return scaled;

    const tail = Math.log1p(radius - 1);
    const compressedRadius = 1 + (MAX_NORMALIZED_RADIUS - 1) * tail / (1 + tail);
    return scaled.map((value) => value * compressedRadius / radius) as Position3;
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
