import { atomsFromZmatrixRows, formatXyz, placeInReferenceFrame, type CoordinateAtom } from "../../../../../scripts/internal-coordinates.mjs";
import { measureGeometry } from "../../../../../scripts/molecular-geometry.js";
import { atomsFromZmatrixDocument, resolveZmatrixDocument, type ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { zmatrixDocumentFromAtoms } from "../../../../../scripts/zmatrix-export.mjs";
import type { ZmatrixRowEdit } from "../../../../../scripts/zmatrix-rows.mjs";
import { zmatrixAfterOptimization } from "./zmatrix-optimization";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { MolecularAtom } from "../molecular-workbench/types";
import { addDocumentInternalCoordinates, revisionIndex, type ImportedRevision } from "./scientific-source-state";

/** Reference rows (X) place other rows; they are never atoms. */
export function isReferencePoint(row: ZmatrixDocument["rows"][number]) {
  return row.element === "X";
}

/** Real atoms numbered as the viewer numbers them, reference points numbered apart. */
export function zmatrixRowLabels(definition: ZmatrixDocument) {
  let atoms = 0;
  let points = 0;
  return definition.rows.map((row) => (isReferencePoint(row) ? `Ref ${++points}` : `${row.element}${++atoms}`));
}

export type VariableUse = { row: number; slot: number; sign: 1 | -1 };

/** Every coordinate each named variable sets, in row order. */
export function variableUses(definition: ZmatrixDocument) {
  const uses = new Map<string, VariableUse[]>(definition.variables.map(({ name }) => [name, []]));
  definition.rows.forEach((row, index) => row.values.forEach((value, slot) => {
    if (typeof value !== "string") return;
    uses.get(value.replace(/^[+-]/u, ""))?.push({ row: index, slot, sign: value.startsWith("-") ? -1 : 1 });
  }));
  return uses;
}

export function withVariable(definition: ZmatrixDocument, name: string, value: number): ZmatrixDocument {
  return { ...definition, variables: definition.variables.map((variable) => (variable.name === name ? { name, value } : variable)) };
}

/** A literal coordinate; a coordinate bound to a variable changes only through that variable. */
export function withRowValue(definition: ZmatrixDocument, row: number, slot: number, value: number): ZmatrixDocument {
  if (typeof definition.rows[row]?.values[slot] !== "number") throw new Error("This coordinate is set by a variable.");
  return { ...definition, rows: definition.rows.map((item, index) => (index === row
    ? { ...item, values: item.values.map((current, position) => (position === slot ? value : current)) }
    : item)) };
}

/** A row's references with `slot` measured from `reference`; a row another slot uses trades places with it. */
export function withReference(refs: readonly number[], slot: number, reference: number) {
  const next = [...refs];
  const other = next.indexOf(reference);
  if (other >= 0 && other !== slot) next[other] = next[slot];
  next[slot] = reference;
  return next;
}

/** The first of V1, V2, … no variable is named yet. */
export function nextVariableName(definition: ZmatrixDocument) {
  const taken = new Set(definition.variables.map(({ name }) => name));
  let index = 1;
  while (taken.has(`V${index}`)) index++;
  return `V${index}`;
}

export function sameDefinition(a: ZmatrixDocument | undefined, b: ZmatrixDocument) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Below this displacement an atom keeps its source line verbatim. Cartesian Geometry bounds
// each axis; here the distance is bounded, so a definition placing an atom this close to its
// kept position still matches the geometry (zmatrix-optimization.ts checks 1e-6 Å).
const UNCHANGED_POSITION_A = 1e-6;

// The atoms of `placed` within UNCHANGED_POSITION_A of their source (`sources[index]`, none
// for a new atom), nearest first.
function nearSources(placed: readonly CoordinateAtom[], sources: readonly (MolecularAtom | undefined)[]) {
  return placed.flatMap(({ element, position }, index) => {
    const source = sources[index];
    const distance = source?.element === element ? Math.hypot(position[0] - source.x, position[1] - source.y, position[2] - source.z) : Infinity;
    return distance < UNCHANGED_POSITION_A ? [{ index, distance }] : [];
  }).sort((a, b) => a.distance - b.distance).map(({ index }) => index);
}

// `placed` with the atoms listed in `kept` exactly at their source positions.
function withKept(placed: readonly CoordinateAtom[], sources: readonly (MolecularAtom | undefined)[], kept: readonly number[]): CoordinateAtom[] {
  const keep = new Set(kept);
  return placed.map(({ element, position }, index) => {
    const source = sources[index];
    return keep.has(index) && source ? { element, position: [source.x, source.y, source.z] } : { element, position: [...position] };
  });
}

// `placed` with every atom that is within UNCHANGED_POSITION_A of where it was exactly there.
// Only for a definition that is measured afterwards on these atoms.
function keptInPlace(science: ScientificDocument, placed: readonly CoordinateAtom[]) {
  return withKept(placed, science.atoms, nearSources(placed, science.atoms));
}

// Coordinates agree below this (Å, degrees), as in zmatrix-optimization.ts and zmatrix-rows.mjs.
const AGREEMENT = 1e-8;
const DEG = Math.PI / 180;
// Round-off of a coordinate relative to the largest coordinate around it: placing the rows,
// moving them rigidly and measuring them each round every coordinate a few times.
const ROUND_OFF = 64 * Number.EPSILON;

const sub = (a: readonly number[], b: readonly number[]) => a.map((value, k) => value - b[k]);
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, k) => sum + value * b[k], 0);
const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: readonly number[]) => Math.hypot(...a);
const unit = (a: readonly number[]) => a.map((value) => value / norm(a));
// The part of `a` across the unit vector `u`, removed twice so it is across `u` to round-off
// even when `a` nearly lies along it.
const across = (a: readonly number[], u: readonly number[]) => [0, 1].reduce((v) => sub(v, u.map((value) => value * dot(v, u))), [...a]);
const largest = (points: readonly (readonly number[])[]) => Math.max(...points.flatMap((point) => point.map(Math.abs)));

