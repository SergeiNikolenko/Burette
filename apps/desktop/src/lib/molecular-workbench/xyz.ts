import { formatXyz } from '../../../../../scripts/internal-coordinates.mjs';
import type { MolecularAtom } from './types';
import { atomicNumber } from './elements';

const MAX_ATOMS = 100_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/;
export function parseXyz(text: string): { atoms: MolecularAtom[]; title: string } {
  if (text.length > 16 * 1024 * 1024 || text.includes('\0')) throw new Error('XYZ input exceeds 16 MiB or contains binary data.');
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  const count = Number(lines[0]);
  if (!/^\d+$/.test(lines[0]?.trim() ?? '') || !Number.isSafeInteger(count) || count < 1 || count > MAX_ATOMS) throw new Error('Expected 1–100000 atoms.');
  if (lines.length !== count + 2) throw new Error('Expected one complete XYZ frame.');
  const atoms = lines.slice(2).map(line => {
    const [element, ...fields] = line.trim().split(/\s+/);
    atomicNumber(element);
    if (fields.length !== 3 || fields.some(value => !NUMBER.test(value))) throw new Error('Expected element and three numeric XYZ coordinates.');
    const [x, y, z] = fields.map(value => Number(value.replace(/[dD]/, 'e')));
    if (![x, y, z].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) throw new Error('Invalid atomic coordinates.');
    return { element, x, y, z };
  });
  return { atoms, title: lines[1] };
}
export function serializeXyz(atoms: MolecularAtom[], title = ''): string {
  if (!atoms.length || atoms.length > MAX_ATOMS) throw new Error('Expected 1–100000 atoms.');
  for (const atom of atoms) {
    atomicNumber(atom.element);
    if (![atom.x, atom.y, atom.z].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) throw new Error('Invalid atomic coordinates.');
  }
  return formatXyz(atoms.map(({element,x,y,z}) => ({element,position:[x,y,z]})), title.replace(/[\r\n]/g,' '));
}
