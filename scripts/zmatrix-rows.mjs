// Row topology edits retain physical positions and report real-atom provenance.
// X rows are reference geometry only. No graph, bond order or charge is inferred.
import { atomsFromZmatrixRows, placeInReferenceFrame, zmatrixRowsFromAtoms } from './internal-coordinates.mjs';
import { atomsFromZmatrixDocument, resolveZmatrixDocument } from './zmatrix-document.mjs';
import { measureGeometry } from './molecular-geometry.js';

const distance = (a, b) => Math.hypot(...a.map((value, k) => value - b[k]));
const difference = (a, b, slot) => slot === 2 ? (a - b) - 360 * Math.round((a - b) / 360) : a - b;
const copyRow = row => ({ element: row.element, refs: [...row.refs], values: [...row.values] });

function rowIndex(document, index) {
  if (!Number.isInteger(index) || index < 0 || index >= document.rows.length) throw new Error('Choose an existing Z-matrix row.');
}

function measuredRow(points, index, refs) {
  const values = refs.map((_, slot) => {
    if (slot === 2) {
      const angle = measureGeometry('angle', [index, ...refs.slice(0, 2)].map(i => ({ id: String(i), position: points[i].position }))).value;
      if (Math.min(angle, 180 - angle) < 1e-12) return 0;
    }
    const value = measureGeometry(['distance', 'angle', 'dihedral'][slot], [index, ...refs.slice(0, slot + 1)]
      .map(i => ({ id: String(i), position: points[i].position }))).value;
    return slot === 1 && Math.min(value, 180 - value) < 1e-12 ? (value < 90 ? 0 : 180) : value;
  });
  return { element: points[index].element, refs, values };
}

/**
 * Append an explicit row, remove a row, or move it to a final 0-based index.
 * Existing positions never change. References are remapped where possible and
 * otherwise chosen from earlier rows. Invalid/degenerate new orders are rejected
 * atomically; no hidden reference points or chemical atoms are inserted.
 * referenceAtoms, when supplied, is the current real geometry of this definition.
 */
export function editZmatrixRows(document, action, referenceAtoms = atomsFromZmatrixDocument(document)) {
  const resolved = resolveZmatrixDocument(document);
  const allBefore = atomsFromZmatrixRows(resolved);
  const realBefore = atomsFromZmatrixDocument(document);
  if (referenceAtoms.length !== realBefore.length || referenceAtoms.some((atom, i) =>
    atom.element !== realBefore[i].element || atom.position.length !== 3 || atom.position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6))) {
    throw new Error('The current geometry does not match the Z-matrix atom identities.');
  }
  if (referenceAtoms.some((atom, i) => referenceAtoms.slice(0, i).some(other => distance(atom.position, other.position) < 1e-8))) {
    throw new Error('The current geometry no longer matches a valid Z-matrix: coincident atoms.');
  }
  const aligned = placeInReferenceFrame(realBefore, referenceAtoms);
  if (aligned.some((atom, i) => {
    const error = distance(atom.position, referenceAtoms[i].position);
    return !Number.isFinite(error) || error > 1e-6;
  })) {
    throw new Error('The current geometry no longer matches this Z-matrix definition.');
  }
  let order = document.rows.map((_, i) => i);
  let next;
  let points;
  const detachedBindings = [];
  if (action.type === 'append') {
    next = { rows: [...document.rows.map(copyRow), copyRow(action.row)], variables: document.variables.map(value => ({ ...value })) };
    atomsFromZmatrixDocument(next);
    points = atomsFromZmatrixRows(resolveZmatrixDocument(next));
    order.push(null);
  } else {
    rowIndex(document, action.index);
    if (action.type === 'remove') order.splice(action.index, 1);
    else if (action.type === 'move') {
      rowIndex(document, action.to);
      order.splice(action.to, 0, ...order.splice(action.index, 1));
    } else throw new Error('Unknown Z-matrix row edit.');
    points = order.map(index => allBefore[index]);
    if (!points.some(atom => atom.element !== 'X')) throw new Error('Keep at least one real atom.');
    // Generate only when a row loses a reference or gains a coordinate slot.
    // The ordinary exporter can reject an ill-conditioned order: retain that
    // scientific error rather than perturbing coordinates to make it fit.
    let generated;
    const oldToNew = new Map(order.map((old, i) => [old, i]));
    const rows = order.map((old, index) => {
      const original = document.rows[old];
      const remapped = original.refs.map(ref => oldToNew.get(ref));
      let row;
      if (remapped.length === Math.min(index, 3) && remapped.every(ref => ref !== undefined && ref < index)) {
        row = measuredRow(points, index, remapped);
      } else {
        generated ??= zmatrixRowsFromAtoms(points);
        row = generated[index];
      }
      row = copyRow(row);
      row.values = row.values.map((value, slot) => {
        const sameReferences = row.refs.slice(0, slot + 1).every((ref, k) => order[ref] === original.refs[k]);
        return sameReferences && Math.abs(difference(value, resolved[old].values[slot], slot)) < 1e-8 ? original.values[slot] : value;
      });
      original.values.forEach((binding, slot) => {
        if (typeof binding === 'string' && row.values[slot] !== binding) detachedBindings.push({ row: index, slot, binding });
      });
      return row;
    });
    next = { rows, variables: document.variables.map(value => ({ ...value })) };
    atomsFromZmatrixDocument(next);
    const reconstructed = placeInReferenceFrame(atomsFromZmatrixRows(resolveZmatrixDocument(next)), points);
    if (reconstructed.some((atom, i) => {
      const error = distance(atom.position, points[i].position);
      return !Number.isFinite(error) || error > 1e-6;
    })) {
      throw new Error('This row order cannot preserve the geometry accurately. Keep an earlier reference point.');
    }
  }
  const realIndex = new Map();
  let count = 0;
  allBefore.forEach((atom, i) => { if (atom.element !== 'X') realIndex.set(i, count++); });
  const atomMap = order.filter((_, i) => points[i].element !== 'X').map(old => old === null ? null : realIndex.get(old));
  const positioned = placeInReferenceFrame(realBefore, referenceAtoms, points.filter(atom => atom.element !== 'X'));
  const atoms = positioned.map((atom, i) => ({
    element: atom.element,
    // Surviving atoms retain exact source positions, including floating-point bits.
    position: [...(atomMap[i] === null ? atom.position : referenceAtoms[atomMap[i]].position)],
  }));
  if (atoms.some(atom => atom.position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6))) throw new Error('Row edit places an atom outside coordinate bounds.');
  return { document: next, atoms, atomMap, detachedBindings };
}