// A rigid frame on the points `o`, `x` and `y` of `points`: the origin at o, the first axis
// toward x, the second across it toward y (any direction across it when y is on its line).
function frameOn(points: readonly number[][], [o, x, y]: readonly number[]) {
  const toward = sub(points[x], points[o]);
  const first = norm(toward) ? unit(toward) : [1, 0, 0];
  const off = across(sub(points[y], points[o]), first);
  const least = first.reduce((best, value, k) => (Math.abs(value) < Math.abs(first[best]) ? k : best), 0);
  const second = unit(norm(off) ? off : across([0, 1, 2].map((k) => Number(k === least)), first));
  return { origin: points[o], axes: [first, second, cross(first, second)] };
}

// `canonical` (the definition's own placement, a point per row) moved rigidly onto the real
// atoms of `at` (rows `atomRows`), on the frame of three of them: the first, the one farthest
// from it and the one farthest from their line. No atom lies farther from those anchors than
// they lie apart, so round-off at an anchor moves no point by more than a few times as much,
// however close to a line the atoms lie (where the frame of placeInReferenceFrame, anchored on
// the first atoms, can shear by round-off over their tiny offset). O(rows).
function superposed(canonical: readonly number[][], at: readonly number[][], atomRows: readonly number[]) {
  const [o] = atomRows;
  const farthest = (distance: (row: number) => number) => atomRows.reduce((best, row) => (distance(row) > distance(best) ? row : best), o);
  const x = farthest((row) => norm(sub(at[row], at[o])));
  const axis = norm(sub(at[x], at[o])) ? unit(sub(at[x], at[o])) : [1, 0, 0];
  const y = farthest((row) => norm(across(sub(at[row], at[o]), axis)));
  const [from, to] = [frameOn(canonical, [o, x, y]), frameOn(at, [o, x, y])];
  return canonical.map((point) => {
    const offset = sub(point, from.origin);
    return to.axes.reduce((position, direction, k) => position.map((value, j) => value + direction[j] * dot(from.axes[k], offset)), [...to.origin]);
  });
}

// How far, in degrees, a torsion measured by `measured` is from `torsion`. An atom too close
// to its axis for molecular-geometry.js to measure a torsion counts as half a turn off.
function torsionTurn(measured: () => number, torsion: number) {
  try {
    const turn = Math.abs(measured() - torsion);
    return Math.min(turn, 360 - turn);
  } catch {
    return 180;
  }
}

