// Z-matrix interchange in angstrom/degrees. Named values follow the simple
// assignment syntax documented by Psi4; expressions and mixed Cartesian rows
// are deliberately not evaluated. X rows are reference points, never atoms.
// https://psicode.org/psi4manual/master/psithonmol.html
import { MAX_INTERNAL_COORDINATE_ATOMS, atomsFromZmatrixRows, formatZmatrix, parseZmatrixRows } from './internal-coordinates.mjs';

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const MAX_BYTES = 1024 * 1024;
const MAX_VARIABLES = 1536;

function invalid(message, code = 'INVALID_COORDINATES') {
  throw Object.assign(new Error(message), { code });
}

function finiteNumber(text) {
  if (!NUMBER.test(text)) invalid(`Expected a finite number, received "${text.slice(0, 64)}".`);
  const value = Number(text.replace(/[dD]/, 'e'));
  if (!Number.isFinite(value)) invalid('Z-matrix values must be finite.');
  return value;
}

/** Retains named coordinate bindings so a variable can edit all its uses. */
export function parseZmatrixDocument(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) invalid('Z-matrix exceeds 1 MiB.', 'COORDINATE_LIMIT');
  const rows = [], variables = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n?|\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    if (line.includes('=')) {
      const parts = line.split('=').map(part => part.trim());
      if (parts.length !== 2 || !NAME.test(parts[0])) invalid('Variable definitions require name = number.');
      if (variables.some(variable => variable.name === parts[0])) invalid(`Duplicate variable ${parts[0]}.`);
      variables.push({ name: parts[0], value: finiteNumber(parts[1]) });
      if (variables.length > MAX_VARIABLES) invalid('Too many Z-matrix variables.', 'COORDINATE_LIMIT');
      continue;
    }
    const fields = line.split(/\s+/);
    const i = rows.length;
    if (i >= MAX_INTERNAL_COORDINATE_ATOMS) invalid('Z-matrix allows at most 512 rows, including dummy points.', 'COORDINATE_LIMIT');
    if (fields.length !== 1 + 2 * Math.min(i, 3)) invalid('Z-matrix rows require an element and reference/value pairs.');
    const refs = [], values = [];
    for (let j = 1; j < fields.length; j += 2) {
      if (!/^\d+$/.test(fields[j])) invalid('Z-matrix references must be positive integer indices.');
      refs.push(Number(fields[j]) - 1);
      const token = fields[j + 1];
      if (NUMBER.test(token)) values.push(finiteNumber(token));
      else {
        if (!NAME.test(token.replace(/^[+-]/, ''))) invalid(`Invalid coordinate variable "${token.slice(0, 64)}".`);
        values.push(token);
      }
    }
    rows.push({ element: fields[0], refs, values });
  }
  const document = { rows, variables };
  resolveZmatrixDocument(document);
  return document;
}

/** Resolves bindings and validates element symbols, arity and earlier references. */
export function resolveZmatrixDocument(document) {
  if (!document.rows.length || document.rows.length > MAX_INTERNAL_COORDINATE_ATOMS) invalid('Z-matrix requires 1–512 rows, including dummy points.', 'COORDINATE_LIMIT');
  if (document.variables.length > MAX_VARIABLES) invalid('Too many Z-matrix variables.', 'COORDINATE_LIMIT');
  const variables = new Map();
  for (const { name, value } of document.variables) {
    if (!NAME.test(name) || !Number.isFinite(value) || variables.has(name)) invalid('Variable names must be unique and values finite.');
    variables.set(name, value);
  }
  const rows = document.rows.map((row, index) => {
    const arity = Math.min(index, 3);
    if (!/^[A-Z][a-z]?$/.test(row.element) || row.refs.length !== arity || row.values.length !== arity
      || row.refs.some(ref => !Number.isInteger(ref))) invalid('Invalid Z-matrix row.');
    return { ...row, values: row.values.map(value => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid('Z-matrix values must be finite.');
      return value;
    }
    const name = value.replace(/^[+-]/, '');
    if (!NAME.test(name) || !variables.has(name)) invalid(`Undefined coordinate variable "${name.slice(0, 64)}".`);
    return (value.startsWith('-') ? -1 : 1) * variables.get(name);
    }) };
  });
  // Use the same numerical row contract as Geometry and the CLI.
  return parseZmatrixRows(formatZmatrix(rows));
}

/** Keeps real-atom order; dummy points participate only in coordinate placement. */
export function atomsFromZmatrixDocument(document) {
  const atoms = atomsFromZmatrixRows(resolveZmatrixDocument(document)).filter(atom => atom.element !== 'X');
  if (!atoms.length) invalid('A Z-matrix must contain at least one real atom.');
  return atoms;
}

export function formatZmatrixDocument(document) {
  resolveZmatrixDocument(document);
  const rows = document.rows.map(row => [row.element, ...row.refs.flatMap((ref, i) => [ref + 1, row.values[i]])].join(' '));
  const assignments = document.variables.map(({ name, value }) => `${name} = ${value}`);
  return [...rows, ...(assignments.length ? ['', ...assignments] : [])].join('\n') + '\n';
}
