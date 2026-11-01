import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateScientificDocument } from '../apps/desktop/src/lib/science-session/scientific-document';
import { elementSymbol } from '../apps/desktop/src/lib/molecular-workbench/elements';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';

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