// Whether every row of `rows` (resolved values) holds among `points`, the position of every
// row (reference points too): its distance and angle measure their values to AGREEMENT, and
// its torsion turns the atom off its value by less than an angle at AGREEMENT would
// (sin(angle) × torsion difference, in degrees). Each measurement may also be off by what the
// round-off of its points turns it: an angle by that round-off over each arm, a torsion by it
// over each end's distance from the axis. That is far below AGREEMENT unless a reference
// nearly lies on the axis, where no placement fixes the torsion any closer (the frame of a
// torsion measured from a reference 2e-8 Å off its axis turns by 1e-7 rad per 1e-15 Å).
// Placement (internal-coordinates.mjs) ignores the torsion of a row at 0° or 180°, so any
// torsion there holds, as it does on a row that only nearly lies on its axis. Each row is
// checked against its own references, so the rows hold whichever of them anchor the frame and
// a later row move cannot amplify an offset. O(rows).
function describes(rows: ReturnType<typeof resolveZmatrixDocument>, points: readonly number[][]) {
  const measure = (kind: "distance" | "angle" | "dihedral", indices: number[]) => measureGeometry(kind, indices.map((i) => ({ id: String(i), position: points[i] }))).value;
  try {
    return rows.every(({ refs, values: [distance, angle, torsion] }, index) => {
      if (!refs.length) return true;
      const ends = [index, ...refs].map((i) => points[i]);
      const [p, a, b, c] = ends;
      // Off by less than AGREEMENT, or than it plus what round-off turns the measurement (only
      // worked out for a measurement off by more).
      const agrees = (difference: number, roundOff: () => number) => difference < AGREEMENT || difference < AGREEMENT + roundOff();
      // Radians a measurement turns when round-off moves a point across an arm of this length.
      const turn = (length: number) => (ROUND_OFF * largest(ends)) / length;
      if (!agrees(Math.abs(measure("distance", [index, refs[0]]) - distance), () => 2 * ROUND_OFF * largest(ends))) return false;
      if (!b) return true;
      if (!agrees(Math.abs(measure("angle", [index, refs[0], refs[1]]) - angle), () => 2 * (turn(norm(sub(p, a))) + turn(norm(sub(b, a)))) / DEG)) return false;
      const sine = angle === 0 || angle === 180 ? 0 : Math.sin(angle * DEG);
      if (!c || sine === 0) return true;
      const axis = () => unit(sub(b, a));
      return agrees(sine * torsionTurn(() => measure("dihedral", [index, ...refs]), torsion),
        () => sine * 2 * (turn(norm(across(sub(p, a), axis()))) + turn(norm(across(sub(c, b), axis()))) + 2 * turn(norm(sub(b, a)))) / DEG);
    });
  } catch {
    return false;
  }
}

// The real atoms of `definition` placed in the frame of `reference` (its current real atoms).
// An atom near its source keeps it while the definition still describes the atoms: they are
// its own placement moved rigidly (superposed) to AGREEMENT plus round-off, and every row
// holds on them with the reference points where that rigid move takes them. The first catches
// an atom moved relative to atoms its own references barely fix (a torsion measured from a
// reference nearly on the axis), the second an angle or torsion off by more than 1e-8°. A
// round-off difference keeps the line, a sub-micron authored change (a bond 0.9e-6 Å longer)
// is written where the definition places it. Source atoms the definition describes all stay,
// even where the frame, anchored on an atom nearly on the line of the first two, shears by
// round-off and places one farther than 1e-6 Å. Otherwise snaps are undone farthest first;
// with none kept the atoms are the definition's own placement. Placing the rows is O(rows²)
// (internal-coordinates.mjs checks each new row against every earlier one); the search adds
// O(rows × log snaps) on top.
function keptByDefinition(definition: ZmatrixDocument, reference: readonly CoordinateAtom[], sources: readonly (MolecularAtom | undefined)[]) {
  const rows = resolveZmatrixDocument(definition);
  const all = atomsFromZmatrixRows(rows);
  const atomRows = all.flatMap(({ element }, row) => (element === "X" ? [] : [row]));
  if (!atomRows.length) throw new Error("A Z-matrix must contain at least one real atom.");
  const canonical = all.map(({ position }) => position);
  const points = placeInReferenceFrame(atomRows.map((row) => all[row]), [...reference], all).map(({ position }) => position);
  const placed = atomRows.map((row) => ({ element: all[row].element, position: points[row] }));
  const near = nearSources(placed, sources);
  const keeping = (count: number) => withKept(placed, sources, near.slice(0, count));
  const holds = (atoms: CoordinateAtom[]) => {
    const at = [...points];
    atomRows.forEach((row, index) => { at[row] = atoms[index].position; });
    const shape = superposed(canonical, at, atomRows);
    const bound = AGREEMENT + 2 * ROUND_OFF * largest(atoms.map(({ position }) => position));
    if (!atomRows.every((row) => norm(sub(at[row], shape[row])) < bound)) return false;
    all.forEach(({ element }, row) => { if (element === "X") at[row] = shape[row]; });
    return describes(rows, at);
  };
  // Atoms the definition still describes all stay, however far the frame placed them.
  const every = placed.map((_, index) => index);
  if (near.length < every.length && every.every((index) => sources[index]?.element === placed[index].element)) {
    const unchanged = withKept(placed, sources, every);
    if (holds(unchanged)) return unchanged;
  }
  const kept = keeping(near.length);
  if (holds(kept)) return kept;
  let [low, high] = [0, near.length - 1];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (holds(keeping(middle))) low = middle;
    else high = middle - 1;
  }
  return keeping(low);
}

