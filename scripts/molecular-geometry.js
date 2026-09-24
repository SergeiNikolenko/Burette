const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_GEOMETRY' }); };
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalized(vector) {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-10) fail('Geometry has coincident or collinear endpoints.');
  return vector.map(value => value / length);
}

// Endpoints are already resolved in one immutable scene revision by the caller.
// This kernel neither changes the scene nor infers chemical bonding.
export function measureGeometry(kind, atoms) {
  const size = { distance: 2, angle: 3, dihedral: 4 }[kind];
  if (!size || !Array.isArray(atoms) || atoms.length !== size) fail('distance/angle/dihedral require exactly 2/3/4 ordered endpoints.');
  if (new Set(atoms.map(atom => atom.id)).size !== size) fail('Geometry endpoints must be distinct atoms.');
  if (atoms.some(atom => !Array.isArray(atom.position) || atom.position.length !== 3 || !atom.position.every(Number.isFinite))) fail('Geometry endpoints require finite Cartesian coordinates.');
  const points = atoms.map(atom => atom.position);
  let value;
  if (kind === 'distance') value = Math.hypot(...subtract(points[0], points[1]));
  else if (kind === 'angle') {
    const a = normalized(subtract(points[0], points[1]));
    const b = normalized(subtract(points[2], points[1]));
    value = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
  } else {
    const axis = normalized(subtract(points[2], points[1]));
    const start = subtract(points[0], points[1]);
    const end = subtract(points[3], points[2]);
    const a = normalized(start.map((x, i) => x - dot(start, axis) * axis[i]));
    const b = normalized(end.map((x, i) => x - dot(end, axis) * axis[i]));
    value = Math.atan2(dot(cross(axis, a), b), dot(a, b)) * 180 / Math.PI;
    if (value === -180) value = 180;
    if (Object.is(value, -0)) value = 0;
  }
  if (!Number.isFinite(value)) fail('Geometry exceeds finite numeric range.');
  const warnings = [];
  if (atoms.some(atom => atom.occupancy === 0)) warnings.push('Explicit endpoints include zero-occupancy atoms.');
  if (atoms.some(atom => atom.label_alt_id)) warnings.push('Alternate conformers were explicitly selected; no conformer averaging was performed.');
  return { method: 'cartesian-geometry/v1', kind, value, units: kind === 'distance' ? 'angstrom' : 'degrees',
    coordinateSpace: 'scene', endpoints: atoms.map(atom => ({ id: atom.id, position: [...atom.position],
      occupancy: atom.occupancy ?? null, label_alt_id: atom.label_alt_id ?? null })), warnings,
    ...(kind === 'dihedral' ? { convention: 'atan2((B→C × projected B→A) · projected C→D, projected B→A · projected C→D), (-180,180]' } : {}),
  };
}
