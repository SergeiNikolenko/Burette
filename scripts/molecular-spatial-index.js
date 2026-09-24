const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// One bounded Cartesian grid shared by contact counting and spatial selection.
// A false visitor result stops the search after the first accepted neighbour.
export function distanceIndex(atoms, radius, budget = { checks: 0 }) {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 20) fail('INVALID_SPATIAL', 'radiusAngstrom must be in (0,20].');
  const cellOf = atom => {
    if (!Array.isArray(atom.position) || atom.position.length !== 3 || !atom.position.every(Number.isFinite)) fail('INVALID_COORDINATES', 'Spatial inputs require finite Cartesian coordinates.');
    const cell = atom.position.map(value => Math.floor(value / radius));
    if (!cell.every(value => Number.isSafeInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER - 1)) fail('INVALID_COORDINATES', 'Coordinates/radius exceed the exact spatial-grid range.');
    return cell;
  };
  const grid = new Map();
  for (const atom of atoms) {
    const key = cellOf(atom).join(',');
    const bucket = grid.get(key) ?? [];
    bucket.push(atom); grid.set(key, bucket);
  }
  return {
    get candidateChecks() { return budget.checks; },
    visitWithin(atom, visitor) {
      const [x, y, z] = cellOf(atom);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const other of grid.get([x + dx, y + dy, z + dz].join(',')) ?? []) {
          if (++budget.checks > 2000000) fail('WORK_LIMIT', 'Spatial calculation exceeded 2000000 candidate checks; narrow the selections. No partial totals are returned.');
          const distance = Math.hypot(...atom.position.map((value, i) => value - other.position[i]));
          if (distance <= radius && visitor(other, distance) === false) return;
        }
      }
    },
  };
}