// A definition that leaves every real atom where it was (an unused variable, a reference
// point's distance) still needs text of its own, or its revision could not be told apart.
// The comment carries at most one such marker, replaced on every edit, so it never grows.
const DEFINITION_MARKER = / zdef-[0-9a-f]{8}$/u;

function definitionMarker(definition: ZmatrixDocument) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(definition)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return ` zdef-${hash.toString(16).padStart(8, "0")}`;
}

// XYZ `lines` (count, comment, atoms) as the text of `definition`, with the marker when an
// earlier revision with another definition has the same text.
function revisionText(lines: readonly string[], definition: ZmatrixDocument, revisions: readonly ImportedRevision[]) {
  const comment = (lines[1] ?? "").replace(DEFINITION_MARKER, "");
  const withComment = (value: string) => [lines[0], value, ...lines.slice(2)].join("\n");
  const taken = (candidate: string) => revisions.some((revision) => revision.text === candidate && !sameDefinition(revision.document.internalCoordinates, definition));
  let next = withComment(comment);
  if (taken(next)) next = withComment(`${comment}${definitionMarker(definition)}`);
  if (taken(next)) throw new Error("This Z-matrix edit cannot be told apart from an earlier one.");
  return next;
}

// The data of `atoms` defined by `definition`. Real atoms that are all where they were, in
// the same order, are the same geometry: everything computed for it (frames with their
// energies, velocities, forces and modes; modes, orbitals, basis, grid, convergence) stays.
// Any other atoms are a new geometry, which that data does not describe.
function revisionDocument(science: ScientificDocument, atoms: MolecularAtom[], definition: ZmatrixDocument): ScientificDocument {
  const same = atoms.length === science.atoms.length && atoms.every((atom, index) => {
    const { element, x, y, z } = science.atoms[index];
    return atom.element === element && atom.x === x && atom.y === y && atom.z === z;
  });
  return same
    ? { ...science, internalCoordinates: definition }
    : { format: science.format, atoms, frames: [{ atoms }], modes: [], orbitals: [], internalCoordinates: definition };
}

// Each row edit that changes the real atoms or their order starts a topology of its own.
let topologies = 0;
const topologyOf = (revisions: readonly ImportedRevision[], text: string) => revisions[revisionIndex(revisions, text)]?.topology;

/**
 * The XYZ text and scientific data of `definition`, as the revision after `text`.
 * Placing the rows checks every variable, reference and range first, so an invalid
 * definition throws before anything is applied. The placed atoms are moved rigidly
 * into the current atoms' frame, so an edit never reorients or translates the
 * molecule; atoms that did not move keep their lines, and the comment (with any
 * import token) is kept. Reference points are placed and then left out. An edit that
 * moves no atom keeps all data of the geometry; one that moves atoms leaves it out.
 */
export function zmatrixRevision(science: ScientificDocument, definition: ZmatrixDocument, text: string, revisions: readonly ImportedRevision[]): ImportedRevision {
  const reference = science.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  return geometryRevision(science, definition, keptByDefinition(definition, reference, science.atoms), text, revisions);
}

/**
 * The revision after `text` of the optimized real atoms `optimized` (the same atoms in the
 * same order), with `definition` written back through its rows by zmatrixAfterOptimization.
 * Atoms the optimization left in place keep their source lines; the definition is measured on
 * the atoms as they are kept, so the text, the atoms and the definition are one geometry.
 */
