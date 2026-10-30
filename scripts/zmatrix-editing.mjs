// Immutable definition edits. A returned document is fully placeable; rejected
// edits never change the caller's definition or its bindings.
import { atomsFromZmatrixDocument, resolveZmatrixDocument } from './zmatrix-document.mjs';
import { atomsFromZmatrixRows, placeInReferenceFrame } from './internal-coordinates.mjs';
import { measureGeometry } from './molecular-geometry.js';

function checked(document) {
  atomsFromZmatrixDocument(document);
  return document;
}

function variableIndex(document, name) {
  const index = document.variables.findIndex(variable => variable.name === name);
  if (index < 0) throw new Error(`Unknown Z-matrix variable: ${String(name).slice(0, 64)}.`);
  return index;
}

/** Adds an initially unused variable; binding it is a separate undoable edit. */
export function addZmatrixVariable(document, name, value) {
  return checked({ ...document, variables: [...document.variables, { name, value }] });
}

/** Renaming preserves signed uses and leaves coordinates unchanged. */
export function renameZmatrixVariable(document, name, nextName) {
  const index = variableIndex(document, name);
  const rows = document.rows.map(row => ({ ...row, values: row.values.map(value => {
    if (typeof value !== 'string' || value.replace(/^[+-]/u, '') !== name) return value;
    return `${/^[+-]/u.test(value) ? value[0] : ''}${nextName}`;
  }) }));
  return checked({ rows, variables: document.variables.map((variable, i) => i === index ? { ...variable, name: nextName } : variable) });
}

/** Removing a variable inlines each resolved use, including its sign. */
export function removeZmatrixVariable(document, name) {
  const index = variableIndex(document, name);
  const resolved = resolveZmatrixDocument(document);
  const rows = document.rows.map((row, r) => ({ ...row, values: row.values.map((value, slot) =>
    typeof value === 'string' && value.replace(/^[+-]/u, '') === name ? resolved[r].values[slot] : value) }));
  return checked({ rows, variables: document.variables.filter((_, i) => i !== index) });
}

/** A finite literal or a signed existing variable; null detaches at its current value. */
export function bindZmatrixCoordinate(document, rowIndex, slot, binding) {
  const resolved = resolveZmatrixDocument(document);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(slot) || !resolved[rowIndex] || slot < 0 || slot >= resolved[rowIndex].values.length) {
    throw new Error('Choose an existing Z-matrix coordinate.');
  }
  if (binding !== null && typeof binding !== 'number' && typeof binding !== 'string') throw new Error('A coordinate requires a number or variable name.');
  const value = binding === null ? resolved[rowIndex].values[slot] : binding;
  return checked({ ...document, rows: document.rows.map((row, r) => r === rowIndex
    ? { ...row, values: row.values.map((old, s) => s === slot ? value : old) } : row) });
}

/**
 * Changes a row's reference choices without changing the molecule. Re-measures
 * all affected coordinates, retaining a binding only if its signed value still
 * agrees. The caller can show which slots became literals. Dummy rows participate
 * in reference geometry but never in chemical atom indexing.
 */
export function setZmatrixReferences(document, rowIndex, refs) {
  const resolved = resolveZmatrixDocument(document);
  if (!Number.isInteger(rowIndex) || !resolved[rowIndex] || !Array.isArray(refs)
      || refs.length !== Math.min(rowIndex, 3) || new Set(refs).size !== refs.length
      || refs.some(ref => !Number.isInteger(ref) || ref < 0 || ref >= rowIndex)) {
    throw new Error('References must be distinct earlier rows.');
  }
  const before = atomsFromZmatrixRows(resolved);
  const row = document.rows[rowIndex];
  if (refs.every((ref, slot) => ref === row.refs[slot])) return { document, detachedSlots: [] };
  let angle = refs.length >= 2 ? measureGeometry('angle', [rowIndex, ...refs.slice(0, 2)]
    .map(index => ({ id: String(index), position: before[index].position }))).value : null;
  // Independently normalized collinear vectors can differ by a few ulps.
  // Snap both the angle and its arbitrary torsion consistently; this degree
  // tolerance covers rounding, not resolvable near-linearity.
  if (angle !== null && Math.min(angle, 180 - angle) < 1e-12) angle = angle < 90 ? 0 : 180;
  const measured = refs.map((_, slot) => {
    if (slot === 1) return angle;
    // The torsion of a linear placement is arbitrary. Zero reproduces it and
    // avoids trying to normalize a vanishing projected vector.
    if (slot === 2) {
      if (angle === 0 || angle === 180) return 0;
    }
    return measureGeometry(['distance', 'angle', 'dihedral'][slot], [rowIndex, ...refs.slice(0, slot + 1)]
      .map(index => ({ id: String(index), position: before[index].position }))).value;
  });
  const detachedSlots = [];
  const values = measured.map((value, slot) => {
    if (typeof row.values[slot] !== 'string') return value;
    const difference = value - resolved[rowIndex].values[slot];
    // -180 and +180 describe the same plane. Retain the original signed
    // variable instead of silently turning an equivalent binding into a literal.
    const error = slot === 2 ? difference - 360 * Math.round(difference / 360) : difference;
    if (Math.abs(error) < 1e-8) return row.values[slot];
    detachedSlots.push(slot);
    return value;
  });
  const next = checked({ ...document, rows: document.rows.map((item, index) => index === rowIndex ? { ...item, refs: [...refs], values } : item) });
  const restored = placeInReferenceFrame(atomsFromZmatrixRows(resolveZmatrixDocument(next)), before);
  if (restored.some((atom, index) => Math.hypot(...atom.position.map((value, axis) => value - before[index].position[axis])) > 1e-6)) {
    throw new Error('These references cannot preserve the geometry accurately; choose a different reference plane.');
  }
  return { document: next, detachedSlots };
}
