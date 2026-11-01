// Cartesian -> Z-matrix with an explicit reference point when the original
// atom order cannot define a plane. Chemical atom order is never changed.
import { MAX_INTERNAL_COORDINATE_ATOMS, formatXyz, parseXyzAtoms, zmatrixRowsFromAtoms } from './internal-coordinates.mjs';
import { atomsFromZmatrixDocument } from './zmatrix-document.mjs';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = v => Math.hypot(...v);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/** Returns numerical bindings, inserting at most one X after the first pair. */
export function zmatrixDocumentFromAtoms(atoms) {
  // Apply the same real-atom/finite/separation/size contract as XYZ import.
  parseXyzAtoms(formatXyz(atoms, 'Z-matrix validation'));
  let rows;
  try { rows = zmatrixRowsFromAtoms(atoms); }
  catch (error) {
    if (!['DEGENERATE_REFERENCE_PLANE', 'ILL_CONDITIONED_ANGLE'].includes(error.code)) throw error;
    if (atoms.length >= MAX_INTERNAL_COORDINATE_ATOMS) {
      throw Object.assign(new Error('A dummy reference would exceed the 512-row Z-matrix limit.'), { code: 'COORDINATE_LIMIT' });
    }
    const origin = atoms[0].position;
    const axis = sub(atoms[1].position, origin);
    const length = norm(axis), u = axis.map(v => v / length);
    const anchor = atoms.slice(2).find(atom => {
      const delta = sub(atom.position, origin);
      const projection = sub(delta, u.map(v => v * dot(delta, u)));
      return norm(projection) / norm(delta) > 1e-8 && norm(projection) >= 1e-8;
    });
    if (!anchor) throw error;
    const delta = sub(anchor.position, origin);
    const plane = sub(delta, u.map(v => v * dot(delta, u)));
    const direction = plane.map(v => v / norm(plane));
    // Interior points of a segment between two input atoms stay in bounds,
    // even when atom0 sits at a corner where every perpendicular leaves them.
    // Perpendicular candidates also cover very small molecular geometries.
    let position;
    const distances = Array.from({ length: atoms.length + 1 }, (_, i) => 1 + i / (atoms.length + 1)).flatMap(v => [v, -v]);
    const candidates = [
      ...Array.from({ length: atoms.length + 1 }, (_, i) => origin.map((v, k) => v + (0.25 + i / (2 * (atoms.length + 1))) * delta[k])),
      ...distances.map(distance => origin.map((v, i) => v + distance * direction[i])),
    ];
    for (const candidate of candidates) {
      if (candidate.every(v => Math.abs(v) <= 1e6)
        && atoms.every(atom => norm(sub(candidate, atom.position)) >= 1e-8)) {
        position = candidate;
        break;
      }
    }
    if (!position) throw new Error('Cannot place a distinct dummy reference within coordinate bounds.');
    rows = zmatrixRowsFromAtoms([...atoms.slice(0, 2), { element: 'X', position }, ...atoms.slice(2)]);
  }
  const document = { rows, variables: [] };
  // Canonical rotation can exceed coordinate bounds; never emit an invalid file.
  atomsFromZmatrixDocument(document);
  return document;
}