export function zmatrixOptimizedRevision(science: ScientificDocument, definition: ZmatrixDocument, optimized: readonly CoordinateAtom[], labels: readonly string[], text: string, revisions: readonly ImportedRevision[], optimizedDefinition?: ZmatrixDocument) {
  if (optimizedDefinition) {
    // A reduced-coordinate result already owns the exact definition. Measuring
    // it again from Cartesian atoms would lose the dummy frame and its bindings.
    const structure = (document: ZmatrixDocument) => JSON.stringify({ rows: document.rows.map(row => [row.element, row.refs, row.values.map(value => typeof value === 'string' ? value : null)]), variables: document.variables.map(variable => variable.name) });
    if (structure(definition) !== structure(optimizedDefinition)) throw new Error("The optimized Z-matrix changed its rows or variable bindings.");
    if (optimized.length !== science.atoms.length || optimized.some((atom, i) => atom.element !== science.atoms[i].element)) throw new Error("The optimized structure does not match the Z-matrix atoms.");
    if (optimized.some(atom => atom.position.length !== 3 || atom.position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6))) throw new Error("The optimized structure has invalid coordinates.");
    const rebuilt = placeInReferenceFrame(atomsFromZmatrixDocument(optimizedDefinition), [...optimized]);
    if (rebuilt.some((atom, i) => Math.hypot(...atom.position.map((value, k) => value - optimized[i].position[k])) > 1e-6)) throw new Error("The optimized geometry does not match its Z-matrix definition.");
    return { revision: geometryRevision(science, optimizedDefinition, optimized, text, revisions), detachedBindings: [] };
  }
  const kept = keptInPlace(science, optimized);
  const current = science.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  const written = zmatrixAfterOptimization(definition, current, kept, labels);
  return { revision: geometryRevision(science, written.document, kept, text, revisions), detachedBindings: written.detachedBindings };
}

// The revision after `text` with the real atoms exactly at `placed` (the same atoms in the
// same order) and `definition` describing them. Positions are never re-anchored; an atom
// keeps its source line only where it is exactly where it was.
function geometryRevision(science: ScientificDocument, definition: ZmatrixDocument, placed: readonly CoordinateAtom[], text: string, revisions: readonly ImportedRevision[]): ImportedRevision {
  if (placed.length !== science.atoms.length || placed.some(({ element }, index) => element !== science.atoms[index].element)) {
    throw new Error("The geometry does not match the Z-matrix atoms.");
  }
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const atoms = placed.map(({ element, position: [x, y, z] }, index) => {
    const source = science.atoms[index];
    if (x !== source.x || y !== source.y || z !== source.z) lines[index + 2] = formatXyz([{ element, position: [x, y, z] }], "").split("\n")[2];
    return { element, x, y, z };
  });
  return { text: revisionText(lines, definition, revisions), document: revisionDocument(science, atoms, definition), topology: topologyOf(revisions, text) };
}

/**
 * The XYZ text and scientific data after a row edit (`editZmatrixRows` on the current
 * atoms): the real atoms in the new row order, where the edit placed them. A surviving atom
 * the new rows still place where it was keeps its source line, the count line follows the
 * atom count, and the comment (with any
 * import token) is kept. Data of the previous atoms (orbitals, basis, grid, modes, frame
 * energies, velocities, forces, convergence) does not describe the new ones and is left
 * out; Undo returns to the revision that still has it. Bond orders are not inferred.
 * An edit that leaves every real atom in place (reference points alone) keeps the atoms,
 * all their data and the topology.
 */
export function zmatrixRowsRevision(science: ScientificDocument, edit: ZmatrixRowEdit, text: string, revisions: readonly ImportedRevision[]): ImportedRevision {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const count = science.atoms.length;
  // The new rows anchor the frame on other atoms; they are placed in it and checked like a
  // definition edit, so the atoms written are the geometry the rows describe.
  const sources = edit.atomMap.map((old) => (old === null ? undefined : science.atoms[old]));
  const placed = keptByDefinition(edit.document, edit.atoms, sources);
  const atoms: MolecularAtom[] = [];
  const atomLines = placed.map(({ element, position }, index) => {
    const source = sources[index];
    const [x, y, z] = position;
    if (source && x === source.x && y === source.y && z === source.z) {
      atoms.push({ ...source });
      return lines[(edit.atomMap[index] as number) + 2];
    }
    atoms.push({ element, x, y, z });
    return formatXyz([{ element, position }], "").split("\n")[2];
  });
  const sameAtoms = edit.atomMap.length === count && edit.atomMap.every((old, index) => old === index);
  const next = revisionText([sameAtoms ? lines[0] : String(atoms.length), lines[1] ?? "", ...atomLines, ...lines.slice(count + 2)], edit.document, revisions);
  return { text: next, document: revisionDocument(science, atoms, edit.document), topology: sameAtoms ? topologyOf(revisions, text) : ++topologies };
}

/**
 * Gives a single-geometry document's current text a Z-matrix definition, so Geometry
 * edits it through the definition like an imported Z-matrix. A reference point is added
 * when the atom order alone cannot define a plane; atom order never changes.
 */
export function convertToInternalCoordinates(documentId: string, text: string, science: ScientificDocument) {
  if (science.frames.length > 1) throw new Error("Only a single geometry can be converted to internal coordinates.");
  const definition = zmatrixDocumentFromAtoms(science.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] })));
  addDocumentInternalCoordinates(documentId, text, { ...science, internalCoordinates: definition });
}
