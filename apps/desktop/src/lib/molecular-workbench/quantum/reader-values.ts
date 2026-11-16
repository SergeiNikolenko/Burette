import { atomicNumber } from '../elements';
import type { MolecularAtom } from '../types';

export const BOHR = 0.529177210903;
export const MAX_ATOMS = 10_000;
export const MAX_FRAMES = 2_000;
export const MAX_VALUES = 2_000_000;
export function numeric(token: string): number {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(token)) throw new Error('Invalid quantum output number.');
  return finite(Number(token.replace(/[Dd]/, 'e')));
}
export function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Quantum output values must be finite numbers.');
  return value;
}
export function coordinate(element: string, xyz: number[], scale = 1): MolecularAtom {
  atomicNumber(element);
  if (xyz.length !== 3 || xyz.some(v => !Number.isFinite(v) || Math.abs(v * scale) > 1e6)) throw new Error('Invalid quantum output coordinates.');
  return { element, x: xyz[0] * scale, y: xyz[1] * scale, z: xyz[2] * scale };
}
export function checkIdentity(atoms: MolecularAtom[], reference: MolecularAtom[]) {
  if (atoms.length !== reference.length || atoms.some((a, i) => a.element !== reference[i].element)) throw new Error('Quantum output atom identity changes between frames.');
}
