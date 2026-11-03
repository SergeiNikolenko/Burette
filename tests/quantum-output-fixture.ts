import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateScientificDocument } from '../apps/desktop/src/lib/science-session/scientific-document';
import { elementSymbol } from '../apps/desktop/src/lib/molecular-workbench/elements';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import type { CartesianHessian } from '../apps/desktop/src/lib/molecular-workbench/hessian';

/** cclib's parse of a fixture directory (see fixtures/quantum/cclib-reference.py). */
export type CclibReference = {
  sha256: string; atomnos?: number[]; atomcoords?: number[][][]; scfenergies?: number[]; mpenergies?: number[][]; ccenergies?: number[];
  optdone?: boolean; vibfreqs?: number[]; vibirs?: number[]; vibramans?: number[]; vibdisps?: number[][][]; vibsyms?: string[];
  moenergies?: number[][]; homos?: number[]; mosyms?: (string | null)[][]; nmo?: number; nbasis?: number; mult?: number;
  atomcharges?: Record<string, number[]>; dipole_debye?: number[] | null; hessian?: number[][];
  metadata?: { package?: string; package_version?: string; success?: boolean; methods?: string[] };
};

export const fixtureText = (path: string) => readFileSync(new URL(`./fixtures/quantum/${path}`, import.meta.url), 'utf8');
export const cclibReference = (directory: string): Record<string, CclibReference> => JSON.parse(fixtureText(`${directory}/cclib-reference.json`));

/** cclib lists every printed geometry; consecutive reprints of one geometry are one Burette frame. */
export function distinctGeometries(coordinates: number[][][]) {
  return coordinates.filter((frame, i) => i === 0 || frame.some((atom, a) => atom.some((value, axis) => Math.abs(value - coordinates[i - 1][a][axis]) > 1e-6)));
}

export function expectGeometries(document: ScientificDocument, reference: CclibReference, tolerance = 1e-8) {
  const expected = distinctGeometries(reference.atomcoords!);
  expect(document.frames.length).toBe(expected.length);
  document.frames.forEach((frame, i) => {
    expect(frame.atoms.map(atom => atom.element)).toEqual(reference.atomnos!.map(elementSymbol));
    frame.atoms.forEach((atom, a) => [atom.x, atom.y, atom.z].forEach((value, axis) => expect(Math.abs(value - expected[i][a][axis])).toBeLessThanOrEqual(tolerance)));
  });
  expect(document.atoms).toBe(document.frames.at(-1)!.atoms);
}

export function expectClose(actual: readonly number[], expected: readonly number[], tolerance: number) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(tolerance));
}

/** The MOLX/restore schema accepts the reader output with its final geometry as the scene source (the "final" open layout). */
export function expectSchema(document: ScientificDocument) {
  const source = [{ elements: document.atoms.map(atom => atom.element), positions: Float64Array.from(document.atoms.flatMap(atom => [atom.x, atom.y, atom.z])) }];
  expect(validateScientificDocument(document, source)).toBe(document);
}

/**
 * A run killed at any point keeps the complete frames printed before the cut: every
 * prefix parses (or names its missing geometry), and history never shrinks as the cut moves.
 */
export function expectTruncationsKeepHistory(text: string, parse: (text: string) => ScientificDocument, cuts = 40) {
  const lines = text.split('\n');
  let previous = 0;
  for (let k = 1; k <= cuts; k++) {
    const prefix = lines.slice(0, Math.floor(lines.length * k / cuts)).join('\n');
    let document: ScientificDocument;
    try { document = parse(prefix); }
    catch (error) {
      expect(previous).toBe(0);
      expect(String(error)).toMatch(/geometry/i);
      continue;
    }
    expect(document.frames.length).toBeGreaterThanOrEqual(previous);
    expect(document.frames.every(frame => frame.atoms.length === document.atoms.length)).toBe(true);
    previous = document.frames.length;
  }
  return previous;
}

/** CRLF line endings and a UTF-8 byte-order mark do not change the parse. */
export function expectLineEndingsIgnored(text: string, parse: (text: string) => ScientificDocument) {
  expect(JSON.stringify(parse(`﻿${text.replace(/\n/g, '\r\n')}`))).toBe(JSON.stringify(parse(text)));
}

const CM1_PER_AU = Math.sqrt(4.3597447222071e-18 / (5.29177210903e-11 ** 2 * 1.6605390666e-27)) / (2 * Math.PI * 2.99792458e10);
/**
 * Measurement instrument for parsed Hessians: cyclic-Jacobi eigenvalues of the symmetrized
 * mass-weighted matrix, converted with CODATA 2018 constants to signed wavenumbers (ascending).
 * Comparing them with the frequencies the program itself printed checks units, masses and the
 * matrix layout without trusting either parser.
 */
export function harmonicFrequencies(hessian: CartesianHessian) {
  const n = hessian.dimension;
  const weight = (index: number) => 1 / Math.sqrt(hessian.massesAmu![Math.floor(index / 3)]);
  const at = (i: number, j: number) => hessian.values[i * n + j];
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (at(i, j) + at(j, i)) / 2 * weight(i) * weight(j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-28) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
    }
  }
  return a.map((row, i) => row[i]).sort((x, y) => x - y).map(value => Math.sign(value) * Math.sqrt(Math.abs(value)) * CM1_PER_AU);
}
