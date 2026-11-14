import { measureGeometry } from '../../../../../../scripts/molecular-geometry.js';
import { elementSymbol } from '../elements';
import type { ReactionPath, ReactionPathAxis, ScientificFrame } from '../scientific-types';
import type { MolecularAtom } from '../types';
import { coordinate, numeric } from './reader-values';

const KIND = { B: 'bond', A: 'angle', D: 'dihedral' } as const;
const MEASURE = { bond: 'distance', angle: 'angle', dihedral: 'dihedral' } as const;

/** The scanned coordinate's value in a geometry: Å for a bond, degrees for an angle or dihedral. */
export function measureAxis(axis: Extract<ReactionPathAxis, { atoms: number[] }>, atoms: MolecularAtom[]) {
  return measureGeometry(MEASURE[axis.kind], axis.atoms.map(index => ({ id: String(index), position: [atoms[index].x, atoms[index].y, atoms[index].z] }))).value as number;
}

/**
 * The one coordinate a Gaussian `opt=modredundant` job scans (`B 1 2 S 10 0.1`, `A …`, `D …`),
 * with 0-based atoms. Frozen coordinates are skipped; a scan of several coordinates has none.
 */
export function gaussianScanAxis(lines: string[]): ReactionPathAxis | undefined {
  const start = lines.findIndex(line => /The following ModRedundant input section has been read:/u.test(line));
  if (start < 0) return undefined;
  const scanned: ReactionPathAxis[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim(); i++) {
    const row = lines[i].trim().match(/^([BAD])\s+((?:\d+\s+){1,3}\d+)\s+S\s+\d+\s+\S+/u);
    if (!row) continue;
    const atoms = row[2].trim().split(/\s+/u).map(value => Number(value) - 1);
    if (atoms.length === { B: 2, A: 3, D: 4 }[row[1] as 'B' | 'A' | 'D']) scanned.push({ kind: KIND[row[1] as 'B' | 'A' | 'D'], atoms });
  }
  return scanned.length === 1 ? scanned[0] : scanned.length ? { kind: 'step' } : undefined;
}

/**
 * One converged IRC point: `Point Number: n  Path Number: p`, the `CURRENT STRUCTURE` table and the
 * net reaction coordinate. The reverse path (2) runs to negative coordinates, as Gaussian's summary does.
 */
export function readGaussianIrcPoint(lines: string[], i: number) {
  const header = lines[i].match(/^\s*Point Number:\s*(\d+)\s+Path Number:\s*(\d+)\s*$/u);
  if (!header || !/CURRENT STRUCTURE/u.test(lines[i + 1] ?? '')) return null;
  let j = i + 2;
  while (j < lines.length && !/^\s*-{5,}\s*$/u.test(lines[j])) j++;
  // Dashes, the two header rows and dashes again precede the atoms.
  j += 4;
  const atoms: MolecularAtom[] = [];
  for (; j < lines.length && !/^\s*-{5,}\s*$/u.test(lines[j]); j++) {
    const p = lines[j].trim().split(/\s+/u);
    if (p.length !== 5 || p[0] !== String(atoms.length + 1)) throw new Error('Malformed Gaussian IRC structure row.');
    atoms.push(coordinate(elementSymbol(Number(p[1])), p.slice(2).map(numeric)));
  }
  for (let k = j; k < Math.min(lines.length, j + 6); k++) {
    const net = lines[k].match(/NET REACTION COORDINATE UP TO THIS POINT\s*=\s*(\S+)/u);
    if (net) return { atoms, x: (header[2] === '2' ? -1 : 1) * numeric(net[1]), end: k };
  }
  throw new Error('Gaussian IRC point has no reaction coordinate.');
}

/**
 * ORCA scans and IRC runs, from the output's own summaries: `The Calculated Surface using the
 * 'Actual Energy'` (scan value, energy) and `IRC PATH SUMMARY` (energies with the TS marked).
 * A relaxed scan step's geometry is its last coordinate block before the next step; an unrelaxed
 * scan prints one block per point. IRC geometries live in the separate `_IRC_Full_trj.xyz`.
 */
export function orcaPath(lines: string[], geometryLines: number[]): ReactionPath | undefined {
  const surface = lines.findIndex(line => /The Calculated Surface using the 'Actual Energy'/u.test(line));
  if (surface >= 0) {
    const rows: Array<[number, number]> = [];
    for (let i = surface + 1; i < lines.length; i++) {
      const p = lines[i].trim().split(/\s+/u);
      if (p.length !== 2) break;
      rows.push([numeric(p[0]), numeric(p[1])]);
    }
    const steps = lines.flatMap((line, i) => (/RELAXED SURFACE SCAN STEP\s+\d+/u.test(line) ? [i] : []));
    const frameOf = (k: number) => {
      if (steps.length === rows.length) {
        const end = steps[k + 1] ?? lines.length;
        const last = geometryLines.filter(line => line > steps[k] && line < end).length;
        return last ? geometryLines.findIndex(line => line > steps[k] && line < end) + last - 1 : undefined;
      }
      return geometryLines.length === rows.length ? k : undefined;
    };
    const coordinate = lines.find(line => /^\s*\*\s+(Bond|Angle|Dihedral)\s*\(([\d,\s]+)\)\s*:/u.test(line))?.match(/(Bond|Angle|Dihedral)\s*\(([\d,\s]+)\)/u);
    const axis: ReactionPathAxis = coordinate
      ? { kind: coordinate[1].toLowerCase() as 'bond' | 'angle' | 'dihedral', atoms: coordinate[2].split(',').map(value => Number(value.trim())) }
      : { kind: 'parameter' };
    return { kind: 'scan', axis, points: rows.map(([x, energyHartree], k) => ({ x, energyHartree, ...(frameOf(k) !== undefined ? { frame: frameOf(k) } : {}) })) };
  }
  const summary = lines.findIndex(line => /^\s*IRC PATH SUMMARY\s*$/u.test(line));
  if (summary < 0) return undefined;
  const rows: Array<{ step: number; energy: number; ts: boolean }> = [];
  let i = summary + 1;
  while (i < lines.length && !/^\s*Step\s+E\(Eh\)/u.test(lines[i])) i++;
  for (i++; i < lines.length; i++) {
    const row = lines[i].match(/^\s*(\d+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s*(<= TS)?\s*$/u);
    if (!row) break;
    rows.push({ step: Number(row[1]), energy: numeric(row[2]), ts: Boolean(row[3]) });
  }
  const ts = rows.find(row => row.ts);
  if (!ts) return undefined;
  return { kind: 'irc', axis: { kind: 'step' }, points: rows.map(row => ({ x: row.step - ts.step, energyHartree: row.energy })) };
}

/** ORCA's `_IRC_Full_trj.xyz`: every IRC point with its energy, the TS the highest. */
export function orcaTrajectoryPath(frames: ScientificFrame[]): ReactionPath | undefined {
  if (!/ORCA-job \S*_IRC_Full\b/u.test(frames[0]?.comment ?? '') || frames.some(frame => frame.energyHartree === undefined)) return undefined;
  const energies = frames.map(frame => frame.energyHartree!);
  const ts = energies.indexOf(Math.max(...energies));
  return { kind: 'irc', axis: { kind: 'step' }, points: energies.map((energyHartree, frame) => ({ x: frame - ts, energyHartree, frame })) };
}
